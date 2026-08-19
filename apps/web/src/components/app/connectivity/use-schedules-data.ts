"use client";

import * as React from "react";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";

export function useSchedulesData() {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const query = useApiQuery({
    queryKey: [...queryKeys.env(workspaceId, null), "schedules"],
    queryFn: () => api.schedules.list(scope),
    enabled: Boolean(workspaceId),
    freshness: "live",
  });
  return { rows: query.data ?? [], scope, loading: query.isPending, error: query.error, refetch: query.refetch };
}
