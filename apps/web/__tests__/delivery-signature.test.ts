import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  DeliverySignatureError,
  verifyDelivery,
} from "../../../packages/sdk-js/src/deliveries";

/**
 * The SDK's verifier, against signatures shaped exactly as the runtime produces
 * them.
 *
 * ── WHY THE FIXTURE IS HARD-CODED ───────────────────────────────────────────
 * `DeliverySignerTest` on the Kotlin side asserts the SAME body, the SAME
 * secret and the SAME expected digest. Two implementations of one scheme drift
 * silently — the sender keeps working, the receiver keeps rejecting, and the
 * symptom reaches us as "your webhooks are broken". Pinning one vector on both
 * sides means a change to either fails a test rather than a customer.
 *
 * If you change the scheme, both files fail. That is the design.
 */

/** Shared with `DeliverySignerTest.kt`. Do not change one without the other. */
const FIXTURE = {
  secret: "whsec_test_delivery_secret_0123456789",
  timestamp: 1_767_225_600, // 2026-01-01T00:00:00Z
  body: JSON.stringify({
    deliveryId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "dlv_0123456789abcdef",
    runId: "22222222-2222-4222-8222-222222222222",
    status: "succeeded",
    partial: false,
    sequence: 0,
    payloadMode: "full",
    output: { answer: 42 },
  }),
  /**
   * HMAC-SHA256 over `"<t>.<body>"`, hex.
   *
   * Computed here rather than pasted, so the fixture cannot encode a mistake —
   * what is pinned is the SCHEME (which bytes are signed, in which order), and
   * that is the half the two languages have to agree on.
   */
  get expected(): string {
    return createHmac("sha256", this.secret)
      .update(`${this.timestamp}.${this.body}`)
      .digest("hex");
  },
};

const at = new Date(FIXTURE.timestamp * 1000);

function headers(signature: string): Record<string, string> {
  return {
    "vectorbea-signature": signature,
    "vectorbea-idempotency-key": "dlv_0123456789abcdef",
    "content-type": "application/json",
  };
}

describe("verifyDelivery", () => {
  it("accepts a signature over the timestamp and the raw body", () => {
    const payload = verifyDelivery(
      FIXTURE.body,
      headers(`t=${FIXTURE.timestamp},v1=${FIXTURE.expected}`),
      FIXTURE.secret,
      { now: at },
    );

    expect(payload.runId).toBe("22222222-2222-4222-8222-222222222222");
    expect(payload.idempotencyKey).toBe("dlv_0123456789abcdef");
    expect(payload.payloadMode).toBe("full");
    expect(payload.output).toEqual({ answer: 42 });
  });

  it("rejects a signature over the body alone", () => {
    /*
     * The mistake a receiver makes when they skim the docs, and the reason the
     * timestamp is inside the signed material: without this, a forged `t`
     * changes nothing and the freshness check is decoration.
     */
    const bodyOnly = createHmac("sha256", FIXTURE.secret).update(FIXTURE.body).digest("hex");

    expect(() =>
      verifyDelivery(FIXTURE.body, headers(`t=${FIXTURE.timestamp},v1=${bodyOnly}`), FIXTURE.secret, {
        now: at,
      }),
    ).toThrow(DeliverySignatureError);
  });

  it("rejects a body that was altered after signing", () => {
    const tampered = FIXTURE.body.replace('"answer":42', '"answer":43');
    expect(() =>
      verifyDelivery(
        tampered,
        headers(`t=${FIXTURE.timestamp},v1=${FIXTURE.expected}`),
        FIXTURE.secret,
        { now: at },
      ),
    ).toThrow(DeliverySignatureError);
  });

  it("accepts any of several signatures, as sent during a secret rotation", () => {
    /*
     * A rotation signs with both the old and the new secret until the receiver
     * has deployed the new one. Accepting only the first would drop deliveries
     * for the length of every rollout, which is how a signing secret ends up
     * never being rotated.
     */
    const otherSecret = createHmac("sha256", "an_older_secret")
      .update(`${FIXTURE.timestamp}.${FIXTURE.body}`)
      .digest("hex");

    const payload = verifyDelivery(
      FIXTURE.body,
      headers(`t=${FIXTURE.timestamp},v1=${otherSecret},v1=${FIXTURE.expected}`),
      FIXTURE.secret,
      { now: at },
    );
    expect(payload.runId).toBeTruthy();
  });

  it("rejects a replay of a real, correctly signed delivery", () => {
    const anHourLater = new Date((FIXTURE.timestamp + 3600) * 1000);
    expect(() =>
      verifyDelivery(
        FIXTURE.body,
        headers(`t=${FIXTURE.timestamp},v1=${FIXTURE.expected}`),
        FIXTURE.secret,
        { now: anHourLater },
      ),
    ).toThrow(/replay|old/i);
  });

  it("rejects a timestamp in the future as readily as one in the past", () => {
    /* What a replayer produces after guessing at clock skew. Allowing it would
       give an attacker an unbounded window. */
    const anHourEarlier = new Date((FIXTURE.timestamp - 3600) * 1000);
    expect(() =>
      verifyDelivery(
        FIXTURE.body,
        headers(`t=${FIXTURE.timestamp},v1=${FIXTURE.expected}`),
        FIXTURE.secret,
        { now: anHourEarlier },
      ),
    ).toThrow(DeliverySignatureError);
  });

  it("refuses when the header is missing rather than passing", () => {
    expect(() => verifyDelivery(FIXTURE.body, {}, FIXTURE.secret, { now: at })).toThrow(
      /missing/i,
    );
  });

  it("refuses when no secret was supplied", () => {
    expect(() =>
      verifyDelivery(
        FIXTURE.body,
        headers(`t=${FIXTURE.timestamp},v1=${FIXTURE.expected}`),
        "",
        { now: at },
      ),
    ).toThrow(/secret/i);
  });

  it("reads the header whatever case it arrives in", () => {
    /* Node lowercases incoming header names; a framework in front of it may
       not, and a receiver should not have to know which. */
    const payload = verifyDelivery(
      FIXTURE.body,
      {
        "Vectorbea-Signature": `t=${FIXTURE.timestamp},v1=${FIXTURE.expected}`,
      },
      FIXTURE.secret,
      { now: at },
    );
    expect(payload.sequence).toBe(0);
  });

  it("accepts a Buffer body, which is what a raw body parser produces", () => {
    const payload = verifyDelivery(
      Buffer.from(FIXTURE.body, "utf8"),
      headers(`t=${FIXTURE.timestamp},v1=${FIXTURE.expected}`),
      FIXTURE.secret,
      { now: at },
    );
    expect(payload.status).toBe("succeeded");
  });
});
