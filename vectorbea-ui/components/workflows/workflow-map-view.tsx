"use client";

import { useMemo, useState } from "react";
import { Info, Sparkles } from "lucide-react";

import type { WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { GraphCanvas, GraphMetricChip, GraphSection, JsonPreview } from "@/components/workflows/graph-primitives";

export function WorkflowMapView({
  nodes,
  edges,
  sourceBadge,
  discoveredBanner,
}: {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  sourceBadge?: string | null;
  discoveredBanner?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(nodes[0]?.id ?? null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? nodes[0] ?? null,
    [nodes, selectedId],
  );

  const metadata = (selectedNode?.metadata ?? {}) as Record<string, unknown>;

  return (
    <GraphCanvas
      title="Workflow Map"
      subtitle="The structural blueprint or discovered shape of this agent workflow, showing the expected path and common branches."
      nodes={nodes}
      edges={edges}
      selectedId={selectedId}
      onSelect={setSelectedId}
      sourceBadge={sourceBadge}
      banner={discoveredBanner ? (
        <div className="rounded-2xl border border-[#DBEAFE] bg-[#EFF6FF] p-4">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 text-[#2563EB]" />
            <div>
              <p className="text-sm font-semibold text-[#1D4ED8]">Discovered workflow map</p>
              <p className="mt-1 text-xs text-[#1D4ED8]">{discoveredBanner}</p>
            </div>
          </div>
        </div>
      ) : null}
      rightPanel={
        selectedNode ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-[#111111]">{selectedNode.name}</h3>
                <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{selectedNode.type.replaceAll("_", " ")}</Badge>
              </div>
              <p className="mt-2 text-xs text-[#6B7280]">
                Workflow Map captures the recurring blueprint of the workflow, not a single run.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <GraphMetricChip label="Avg latency" value={selectedNode.latencyMs != null ? `${selectedNode.latencyMs} ms` : "—"} />
              <GraphMetricChip label="Avg cost" value={selectedNode.costEstimate != null ? `$${selectedNode.costEstimate.toFixed(4)}` : "—"} />
              <GraphMetricChip label="Seen in traces" value={String(metadata.observedTraceCount ?? "—")} />
              <GraphMetricChip label="Recent failures" value={String(metadata.failureCount ?? "—")} />
            </div>

            <GraphSection title="Expected role">
              <div className="space-y-2 text-xs text-[#374151]">
                <p><span className="font-semibold text-[#111111]">Node type:</span> {selectedNode.type.replaceAll("_", " ")}</p>
                <p><span className="font-semibold text-[#111111]">Tool / MCP:</span> {[selectedNode.toolName, selectedNode.mcpServerName].filter(Boolean).join(" / ") || "—"}</p>
                <p><span className="font-semibold text-[#111111]">Provider / model:</span> {[selectedNode.provider, selectedNode.model].filter(Boolean).join(" / ") || "—"}</p>
              </div>
            </GraphSection>

            <GraphSection title="Expected inputs">
              <JsonPreview value={metadata.expectedInputs ?? metadata.inputSchema ?? selectedNode.inputPreview} empty="No expected inputs recorded for this workflow node." />
            </GraphSection>

            <GraphSection title="Expected outputs">
              <JsonPreview value={metadata.expectedOutputs ?? metadata.outputSchema ?? selectedNode.outputPreview} empty="No expected outputs recorded for this workflow node." />
            </GraphSection>

            <GraphSection title="Connected rules">
              <JsonPreview value={metadata.connectedRules ?? metadata.relatedRules ?? null} empty="No connected deterministic rules are linked to this workflow node yet." />
            </GraphSection>

            <GraphSection title="Observed metrics">
              <JsonPreview value={{ averageLatencyMs: selectedNode.latencyMs, averageCost: selectedNode.costEstimate, sourceBadge: metadata.sourceBadge, workflowShapeHash: metadata.workflowShapeHash }} empty="No observed metrics available yet." />
            </GraphSection>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#D8CFC2] bg-[#FBFAF7] px-4 py-8 text-center text-sm text-[#6B7280]">
            <Info className="mx-auto mb-2 h-4 w-4 text-[#A8A29E]" />
            Select a workflow node to inspect its structural role and observed metrics.
          </div>
        )
      }
    />
  );
}
