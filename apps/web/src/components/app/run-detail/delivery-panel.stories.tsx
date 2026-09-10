import type { Meta, StoryObj } from "@storybook/nextjs";
import type { contracts } from "@vectorbea/shared";
import { DeliveryPanel } from "./delivery-panel";

/**
 * Whether the result got where it was going.
 *
 * The state that matters is `dead`: a run whose own badge says succeeded, with
 * a panel saying the customer never received it. Those two disagreeing is the
 * point — they are different facts, and a UI that showed only one of them is
 * how results silently vanish.
 */
const meta = {
  title: "App/Run detail/Delivery panel",
  component: DeliveryPanel,
  parameters: { layout: "padded" },
  args: { onRedeliver: async () => {} },
} satisfies Meta<typeof DeliveryPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Real `now`, not a frozen one.
 *
 * The countdown fields ("Next try in 4m") are computed against the wall clock,
 * so a pinned timestamp makes every retrying story read "any moment" — which
 * hides the one thing those stories exist to show. Timings are relative offsets
 * for that reason; the trade is that these particular stories are not
 * pixel-stable for a snapshot.
 */
const NOW = Date.now();

function delivery(
  p: Partial<contracts.RunDelivery> & { id: string },
): contracts.RunDelivery {
  return {
    id: p.id,
    runId: "22222222-2222-4222-8222-222222222222",
    targetId: "33333333-3333-4333-8333-333333333333",
    targetName: p.targetName ?? "Ops callback",
    idempotencyKey: p.idempotencyKey ?? "dlv_9f2c41ab7d3e5061c8b4",
    status: p.status ?? "delivered",
    partial: p.partial ?? false,
    sequence: p.sequence ?? 0,
    attempts: p.attempts ?? 1,
    maxAttempts: p.maxAttempts ?? 8,
    nextAttemptAt: "nextAttemptAt" in p ? p.nextAttemptAt ?? null : null,
    payloadMode: "payloadMode" in p ? p.payloadMode ?? null : "full",
    payloadBytes: "payloadBytes" in p ? p.payloadBytes ?? null : 2_048,
    payloadUrl: p.payloadUrl ?? null,
    lastError: "lastError" in p ? p.lastError ?? null : null,
    deliveredAt: "deliveredAt" in p ? p.deliveredAt ?? null
      : new Date(NOW - 4_000).toISOString(),
    createdAt: new Date(NOW - 10_000).toISOString(),
    redeliverable: p.redeliverable ?? false,
  };
}

/** The ordinary case. Quiet, because there is nothing to act on. */
export const Delivered: Story = {
  args: {
    deliveries: [delivery({ id: "d1", redeliverable: true })],
  },
};

/**
 * The state this whole feature exists for.
 *
 * The run succeeded. The customer did not get the result. The panel takes the
 * failure ramp on a page whose status badge is green, deliberately.
 */
export const NotDelivered: Story = {
  args: {
    deliveries: [
      delivery({
        id: "d2",
        status: "dead",
        attempts: 8,
        deliveredAt: null,
        redeliverable: true,
        /* Null, because `payload_mode_used` is written by `markDelivered` and
           nowhere else. A delivery that never landed cannot report a shape. */
        payloadMode: null,
        payloadBytes: null,
        lastError:
          "The receiver returned HTTP 500. Gave up after 8 attempts over about 2h.",
      }),
    ],
  },
};

/** Still trying. The waiting ramp, not the failure one — it has not failed yet. */
export const Retrying: Story = {
  args: {
    deliveries: [
      delivery({
        id: "d3",
        status: "retrying",
        attempts: 3,
        deliveredAt: null,
        payloadMode: null,
        payloadBytes: null,
        nextAttemptAt: new Date(NOW + 240_000).toISOString(),
        lastError: "The receiver returned HTTP 503.",
      }),
    ],
  },
};

/**
 * A result too large to send inline.
 *
 * The panel says which shape was used, because a receiver that got a link where
 * it expected a body needs to know it was a size decision.
 */
export const SentAsLink: Story = {
  args: {
    deliveries: [
      delivery({
        id: "d4",
        targetName: "S3 archive",
        payloadMode: "url",
        payloadBytes: 8_400_000,
        payloadUrl: "https://api.vectorbea.com/api/delivery-payloads/dpl_abc123",
        redeliverable: true,
      }),
    ],
  },
};

/**
 * Some landed, some did not.
 *
 * From the customer's side this run did not deliver, and the panel says which
 * target is the problem rather than making them open each one.
 */
export const Partial: Story = {
  args: {
    deliveries: [
      delivery({ id: "d5", targetName: "S3 archive", redeliverable: true }),
      delivery({
        id: "d6",
        targetName: "Ops callback",
        status: "dead",
        attempts: 8,
        deliveredAt: null,
        redeliverable: true,
        payloadMode: null,
        payloadBytes: null,
        lastError:
          "The receiver rejected this delivery with HTTP 400. That is a permanent " +
          "answer, so no further attempts will be made — check the payload against " +
          "what the endpoint accepts.",
      }),
      delivery({
        id: "d7",
        targetName: "Slack #ops",
        status: "retrying",
        attempts: 2,
        deliveredAt: null,
        payloadMode: null,
        payloadBytes: null,
        nextAttemptAt: new Date(NOW + 90_000).toISOString(),
        lastError: "Could not reach the endpoint: connection refused",
      }),
    ],
  },
};

/**
 * A streamed pipeline.
 *
 * Sequence 0 is the final result; the partials are what let somebody start on
 * the first half of a six-hour job.
 */
export const Streaming: Story = {
  args: {
    deliveries: [
      delivery({ id: "d8", partial: true, sequence: 1, targetName: "Ops callback" }),
      delivery({ id: "d9", partial: true, sequence: 2, targetName: "Ops callback" }),
      delivery({
        id: "d10",
        partial: true,
        sequence: 3,
        status: "retrying",
        attempts: 1,
        deliveredAt: null,
        payloadMode: null,
        payloadBytes: null,
        nextAttemptAt: new Date(NOW + 15_000).toISOString(),
        lastError: "The receiver returned HTTP 502.",
        targetName: "Ops callback",
      }),
    ],
  },
};

/**
 * A target that deliberately did not fire.
 *
 * Recorded rather than omitted: "why did my Slack message not arrive" needs an
 * answer, and the honest one is often "because you configured it for successes".
 */
export const NotSent: Story = {
  args: {
    deliveries: [
      delivery({
        id: "d11",
        targetName: "Slack #ops",
        status: "skipped",
        attempts: 0,
        deliveredAt: null,
        payloadMode: null,
        payloadBytes: null,
        lastError:
          "The run ended as 'failed', which this target does not deliver on (succeeded, completed).",
      }),
    ],
  },
};
