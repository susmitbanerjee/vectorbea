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
   * False when spans were dropped under buffer pressure, or the run predates
   * instrumentation. The page must SAY so rather than render a partial tree as
   * though it were whole — a trace with a hole in it looks identical to a run
   * that did less than it did.
   */
  traceComplete: boolean;
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

    /** One span WITH its payloads resolved. The only endpoint that returns content. */
    span: (runId: string, spanId: string, signal?: AbortSignal) =>
      transport.request<SpanDetail>(`/api/runs/${runId}/trace/spans/${spanId}`, req(signal)),

    rootCause: (runId: string, signal?: AbortSignal) =>
      transport.request<RootCause>(`/api/runs/${runId}/trace/root-cause`, req(signal)),

    criticalPath: (runId: string, signal?: AbortSignal) =>
      transport.request<CriticalPath>(`/api/runs/${runId}/trace/critical-path`, req(signal)),
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
