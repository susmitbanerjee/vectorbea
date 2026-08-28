"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { toUiRun } from "~/components/app/runs/use-runs-data";
import type { Run } from "~/lib/runs/model";
import type { VectorbeaApiError } from "~/lib/api/errors";

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
  incident: contracts.FailureIncident | null;
  loading: boolean;
  /** True only when the API positively answered 404. */
  notFound: boolean;
  error: VectorbeaApiError | null;
  refetch: () => Promise<void>;
  cancel: () => Promise<void>;
  scope: { workspaceId: string | null; environmentId: string | null };
}

/** Statuses where more is still going to happen, so the page should keep looking. */
const IN_FLIGHT = new Set<contracts.RunStatus>([
  "queued", "running", "recovering", "yielded",
  "waiting_for_approval", "awaiting_approval", "waiting_for_timer",
  "cancellation_requested", "paused",
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

  const uiRun = React.useMemo(
    () => (run.data ? toUiRun(run.data, incident ?? undefined) : null),
    [run.data, incident],
  );

  /* A run that is still moving is re-read; a finished one is not. Polling a
     completed run forever is the kind of thing nobody notices until it is a
     line on a bill. */
  const live = run.data ? IN_FLIGHT.has(run.data.status) : false;
  React.useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      void run.refetch();
      void events.refetch();
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, runId]);

  const error = (run.error ?? null) as VectorbeaApiError | null;
  const refetch = React.useCallback(async () => {
    await Promise.all([run.refetch(), events.refetch()]);
  }, [run, events]);
  const cancel = React.useCallback(async () => {
    await api.runs.cancel(runId, scope);
    await refetch();
  }, [api, runId, scope, refetch]);

  return {
    run: uiRun,
    detail: run.data ?? null,
    events: events.data?.items ?? [],
    incident,
    loading: enabled && run.isPending,
    // Distinguished from any other failure: "this run does not exist" and "the
    // API is unreachable" need different words and different remedies.
    notFound: error?.status === 404,
    error: error?.status === 404 ? null : error,
    refetch,
    cancel,
    scope,
  };
}
