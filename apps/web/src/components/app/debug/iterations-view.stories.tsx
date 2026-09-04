import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { IterationsView } from "./iterations-view";
import type {
  ActivationDetail, Iteration, PayloadRef, SpanDetail, TraceApi,
} from "~/lib/api/trace";

/**
 * The inspector.
 *
 * The four things it has to get right, none of which is visible in a screenshot
 * of a healthy iteration: the prompt is not loaded until asked for, the
 * truncation warning names what went, a repaired action reads as a repair, and a
 * cached tool result reads as cached.
 */

function iter(p: Partial<Iteration> & { number: number }): Iteration {
  return {
    id: `i${p.number}`,
    number: p.number,
    status: p.status ?? "completed",
    actionType: p.actionType ?? "CALL_TOOL",
    thought: p.thought ?? null,
    observation: p.observation ?? null,
    observationSuccess: p.observationSuccess ?? null,
    startedAt: new Date(Date.parse("2026-08-31T10:00:00Z") + p.number * 2_000).toISOString(),
    completedAt: null,
    durationMs: p.durationMs ?? 1_200,
    tokensDelta: p.tokensDelta ?? 480,
    costDeltaCents: p.costDeltaCents ?? 1.25,
    actionJson: p.actionJson ?? null,
    actionRepaired: p.actionRepaired ?? false,
    selectedToolId: p.selectedToolId ?? null,
    toolName: p.toolName ?? null,
    toolResultCached: p.toolResultCached ?? null,
    recalled: p.recalled ?? false,
    context: p.context ?? null,
    llmCall: p.llmCall ?? {
      spanId: `llm-${p.number}`, name: "gpt-4o-mini", status: "ok", durationMs: 900,
      hasInput: true, hasOutput: true, inputBytes: 12_400, outputBytes: 840,
      tokensIn: 3_100, tokensOut: 210,
    },
    toolCall: p.toolCall ?? null,
  };
}

/**
 * A stub whose PAYLOAD calls are counted, so the story itself proves the
 * acceptance criterion: nothing is fetched until something is expanded.
 */
function stubApi(activations: ActivationDetail[], counter: { n: number }): TraceApi {
  return {
    iterations: async () => ({ runId: "r", activations }),
    span: async (_runId: string, spanId: string) => {
      counter.n += 1;
      const prompt =
        "SYSTEM: You are a research assistant.\n" +
        "TASK: Find the account owner for A-8891.\n" +
        "OBSERVATIONS:\n" +
        "  1. THINK: I should look up the account.\n" +
        (spanId.endsWith("4")
          ? "  2. CALL_TOOL crm.search: [redacted: bearer token] HTTP 403\n"
          : "");
      const payload: PayloadRef = {
        ref: "p", sizeBytes: prompt.length, contentType: "text/plain",
        storage: "inline", truncated: false,
        redactions: spanId.endsWith("4") ? '[{"label":"bearer token","count":1}]' : null,
        value: prompt,
      };
      return {
        input: payload,
        output: { ...payload, value: '{"action":"CALL_TOOL","toolId":"crm.search"}' },
      } as unknown as SpanDetail;
    },
  } as unknown as TraceApi;
}

function Frame({ title, note, activations }: {
  title: string; note: string; activations: ActivationDetail[];
}) {
  const counter = React.useRef({ n: 0 });
  const [, force] = React.useState(0);
  const api = React.useMemo(() => stubApi(activations, counter.current), [activations]);

  React.useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      <Text variant="caption" tone="muted" className="mt-1 block max-w-[80ch]">{note}</Text>
      <Text variant="caption" className="mb-3 mt-1 block font-mono text-fg-secondary"
            data-testid="payload-fetches">
        payload fetches: {counter.current.n}
      </Text>
      <IterationsView api={api} runId="r" selectedSpanId={null} onSelectSpan={() => {}} />
    </section>
  );
}

const meta: Meta = { title: "App/Debug/Iterations", parameters: { layout: "padded" } };
export default meta;

const RESEARCHER: ActivationDetail = {
  id: "a1",
  stepId: "n-agent-1",
  agentId: "ag-1",
  agentName: "researcher",
  status: "failed",
  stopReason: "MAX_ITERATIONS",
  budgets: [
    { dimension: "iterations", used: 5, limit: 5 },
    { dimension: "tokens", used: 18_450, limit: 24_000 },
    { dimension: "costCents", used: 21, limit: 40 },
    { dimension: "toolCalls", used: 3, limit: null },
  ],
  replayedFrom: null,
  baseline: null,
  iterations: [
    iter({ number: 1, actionType: "THINK", thought: "I should look up the account first",
           observation: "Thought recorded",
           actionJson: '{"type":"THINK","reasoningSummary":"I should look up the account first"}' }),
    iter({ number: 2, actionType: "CALL_TOOL", observation: "crm.search returned 1 record",
           observationSuccess: true, toolResultCached: false,
           selectedToolId: "crm.search",
           actionJson: '{"type":"CALL_TOOL","toolId":"crm.search","toolInput":{"accountId":"A-8891"}}',
           toolCall: { spanId: "tool-2", name: "crm.search", status: "ok", durationMs: 240,
                       hasInput: true, hasOutput: true, inputBytes: 90, outputBytes: 2_100,
                       tokensIn: null, tokensOut: null } }),
    iter({ number: 3, actionType: "THINK", actionRepaired: true,
           thought: "Failed to parse action response — trying next iteration",
           observation: "Thought recorded",
           actionJson: '{"type":"THINK","reasoningSummary":"Failed to parse action response"}' }),
    iter({ number: 4, actionType: "CALL_TOOL", status: "failed",
           observation: "crm.search failed: HTTP 403 token expired", observationSuccess: false,
           toolResultCached: false, selectedToolId: "crm.search",
           actionJson: '{"type":"CALL_TOOL","toolId":"crm.search","toolInput":{"accountId":"A-8891"}}',
           context: { truncated: true, droppedSections: ["memory", "older observations"],
                      charsUsed: 12_400, charBudget: 12_000, overBudget: false },
           toolCall: { spanId: "tool-4", name: "crm.search", status: "error", durationMs: 2_400,
                       hasInput: true, hasOutput: true, inputBytes: 90, outputBytes: 120,
                       tokensIn: null, tokensOut: null } }),
    iter({ number: 5, actionType: "CALL_TOOL",
           observation: "crm.search returned 1 record (from an earlier identical call)",
           observationSuccess: true, toolResultCached: true, selectedToolId: "crm.search",
           actionJson: '{"type":"CALL_TOOL","toolId":"crm.search","toolInput":{"accountId":"A-8891"}}',
           toolCall: { spanId: "tool-5", name: "crm.search", status: "ok", durationMs: 1,
                       hasInput: true, hasOutput: true, inputBytes: 90, outputBytes: 2_100,
                       tokensIn: null, tokensOut: null } }),
  ],
};

/** The whole inspector on a failed activation. */
export const FailedActivation: StoryObj = {
  name: "A failed activation",
  render: () => (
    <Frame
      title="researcher — stopped at its iteration ceiling"
      note="Iteration 3 is a REPAIR, not a decision. Iteration 4's prompt is missing two
            sections. Iteration 5's tool result is CACHED. The counter above stays at zero
            until you expand a prompt — the list costs one request and no payload bytes."
      activations={[RESEARCHER]}
    />
  ),
};

/** ACCEPTANCE: forty iterations, nothing fetched. */
export const FortyIterations: StoryObj = {
  name: "Forty iterations",
  render: () => (
    <Frame
      title="A 40-iteration activation"
      note="Rendering the whole rail and the selected iteration's metadata costs one
            request. The payload counter stays at zero until a prompt is expanded."
      activations={[{
        ...RESEARCHER,
        stopReason: null,
        budgets: [
          { dimension: "iterations", used: 40, limit: 50 },
          { dimension: "tokens", used: 121_400, limit: 200_000 },
        ],
        iterations: Array.from({ length: 40 }, (_, i) =>
          iter({
            number: i + 1,
            actionType: i % 4 === 0 ? "THINK" : "CALL_TOOL",
            observation: `step ${i + 1} observed`,
            actionJson: `{"type":"${i % 4 === 0 ? "THINK" : "CALL_TOOL"}"}`,
          })),
      }]}
    />
  ),
};

/** Resume: some iterations were recalled, not re-run. */
export const Recalled: StoryObj = {
  name: "Recalled after a resume",
  render: () => (
    <Frame
      title="Resumed at iteration 4"
      note="Iterations 1 to 3 were restored from the transcript, not executed again. Without
            the marker a reader seeing them a second time has no way to tell which is which."
      activations={[{
        ...RESEARCHER,
        status: "succeeded",
        stopReason: null,
        iterations: RESEARCHER.iterations.map((it) => ({ ...it, recalled: it.number < 4 })),
      }]}
    />
  ),
};

/** Reconstruction failed, so the loop replayed from the start. */
export const Replayed: StoryObj = {
  name: "Replayed from the start",
  render: () => (
    <Frame
      title="Reconstruction fell back to replay"
      note="The reason is shown, because a reader seeing iteration 3 twice deserves to know
            the second one is a replay and why the first could not be reused."
      activations={[{
        ...RESEARCHER,
        replayedFrom: { reason: "SCHEMA_CHANGED", detail: "loop_schema_version 1 is older than 2" },
      }]}
    />
  ),
};
