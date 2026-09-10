import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifying that a delivery came from Vectorbea.
 *
 * ── WHY THIS IS IN THE SDK AND NOT JUST IN THE DOCS ─────────────────────────
 * Every receiver has to write this, and the three ways to get it wrong are all
 * silent:
 *
 *   1. Comparing with `===`, which returns at the first differing byte. Over
 *      enough requests that timing difference recovers a signature. The endpoint
 *      is unauthenticated by definition, so there is no rate limit protecting it
 *      other than the receiver's own.
 *   2. Signing the parsed body instead of the raw one. `JSON.parse` then
 *      `JSON.stringify` reorders keys and drops whitespace, so the digest
 *      changes and every delivery fails — which reads as "wrong secret" and
 *      sends somebody rotating credentials that were fine.
 *   3. Skipping the timestamp check, which leaves a captured delivery replayable
 *      forever by anyone who ever saw one.
 *
 * A correct implementation is thirty lines. Nobody should write it twice.
 */

/** How Vectorbea signs. Mirrors `DeliverySigner` in the runtime. */
export const DELIVERY_SIGNATURE_HEADER = "vectorbea-signature";
export const DELIVERY_IDEMPOTENCY_HEADER = "vectorbea-idempotency-key";
export const DELIVERY_ID_HEADER = "vectorbea-delivery-id";
export const DELIVERY_ATTEMPT_HEADER = "vectorbea-attempt";

/** The envelope every delivery carries. */
export interface DeliveryPayload {
  deliveryId: string;
  idempotencyKey: string;
  runId: string;
  workflowId: string | null;
  workspaceId: string;
  status: string;
  triggerType: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** True for a streamed partial; the final result has `false`. */
  partial: boolean;
  /** 0 for the final result; 1..n for partials, in order. */
  sequence: number;
  /** Which node produced a partial. Absent on the final delivery. */
  nodeId?: string;
  /**
   * Which shape this delivery took.
   *
   * Present on EVERY delivery, including the ordinary case — a field that only
   * appears when something unusual happened is a field nobody handles.
   */
  payloadMode: "full" | "url";
  /** Present when `payloadMode` is `"full"`. */
  output?: unknown;
  /** Present when `payloadMode` is `"url"` — fetch it, it expires. */
  outputUrl?: string;
  outputUrlExpiresAt?: string;
  outputBytes?: number;
  error?: unknown;
}

export interface VerifyOptions {
  /**
   * How old a delivery may be, in seconds. Default 300.
   *
   * Zero disables the check, which is only correct if something else in front
   * of the endpoint prevents replays. It is not the default for that reason.
   */
  toleranceSeconds?: number;
  /** Injectable so a test can pin the clock. */
  now?: Date;
}

export class DeliverySignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliverySignatureError";
  }
}

/**
 * Verify a delivery and return its payload.
 *
 * @param rawBody the body EXACTLY as received. In Express that means
 *   `express.raw({ type: "application/json" })` — `express.json()` has already
 *   parsed and discarded the bytes by the time your handler runs, and
 *   re-stringifying them produces a different digest.
 *
 * @example Express
 * ```ts
 * import express from "express";
 * import { verifyDelivery } from "@vectorbea-ai/node";
 *
 * const app = express();
 *
 * app.post(
 *   "/vectorbea",
 *   // raw, not json — the signature is over these exact bytes
 *   express.raw({ type: "application/json" }),
 *   (req, res) => {
 *     let delivery;
 *     try {
 *       delivery = verifyDelivery(
 *         req.body,                       // Buffer
 *         req.headers,
 *         process.env.VECTORBEA_SIGNING_SECRET!,
 *       );
 *     } catch (err) {
 *       // 401 and stop. Do NOT process an unverified delivery.
 *       return res.status(401).json({ error: "bad signature" });
 *     }
 *
 *     // Deduplicate. Vectorbea retries with backoff and an operator can
 *     // redeliver by hand — every copy carries the SAME idempotency key, so
 *     // storing it is all you need.
 *     if (await alreadySeen(delivery.idempotencyKey)) {
 *       return res.status(200).json({ ok: true, duplicate: true });
 *     }
 *     await remember(delivery.idempotencyKey);
 *
 *     const output = delivery.payloadMode === "url"
 *       ? await fetch(delivery.outputUrl!).then((r) => r.json())
 *       : delivery.output;
 *
 *     await handleResult(delivery.runId, output);
 *
 *     // 2xx means "received". Anything else is retried: 4xx stops after this
 *     // attempt, 5xx and 429 back off and try again.
 *     res.status(200).json({ ok: true });
 *   },
 * );
 * ```
 */
export function verifyDelivery(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  options: VerifyOptions = {},
): DeliveryPayload {
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const header = headerValue(headers, DELIVERY_SIGNATURE_HEADER);

  if (!header) {
    throw new DeliverySignatureError(
      `The ${DELIVERY_SIGNATURE_HEADER} header is missing. Either the delivery did not ` +
        `come from Vectorbea, or the target was configured without a signing secret.`,
    );
  }
  if (!secret) {
    throw new DeliverySignatureError(
      "No signing secret was supplied, so nothing can be verified.",
    );
  }

  // `t=<unix>,v1=<hex>[,v1=<hex>…]`
  const parts = header.split(",").reduce<Record<string, string[]>>((acc, chunk) => {
    const [key, value] = chunk.trim().split("=", 2);
    if (key && value) (acc[key] ??= []).push(value);
    return acc;
  }, {});

  const timestamp = Number(parts.t?.[0]);
  if (!Number.isFinite(timestamp)) {
    throw new DeliverySignatureError("The signature header carries no timestamp.");
  }

  const tolerance = options.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
    // Both directions. A timestamp far in the FUTURE is what a replayer produces
    // after guessing at clock skew, and allowing it gives an unbounded window.
    if (Math.abs(now - timestamp) > tolerance) {
      throw new DeliverySignatureError(
        `This delivery is ${Math.abs(now - timestamp)}s old, outside the ${tolerance}s ` +
          `window. It is either a replay or your clock is wrong.`,
      );
    }
  }

  // The timestamp is INSIDE the signed material, which is what makes the check
  // above meaningful: a forged `t` invalidates the signature.
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  // Several `v1=` during a secret rotation — accept whichever matches, so a
  // rotation does not drop deliveries for the length of the rollout.
  const candidates = parts.v1 ?? [];
  if (!candidates.some((candidate) => constantTimeEquals(candidate, expected))) {
    throw new DeliverySignatureError(
      "The signature does not match. Check that the secret is the one configured on " +
        "the delivery target, and that you are verifying the RAW request body.",
    );
  }

  return JSON.parse(body) as DeliveryPayload;
}

/**
 * The idempotency key for a delivery, without verifying it.
 *
 * For a receiver that terminates signatures at a gateway and only needs the
 * dedupe key in the handler. Verify somewhere, though: this reads a header an
 * unauthenticated caller controls.
 */
export function deliveryIdempotencyKey(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  return headerValue(headers, DELIVERY_IDEMPOTENCY_HEADER);
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  // Node lowercases incoming header names; other frameworks do not always.
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const found =
    direct ??
    Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
  if (Array.isArray(found)) return found[0] ?? null;
  return found ?? null;
}

/**
 * Compare without leaking where the difference is.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself be a length
 * oracle — so both sides are hashed to a fixed width first. Hex digests are
 * already the same length in practice; this holds when they are not.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}
