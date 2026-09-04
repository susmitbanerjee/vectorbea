import type { Meta, StoryObj } from "@storybook/nextjs";
import { ActivityView } from "./activity-view";
import type { ActivationDetail, Iteration, TraceApi } from "~/lib/api/trace";

/**
 * The Activity view.
 *
 * The four things worth looking at here, none of which shows in a screenshot of
 * a healthy run: a step reads as a sentence, a long stretch of successful steps
 * folds, a failure inside that stretch does not, and a run that succeeded in far
 * more steps than usual still says so.
 */

let seq = 0;
function iter(p: Partial<Iteration> = {}): Iteration {
  seq += 1;
  const n = p.number ?? seq;
  return {
    id: `i${n}`,
    number: n,
    status: "completed",
    actionType: "CALL_TOOL",
    thought: null,
    observation: null,
    observationSuccess: true,
    startedAt: new Date(Date.parse("2026-08-31T10:00:00Z") + n * 2_000).toISOString(),
    completedAt: new Date(Date.parse("2026-08-31T10:00:01Z") + n * 2_000).toISOString(),
    durationMs: 1_200,
    tokensDelta: 480,
    costDeltaCents: 1.25,
    actionJson: null,
    actionRepaired: false,
    selectedToolId: null,
    toolName: null,
    toolResultCached: null,
    recalled: false,
    context: null,
    llmCall: {
      spanId: `llm-${n}`, name: "gpt-4o-mini", status: "ok", durationMs: 900,
      hasInput: true, hasOutput: true, inputBytes: 12_400, outputBytes: 840,
      tokensIn: 3_100, tokensOut: 210,
    },
    toolCall: null,
    ...p,
  };
}

function activation(p: Partial<ActivationDetail>): ActivationDetail {
  return {
    id: "a1",
    stepId: "n-agent-1",
    agentId: "ag-1",
    agentName: "Support triage",
    status: "succeeded",
    stopReason: null,
    budgets: [
      { dimension: "iterations", used: 4, limit: 25 },
      { dimension: "tokens", used: 18_450, limit: 24_000 },
    ],
    replayedFrom: null,
    baseline: null,
    iterations: [],
    ...p,
  };
}

function stubApi(activations: ActivationDetail[]): TraceApi {
  return {
    iterations: async () => ({ runId: "r", activations }),
  } as unknown as TraceApi;
}

function view(activations: ActivationDetail[]) {
  return (
    <ActivityView
      api={stubApi(activations)}
      runId="r"
      selectedNodeId={null}
      selectedSpanId={null}
      onSelectSpan={() => {}}
    />
  );
}

const meta: Meta = { title: "App/Debug/Activity", parameters: { layout: "padded" } };
export default meta;

/** The case the view exists for: an operations lead reading what happened. */
export const Narrative: StoryObj = {
  render: () =>
    view([
      activation({
        iterations: [
          iter({ number: 1, actionType: "THINK", thought: "Read the ticket and worked out which account it belongs to." }),
          iter({
            number: 2, toolName: "Salesforce account lookup",
            thought: "Looked up account A-8891 in Salesforce.",
            observation: "Returned 1 result.",
          }),
          iter({
            number: 3, toolName: "Ticket search",
            thought: "Searched for related tickets on the same account.",
            observation: "Returned no results.",
          }),
          iter({ number: 4, actionType: "FINAL", thought: "Replied to the customer with the renewal date." }),
        ],
      }),
    ]),
};

/** A failure keeps its own row, in full, with the fix in the sentence. */
export const WithFailure: StoryObj = {
  render: () =>
    view([
      activation({
        status: "failed",
        iterations: [
          iter({ number: 1, actionType: "THINK", thought: "Worked out which account the ticket belongs to." }),
          iter({
            number: 2, toolName: "Salesforce account lookup",
            thought: "Looked up account A-8891 in Salesforce.",
            observationSuccess: false,
            observation:
              "Salesforce rejected the credentials. Retrying will NOT help. To fix: reconnect the Salesforce account in Connections.",
          }),
          iter({ number: 3, actionType: "FAIL", thought: "Stopped — the account could not be read." }),
        ],
      }),
    ]),
};

/**
 * Forty steps, folded — with the two that failed still in plain sight.
 *
 * This is the acceptance criterion rendered: under ten rows, every failure
 * visible without expanding anything.
 */
export const LongActivation: StoryObj = {
  render: () => {
    const iterations = Array.from({ length: 40 }, (_, i) =>
      iter({ number: i + 1, toolName: "Ticket search", thought: `Checked page ${i + 1} of the results.` }));
    iterations[7] = iter({
      number: 8, toolName: "Salesforce account lookup", observationSuccess: false,
      thought: "Tried to read the account.",
      observation: "Could not reach Salesforce — the connection timed out. Retrying may help.",
    });
    iterations[29] = iter({
      number: 30, toolName: "Ticket search", actionRepaired: true,
      observation: "The model's reply could not be read as an action.",
    });
    return view([activation({ iterations, baseline: { typicalSteps: 3, sampleRuns: 18 } })]);
  },
};

/** A SUCCESSFUL run that cost four times what it should have. */
export const MoreStepsThanUsual: StoryObj = {
  render: () =>
    view([
      activation({
        baseline: { typicalSteps: 3, sampleRuns: 18 },
        iterations: Array.from({ length: 14 }, (_, i) =>
          iter({ number: i + 1, toolName: "Ticket search", thought: `Looked for the order under reference ${i + 1}.` })),
      }),
    ]),
};

/** Resumed: the restored steps say so, and never fold in with the executed ones. */
export const Resumed: StoryObj = {
  render: () =>
    view([
      activation({
        replayedFrom: null,
        iterations: [
          ...Array.from({ length: 5 }, (_, i) =>
            iter({ number: i + 1, recalled: true, toolName: "Ticket search", thought: `Checked page ${i + 1}.` })),
          ...Array.from({ length: 5 }, (_, i) =>
            iter({ number: i + 6, toolName: "Salesforce account lookup", thought: `Read account field ${i + 1}.` })),
          iter({ number: 11, actionType: "FINAL", thought: "Answered with the renewal date." }),
        ],
      }),
    ]),
};

/** No agent step at all — a real state, and not an error. */
export const NoAgentStep: StoryObj = { render: () => view([]) };
