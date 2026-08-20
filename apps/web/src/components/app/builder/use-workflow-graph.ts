"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { useEnvironmentUuid } from "~/lib/workspace/use-environment-uuid";
import { fromStoredGraph, toStoredGraph, triggerConfigFrom } from "~/lib/workflows/graph-codec";
import type { BuilderGraph } from "~/lib/workflows/builder-graph";
import { autoLayout } from "./layout";
import type { VectorbeaApiError } from "~/lib/api/errors";

/* ══════════════════════════════════════════════════════════════════════════════
   THE BUILDER'S DATA

   Load: `GET /api/workflows/:id` for the row, `GET /api/workflows/:id/versions`
   for the graph. The detail endpoint does NOT return the graph — it reads the
   current version only to count nodes — so the version list is the only place
   the canvas can get one.

   Save: `POST /api/workflows/:id/versions`. There is no PATCH for a graph; a
   change is a NEW VERSION, and the route points `current_version_id` at it. That
   is also what materialises the cron schedule, via `triggerConfig`.

   AUTO-LAYOUT RUNS ONCE, AND ONLY WHEN THE STORED GRAPH HAS NO POSITIONS.
   Running it on every open is what made every workflow look like the same
   straight line and made dragging feel broken: the positions were re-derived
   before anybody could see the saved ones. Now a graph that has been placed
   opens where it was left, and one that never has is laid out and that layout is
   what the first save writes.
══════════════════════════════════════════════════════════════════════════════ */

export type SaveState = "saved" | "dirty" | "saving" | "error";

export interface WorkflowGraphData {
  workflow: contracts.Workflow | null;
  /** The decoded canvas graph, or null until it has loaded. */
  graph: BuilderGraph | null;
  version: contracts.WorkflowVersion | null;
  loading: boolean;
  error: VectorbeaApiError | null;
  /** True when the graph had no stored positions and was laid out on open. */
  wasLaidOut: boolean;
  save: (graph: BuilderGraph) => Promise<void>;
  /** Mirror a store edit into the save indicator. */
  markDirty: () => void;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  canSave: boolean;
}

export function useWorkflowGraph(workflowId: string): WorkflowGraphData {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  const environment = useEnvironmentUuid();

  const enabled = Boolean(scope.workspaceId) && Boolean(workflowId);
  const keyScope = { workspaceId: scope.workspaceId, environmentId: null };
  const readScope = React.useMemo(
    () => ({ workspaceId: scope.workspaceId, environmentId: null }),
    [scope.workspaceId],
  );

  const workflowQuery = useApiQuery({
    queryKey: queryKeys.workflows.detail(keyScope, workflowId),
    queryFn: () => api.workflows.get(workflowId, readScope),
    enabled,
  });

  const versionsQuery = useApiQuery({
    queryKey: queryKeys.workflows.versions(keyScope, workflowId),
    queryFn: () => api.workflows.versions(workflowId, { ...readScope, page: 1, pageSize: 50 }),
    enabled,
  });

  /**
   * The version the canvas edits.
   *
   * `currentVersionId` when the workflow has one, otherwise the highest version
   * number — a workflow can have versions without a current one if a save landed
   * while the pointer update did not, and opening the builder on nothing in that
   * case would look like the graph had been lost.
   */
  const version = React.useMemo<contracts.WorkflowVersion | null>(() => {
    const items = versionsQuery.data?.items ?? [];
    if (items.length === 0) return null;
    const current = workflowQuery.data?.currentVersionId;
    return (
      items.find((v) => v.id === current)
      ?? [...items].sort((a, b) => b.version - a.version)[0]
      ?? null
    );
  }, [versionsQuery.data, workflowQuery.data?.currentVersionId]);

  const decoded = React.useMemo(() => {
    if (!version) return null;
    return fromStoredGraph(version.graph);
  }, [version]);

  /**
   * The graph handed to the store, laid out only if it has never been placed.
   *
   * Memoised on the VERSION ID rather than on the decoded object so a refetch
   * that returns an identical version cannot re-run the layout and shunt the
   * user's nodes back to the dagre positions mid-edit.
   */
  const graph = React.useMemo<BuilderGraph | null>(() => {
    if (!decoded) return null;
    const base: BuilderGraph = { nodes: decoded.nodes, edges: decoded.edges };
    if (!decoded.needsLayout || base.nodes.length === 0) return base;
    return autoLayout(base.nodes, base.edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id]);

  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);

  const save = React.useCallback(async (next: BuilderGraph) => {
    const environmentId = environment.environmentId;
    if (!environmentId) {
      setSaveState("error");
      setSaveError(
        environment.foreign
          ? "The only environment this deployment can name belongs to a different workspace, so this version cannot be written here. Your changes are still on the canvas."
          : "No environment resolved, so the version cannot be written. Your changes are still on the canvas — reload once the API is reachable.",
      );
      return;
    }

    setSaveState("saving");
    setSaveError(null);

    try {
      await api.workflows.createVersion(
        workflowId,
        {
          graph: toStoredGraph(next),
          // Lifted off the trigger node: without it `syncSchedule` deletes the
          // workflow's schedule row, so saving a layout change would silently
          // unschedule a cron workflow.
          triggerConfig: triggerConfigFrom(next),
        },
        { workspaceId: scope.workspaceId, environmentId },
      );

      setSaveState("saved");
      setLastSavedAt(Date.now());

      // The new version is now current: the version list, the workflow row and
      // the list's step counts are all stale.
      await queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all(keyScope) });
    } catch (error) {
      setSaveState("error");
      setSaveError(
        error instanceof Error
          ? error.message
          : "The version could not be written. Your changes are still on the canvas.",
      );
    }
    // `keyScope` is rebuilt each render; its contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, environment.environmentId, queryClient, scope.workspaceId, workflowId]);

  /**
   * Marked dirty by the view when the store reports an edit.
   *
   * The reducer already owns `dirty` — this only mirrors it into the indicator,
   * and refuses to overwrite "saving" so a keystroke landing mid-request cannot
   * make a save in flight look like it never started.
   */
  const markDirty = React.useCallback(() => {
    setSaveState((current) => (current === "saving" ? current : "dirty"));
  }, []);

  return {
    markDirty,
    workflow: workflowQuery.data ?? null,
    graph,
    version,
    loading: enabled && (workflowQuery.isPending || versionsQuery.isPending),
    error: workflowQuery.error ?? versionsQuery.error ?? null,
    wasLaidOut: decoded?.needsLayout ?? false,
    save,
    saveState,
    saveError,
    lastSavedAt,
    canSave: environment.environmentId !== null,
  };
}
