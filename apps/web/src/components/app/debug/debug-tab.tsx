"use client";

import * as React from "react";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { useApi } from "~/lib/api/api-provider";
import { getAccessToken } from "~/lib/auth/token";
import { useScope } from "~/lib/workspace/workspace-provider";
import {
  createTraceApi, subscribeToSpans,
  type CriticalPath, type RootCause, type TraceStreamStatus, type TraceTree,
} from "~/lib/api/trace";
import { createDebugApi, type Constellation } from "~/lib/api/constellation";
import { AgentsView } from "./agents-view";
import { IterationsView } from "./iterations-view";
import { OverviewView } from "./overview-view";
import { RootCauseBanner } from "./root-cause-banner";
import { TimelineView } from "./timeline-view";

type View = "overview" | "timeline" | "iterations" | "agents";

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
  { id: "iterations", label: "Iterations", hint: "What did it call, and what came back?" },
  { id: "agents",     label: "Agents",     hint: "Who asked whom to do what, and why?" },
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

  const [view, setView] = React.useState<View>("overview");
  const [selectedSpanId, setSelectedSpanId] = React.useState<string | null>(null);

  const [tree, setTree] = React.useState<TraceTree | null>(null);
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
  const debugApi = React.useMemo(
    () => createDebugApi(client.transport, workspaceId),
    [client, workspaceId],
  );

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
    ])
      .then(([t, rc, cp]) => { setTree(t); setRootCause(rc); setCritical(cp); })
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

  /** Cross-navigation: pick a span here, land on it in the other views. */
  const selectSpan = React.useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
  }, []);

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
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            "focus-visible:outline-border-focus",
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
      />

      <TraceCompleteness tree={tree} stream={stream} liveSpanCount={liveSpanCount} />

      {/* View switcher. Each tab is labelled with the question it answers —
          the tab strip is the index to §1's six questions, not decoration. */}
      <div role="tablist" aria-label="Debug views" className="flex gap-1 border-b border-subtle">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            aria-controls={`debug-panel-${v.id}`}
            id={`debug-tab-${v.id}`}
            onClick={() => setView(v.id)}
            title={v.hint}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              "transition-opacity hover:opacity-90 motion-reduce:transition-none",
              "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2",
              "focus-visible:outline-border-focus",
              view === v.id
                ? "border-fg-max font-medium text-fg-max"
                : "border-transparent text-fg-secondary",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`debug-panel-${view}`}
        aria-labelledby={`debug-tab-${view}`}
        className="min-h-[24rem]"
      >
        {loading && !tree ? (
          <LoadingSkeleton />
        ) : !tree || tree.totalSpans === 0 ? (
          <NoTrace />
        ) : view === "overview" ? (
          <OverviewView
            spans={tree.spans}
            rootCauseSpanId={rootCauseSpanId}
            selectedSpanId={selectedSpanId}
            onSelectSpan={selectSpan}
          />
        ) : view === "timeline" ? (
          <div className="h-[32rem]">
            <TimelineView
              spans={tree.spans}
              criticalPathIds={criticalPathIds}
              selectedSpanId={selectedSpanId}
              onSelectSpan={selectSpan}
            />
          </div>
        ) : (
          <IterationsView
            api={api}
            runId={runId}
            spans={tree.spans}
            selectedSpanId={selectedSpanId}
            onSelectSpan={selectSpan}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Say when the trace is not the whole story.
 *
 * A partial tree rendered as though it were complete is worse than no tree: the
 * reader concludes the run did less than it did, and goes looking for a step that
 * is missing only from the record. Spans are dropped under buffer pressure by
 * design, and runs from before instrumentation have none at all.
 */
function TraceCompleteness({
  tree, stream, liveSpanCount,
}: {
  tree: TraceTree | null;
  stream: TraceStreamStatus;
  liveSpanCount: number;
}) {
  const incomplete = tree && !tree.traceComplete;
  const truncated = tree?.truncated;
  const polling = stream === "polling";

  if (!incomplete && !truncated && !polling) return null;

  return (
    <div className="rounded-md border border-status-waiting-border bg-status-waiting-subtle px-3 py-2">
      <ul className="space-y-1">
        {incomplete && (
          <li>
            <Text variant="caption" className="text-status-waiting">
              This trace may be incomplete — the run is still writing spans, or some
              were dropped while the writer was under pressure.
            </Text>
          </li>
        )}
        {truncated && (
          <li>
            <Text variant="caption" className="text-status-waiting">
              Showing {tree.returnedSpans} of {tree.totalSpans} spans. Deeper levels
              load when you open them.
            </Text>
          </li>
        )}
        {polling && (
          <li>
            <Text variant="caption" className="text-status-waiting">
              Live updates are unavailable, so this page is refreshing on a timer
              instead{liveSpanCount > 0 ? "." : " — new spans may appear a few seconds late."}
            </Text>
          </li>
        )}
      </ul>
    </div>
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
