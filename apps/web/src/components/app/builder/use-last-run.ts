"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   THE LAST RUN OF THE WORKFLOW BEING EDITED.

   ── BUILD AND DEBUG ARE ONE LOOP ────────────────────────────────────────────
   Debugging a run today means leaving the builder, finding the workflow in the
   Runs list, filtering to it, picking the newest row, and opening its Debug tab.
   Five navigations, every one of which loses the canvas — its viewport, its
   selection, its undo history — so coming back means finding your place again.

   The loop people actually work in is: change a node, run it, look at what the
   node did, change it again. Every step out of that loop is a step where they
   stop doing it, and the thing that gets dropped is looking at what the node
   did.

   ── WHY IT IS ONE REQUEST AND NOT A SUBSCRIPTION ────────────────────────────
   This answers "is there anything to go and look at", which changes when a run
   is STARTED — an event the builder already knows about, because it is the one
   that starts them. So it is refetched on mount and after a trigger, and left
   alone otherwise. Polling it would put a request every few seconds behind a
   button that is usually not going to be pressed.
══════════════════════════════════════════════════════════════════════════════ */

export interface LastRun {
  /* `RunSummary`, which is what the list route returns — the detail shape has
     a graph on it and this only needs an id and a status. */
  run: contracts.RunSummary | null;
  loading: boolean;
}

export function useLastRun(workflowId: string): LastRun {
  const api = useApi();
  const { workspaceId } = useScope();
  const enabled = Boolean(workspaceId) && Boolean(workflowId);
  const keyScope = { workspaceId, environmentId: null };

  /* pageSize 1: the list is ordered newest-first by the route, and the only
     question here is which run to open. Fetching a page of twenty to use one of
     them would cost the same round trip and twenty times the payload. */
  const filters = { workflowId, page: 1, pageSize: 1 };

  const query = useApiQuery({
    queryKey: queryKeys.runs.list(keyScope, filters),
    queryFn: () => api.runs.list({ ...keyScope, ...filters }),
    enabled,
    freshness: "live",
  });

  return React.useMemo(
    () => ({ run: query.data?.items?.[0] ?? null, loading: enabled && query.isPending }),
    [query.data, query.isPending, enabled],
  );
}
