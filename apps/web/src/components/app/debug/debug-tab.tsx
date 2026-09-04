"use client";

import * as React from "react";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { useApi } from "~/lib/api/api-provider";
import { getAccessToken } from "~/lib/auth/token";
import { useScope } from "~/lib/workspace/workspace-provider";
import {
  createTraceApi, subscribeToSpans,
  type CriticalPath, type RootCause, type TraceCompleteness,
  type TraceGraph, type TraceStreamStatus, type TraceTree,
} from "~/lib/api/trace";
import {
  createDebugApi,
  type Burndown, type Comparison, type Constellation,
  type ReplayAttempt, type ReplayOptions,
} from "~/lib/api/constellation";
import { AgentsView } from "./agents-view";
import { FlowView } from "./flow-view";
import { CompareView } from "./compare-view";
import { ReplayView } from "./replay-view";
import { CostView } from "./cost-view";
import { CompletenessBanner, FlowSkeleton, TraceUnavailable } from "./states";
import { useDebugSelection } from "./use-debug-selection";
import { ActivityView } from "./activity-view";
import { RootCauseBanner } from "./root-cause-banner";
import { TimelineView } from "./timeline-view";

type View =
  | "overview" | "timeline" | "activity" | "agents" | "cost" | "compare" | "replay";

const IS_VIEW = (v: string | null): v is View =>
  v === "overview" || v === "timeline" || v === "activity" ||
  v === "agents" || v === "cost" || v === "compare" || v === "replay";

/**
 * `?view=iterations` still opens the iteration list — now inside Activity.
 *
 * Links to a specific view are pasted into tickets and chat threads and stay
 * there for years. Dropping the tab without this would turn every one of them
 * into a silent redirect to Overview, which reads as "the thing I sent you is
 * gone" rather than "it moved".
 */
function normaliseView(v: string | null): View | null {
  if (v === "iterations") return "activity";
  return IS_VIEW(v) ? v : null;
}

/** True when a rejection is this component cancelling its own in-flight request. */
function isAborted(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  return typeof e === "object" && e !== null && (e as { kind?: string }).kind === "aborted";
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Could not load the trace.";
}

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: "overview",   label: "Overview",   hint: "Did it fail, and where?" },
  { id: "timeline",   label: "Timeline",   hint: "Why did it take that long?" },
  { id: "activity",   label: "Activity",   hint: "What did the agent actually do?" },
  { id: "agents",     label: "Agents",     hint: "Who asked whom to do what, and why?" },
  { id: "cost",       label: "Cost",       hint: "Where did the money go?" },
  { id: "compare",    label: "Compare",    hint: "It worked yesterday — what changed?" },
  { id: "replay",     label: "Replay",     hint: "Run it again — and say what that will do." },
];

/**
 * The Debug tab: a pinned answer over four views of the evidence.
 *
 * Cost burn-down and Compare are still absent rather than stubbed — a tab strip
 * with dead entries teaches people the product is unfinished every time they
 * look at it, so a view appears here the tick it starts working.
 *
 * Agents is loaded LAZILY, on first visit to that tab. The constellation is a
 * second request carrying every contract and output in the run, and a run with
 * no team has nothing to show — making every visitor pay for it to open
 * Overview would be a tax on the common case for the benefit of the rare one.
 *
 * Wired to the real trace API through `~/lib/api/trace`, which uses the same
 * transport as the rest of `src/lib/api`. The routed builder page reads mock
 * workflow data and its handlers mutate local state
 * (AGENTIC-WORKFLOW-EXECUTION-FLOW §16 observation 1); nothing here inherits
 * that path.
 */
export function DebugTab({
  runId,
  onReconnect,
  onRetryFromHere,
}: {
  runId: string;
  onReconnect?: () => void;
  onRetryFromHere?: (spanId: string | null) => void;
}) {
  const client = useApi();
  const { workspaceId } = useScope();
  /* One scoped client per workspace. Rebuilt only when the scope changes, so a
     re-render does not hand every effect a new identity and restart the stream. */
  const api = React.useMemo(
    () => createTraceApi(client.transport, workspaceId),
    [client, workspaceId],
  );

  /*
   * SELECTION AND VIEW LIVE IN THE URL.
   *
   * Debugging is a conversation: somebody finds the step that broke and sends it
   * to whoever owns it. With selection in component state that link opens at the
   * top of an unrelated view and the recipient has to find it again from a
   * description — which is where most of the time in a support thread goes.
   */
  const selection = useDebugSelection();
  const view: View = normaliseView(selection.view) ?? "overview";
  const selectedSpanId = selection.spanId;
  const selectedNodeId = selection.nodeId;

  const [tree, setTree] = React.useState<TraceTree | null>(null);
  const [graph, setGraph] = React.useState<TraceGraph | null>(null);
  const [rootCause, setRootCause] = React.useState<RootCause | null>(null);
  const [critical, setCritical] = React.useState<CriticalPath | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [stream, setStream] = React.useState<TraceStreamStatus>("connecting");
  const [liveSpanCount, setLiveSpanCount] = React.useState(0);

  /* The constellation, fetched on first visit to Agents. Null means "not asked
     yet", which is why `agentsError` is separate: a failed fetch and an unvisited
     tab are different states and must not render the same. */
  const [constellation, setConstellation] = React.useState<Constellation | null>(null);
  const [agentsError, setAgentsError] = React.useState<string | null>(null);
  /* The burn-down, on first visit to Cost. Same reasoning as the constellation:
     a second request carrying every metered span, which a reader who never
     opens the tab should not pay for. */
  const [burndown, setBurndown] = React.useState<Burndown | null>(null);
  const [costError, setCostError] = React.useState<string | null>(null);

  /*
   * The comparison, on first visit to Compare.
   *
   * Two requests, in order: who to compare against, then the comparison itself.
   * The reader is not asked to pick a run first — that is asking them to answer
   * the question they came with.
   */
  /* Replay options and history, on first visit. Both are small; one round trip
     each, and neither is paid for by a reader who never opens the tab. */
  const [replayOptions, setReplayOptions] = React.useState<ReplayOptions | null>(null);
  const [replayHistory, setReplayHistory] = React.useState<ReplayAttempt[]>([]);
  const [replayError, setReplayError] = React.useState<string | null>(null);

  const [comparison, setComparison] = React.useState<Comparison | null>(null);
  const [compareNote, setCompareNote] = React.useState<string | null>(null);
  const [compareError, setCompareError] = React.useState<string | null>(null);
  const debugApi = React.useMemo(
    () => createDebugApi(client.transport, workspaceId),
    [client, workspaceId],
  );

  React.useEffect(() => {
    if (view !== "replay" || replayOptions || replayError) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const [opts, hist] = await Promise.all([
          debugApi.replayOptions(runId, ac.signal),
          debugApi.replays(runId, ac.signal).catch(() => ({ runId, attempts: [] })),
        ]);
        setReplayOptions(opts);
        setReplayHistory(hist.attempts);
      } catch (e) {
        if (!isAborted(e)) setReplayError(messageOf(e));
      }
    })();
    return () => ac.abort();
  }, [view, replayOptions, replayError, debugApi, runId]);

  React.useEffect(() => {
    if (view !== "compare" || comparison || compareNote || compareError) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const t = await debugApi.compareTarget(runId, ac.signal);
        if (t.target == null) { setCompareNote(t.reason); return; }
        setComparison(await debugApi.compare(runId, t.target.runId, ac.signal));
      } catch (e) {
        if (!isAborted(e)) setCompareError(messageOf(e));
      }
    })();
    return () => ac.abort();
  }, [view, comparison, compareNote, compareError, debugApi, runId]);

  React.useEffect(() => {
    if (view !== "cost" || burndown || costError) return;
    const ac = new AbortController();
    void (async () => {
      try {
        setBurndown(await debugApi.burndown(runId, ac.signal));
      } catch (e) {
        if (!isAborted(e)) setCostError(messageOf(e));
      }
    })();
    return () => ac.abort();
  }, [view, burndown, costError, debugApi, runId]);

  React.useEffect(() => {
    if (view !== "agents" || constellation || agentsError) return;
    const ac = new AbortController();
    void (async () => {
      try {
        setConstellation(await debugApi.constellation(runId, ac.signal));
      } catch (e) {
        if (!isAborted(e)) setAgentsError(messageOf(e));
      }
    })();
    return () => ac.abort();
  }, [view, constellation, agentsError, debugApi, runId]);

  // ── Initial load ─────────────────────────────────────────────────────────
  const load = React.useCallback(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    /*
     * Depth 9 rather than the default 3: today's deepest tree is
     * run → tick → step → call, and the extra levels cost nothing while making
     * the timeline complete. When P6 adds activation and iteration spans this
     * should go back to depth-limited with expand-on-demand.
     */
    Promise.all([
      api.tree(runId, 9, ac.signal),
      api.rootCause(runId, ac.signal),
      api.criticalPath(runId, ac.signal).catch(() => null),
      /* The graph is the Overview's whole content, but a failure here must not
         take the timeline and inspector down with it — they read spans and do
         not need the workflow at all. */
      api.graph(runId, ac.signal).catch(() => null),
    ])
      .then(([t, rc, cp, g]) => { setTree(t); setRootCause(rc); setCritical(cp); setGraph(g); })
      /* An abort is this effect cleaning up after itself — a re-render, a scope
         change, or React's development double-mount — not a failure the reader
         should be shown. The transport wraps it as kind "aborted" rather than
         letting a raw AbortError through, so checking `e.name` misses it and
         paints "The request was cancelled" over a page that is about to load
         correctly. */
      .catch((e: unknown) => { if (!isAborted(e)) setError(messageOf(e)); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [runId, api]);

  React.useEffect(() => load(), [load]);

  // ── Live spans, with the polling fallback the server asks for ────────────
  React.useEffect(() => {
    const stop = subscribeToSpans(
      runId,
      {
        api,
        workspaceId,
        getToken: async () => (await getAccessToken())?.token ?? null,
      },
      () => setLiveSpanCount((n) => n + 1),
      setStream,
      /* Terminal: reload once so the root cause and critical path — both
         computed at terminalisation — are the finished versions. */
      () => load(),
    );
    return stop;
  }, [runId, load, api, workspaceId]);

  const criticalPathIds = React.useMemo(
    () => new Set((critical?.path ?? []).map((s) => s.spanId)),
    [critical],
  );

  const rootCauseSpanId = rootCause?.rootCause?.spanId ?? null;

  /**
   * Cross-navigation, both directions.
   *
   * The views disagree about what a selection is: the Flow view selects a NODE,
   * stable across executions; the timeline and inspector select a SPAN, one
   * execution of one. Both are written, so each view can read the one it can use
   * and a node that ran three times still highlights in the map.
   */
  const selectSpan = React.useCallback(
    (spanId: string) => selection.selectSpan(spanId),
    [selection],
  );
  const selectNode = React.useCallback(
    (nodeId: string, spanId: string | null) => selection.selectNode(nodeId, spanId),
    [selection],
  );

  if (error) {
    return (
      <div className="rounded-md border border-status-failed-border bg-status-failed-subtle p-4">
        <Text variant="body" className="text-status-failed">{error}</Text>
        <button
          type="button"
          onClick={load}
          className={cn(
            "mt-2 rounded-xs px-1 text-sm text-fg-link",
            "transition-opacity hover:opacity-80 motion-reduce:transition-none",
            "focus-visible:focus-ring",
          )}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The answer, pinned above every view. */}
      <RootCauseBanner
        rootCause={rootCause}
        loading={loading}
        onReconnect={onReconnect}
        onRetryFromHere={onRetryFromHere ? () => onRetryFromHere(rootCauseSpanId) : undefined}
        /* ONE CLICK from the failure to "what changed". "It worked yesterday" is
           the most common report, and the banner is where the reader already is
           when they think it. */
        onCompare={() => selection.setView("compare")}
      />

      <CompletenessBanner completeness={tree?.completeness}>
        {tree?.truncated ? <DepthNote tree={tree} /> : null}
      </CompletenessBanner>

      {/* View switcher. Each tab is labelled with the question it answers —
          the tab strip is the index to §1's six questions, not decoration.

          The transport indicator sits on this row, at the end: it is about how
          the page is updating itself, which belongs beside the controls rather
          than in a banner about the trace. */}
      <div className="flex items-end justify-between gap-4 border-b border-subtle">
      <div role="tablist" aria-label="Debug views" className="flex gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            aria-controls={`debug-panel-${v.id}`}
            id={`debug-tab-${v.id}`}
            onClick={() => selection.setView(v.id)}
            title={v.hint}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              "transition-opacity hover:opacity-90 motion-reduce:transition-none",
              "focus-visible:focus-ring-inset",
              view === v.id
                ? "border-fg-max font-medium text-fg-max"
                : "border-transparent text-fg-secondary",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
        <div className="pb-2">
          <TransportIndicator stream={stream} />
        </div>
      </div>

      <div
        role="tabpanel"
        id={`debug-panel-${view}`}
        aria-labelledby={`debug-tab-${view}`}
        className="min-h-[24rem]"
      >
        {loading && !tree ? (
          view === "overview" ? <FlowSkeleton /> : <LoadingSkeleton />
        ) : !tree || tree.totalSpans === 0 ? (
          <NoTrace />
        ) : view === "overview" ? (
          graph ? (
            <FlowView
              graph={graph}
              selectedNodeId={selectedNodeId}
              onSelectNode={selectNode}
            />
          ) : (
            /* The spans loaded and the graph did not. Distinct from an empty
               run, and it says which half is missing. */
            <TraceUnavailable
              message="The workflow structure for this run could not be loaded, so the run map cannot be drawn. The timeline and inspector still work."
              onRetry={load}
            />
          )
        ) : view === "timeline" ? (
          <div className="h-[32rem]">
            <TimelineView
              spans={tree.spans}
              criticalPathIds={criticalPathIds}
              selectedSpanId={selectedSpanId}
              onSelectSpan={selectSpan}
            />
          </div>
        ) : view === "replay" ? (
          replayError ? (
            <TraceUnavailable message={replayError} onRetry={() => setReplayError(null)} />
          ) : replayOptions ? (
            <ReplayView options={replayOptions} history={replayHistory} />
          ) : (
            <div className="h-48 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
                 aria-busy="true" aria-label="Loading replay options" />
          )
        ) : view === "compare" ? (
          compareError ? (
            <TraceUnavailable message={compareError} onRetry={() => setCompareError(null)} />
          ) : compareNote ? (
            /* No counterpart exists. A real state, not an error: the first run
               of a version has nothing to be compared with. */
            <div className="flex min-h-48 items-center justify-center rounded-md border border-subtle bg-surface-raised p-6">
              <Text variant="body" className="max-w-[60ch] text-center text-fg-secondary">
                {compareNote}
              </Text>
            </div>
          ) : comparison ? (
            <CompareView comparison={comparison} />
          ) : (
            <div className="h-48 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
                 aria-busy="true" aria-label="Finding a run to compare against" />
          )
        ) : view === "cost" ? (
          costError ? (
            <TraceUnavailable message={costError} onRetry={() => setCostError(null)} />
          ) : burndown ? (
            <CostView burndown={burndown} />
          ) : (
            <div className="h-64 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
                 aria-busy="true" aria-label="Loading the burn-down" />
          )
        ) : view === "agents" ? (
          agentsError ? (
            <TraceUnavailable message={agentsError} onRetry={() => setAgentsError(null)} />
          ) : constellation ? (
            <AgentsView constellation={constellation} />
          ) : (
            <div className="h-64 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
                 aria-busy="true" aria-label="Loading the agent constellation" />
          )
        ) : (
          <ActivityView
            api={api}
            runId={runId}
            selectedNodeId={selectedNodeId}
            selectedSpanId={selectedSpanId}
            onSelectSpan={selectSpan}
          />
        )}
      </div>
    </div>
  );
}

/** Depth truncation: a fact about this request, not about the run. */
function DepthNote({ tree }: { tree: TraceTree }) {
  return (
    <Text variant="caption" className="mt-0.5 block text-fg-muted">
      Showing {tree.returnedSpans} of {tree.totalSpans} spans. Deeper levels load
      when you open them.
    </Text>
  );
}

/**
 * What the transport indicator says, or null for "say nothing".
 *
 * `open` is the healthy state and renders NOTHING — the old code folded this
 * into the trace-completeness banner, so a reconnect looked like data loss. The
 * wording avoids the word "unavailable" for polling on purpose: updates are
 * still arriving, just on a timer, and the trace is byte-for-byte the same.
 */
export function transportLabel(stream: TraceStreamStatus): string | null {
  switch (stream) {
    case "open": return null;
    case "connecting": return "Connecting…";
    case "polling": return "Refreshing on a timer";
    case "closed": return "Updates stopped";
  }
}

/**
 * How the page is getting its updates — a property of the TRANSPORT, not of the
 * trace.
 *
 * Separated because it used to sit in the same amber box as "spans are missing",
 * and the two say completely different things. SSE being unavailable means
 * updates arrive on a timer; the trace itself is exactly as complete either way.
 * Bundling them made a transport hiccup look like data loss.
 *
 * Quiet, inline, beside the view controls — an indicator, not a warning.
 */
export function TransportIndicator({ stream }: { stream: TraceStreamStatus }) {
  const label = transportLabel(stream);
  if (label === null) return null;

  return (
    <span className="inline-flex items-center gap-1.5" title={
      stream === "polling"
        ? "Live updates are unavailable, so this page re-fetches every few seconds. The trace is unaffected."
        : undefined
    }>
      <span aria-hidden="true" className={cn(
        "size-1.5 shrink-0 rounded-full bg-fg-muted",
        stream === "connecting" && "animate-pulse motion-reduce:animate-none",
      )} />
      <Text variant="caption" className="text-fg-muted">{label}</Text>
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading trace">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-40 animate-pulse rounded-xs bg-surface-sunken" />
          <div
            className="h-4 animate-pulse rounded-xs bg-surface-sunken"
            style={{ width: `${30 + ((i * 13) % 50)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function NoTrace() {
  return (
    <div className="flex h-48 items-center justify-center rounded-md border border-subtle bg-surface-raised">
      <div className="max-w-md text-center">
        <Text variant="body" className="text-fg-secondary">
          No trace was recorded for this run.
        </Text>
        <Text variant="caption" className="mt-1 text-fg-muted">
          Runs from before tracing was switched on have no spans. Newer runs will.
        </Text>
      </div>
    </div>
  );
}
