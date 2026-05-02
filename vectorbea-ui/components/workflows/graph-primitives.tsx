"use client";

import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BotMessageSquare,
  Cable,
  CheckCircle2,
  Database,
  GitBranch,
  Hand,
  PlayCircle,
  Route,
  StopCircle,
  Wrench,
} from "lucide-react";

import type { WorkflowGraphEdge, WorkflowGraphNode } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function iconForGraphNode(type: WorkflowGraphNode["type"]) {
  switch (type) {
    case "start":
      return PlayCircle;
    case "end":
      return StopCircle;
    case "agent":
    case "planner":
      return BotMessageSquare;
    case "tool_call":
      return Wrench;
    case "mcp_tool_call":
      return Cable;
    case "rag_retrieval":
    case "reranker":
      return Database;
    case "decision":
      return GitBranch;
    case "human_handoff":
      return Hand;
    case "final_response":
      return CheckCircle2;
    case "error":
      return AlertTriangle;
    default:
      return Activity;
  }
}

export function surfaceToneForGraphNode(node: WorkflowGraphNode, selected: boolean) {
  if (selected) return "border-[#93C5FD] bg-[#EFF6FF] ring-2 ring-[#2563EB]/15";
  if (node.status === "failed" || node.type === "error") return "border-[#FECACA] bg-[#FEF2F2]";
  if (node.type === "human_handoff") return "border-[#FDE68A] bg-[#FFFBEB]";
  if (node.type === "final_response" || node.type === "end") return "border-[#BBF7D0] bg-[#F0FDF4]";
  return "border-[#E7DED1] bg-white";
}

export function badgeToneForGraphNode(node: WorkflowGraphNode) {
  if (node.status === "failed" || node.type === "error") return "bg-[#FEE2E2] text-[#991B1B]";
  if (node.type === "human_handoff") return "bg-[#FEF3C7] text-[#92400E]";
  if (node.type === "final_response" || node.type === "end") return "bg-[#DCFCE7] text-[#166534]";
  return "bg-[#EFF6FF] text-[#1D4ED8]";
}

export function GraphMetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E7DED1] bg-white px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8A7F72]">{label}</p>
      <p className="mt-1 text-xs font-medium text-[#111111]">{value}</p>
    </div>
  );
}

export function GraphSection({
  title,
  children,
  empty,
}: {
  title: string;
  children?: ReactNode;
  empty?: string;
}) {
  const isEmpty = children == null || children === false || children === "";
  return (
    <div className="rounded-2xl border border-[#E7DED1] bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8A7F72]">{title}</p>
      {isEmpty ? (
        <p className="mt-2 text-xs text-[#6B7280]">{empty ?? "No data recorded for this section."}</p>
      ) : (
        <div className="mt-2">{children}</div>
      )}
    </div>
  );
}

export function JsonPreview({ value, empty }: { value: unknown; empty: string }) {
  if (
    value == null ||
    value === "" ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0)
  ) {
    return <p className="text-xs text-[#6B7280]">{empty}</p>;
  }

  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[#EEE6DA] bg-[#FBFAF7] p-3 text-[11px] leading-5 text-[#374151]">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function GraphCanvas({
  title,
  subtitle,
  nodes,
  edges,
  selectedId,
  onSelect,
  sourceBadge,
  rightPanel,
  banner,
}: {
  title: string;
  subtitle: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sourceBadge?: string | null;
  rightPanel: ReactNode;
  banner?: ReactNode;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_380px]">
      <div className="rounded-3xl border border-[#E7DED1] bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#111111]">{title}</h3>
            <p className="mt-1 text-xs text-[#6B7280]">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sourceBadge ? <Badge className="bg-[#F8F5EF] text-[#6B7280]">{sourceBadge}</Badge> : null}
            <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">
              <Route className="mr-1 h-3 w-3" />
              {nodes.length} nodes
            </Badge>
          </div>
        </div>

        {banner ? <div className="mb-4">{banner}</div> : null}

        {nodes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D8CFC2] bg-[#FBFAF7] px-4 py-10 text-center">
            <p className="text-sm font-medium text-[#374151]">No graph nodes available.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px] space-y-3 rounded-3xl bg-[#FAF7F0] p-4">
              {nodes.map((node, index) => {
                const Icon = iconForGraphNode(node.type);
                const outgoing = edges.filter((edge) => edge.from === node.id);
                return (
                  <div key={node.id} className="space-y-2">
                    <button
                      type="button"
                      onClick={() => onSelect(node.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition hover:shadow-sm",
                        surfaceToneForGraphNode(node, selectedId === node.id),
                      )}
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#EDE5D8] bg-[#F8F5EF] text-[#374151]">
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-[#111111]">{node.name}</p>
                          <Badge className={badgeToneForGraphNode(node)}>{node.type.replaceAll("_", " ")}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-[#6B7280]">
                          {[node.provider, node.model, node.toolName, node.mcpServerName].filter(Boolean).join(" · ") || "Workflow node"}
                        </p>
                      </div>
                      <div className="text-right text-[11px] text-[#6B7280]">
                        <p>{node.latencyMs != null ? `${node.latencyMs} ms` : "—"}</p>
                        <p>{node.costEstimate != null ? `$${node.costEstimate.toFixed(4)}` : "—"}</p>
                      </div>
                    </button>
                    {index < nodes.length - 1 ? (
                      <div className="ml-10 border-l-2 border-dashed border-[#D8CFC2] pl-6 text-[11px] text-[#8A7F72]">
                        {outgoing[0]?.label ?? (outgoing[0]?.reason === "parent_span" ? "Parent-child edge" : "Observed path")}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-[#E7DED1] bg-white p-5 shadow-sm">{rightPanel}</div>
    </div>
  );
}
