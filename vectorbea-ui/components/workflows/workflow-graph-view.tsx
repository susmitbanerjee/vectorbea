"use client";

import type { WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/api";
import { WorkflowMapView } from "@/components/workflows/workflow-map-view";

export function WorkflowGraphView({
  nodes,
  edges,
  sourceBadge,
}: {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  sourceBadge?: string | null;
}) {
  return (
    <WorkflowMapView
      nodes={nodes}
      edges={edges}
      sourceBadge={sourceBadge}
      discoveredBanner="This workflow map was discovered from production traces and can be confirmed as the expected blueprint."
    />
  );
}
