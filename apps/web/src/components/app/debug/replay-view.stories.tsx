import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { ReplayView } from "./replay-view";
import type { ReplayAttempt, ReplayOption, ReplayOptions } from "~/lib/api/constellation";

/**
 * Replay and time travel.
 *
 * The rule the whole surface is built around: a user must never be unsure
 * whether an action will email a customer.
 */

const SAFE: ReplayOption = {
  id: "replay_run",
  label: "Replay this run",
  sideEffects: "NONE",
  effectSummary:
    "Re-executes the whole run against the recorded provider responses. No model " +
    "is called, no tool runs, nothing leaves this system.",
  available: true,
  reason: null,
};

const fromIteration = (available: boolean, reason: string | null): ReplayOption => ({
  id: "replay_from_iteration",
  label: "Replay from an iteration",
  sideEffects: "LIVE_FROM_POINT",
  effectSummary:
    "Restores the agent's state up to the iteration you pick, then runs LIVE from " +
    "there — real model calls and real tool calls, which can have real effects. " +
    "Iterations 1 to 4 can be restored.",
  available,
  reason,
});

const withEdit = (available: boolean, reason: string | null): ReplayOption => ({
  id: "replay_with_edit",
  label: "Replay with an edit",
  sideEffects: "LIVE_FROM_POINT",
  effectSummary:
    "Change a recorded tool result, then run live from that iteration. You see the " +
    "edit next to the original before anything runs.",
  available,
  reason,
});

const REAL: ReplayOption = {
  id: "retry_from_step",
  label: "Retry from a step",
  sideEffects: "REAL",
  effectSummary:
    "Runs the workflow again from the step you pick, for real. Every tool call " +
    "happens, including anything that sends mail, charges a card or writes to " +
    "another system.",
  available: true,
  reason: null,
};

function options(p: Partial<ReplayOptions> & { options: ReplayOption[] }): ReplayOptions {
  return {
    runId: "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13",
    status: p.status ?? "failed",
    highestIteration: p.highestIteration ?? 5,
    options: p.options,
  };
}

function Frame({ title, note, data, history }: {
  title: string; note: string; data: ReplayOptions; history?: ReplayAttempt[];
}) {
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      <Text variant="caption" tone="secondary" className="mb-3 mt-1 block max-w-[80ch]">{note}</Text>
      <ReplayView options={data} history={history ?? []} onRun={() => {}} onOpenRun={() => {}} />
    </section>
  );
}

const meta: Meta = { title: "App/Debug/Replay", parameters: { layout: "padded" } };
export default meta;

/** All four, each carrying its profile before anything is clicked. */
export const AllFour: StoryObj = {
  name: "Four actions, four profiles",
  render: () => (
    <Frame
      title="Every action says what it will do in the world"
      note="The profile is on the CARD, not behind the confirmation: the decision to click
            is the decision that matters, and a confirmation that first tells you the
            consequence has already let you commit to finding out. Ordered safest first,
            so the one with real effects is met last rather than in the middle."
      data={options({
        options: [SAFE, fromIteration(true, null), withEdit(true, null), REAL],
      })}
    />
  ),
};

/** ACCEPTANCE: no reconstruction data disables the action and names the reason. */
export const NoReconstruction: StoryObj = {
  name: "Disabled, with the reason",
  render: () => {
    const why =
      "The recorded iterations have a gap (1, 2, 4), so restoring them would leave " +
      "the agent with an incomplete account of what it had already done.";
    return (
      <Frame
        title="Replay from an iteration is not available here"
        note="A greyed control with no reason sends somebody looking for a setting that does
              not exist. And the alternative is worse than useless: 'replay from iteration 4'
              that quietly replays from 1 leaves the reader believing three iterations were
              restored while the run makes three live model calls."
        data={options({
          highestIteration: null,
          options: [SAFE, fromIteration(false, why), withEdit(false, why), REAL],
        })}
      />
    );
  },
};

/** A run that cannot be retried at all. */
export const NotRetryable: StoryObj = {
  name: "A running run",
  render: () => (
    <Frame
      title="Still running"
      note="The safest action survives every blocker — a recorded replay of a run in flight
            is still a recorded replay. The real retry names the status that blocks it."
      data={options({
        status: "running",
        options: [
          SAFE,
          fromIteration(true, null),
          withEdit(true, null),
          { ...REAL, available: false,
            reason: "A run with status 'running' cannot be retried." },
        ],
      })}
    />
  ),
};

/** Three attempts at a fix, comparable. */
export const History: StoryObj = {
  name: "Replay history",
  render: () => (
    <Frame
      title="Three attempts at a fix"
      note="The original is in the list too, marked — a history showing only the replays
            would omit the one run that actually happened. Every replay is badged 'not
            counted', because a reader comparing four rows otherwise has no way to tell
            which one the workspace's numbers are about."
      data={options({ options: [SAFE, fromIteration(true, null), withEdit(true, null), REAL] })}
      history={[
        { runId: "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13", status: "failed",
          createdAt: "2026-08-31T10:00:00Z", completedAt: "2026-08-31T10:04:12Z",
          sourceRunId: null, replayUntilNode: null, isReplay: false, isThisRun: true },
        { runId: "aa11bb22-cc33-4d44-9e55-6f77aa88bb99", status: "failed",
          createdAt: "2026-08-31T10:20:00Z", completedAt: "2026-08-31T10:23:40Z",
          sourceRunId: "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13", replayUntilNode: null,
          isReplay: true, isThisRun: false },
        { runId: "bb22cc33-dd44-4e55-9f66-7a88bb99cc00", status: "succeeded",
          createdAt: "2026-08-31T10:41:00Z", completedAt: "2026-08-31T10:43:02Z",
          sourceRunId: "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13", replayUntilNode: null,
          isReplay: true, isThisRun: false },
      ]}
    />
  ),
};
