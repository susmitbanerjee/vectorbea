"use client";

import * as React from "react";

import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { deriveAttention } from "./derive";
import type { AttentionItem } from "./model";

/**
 * The attention feed, from live data.
 *
 * Shared by the notification inbox in the shell and the summary line on
 * Control, so the bell and the page can never disagree about how many things
 * need doing — they are the same query, deduplicated by TanStack's cache under
 * one key rather than fetched twice.
 *
 * Workspace-scoped, not environment-scoped, for the same reason as the rest of
 * Control: the header is optional on reads, and every row in the database
 * points at an `environment_id` that is not in the `environments` table, so
 * filtering by the real environment returns nothing.
 */
export function useAttention(): { items: AttentionItem[]; loading: boolean } {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId);

  const runs = useApiQuery({
    queryKey: queryKeys.runs.list(keyScope, { pageSize: 100 }),
    queryFn: () => api.runs.list({ ...scope, pageSize: 100 }),
    enabled,
  });
  const workflows = useApiQuery({
    queryKey: queryKeys.workflows.list(keyScope),
    queryFn: () => api.workflows.list({ ...scope, pageSize: 100 }),
    enabled,
  });
  const connections = useApiQuery({
    queryKey: queryKeys.connections.list(keyScope),
    queryFn: () => api.connections.list({ ...scope, pageSize: 100 }),
    enabled,
  });
  const incidents = useApiQuery({
    queryKey: [...queryKeys.env(workspaceId, null), "incidents"],
    queryFn: () => api.incidents.list({ ...scope, limit: 50 }),
    enabled,
  });

  return React.useMemo(
    () => ({
      items: deriveAttention(
        runs.data?.items ?? [],
        workflows.data?.items ?? [],
        connections.data?.items ?? [],
        incidents.data ?? [],
        Date.now(),
      ),
      loading: runs.isPending || incidents.isPending,
    }),
    [runs.data, workflows.data, connections.data, incidents.data, runs.isPending, incidents.isPending],
  );
}
