"use client";

import * as React from "react";

import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import {
  deriveAttention, deriveCostTrend, deriveFleet, deriveHealth, deriveLatency,
  runsAreComplete, runsInRange,
} from "~/lib/control/derive";
import type {
  AttentionItem, CostTrend, FleetRow, FleetSort, HealthSnapshot,
  LatencyDistribution, TimeRange, ControlBudgetSettings,
} from "~/lib/control/model";

/**
 * Control's data, from the API.
 *
 * One page of runs feeds the health strip, the fleet strip, the latency
 * distribution and the cost trend. That is deliberate: none of those four has
 * an endpoint of its own, and the alternative — a request per workflow — is the
 * N+1 the fleet band exists to avoid.
 *
 * SCOPE IS WORKSPACE, NOT ENVIRONMENT. Control is a workspace-level reading,
 * and the environment header is optional on reads. Omitting it also avoids a
 * live data bug worth knowing about: every workflow and run row in the database
 * references an `environment_id` that is not present in the `environments`
 * table, so filtering by the workspace's real environment returns nothing at
 * all. Scoping to the workspace shows the rows that exist.
 */

/** Enough runs to fill a 30-cell heatstrip for several workflows. */
const RUN_PAGE_SIZE = 100;

export interface ControlData {
  health: HealthSnapshot;
  attention: AttentionItem[];
  fleet: FleetRow[];
  latency: LatencyDistribution;
  cost: CostTrend;
  /** False when the run page did not cover the whole selected range. */
  complete: boolean;
  /** True until the first successful load of every query. */
  loading: boolean;
  /** Set when a query failed outright. Individual degradations are not errors. */
  error: Error | null;
  /** Endpoints that answered with a failure, for honest partial rendering. */
  unavailable: string[];
  refetch: () => void;
}

export function useControlData(
  range: TimeRange,
  sort: FleetSort,
  tick = 0,
): ControlData {
  const api = useApi();
  const { workspaceId } = useScope();
  // Environment is intentionally not part of the scope — see the note above.
  const scope = React.useMemo(
    () => ({ workspaceId, environmentId: null }),
    [workspaceId],
  );
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId);

  const runs = useApiQuery({
    queryKey: [...queryKeys.runs.list(keyScope, { pageSize: RUN_PAGE_SIZE }), tick],
    queryFn: () => api.runs.list({ ...scope, pageSize: RUN_PAGE_SIZE }),
    enabled,
    freshness: "list",
  });

  const workflows = useApiQuery({
    queryKey: [...queryKeys.workflows.list(keyScope), tick],
    queryFn: () => api.workflows.list({ ...scope, pageSize: RUN_PAGE_SIZE }),
    enabled,
  });

  const metrics = useApiQuery({
    queryKey: [...queryKeys.env(workspaceId, null), "control-metrics", tick],
    queryFn: () => api.controlMetrics(scope),
    enabled,
    freshness: "live",
  });

  const incidents = useApiQuery({
    queryKey: [...queryKeys.env(workspaceId, null), "incidents", tick],
    queryFn: () => api.incidents.list({ ...scope, limit: 50 }),
    enabled,
  });

  const connections = useApiQuery({
    queryKey: [...queryKeys.connections.list(keyScope), tick],
    queryFn: () => api.connections.list({ ...scope, pageSize: RUN_PAGE_SIZE }),
    enabled,
  });

  const budget = useApiQuery<ControlBudgetSettings>({
    queryKey: [...queryKeys.env(workspaceId, null), "control-budget", tick],
    queryFn: async () => {
      const response = await fetch(
        `/api/settings/control-budget?workspaceId=${encodeURIComponent(workspaceId ?? "")}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Failed to load operational budget");
      return response.json() as Promise<ControlBudgetSettings>;
    },
    enabled,
  });

  const now = Date.now();

  return React.useMemo(() => {
    const allRuns = runs.data?.items ?? [];
    const inRange = runsInRange(allRuns, range, now);
    const workflowList = workflows.data?.items ?? [];
    const incidentList = incidents.data ?? [];
    const connectionList = connections.data?.items ?? [];

    // A failed query is named rather than silently treated as "no data" — an
    // empty fleet strip because the endpoint 500'd looks exactly like an empty
    // fleet strip because nothing has run, and those need different responses.
    const unavailable = [
      runs.isError && "runs",
      workflows.isError && "workflows",
      metrics.isError && "control metrics",
      incidents.isError && "incidents",
      connections.isError && "connections",
      budget.isError && "operational budget",
    ].filter((x): x is string => typeof x === "string");

    return {
      health: deriveHealth(inRange, allRuns, metrics.data, incidentList, now, budget.data),
      attention: deriveAttention(inRange, workflowList, connectionList, incidentList, now),
      fleet: deriveFleet(inRange, workflowList, sort),
      latency: deriveLatency(inRange),
      cost: deriveCostTrend(inRange, range, now, budget.data),
      complete: runsAreComplete(allRuns, range, now, runs.data?.total ?? allRuns.length),
      loading: runs.isPending || workflows.isPending || budget.isPending,
      error: runs.error ?? workflows.error ?? budget.error ?? null,
      unavailable,
      refetch: () => {
        void runs.refetch();
        void workflows.refetch();
        void metrics.refetch();
        void incidents.refetch();
        void connections.refetch();
      },
    };
    // `now` is recomputed each render by design; the tick in every query key is
    // what actually drives a refetch, so it is not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, workflows, metrics, incidents, connections, budget, range, sort]);
}
