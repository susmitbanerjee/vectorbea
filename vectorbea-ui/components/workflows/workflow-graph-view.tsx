"use client";

import { useMemo, useState } from "react";
import { Activity, BotMessageSquare, Cable, Database, GitBranch, Hand, AlertTriangle, Wrench, CheckCircle2 } from "lucide-react";

import type { WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function iconForNode(type: WorkflowGraphNode["type"]) {
  switch (type) {
    case "agent":
      return BotMessageSquare;
    case "llm_call":
      return Activity;
    case "tool_call":
      return Wrench;
    case "mcp_tool_call":
      return Cable;
    case "rag_retrieval":
      return Database;
    case "decision":
      return GitBranch;
    case "human_handoff":
      return Hand;
    case "error":
      return AlertTriangle;
    case "final_response":
      return CheckCircle2;
    default:
      return Activity;
  }
}

function accentForNode(node: WorkflowGraphNode) {
  if (node.status === "failed" || node.type === "error") {
    return "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]";
  }
  if (node.type === "human_handoff") {
    return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
  }
  if (node.type === "final_response") {
    return "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]";
  }
  return "border-[#E7DED1] bg-white text-[#111111]";
}

function statusBadge(node: WorkflowGraphNode) {
  if (node.status === "failed") return "bg-[#FEE2E2] text-[#991B1B]";
  if (node.type === "human_handoff") return "bg-[#FEF3C7] text-[#92400E]";
  if (node.type === "final_response") return "bg-[#DCFCE7] text-[#166534]";
  return "bg-[#EFF6FF] text-[#1D4ED8]";
}

export function WorkflowGraphView({
  nodes,
  edges,
  sourceBadge,
}: {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  sourceBadge?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(nodes[0]?.id ?? null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? nodes[0] ?? null,
    [nodes, selectedId],
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_360px]">
      <div className="rounded-2xl border border-[#E7DED1] bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[#111111]">Workflow graph</h3>
          {sourceBadge ? (
            <Badge className="bg-[#F8F5EF] text-[#6B7280]">{sourceBadge}</Badge>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[680px] space-y-3">
            {nodes.map((node, index) => {
              const Icon = iconForNode(node.type);
              const outgoing = edges.filter((edge) => edge.from === node.id);
              return (
                <div key={node.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(node.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition hover:shadow-sm",
                      accentForNode(node),
                      selectedId === node.id && "ring-2 ring-[#2563EB]/20",
                    )}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F8F5EF]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">{node.name}</p>
                        <Badge className={statusBadge(node)}>{node.type.replaceAll("_", " ")}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-[#6B7280]">
                        {node.provider || node.model || node.toolName || node.mcpServerName
                          ? [node.provider, node.model, node.toolName, node.mcpServerName].filter(Boolean).join(" · ")
                          : "Workflow node"}
                      </p>
                    </div>
                    <div className="text-right text-xs text-[#6B7280]">
                      <p>{node.latencyMs != null ? `${node.latencyMs} ms` : "—"}</p>
                      <p>{node.costEstimate != null ? `$${node.costEstimate.toFixed(4)}` : "—"}</p>
                    </div>
                  </button>
                  {index < nodes.length - 1 ? (
                    <div className="ml-8 border-l-2 border-dashed border-[#D8CFC2] pl-6 text-[11px] text-[#8A7F72]">
                      {outgoing[0]?.reason === "parent_span" ? "Parent-child edge" : "Sequence edge"}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#E7DED1] bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-[#111111]">Node details</h3>
        {selectedNode ? (
          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
              <p className="font-semibold text-[#111111]">{selectedNode.name}</p>
              <p className="mt-1 text-xs text-[#6B7280]">{selectedNode.type.replaceAll("_", " ")}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#E7DED1] bg-white p-3">
                <p className="text-xs text-[#6B7280]">Status</p>
                <p className="mt-1 font-medium text-[#111111]">{selectedNode.status}</p>
              </div>
              <div className="rounded-xl border border-[#E7DED1] bg-white p-3">
                <p className="text-xs text-[#6B7280]">Latency</p>
                <p className="mt-1 font-medium text-[#111111]">{selectedNode.latencyMs != null ? `${selectedNode.latencyMs} ms` : "—"}</p>
              </div>
              <div className="rounded-xl border border-[#E7DED1] bg-white p-3">
                <p className="text-xs text-[#6B7280]">Provider / Model</p>
                <p className="mt-1 font-medium text-[#111111]">{[selectedNode.provider, selectedNode.model].filter(Boolean).join(" / ") || "—"}</p>
              </div>
              <div className="rounded-xl border border-[#E7DED1] bg-white p-3">
                <p className="text-xs text-[#6B7280]">Tool / MCP</p>
                <p className="mt-1 font-medium text-[#111111]">{[selectedNode.toolName, selectedNode.mcpServerName].filter(Boolean).join(" / ") || "—"}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-[#E7DED1] bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8A7F72]">Input preview</p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-[#374151]">{selectedNode.inputPreview ?? "—"}</pre>
              </div>
              <div className="rounded-xl border border-[#E7DED1] bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8A7F72]">Output preview</p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-[#374151]">{selectedNode.outputPreview ?? "—"}</pre>
              </div>
              <div className="rounded-xl border border-[#E7DED1] bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8A7F72]">Error</p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-[#374151]">{selectedNode.error ?? "No error recorded"}</pre>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[#6B7280]">No workflow nodes yet.</p>
        )}
      </div>
    </div>
  );
}
