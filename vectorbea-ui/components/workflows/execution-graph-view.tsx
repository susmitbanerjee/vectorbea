"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, GitCompare, Info } from "lucide-react";

import type { WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { GraphCanvas, GraphMetricChip, GraphSection, JsonPreview } from "@/components/workflows/graph-primitives";

function metricValue(value: number | null | undefined, suffix = "") {
  if (value == null) return "—";
  return `${value}${suffix}`;
}

export function ExecutionGraphView({
  nodes,
  edges,
  sourceBadge,
  comparisonMessages = [],
}: {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  sourceBadge?: string | null;
  comparisonMessages?: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(nodes[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<"overview" | "input" | "output" | "metadata" | "rules">("overview");

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? nodes[0] ?? null,
    [nodes, selectedId],
  );

  const metadata = (selectedNode?.metadata ?? {}) as Record<string, unknown>;

  return (
    <GraphCanvas
      title="Execution Graph"
      subtitle="One actual run of the agent workflow, including the exact path, latency, cost, and step-level outcomes."
      nodes={nodes}
      edges={edges}
      selectedId={selectedId}
      onSelect={setSelectedId}
      sourceBadge={sourceBadge}
      banner={comparisonMessages.length > 0 ? (
        <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
          <div className="flex items-start gap-2">
            <GitCompare className="mt-0.5 h-4 w-4 text-[#B45309]" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#92400E]">Compare with Workflow Map</p>
              {comparisonMessages.map((message) => (
                <p key={message} className="text-xs text-[#92400E]">{message}</p>
              ))}
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
                {selectedNode.status === "failed" ? (
                  <Badge className="bg-[#FEE2E2] text-[#991B1B]">failed</Badge>
                ) : (
                  <Badge className="bg-[#F3F4F6] text-[#374151]">{selectedNode.status}</Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-[#6B7280]">
                Click any execution step to inspect provider, tool, MCP, retrieval, response, and rule context.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <GraphMetricChip label="Latency" value={selectedNode.latencyMs != null ? `${selectedNode.latencyMs} ms` : "—"} />
              <GraphMetricChip label="Cost" value={selectedNode.costEstimate != null ? `$${selectedNode.costEstimate.toFixed(4)}` : "—"} />
              <GraphMetricChip label="Tokens in" value={metricValue((metadata.tokensInput as number | null | undefined) ?? null)} />
              <GraphMetricChip label="Tokens out" value={metricValue((metadata.tokensOutput as number | null | undefined) ?? null)} />
            </div>

            <div className="flex flex-wrap gap-1 rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-1">
              {[
                ["overview", "Overview"],
                ["input", "Input"],
                ["output", "Output"],
                ["metadata", "Metadata"],
                ["rules", "Rules"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveTab(value as typeof activeTab)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                    activeTab === value ? "bg-white text-[#111111] shadow-sm" : "text-[#6B7280]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "overview" ? (
              <div className="space-y-3">
                <GraphSection title="Overview">
                  <div className="grid gap-2 text-xs text-[#374151]">
                    <p><span className="font-semibold text-[#111111]">Step name:</span> {String(metadata.stepLabel ?? selectedNode.name)}</p>
                    <p><span className="font-semibold text-[#111111]">Provider / model:</span> {[selectedNode.provider, selectedNode.model].filter(Boolean).join(" / ") || "—"}</p>
                    <p><span className="font-semibold text-[#111111]">Tool / MCP:</span> {[selectedNode.toolName, selectedNode.mcpServerName].filter(Boolean).join(" / ") || "—"}</p>
                    <p><span className="font-semibold text-[#111111]">Span id:</span> {String(metadata.spanId ?? "—")}</p>
                    <p><span className="font-semibold text-[#111111]">Parent span id:</span> {String(metadata.parentSpanId ?? "—")}</p>
                    <p><span className="font-semibold text-[#111111]">Error:</span> {selectedNode.error ?? "No error recorded"}</p>
                  </div>
                </GraphSection>
                {selectedNode.type === "llm_call" ? (
                  <GraphSection title="LLM call details">
                    <div className="space-y-2 text-xs text-[#374151]">
                      <p><span className="font-semibold text-[#111111]">Provider:</span> {selectedNode.provider ?? "—"}</p>
                      <p><span className="font-semibold text-[#111111]">Model:</span> {selectedNode.model ?? "—"}</p>
                      <p><span className="font-semibold text-[#111111]">Prompt version:</span> {String(metadata.promptVersion ?? "—")}</p>
                      <p><span className="font-semibold text-[#111111]">Temperature:</span> {String(metadata.temperature ?? "—")}</p>
                      <p><span className="font-semibold text-[#111111]">Max tokens:</span> {String(metadata.maxTokens ?? "—")}</p>
                    </div>
                  </GraphSection>
                ) : null}
                {selectedNode.type === "tool_call" || selectedNode.type === "mcp_tool_call" ? (
                  <GraphSection title="Tool call details">
                    <div className="space-y-2 text-xs text-[#374151]">
                      <p><span className="font-semibold text-[#111111]">Tool:</span> {selectedNode.toolName ?? "—"}</p>
                      <p><span className="font-semibold text-[#111111]">MCP server:</span> {selectedNode.mcpServerName ?? "—"}</p>
                      <p><span className="font-semibold text-[#111111]">Policy violations:</span> {String(metadata.policyViolations ?? "None recorded")}</p>
                    </div>
                  </GraphSection>
                ) : null}
                {selectedNode.type === "rag_retrieval" ? (
                  <GraphSection title="Retrieval details">
                    <div className="space-y-2 text-xs text-[#374151]">
                      <p><span className="font-semibold text-[#111111]">Query:</span> {String(metadata.query ?? "—")}</p>
                      <p><span className="font-semibold text-[#111111]">Retrieved docs:</span> {String(metadata.retrievedDocumentCount ?? "—")}</p>
                      <p><span className="font-semibold text-[#111111]">Reranker score:</span> {String(metadata.rerankerScore ?? "—")}</p>
                    </div>
                  </GraphSection>
                ) : null}
                {selectedNode.type === "final_response" || selectedNode.type === "human_handoff" ? (
                  <GraphSection title="Outcome">
                    <div className="space-y-2 text-xs text-[#374151]">
                      <p><span className="font-semibold text-[#111111]">Final action:</span> {String(metadata.finalAction ?? "—")}</p>
                      <p><span className="font-semibold text-[#111111]">Outcome status:</span> {String(metadata.outcomeStatus ?? "—")}</p>
                      <p><span className="font-semibold text-[#111111]">Outcome reason:</span> {String(metadata.outcomeReason ?? "—")}</p>
                      <p><span className="font-semibold text-[#111111]">Business outcome:</span> {String(metadata.finalBusinessOutcome ?? "—")}</p>
                    </div>
                  </GraphSection>
                ) : null}
              </div>
            ) : null}

            {activeTab === "input" ? (
              <div className="space-y-3">
                <GraphSection title="Input preview">
                  <JsonPreview
                    value={metadata.rawInputDisabled ? "Raw payload capture is disabled for this workspace." : (metadata.toolArguments ?? metadata.inputPayload ?? selectedNode.inputPreview)}
                    empty="No input payload captured for this step."
                  />
                </GraphSection>
              </div>
            ) : null}

            {activeTab === "output" ? (
              <div className="space-y-3">
                <GraphSection title="Output preview">
                  <JsonPreview
                    value={metadata.rawOutputDisabled ? "Raw payload capture is disabled for this workspace." : (metadata.toolResult ?? metadata.outputPayload ?? metadata.finalResponse ?? selectedNode.outputPreview)}
                    empty="No output payload captured for this step."
                  />
                </GraphSection>
              </div>
            ) : null}

            {activeTab === "metadata" ? (
              <div className="space-y-3">
                <GraphSection title="Metadata">
                  <JsonPreview value={metadata} empty="No metadata captured for this step." />
                </GraphSection>
              </div>
            ) : null}

            {activeTab === "rules" ? (
              <div className="space-y-3">
                <GraphSection title="Related rules">
                  <JsonPreview value={metadata.relatedRules ?? metadata.policyViolations ?? null} empty="No related rules or policy violations were attached to this step." />
                </GraphSection>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#D8CFC2] bg-[#FBFAF7] px-4 py-8 text-center text-sm text-[#6B7280]">
            <Info className="mx-auto mb-2 h-4 w-4 text-[#A8A29E]" />
            Select an execution step to inspect its details.
          </div>
        )
      }
    />
  );
}
