/**
 * The trace read API, typed.
 *
 * Deliberately its own module rather than another block inside `client.ts`: the
 * trace endpoints are read-only, they answer one screen, and none of the rest of
 * the app needs them. Keeping them separate means the Debug tab can be deleted or
 * replaced without touching the client every other screen depends on.
 *
 * WIRED TO THE REAL API, NOT TO FIXTURES. The routed builder page reads mock
 * workflow data and its save/run handlers update local state
 * (AGENTIC-WORKFLOW-EXECUTION-FLOW §16 observation 1). This module goes through
 * the same transport as the rest of `src/lib/api`, which switches on
 * `NEXT_PUBLIC_DATA_MODE` in exactly one place — so the tab reads live spans
 * wherever the API is reachable, and there is no second mock path to inherit.
 */

import { getApiBaseUrl } from "./config";
import type { RequestOptions, Transport } from "./transport";

// ── Shapes, mirroring what TraceRoutes actually returns ─────────────────────

export type SpanStatus = "ok" | "error" | "paused" | "skipped" | "cancelled" | "running";

export type SpanKind =
  | "run" | "tick" | "step" | "input_mapping" | "llm_call" | "tool_call"
  | "approval" | "retry" | "checkpoint" | "wait"
  /** Defined in the data model, not emitted until P6. */
  | "activation" | "iteration" | "handoff";

export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  kind: SpanKind;
  name: string;
  status: SpanStatus;
  stepId: string | null;
  iterationIndex: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  selfMs: number | null;
  failureClass: string | null;
  isRootCause: boolean;
  /** Whether a payload EXISTS. The content is fetched per span, never here. */
  hasInput: boolean;
  hasOutput: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  costCents: number | null;
  childCount: number;
  children: TraceSpan[];
  truncated: boolean;
}

export interface TraceTree {
  runId: string;
  depth: number;
  totalSpans: number;
  returnedSpans: number;
  truncated: boolean;
  spans: TraceSpan[];
  /**
   * @deprecated Means "the run span is closed" and nothing more. The page read
   * it as "spans were dropped", which it never was — see {@link TraceCompleteness}.
   * Kept for one release so an older client does not break.
   */
  traceComplete: boolean;

  completeness: TraceCompleteness;
}

/**
 * Whether this trace is the whole story, and if not, why not.
 *
 * ── FOUR STATES, BECAUSE THERE ARE FOUR DIFFERENT ANSWERS ─────────────────
 * This replaced a single boolean rendered as one amber box. The boolean meant
 * "the run span is closed"; the box said spans "were dropped while the writer
 * was under pressure" — a cause it had no signal for — and it fired on healthy
 * completed runs. A warning that fires on healthy runs trains people to ignore
 * warnings, which costs more than the warning was ever worth.
 *
 *   complete    — nothing to say. Render no banner at all.
 *   live        — the run is still going. NEUTRAL, never amber: "this is still
 *                 running" is a status, not a problem.
 *   partial     — spans really are missing, and `droppedSpans` says how many.
 *                 The only state permitted to make that claim.
 *   unavailable — the trace could not be read. Distinct from partial, because
 *                 an empty tree shown as an answer is a wrong answer.
 */
export interface TraceCompleteness {
  state: "complete" | "live" | "partial" | "unavailable";
  /** Spans this run produced that were never persisted. */
  droppedSpans: number;
  /** One sentence naming the cause. Null when there is nothing to say. */
  reason: string | null;
}

// ── The run as a graph ──────────────────────────────────────────────────────

/**
 * One thing worth knowing about a node that did NOT fail.
 *
 * Retries, truncated context and clamped budgets all leave a run green. Without
 * them a healthy-looking run has nothing to show for itself, and "it worked" and
 * "it worked this time" render identically.
 */
export interface GraphWarning {
  kind: "retry" | "context_truncated" | "budget_clamped" | "approval" | string;
  /** A sentence, not a code. Used as the accessible description. */
  detail: string;
  count: number;
}

/**
 * One member of an agent or team node, for the inline expansion.
 *
 * Status and duration travel with the name because a list of names answers
 * neither question an expanded team node is opened for: which member broke, and
 * which one took the time.
 */
export interface GraphMember {
  name: string;
  status: string;
  totalMs: number | null;
}

/** What an agent or team node did, without expanding it. */
export interface GraphNodeSummary {
  activations: number;
  /** One row per MEMBER, not per activation. */
  members: GraphMember[];
  failingMember: string | null;
}

export interface GraphNode {
  /** The workflow node's own id. Stable across executions, unlike a span id. */
  id: string;
  /** Resolved server-side: label → agent name → "Type · id8". Never a bare type. */
  label: string;
  type: string;
  /** A span status, or "not_reached". */
  status: string;
  /** False when the run never got here. Rendered dimmed and dashed, never hidden. */
  reached: boolean;
  attempts: number;
  /** Summed across attempts — the time this node actually cost the run. */
  totalMs: number | null;
  /** Every execution, so selecting the node selects all of them in other views. */
  spanIds: string[];
  warnings: GraphWarning[];
  isRootCause: boolean;
  costCents: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  summary: GraphNodeSummary | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string | null;
  condition: string | null;
  /**
   * Whether the run went this way — true, false, or NULL for "cannot tell".
   *
   * Traversal is derived from which endpoints have spans, which is exact for a
   * branch (one reached inbound source) and unknowable for a join reached from
   * two branches that both ran. Null renders as an ordinary edge, claiming
   * nothing — never as a guess.
   */
  traversed: boolean | null;
}

export interface RunBarSegment {
  kind: "queued" | "working" | "parked" | "failed" | string;
  ms: number;
  /** Named by its reason where there is one: "parked" is not actionable. */
  label: string;
}

/**
 * The run resolved against the workflow it ran.
 *
 * The SERVER resolves this. `graph_json` has two historical shapes and the
 * worker's parser is the only reader of both; a second implementation in
 * TypeScript would diverge the first time a third appears, silently, on the one
 * screen people open when something has already gone wrong.
 */
export interface TraceGraph {
  runId: string;
  status: string;
  completeness: TraceCompleteness;
  /**
   * True when the workflow version could not be read, so there are no edges.
   * Said out loud rather than inferred from an empty list: the reader must know
   * the structure is MISSING rather than believe the run had none.
   */
  graphUnavailable: boolean;
  runBar: { totalMs: number; segments: RunBarSegment[] };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── The inspector ───────────────────────────────────────────────────────────

/** A model or tool call beneath an iteration. Refs and sizes, never content. */
export interface IterationCall {
  spanId: string;
  name: string;
  status: string;
  durationMs: number | null;
  hasInput: boolean;
  hasOutput: boolean;
  inputBytes: number | null;
  outputBytes: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * What the context assembler had to leave out of this iteration's prompt.
 *
 * Named sections, not a boolean: "context was truncated" says something is
 * missing but not what, and the diagnostic value is entirely in WHICH sections
 * went. An agent that "ignored" an instruction it was never shown is the hardest
 * agent failure to diagnose.
 */
export interface ContextFit {
  truncated: boolean;
  droppedSections: string[];
  charsUsed: number | null;
  charBudget: number | null;
  overBudget: boolean;
}

export interface Iteration {
  id: string;
  number: number;
  status: string;
  /** THINK · CALL_TOOL · FINAL · DELEGATE … Null while still running. */
  actionType: string | null;
  thought: string | null;
  observation: string | null;
  observationSuccess: boolean | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  tokensDelta: number | null;
  costDeltaCents: number | null;
  /** The action AS PARSED, sanitized. Rendered beside the raw response. */
  actionJson: string | null;
  /**
   * The runtime built this action because the response would not parse.
   *
   * NULL means the row predates the column — NOT false. An older worker's rows
   * must not claim the model chose to think.
   */
  actionRepaired: boolean | null;
  selectedToolId: string | null;
  /**
   * The tool's human name, resolved by the API.
   *
   * Null when the iteration called no tool, or when the tool has since been
   * deleted — history keeps its iterations either way, and the Activity view
   * says "a tool" rather than printing a uuid at somebody.
   */
  toolName: string | null;
  /** The guard replayed a previous identical call instead of executing it. */
  toolResultCached: boolean | null;
  /** Restored from the transcript on resume rather than executed this time. */
  recalled: boolean;
  context: ContextFit | null;
  llmCall: IterationCall | null;
  toolCall: IterationCall | null;
}

/** Why reconstruction gave up and the loop replayed from iteration 1. */
export interface ReplayNote {
  reason: string;
  detail: string | null;
}

export interface IterationBudget {
  dimension: string;
  used: number;
  /** Null when the dimension has no granted ceiling — never a guessed one. */
  limit: number | null;
}

/**
 * What this agent usually takes, over recent runs that SUCCEEDED.
 *
 * Null is the common answer and renders as silence: an agent with no successful
 * history has no typical, and a flag that fires on new agents is a flag people
 * learn to ignore.
 */
export interface StepBaseline {
  typicalSteps: number;
  /** How many activations the median was drawn from. Shown, not hidden. */
  sampleRuns: number;
}

export interface ActivationDetail {
  id: string | null;
  stepId: string;
  agentId: string | null;
  agentName: string | null;
  status: string | null;
  stopReason: string | null;
  budgets: IterationBudget[];
  replayedFrom: ReplayNote | null;
  baseline: StepBaseline | null;
  iterations: Iteration[];
}

export interface PayloadRef {
  ref: string;
  sizeBytes: number;
  contentType: string;
  storage: "inline" | "object";
  truncated: boolean;
  /** What was masked and why, so a redaction reads as one and not as a gap. */
  redactions: string | null;
  value?: string;
  /** Short-lived signed URL, for object-stored content. */
  url?: string;
  /**
   * The metadata is here and the CONTENT was not requested.
   *
   * Distinct from content that is gone: the panel says "show" rather than
   * "no longer available", which are different sentences and different fixes.
   */
  contentWithheld?: boolean;
}

export interface SpanDetail extends Omit<TraceSpan, "children" | "childCount" | "truncated"> {
  attributes: string | null;
  errorJson: string | null;
  input: PayloadRef | null;
  output: PayloadRef | null;
}

export interface RootCause {
  runId: string;
  rootCause: TraceSpan | null;
  concurrentGroup: string[];
  concurrentLabel: string | null;
  failureClass: string | null;
  owner: string | null;
  retry: string | null;
  /** BUDGET is a limit, not a crash, and must not render red. */
  rendersAsError: boolean;
  ancestry: TraceSpan[];
  sentence: string | null;
  reason?: string;
}

export interface CriticalPathSpan extends TraceSpan {
  sharePct: number | null;
}

export interface CriticalPath {
  runId: string;
  totalMs: number;
  path: CriticalPathSpan[];
}

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * Built from the app's transport, never from a bare `fetch`.
 *
 * The transport is what attaches the bearer token and `X-Workspace-Id`, and both
 * are load-bearing here: the trace endpoints are workspace-scoped and fail closed,
 * so a request without the header does not return somebody else's spans — it
 * returns nothing, and the tab renders an empty state that looks like a run with
 * no trace. Hand-rolling `fetch` gets that wrong in the most confusing possible
 * direction. It also inherits retries, timeouts and the shared error taxonomy.
 */
export function createTraceApi(transport: Transport, workspaceId: string | null) {
  const req = (signal?: AbortSignal): RequestOptions => ({ workspaceId, signal });

  return {
    /** Depth-limited; a wide trace is thousands of spans. */
    tree: (runId: string, depth = 3, signal?: AbortSignal) =>
      transport.request<TraceTree>(`/api/runs/${runId}/trace?depth=${depth}`, req(signal)),

    /**
     * One span. The only endpoint that returns payload CONTENT — and only when
     * asked: `content: false` returns sizes, truncation and redactions without
     * moving the bytes, which is what a collapsed panel needs.
     */
    span: (runId: string, spanId: string, opts?: { content?: boolean }, signal?: AbortSignal) =>
      transport.request<SpanDetail>(
        `/api/runs/${runId}/trace/spans/${spanId}` +
          (opts?.content === false ? "?content=false" : ""),
        req(signal)),

    rootCause: (runId: string, signal?: AbortSignal) =>
      transport.request<RootCause>(`/api/runs/${runId}/trace/root-cause`, req(signal)),

    criticalPath: (runId: string, signal?: AbortSignal) =>
      transport.request<CriticalPath>(`/api/runs/${runId}/trace/critical-path`, req(signal)),

    /** The workflow resolved against the run: one entry per NODE, plus edges. */
    graph: (runId: string, signal?: AbortSignal) =>
      transport.request<TraceGraph>(`/api/runs/${runId}/trace/graph`, req(signal)),

    /**
     * Every activation's iterations. Refs and sizes only — no prompt bytes.
     *
     * The inspector renders its whole left rail and most of its right pane from
     * this one response, so a 40-iteration activation costs one request and no
     * payload content until the reader expands something.
     */
    iterations: (runId: string, signal?: AbortSignal) =>
      transport.request<{ runId: string; activations: ActivationDetail[] }>(
        `/api/runs/${runId}/trace/iterations`, req(signal)),

    /** What one iteration's tool call returned in full, and the copy the agent was shown. */
    iterationToolResult: (runId: string, iterationId: string, signal?: AbortSignal) =>
      transport.request<{ result: PayloadRef | null; shown: PayloadRef | null }>(
        `/api/runs/${runId}/trace/iterations/${iterationId}/tool-result`, req(signal)),
  };
}

export type TraceApi = ReturnType<typeof createTraceApi>;

// ── Live spans ──────────────────────────────────────────────────────────────

export type TraceStreamStatus = "connecting" | "open" | "polling" | "closed";

/**
 * Subscribe to live spans, falling back to polling.
 *
 * Mirrors the run-event stream's contract because the server implements the same
 * one: durable spans replay from Postgres first, then Redis takes over, and
 * `stream_unavailable` means Redis is absent and the client must poll instead.
 *
 * The fallback is not optional. Without it a workspace running without Redis sees
 * a Debug tab that renders once and then never updates, which is
 * indistinguishable from a hung run — the exact confusion this whole tab exists
 * to remove.
 */
export function subscribeToSpans(
  runId: string,
  opts: {
    api: TraceApi;
    workspaceId: string | null;
    /**
     * Re-read per connection so a token refresh is picked up on reconnect.
     * EventSource cannot set headers, so this rides on the query string — the
     * same trade `run-stream.ts` documents: same-site to our own API over TLS,
     * and the alternative is no live updates at all.
     */
    getToken: () => Promise<string | null>;
  },
  onSpan: (span: Partial<TraceSpan> & { spanId: string }) => void,
  onStatus: (status: TraceStreamStatus) => void,
  onComplete: () => void,
): () => void {
  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let source: EventSource | null = null;

  const startPolling = () => {
    if (closed || pollTimer) return;
    onStatus("polling");
    pollTimer = setInterval(() => {
      void opts.api
        .tree(runId, 9)
        .then((t) => {
          const walk = (s: TraceSpan[]) =>
            s.forEach((n) => {
              onSpan(n);
              walk(n.children);
            });
          walk(t.spans);
        })
        .catch(() => {
          /* A failed poll is not fatal; the next one may succeed. */
        });
    }, 4000);
  };

  void (async () => {
    const token = await opts.getToken().catch(() => null);
    if (closed) return;
    const url = new URL(`${getApiBaseUrl()}/api/runs/${runId}/trace/stream`);
    if (token) url.searchParams.set("access_token", token);
    if (opts.workspaceId) url.searchParams.set("workspaceId", opts.workspaceId);

    try {
      source = new EventSource(url.toString());
      onStatus("connecting");

      source.addEventListener("open", () => !closed && onStatus("open"));
      source.addEventListener("span", (e) => {
        try {
          onSpan(JSON.parse((e as MessageEvent).data));
        } catch {
          /* A malformed frame must not tear down the stream. */
        }
      });
      source.addEventListener("trace_complete", () => {
        onComplete();
        onStatus("closed");
        source?.close();
      });
      source.addEventListener("stream_unavailable", () => {
        /* The server says Redis is absent. Polling is not a nicety here: without
           it the tab renders once and never updates, which is indistinguishable
           from a hung run — the exact confusion this tab exists to remove. */
        source?.close();
        startPolling();
      });
      source.addEventListener("error", () => {
        /* EventSource retries on its own; polling is the last resort after it has
           clearly given up rather than after a single blip. */
        if (source?.readyState === EventSource.CLOSED) startPolling();
      });
    } catch {
      startPolling();
    }
  })();

  return () => {
    closed = true;
    source?.close();
    if (pollTimer) clearInterval(pollTimer);
  };
}
