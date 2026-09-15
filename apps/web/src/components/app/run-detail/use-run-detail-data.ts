"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { openRunStream, type RunStreamState } from "~/lib/api/run-stream";
import { getApiBaseUrl } from "~/lib/api/config";
import { getAccessToken } from "~/lib/auth/token";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { toUiRun } from "~/components/app/runs/use-runs-data";
import type { Run } from "~/lib/runs/model";
import type { VectorbeaApiError } from "~/lib/api/errors";
import { fromStoredGraph } from "~/lib/workflows/graph-codec";

/* ══════════════════════════════════════════════════════════════════════════════
   THE RUN THIS PAGE IS ACTUALLY ABOUT

   Run detail used to resolve its run as `getRun(runId) ?? SIGNATURE_RUN` — a
   fixture lookup with a fixture fallback. Every real run id missed the lookup
   and fell through to the fallback, so the page rendered a completely different
   workflow's run, confidently, with its own name, steps, timings and cost. It
   could not report "not found" either: the fallback always succeeded.

   That is the worst failure mode a diagnostic screen can have. Someone opening
   a failed production run to find out what happened was shown a fabricated
   success from a workflow they had never run.

   Everything here comes from the API:

     GET /api/runs/:id           the run — status, timings, cost, node ribbon
     GET /api/runs/:id/events    what it did, step by step
     GET /api/incidents          the failure summary, when one was clustered

   `toUiRun` is the SAME adapter the runs list uses, so the two screens cannot
   disagree about what a run is. `RunDetail` extends `RunSummary`, so it feeds
   that adapter unchanged and the extra detail fields ride alongside.
══════════════════════════════════════════════════════════════════════════════ */

export interface RunDetailData {
  /** The run in the UI's shape, or null while loading / when absent. */
  run: Run | null;
  /** The raw detail response — `outputJson` and `errorJson` live only here. */
  detail: contracts.RunDetail | null;
  events: contracts.RunEvent[];
  /**
   * What the run is parked on right now. Empty for a run that is not parked,
   * and empty for a finished one — its waits are history, and history is in
   * `events`.
   */
  waits: contracts.RunWait[];
  /**
   * Where the result went, and whether it got there.
   *
   * Read for FINISHED runs, not only failed ones — "delivered" is the answer
   * somebody is looking for as often as "not delivered", and a panel that only
   * appeared on failure would leave every successful run silently unconfirmed.
   */
  deliveries: contracts.RunDelivery[];
  /** Requeue a delivery. It carries the same idempotency key it was born with. */
  redeliver: (deliveryId: string) => Promise<void>;
  incident: contracts.FailureIncident | null;
  loading: boolean;
  /** True only when the API positively answered 404. */
  notFound: boolean;
  error: VectorbeaApiError | null;
  refetch: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Re-run one failed step, and everything downstream of it. */
  retryStep: (nodeId: string) => Promise<void>;
  /** Re-run the whole workflow from the trigger. */
  retryRun: () => Promise<void>;
  /** Live-stream transport state, or null when the run is not being followed. */
  stream: RunStreamState | null;
  scope: { workspaceId: string | null; environmentId: string | null };
}

/** Statuses where more is still going to happen, so the page should keep looking. */
const IN_FLIGHT = new Set<contracts.RunStatus>([
  "queued", "running", "recovering", "yielded",
  "waiting_for_approval", "awaiting_approval", "waiting_for_timer",
  /* Omitting this is how a six-minute render looks like a hung page: the run is
     parked, more IS going to happen, and the screen would have stopped looking
     for it until somebody reloaded. */
  "waiting_for_event",
  "cancellation_requested", "paused",
]);

/**
 * Statuses where the run is parked on a wait rather than executing.
 *
 * A subset of [IN_FLIGHT], and deliberately not derived from it: `queued` and
 * `running` are in flight and have nothing to be parked on, and asking the waits
 * endpoint about them would be a request per poll for an always-empty list.
 */
const PARKED = new Set<contracts.RunStatus>([
  "waiting_for_approval", "awaiting_approval", "waiting_for_event",
]);

export function useRunDetailData(runId: string): RunDetailData {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(
    () => ({ workspaceId, environmentId: null }),
    [workspaceId],
  );
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId) && Boolean(runId);

  const run = useApiQuery({
    queryKey: queryKeys.runs.detail(keyScope, runId),
    queryFn: () => api.runs.get(runId, scope),
    enabled,
    freshness: "live",
  });

  const events = useApiQuery({
    queryKey: [...queryKeys.runs.detail(keyScope, runId), "events"],
    queryFn: () => api.runs.events(runId, { ...scope, page: 1, pageSize: 200 }),
    // Pointless before the run exists, and pointless if it never did.
    enabled: enabled && Boolean(run.data),
    freshness: "live",
  });

  /*
   * ── WHAT THE RUN IS PARKED ON ────────────────────────────────────────────
   * Asked only while the run is actually parked. A run that is running has no
   * active waits, so the request would be a round trip to learn nothing, on a
   * page that already polls.
   *
   * Ten seconds, matching the run-record poll rather than the stream: a wait's
   * elapsed and remaining are clocks, and nothing emits an event as they tick.
   * Anything faster would be redrawing a countdown from the server that the
   * page can just as well not pretend to have to the second.
   */
  const parked = run.data ? PARKED.has(run.data.status) : false;
  const waits = useApiQuery({
    queryKey: [...queryKeys.runs.detail(keyScope, runId), "waits"],
    queryFn: () => api.runs.waits(runId, scope),
    enabled: enabled && parked,
    freshness: "live",
  });

  /*
   * ── WHERE THE RESULT WENT ─────────────────────────────────
   * Asked once the run has finished, because nothing is delivered before then.
   * Kept live while anything is still retrying: a delivery's backoff is minutes
   * long, so a page opened on a failing callback should show it landing without
   * a manual refresh.
   */
  const finished = run.data ? !IN_FLIGHT.has(run.data.status) : false;
  const deliveries = useApiQuery({
    queryKey: [...queryKeys.runs.detail(keyScope, runId), "deliveries"],
    queryFn: () => api.runs.deliveries(runId, scope),
    enabled: enabled && finished,
    freshness: "live",
  });

  /* The incident carries the human-readable failure summary; the run itself
     only carries the id. Skipped entirely when nothing failed. */
  const incidentId = run.data?.incidentId ?? null;
  const incidents = useApiQuery({
    queryKey: queryKeys.incidents.list(keyScope, { limit: 100 }),
    queryFn: () => api.incidents.list({ ...scope, limit: 100 }),
    enabled: enabled && Boolean(incidentId),
  });

  const incident = React.useMemo(
    () => (incidents.data ?? []).find((candidate) => candidate.id === incidentId) ?? null,
    [incidents.data, incidentId],
  );

  /*
   * ── STEP NAMES ───────────────────────────────────────────────────────────
   * The run's ribbon records node IDS, so every step on this page read
   * "n-new-agent-2" rather than "Review changes". The names are in the graph of
   * the version this run executed; read it once and relabel.
   */
  const workflowId = run.data?.workflowId ?? null;
  const versions = useApiQuery({
    queryKey: queryKeys.workflows.versions(keyScope, workflowId ?? ""),
    queryFn: () => api.workflows.versions(workflowId!, { ...scope, page: 1, pageSize: 50 }),
    enabled: enabled && Boolean(workflowId),
  });
  const stepNames = React.useMemo(() => {
    const version = versions.data?.items.find((v) => v.id === run.data?.workflowVersionId);
    if (!version) return null;
    return new Map(fromStoredGraph(version.graph).nodes.map((n) => [n.node.id, n.node] as const));
  }, [versions.data, run.data?.workflowVersionId]);

  const uiRun = React.useMemo(() => {
    if (!run.data) return null;
    const base = toUiRun(run.data, incident ?? undefined);
    if (!stepNames) return base;
    return {
      ...base,
      nodes: base.nodes.map((n) => {
        const step = stepNames.get(n.id);
        if (!step) return n;
        const kind = step.kind === "agent_team" ? "agent" : step.kind;
        return { ...n, name: step.name, kind };
      }),
    };
  }, [run.data, incident, stepNames]);

  /* A run that is still moving is followed; a finished one is not. Watching a
     completed run forever is the kind of thing nobody notices until it is a
     line on a bill. */
  const live = run.data ? IN_FLIGHT.has(run.data.status) : false;

  /*
   * ── WHY THIS IS A STREAM AND WAS A THREE-SECOND POLL ─────────────────────
   *
   * The log panel lagged, and the reason was not the interval. The poll asked
   * for `page: 1, pageSize: 200`, and `RunEventRepository.listByRun` orders
   * `sequence ASC` — so it re-fetched the OLDEST two hundred events every three
   * seconds. On a run that emits more than two hundred, the newest events never
   * arrived at all: not a delay, a ceiling. Short runs merely felt slow.
   *
   * `openRunStream` already solved this and nothing imported it. It is the SSE
   * client for `GET /api/runs/:id/stream`, with reconnect backoff, de-duplication
   * on `sequence`, a backfill through `?afterSequence=` that closes the server's
   * 500-event replay hole, and a polling fallback for when Redis is absent and
   * the server says `stream_unavailable`. It has its own tests.
   *
   * The run RECORD is still re-read on a timer, deliberately: status, cost and
   * token totals live on `agent_runs` and are not published as events, so
   * nothing would move them. That poll is slower than the old one because it no
   * longer carries the log.
   */
  const [streamState, setStreamState] = React.useState<RunStreamState | null>(null);

  React.useEffect(() => {
    if (!live || !workspaceId) return;

    const stream = openRunStream({
      runId,
      baseUrl: getApiBaseUrl(),
      /* `.token`, not the record: `getAccessToken` returns the whole
         AccessToken (with its expiry and user), and the stream wants the bearer
         string. Same unwrap the trace stream does. */
      getToken: async () => (await getAccessToken())?.token ?? null,
      workspaceId,
      onEvent: () => {
        /* The event is already in the cache's future: refetching the page is
           cheaper to keep correct than merging one event into a paged query,
           and it happens only when something actually happened — which is the
           whole difference from a timer. */
        void events.refetch();
      },
      onStatus: setStreamState,
      onComplete: () => {
        /* Terminal. Read the run once more so the header stops saying running. */
        void run.refetch();
        void events.refetch();
      },
    });

    return () => stream.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, runId, workspaceId]);

  React.useEffect(() => {
    if (!live) return;
    /* The run row itself. Ten seconds, not three: the log no longer rides on
       this timer, and the fields it carries change at step boundaries. */
    const timer = window.setInterval(() => {
      void run.refetch();
      if (parked) void waits.refetch();
    }, 10_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, parked, runId]);

  const error = (run.error ?? null) as VectorbeaApiError | null;
  const refetch = React.useCallback(async () => {
    await Promise.all([run.refetch(), events.refetch(), parked ? waits.refetch() : null]);
  }, [run, events, waits, parked]);
  const cancel = React.useCallback(async () => {
    await api.runs.cancel(runId, scope);
    await refetch();
  }, [api, runId, scope, refetch]);

  /*
   * ── THE TWO RETRIES ──────────────────────────────────────────────────────
   *
   * `POST /api/runs/:id/retry-node` and `POST /api/runs/:id/retry` have both
   * existed since the run routes were written. The header rendered a button for
   * each and passed neither a handler, so both were affordances that did
   * nothing — pressed, the page did not even flicker.
   *
   * Each refetches afterwards rather than optimistically restating the status:
   * the API decides whether the run was in a retryable state at all, and
   * painting "queued" before it answers would show a state the server may
   * refuse.
   */
  const retryStep = React.useCallback(async (nodeId: string) => {
    await api.runs.retryNode(runId, nodeId, scope);
    await refetch();
  }, [api, runId, scope, refetch]);

  /**
   * Requeue a delivery.
   *
   * Refetches afterwards rather than optimistically flipping the row to
   * `pending`: the API decides whether the delivery was in a requeueable state
   * at all, and painting a state the server may refuse is how a UI ends up
   * disagreeing with the thing it is showing.
   */
  const redeliverDelivery = React.useCallback(async (deliveryId: string) => {
    await api.runs.redeliver(deliveryId, scope);
    await deliveries.refetch();
  }, [api, scope, deliveries]);

  const retryRun = React.useCallback(async () => {
    await api.runs.retry(runId, scope);
    await refetch();
  }, [api, runId, scope, refetch]);

  return {
    run: uiRun,
    detail: run.data ?? null,
    events: events.data?.items ?? [],
    waits: parked ? waits.data?.items ?? [] : [],
    deliveries: deliveries.data?.items ?? [],
    redeliver: redeliverDelivery,
    incident,
    loading: enabled && run.isPending,
    // Distinguished from any other failure: "this run does not exist" and "the
    // API is unreachable" need different words and different remedies.
    notFound: error?.status === 404,
    error: error?.status === 404 ? null : error,
    refetch,
    cancel,
    retryStep,
    retryRun,
    /*
     * How the log is arriving. Null when the run is finished and nothing is
     * following it. The panel says "Refreshing on a timer" for `polling`,
     * because a reader watching a quiet log deserves to know whether it is
     * quiet or stalled.
     */
    stream: streamState,
    scope,
  };
}
