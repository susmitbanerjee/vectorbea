import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { FailuresView } from "./failures-view";
import type {
  FailureAgentRow, FailureClassRow, FailureOwnerRow, FailureRollup, FailureWindow,
} from "~/lib/api/failures";

/**
 * The failures roll-up.
 *
 * The stories are the acceptance criteria, made visible: one credential across
 * forty runs is one row; BUDGET never renders as a crash; a workspace whose
 * traces are half-dropped says so before anything else on the page.
 */

const OWNER: Record<string, string> = {
  CONFIG: "Workflow builder",
  INPUT: "Workflow builder",
  ORCHESTRATION: "Workflow builder",
  AUTH: "Workspace admin",
  TOOL_FAILURE: "Integration owner",
  MODEL_BEHAVIOR: "Agent designer",
  BUDGET: "Operator",
  POLICY: "Approver or builder",
  TIMEOUT: "Platform and design",
  INFRA: "Platform",
  UNCLASSIFIED: "Platform",
};

const SUMMARY: Record<string, string> = {
  AUTH: "A credential is missing, expired or lacks the scope the step needs.",
  CONFIG: "The workflow is wired in a way that cannot work.",
  INPUT: "The data reaching a step is not the shape the step requires.",
  TOOL_FAILURE: "An external system returned an error or did not answer.",
  MODEL_BEHAVIOR: "The model did not converge on a usable action.",
  BUDGET: "The run reached a limit it was configured with and stopped.",
  TIMEOUT: "A step or the run exceeded its allotted time.",
  INFRA: "Something inside the platform failed.",
  UNCLASSIFIED: "This run failed and nothing could classify why. That is a gap in the taxonomy, not in the workflow.",
};

const RETRY: Record<string, string> = {
  AUTH: "Not until fixed",
  CONFIG: "No",
  INPUT: "No",
  TOOL_FAILURE: "Sometimes",
  MODEL_BEHAVIOR: "Rarely",
  BUDGET: "Only with a raised limit",
  TIMEOUT: "Sometimes",
  INFRA: "Yes",
  UNCLASSIFIED: "Sometimes",
};

const RUN = "9f2c1b7a-4e5d-4a1f-8c3b-6d2e0a7f5c14";

function classRow(cls: string, count: number, previous: number, total: number): FailureClassRow {
  return {
    class: cls,
    count,
    previousCount: previous,
    changePct: previous === 0 ? null : Math.round(((count - previous) * 100) / previous),
    owner: OWNER[cls] ?? "Unassigned",
    summary: SUMMARY[cls] ?? "No description for this class.",
    retry: RETRY[cls] ?? "Sometimes",
    /* The one class that is not an error. The server sends this; the view never
       infers it from the name. */
    rendersAsError: cls !== "BUDGET",
    shareOfTotal: total === 0 ? 0 : count / total,
  };
}

function ownersOf(rows: FailureClassRow[]): FailureOwnerRow[] {
  const by = new Map<string, FailureOwnerRow>();
  for (const r of rows) {
    const o = by.get(r.owner) ?? { owner: r.owner, count: 0, classes: [] };
    o.count += r.count;
    o.classes.push({ class: r.class, count: r.count });
    by.set(r.owner, o);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

function rollup(p: {
  classes: Array<[string, number, number]>;
  recurring?: FailureRollup["recurring"];
  workflows?: FailureRollup["byWorkflow"];
  agents?: FailureAgentRow[];
  budget?: FailureRollup["budgetPressure"];
  completeness?: Partial<FailureRollup["traceCompleteness"]>;
  window?: FailureWindow;
}): FailureRollup {
  const total = p.classes.reduce((n, [, c]) => n + c, 0);
  const byClass = p.classes
    .map(([cls, count, prev]) => classRow(cls, count, prev, total))
    .sort((a, b) => b.count - a.count);

  const c = {
    runs: 1240, partialRuns: 12, droppedSpans: 340,
    partialShare: 12 / 1240, undermines: false,
    ...p.completeness,
  };

  return {
    workspaceId: "11111111-1111-1111-1111-111111111111",
    window: p.window ?? "7d",
    from: "2026-08-26T00:00:00Z",
    to: "2026-09-02T00:00:00Z",
    totalFailures: total,
    byClass,
    byOwner: ownersOf(byClass),
    byWorkflow: p.workflows ?? [],
    byAgent: p.agents ?? [],
    recurring: p.recurring ?? [],
    budgetPressure: p.budget ?? [],
    traceCompleteness: c,
  };
}

function Frame({
  children, note, initial = "7d",
}: {
  children: React.ReactNode;
  note: string;
  /** Must match the roll-up's own `window`, or the header contradicts the data. */
  initial?: FailureWindow;
}) {
  const [win, setWin] = React.useState<FailureWindow>(initial);
  return (
    <div className="bg-surface-app min-h-screen p-6">
      <Text variant="caption" tone="muted" className="mb-4 block max-w-[76ch]">{note}</Text>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ window: FailureWindow; onWindow: (w: FailureWindow) => void }>,
            { window: win, onWindow: setWin })
        : children}
    </div>
  );
}

const meta: Meta<typeof FailuresView> = {
  title: "App/Failures/Roll-up",
  component: FailuresView,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof FailuresView>;

/** A working week. Several classes, several owners, a real recurring cause. */
export const Typical: Story = {
  render: () => (
    <Frame note="A normal week. The owner cards come first because they are the only grouping anyone can act on directly.">
      <FailuresView
        window="7d"
        onWindow={() => {}}
        data={rollup({
          classes: [
            ["AUTH", 41, 6],
            ["TOOL_FAILURE", 23, 25],
            ["INPUT", 14, 14],
            ["CONFIG", 9, 0],
            ["BUDGET", 7, 11],
            ["MODEL_BEHAVIOR", 5, 3],
            ["INFRA", 2, 8],
            ["UNCLASSIFIED", 1, 0],
          ],
          recurring: [
            {
              class: "AUTH", owner: "Workspace admin",
              stepId: "salesforce.query", stepName: "Look up account", kind: "tool_call",
              count: 40, workflows: 6, sampleRunId: RUN, lastSeen: "2026-09-01T18:04:00Z",
            },
            {
              class: "TOOL_FAILURE", owner: "Integration owner",
              stepId: "billing.invoice", stepName: "Create invoice", kind: "tool_call",
              count: 18, workflows: 1, sampleRunId: RUN, lastSeen: "2026-09-01T09:20:00Z",
            },
            {
              class: "MODEL_BEHAVIOR", owner: "Agent designer",
              stepId: "triage", stepName: "Triage agent", kind: "activation",
              count: 5, workflows: 1, sampleRunId: RUN, lastSeen: "2026-08-31T22:11:00Z",
            },
          ],
          workflows: [
            { workflowId: "w1", workflowName: "Lead enrichment", class: "AUTH", count: 28, sampleRunId: RUN, owner: "Workspace admin" },
            { workflowId: "w2", workflowName: "Invoice reconciliation", class: "TOOL_FAILURE", count: 18, sampleRunId: RUN, owner: "Integration owner" },
            { workflowId: "w3", workflowName: "Support triage", class: "INPUT", count: 11, sampleRunId: RUN, owner: "Workflow builder" },
            { workflowId: "w1", workflowName: "Lead enrichment", class: "CONFIG", count: 9, sampleRunId: RUN, owner: "Workflow builder" },
          ],
          agents: [
            { agentId: "a1", agentName: "Triage agent", class: "MODEL_BEHAVIOR", owner: "Agent designer", count: 12, runs: 5, workflows: 1, sampleRunId: RUN },
            { agentId: "a2", agentName: "Enrichment researcher", class: "BUDGET", owner: "Operator", count: 7, runs: 7, workflows: 2, sampleRunId: RUN },
            { agentId: "a3", agentName: "Invoice matcher", class: "TOOL_FAILURE", owner: "Integration owner", count: 4, runs: 4, workflows: 1, sampleRunId: RUN },
          ],
          budget: [
            { workflowId: "w4", workflowName: "Deep research", runs: 62, nearCeiling: 41, sharePct: 66, peakCents: 96, ceilingCents: 100, sampleRunId: RUN },
            { workflowId: "w5", workflowName: "Weekly digest", runs: 14, nearCeiling: 5, sharePct: 36, peakCents: 44, ceilingCents: 50, sampleRunId: RUN },
          ],
        })}
      />
    </Frame>
  ),
};

/**
 * ACCEPTANCE: one expired credential across forty runs is ONE row.
 *
 * The count is forty. The rows are one. Without the collapse this page is the
 * run list with extra steps.
 */
export const OneCredentialFortyRuns: Story = {
  render: () => (
    <Frame initial="24h" note="Acceptance: forty runs blocked by a single expired credential. One recurring row, count 40, across six workflows.">
      <FailuresView
        window="24h"
        onWindow={() => {}}
        data={rollup({
          window: "24h",
          classes: [["AUTH", 40, 0]],
          recurring: [{
            class: "AUTH", owner: "Workspace admin",
            stepId: "salesforce.query", stepName: "Look up account", kind: "tool_call",
            count: 40, workflows: 6, sampleRunId: RUN, lastSeen: "2026-09-01T18:04:00Z",
          }],
          workflows: [
            { workflowId: "w1", workflowName: "Lead enrichment", class: "AUTH", count: 22, sampleRunId: RUN, owner: "Workspace admin" },
            { workflowId: "w2", workflowName: "Account sync", class: "AUTH", count: 18, sampleRunId: RUN, owner: "Workspace admin" },
          ],
        })}
      />
    </Frame>
  ),
};

/**
 * BUDGET is not a crash.
 *
 * A window where every failure is a ceiling. The page must not turn red: these
 * runs did exactly what they were configured to do.
 */
export const BudgetOnly: Story = {
  render: () => (
    <Frame note="Every failure in the window is a budget ceiling. Nothing renders in the failure hue — a limit that worked is not a fault.">
      <FailuresView
        window="7d"
        onWindow={() => {}}
        data={rollup({
          classes: [["BUDGET", 18, 4]],
          budget: [
            { workflowId: "w4", workflowName: "Deep research", runs: 62, nearCeiling: 55, sharePct: 89, peakCents: 99, ceilingCents: 100, sampleRunId: RUN },
          ],
          agents: [
            { agentId: "a2", agentName: "Enrichment researcher", class: "BUDGET", owner: "Operator", count: 18, runs: 18, workflows: 2, sampleRunId: RUN },
          ],
        })}
      />
    </Frame>
  ),
};

/**
 * ACCEPTANCE (item 7): completeness undermines the page, so it says so FIRST.
 */
export const TracesIncomplete: Story = {
  render: () => (
    <Frame note="A third of runs dropped spans. The banner is above everything because every number below is attributed from spans that survived.">
      <FailuresView
        window="7d"
        onWindow={() => {}}
        data={rollup({
          classes: [["INFRA", 22, 3], ["UNCLASSIFIED", 19, 1], ["TOOL_FAILURE", 6, 5]],
          completeness: { runs: 900, partialRuns: 301, droppedSpans: 41_200, partialShare: 301 / 900, undermines: true },
        })}
      />
    </Frame>
  ),
};

/** Nothing failed. Every section says what its own emptiness means. */
export const Quiet: Story = {
  render: () => (
    <Frame initial="24h" note="A clean window. Each section states what empty means for it rather than sharing one generic message.">
      <FailuresView
        window="24h"
        onWindow={() => {}}
        data={rollup({
          window: "24h",
          classes: [],
          completeness: { runs: 310, partialRuns: 0, droppedSpans: 0, partialShare: 0, undermines: false },
        })}
      />
    </Frame>
  ),
};
