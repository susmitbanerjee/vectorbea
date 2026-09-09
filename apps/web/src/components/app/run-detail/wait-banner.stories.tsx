import type { Meta, StoryObj } from "@storybook/nextjs";
import type { contracts } from "@vectorbea/shared";
import { WaitBanner } from "./wait-banner";

/**
 * What a run is parked on.
 *
 * The states worth looking at are the ones that are easy to get wrong, and all
 * four are here: a healthy long wait, a wait with no deadline (the parked-
 * forever risk, which must not read as normal), a wait already past its deadline
 * but not yet swept, and several at once from a fan-out.
 */
const meta = {
  title: "App/Run detail/Wait banner",
  component: WaitBanner,
  parameters: { layout: "padded" },
} satisfies Meta<typeof WaitBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

const NOW = new Date("2026-08-11T14:20:00Z").getTime();

function wait(p: Partial<contracts.RunWait> & { waitId: string }): contracts.RunWait {
  const waitingMs = p.waitingMs ?? 6 * 60_000;
  /*
   * `in`, not `??`, for the two nullable fields the stories set deliberately.
   * An explicit null means "this kind has no provider handle" and "this wait has
   * no deadline"; coalescing either back to its default put a job id on an
   * approval and a deadline on the no-deadline story — which is precisely the
   * state the story exists to show.
   */
  const expiresInMs = "expiresInMs" in p ? p.expiresInMs ?? null : 4 * 60_000;
  return {
    waitId: p.waitId,
    kind: p.kind ?? "async_tool",
    label: "label" in p ? p.label ?? null : "waiting for render_video to finish",
    nodeId: p.nodeId ?? "render_video",
    signalName: p.signalName ?? null,
    externalRef: "externalRef" in p ? p.externalRef ?? null : "job_9f2c41ab",
    createdAt: new Date(NOW - waitingMs).toISOString(),
    timeoutAt: expiresInMs == null ? null : new Date(NOW + expiresInMs).toISOString(),
    waitingMs,
    expiresInMs,
    pollAttempts: p.pollAttempts ?? 3,
  };
}

/** The case the primitive was built for, at the moment somebody checks on it. */
export const AsyncTool: Story = {
  args: { waits: [wait({ waitId: "00000000-0000-4000-8000-0000000aa001" })] },
};

/**
 * No deadline.
 *
 * The failure mode the timeout exists to prevent, so the field says so in words
 * rather than leaving a blank that reads as "fine".
 */
export const NoDeadline: Story = {
  args: {
    waits: [
      wait({
        waitId: "00000000-0000-4000-8000-0000000aa002",
        label: "waiting for the vendor to call back",
        expiresInMs: null,
        pollAttempts: 0,
      }),
    ],
  },
};

/** Past the deadline, before the sweeper has run. Overdue is a real state. */
export const Overdue: Story = {
  args: {
    waits: [
      wait({
        waitId: "00000000-0000-4000-8000-0000000aa003",
        waitingMs: 61 * 60_000,
        expiresInMs: -90_000,
      }),
    ],
  },
};

/** A signal wait names the signal that will resolve it — otherwise the operator
    cannot send the thing that unblocks the run. */
export const AwaitingSignal: Story = {
  args: {
    waits: [
      wait({
        waitId: "00000000-0000-4000-8000-0000000aa004",
        kind: "signal",
        label: "waiting for a second alert on this service",
        nodeId: "triage",
        signalName: "new_alert",
        externalRef: null,
        waitingMs: 45_000,
        expiresInMs: 30 * 60_000,
        pollAttempts: 0,
      }),
    ],
  },
};

/** A fan-out with three branches parked. The heading counts them. */
export const SeveralAtOnce: Story = {
  args: {
    waits: [
      wait({ waitId: "00000000-0000-4000-8000-0000000aa005", nodeId: "render_intro" }),
      wait({
        waitId: "00000000-0000-4000-8000-0000000aa006",
        nodeId: "render_body",
        waitingMs: 2 * 60_000,
        expiresInMs: 8 * 60_000,
        pollAttempts: 1,
      }),
      wait({
        waitId: "00000000-0000-4000-8000-0000000aa007",
        kind: "approval",
        label: "waiting for a person to approve the publish",
        nodeId: "publish",
        externalRef: null,
        waitingMs: 22 * 60_000,
        expiresInMs: 3 * 60 * 60_000,
        pollAttempts: 0,
      }),
    ],
  },
};

/**
 * A kind this build has never heard of.
 *
 * Worker and web deploy separately, so this is routine rather than exceptional.
 * The row still renders, with the wire name in place of the friendly noun.
 */
export const UnknownKind: Story = {
  args: {
    waits: [
      wait({
        waitId: "00000000-0000-4000-8000-0000000aa008",
        kind: "human_task",
        label: null,
        externalRef: "task_771",
      }),
    ],
  },
};
