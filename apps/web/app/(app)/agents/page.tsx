"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, RefreshCw, Trash2, ArrowRight, Cpu, Wrench } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { IconBadge, AgentIcon, BrainIcon, ToolIcon } from "@/components/icons/vectorbea-icons";
import type { Agent } from "@/types/platform";
import { getAgents, deleteAgent } from "@/lib/repository";
import { AppSelect } from "@/components/ui/app-select";
import { SearchInput } from "@/components/ui/search-input";
import { Chip, EmptyHint, StatTile } from "@/components/ui/page-kit";

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<Agent["type"], string> = {
  native_llm_agent:             "Native LLM",
  tool_agent:                   "Tool Agent",
  router_agent:                 "Router",
  approval_agent:               "Approval",
  imported_langgraph_node:      "LangGraph",
  iterative_agent:              "Iterative Agent",
  external_instrumented_agent:  "External",
};

const TYPE_COLORS: Record<Agent["type"], string> = {
  native_llm_agent:             "bg-violet-50 text-violet-700 border-violet-200",
  tool_agent:                   "bg-cyan-50 text-cyan-700 border-cyan-200",
  router_agent:                 "bg-teal-50 text-teal-700 border-teal-200",
  approval_agent:               "bg-amber-50 text-amber-700 border-amber-200",
  iterative_agent:              "bg-violet-50 text-violet-700 border-violet-200",
  imported_langgraph_node:      "bg-purple-50 text-purple-700 border-purple-200",
  external_instrumented_agent:  "bg-teal-50 text-teal-700 border-teal-200",
};

function timeAgo(ts: string | null) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusChip(status: Agent["status"]) {
  if (status === "active") return <Chip tone="green">Active</Chip>;
  if (status === "deprecated") return <Chip tone="red">Deprecated</Chip>;
  return <Chip tone="gray" dot={false}>Inactive</Chip>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Agent["type"] | "">("");
  const [statusFilter, setStatusFilter] = useState<Agent["status"] | "">("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId]   = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteAgent(id);
      toast.success("Agent deleted");
      setAgents(prev => prev.filter(a => a.id !== id));
    } catch {
      toast.error("Failed to delete agent");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      setAgents(await getAgents());
    } catch {
      toast.error("Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = agents.filter((a) => {
    if (search) {
      const q = search.toLowerCase();
      if (!a.name.toLowerCase().includes(q) && !a.role.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) return false;
    }
    if (typeFilter && a.type !== typeFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  const activeCount = agents.filter((a) => a.status === "active").length;
  const totalRuns = agents.reduce((s, a) => s + (a.totalRuns ?? 0), 0);

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Build</span>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.025em] text-[#0B0D0F]">Agents</h1>
          <p className="mt-1 text-[13.5px] text-[#6B7280]">
            {loading ? "Loading…" : `${agents.length} agent${agents.length !== 1 ? "s" : ""} registered for your workflows`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-[#6B7280]", loading && "animate-spin")} />
          </button>
          <Link
            href={"/agents/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]"
          >
            <Plus className="h-4 w-4" />
            New agent
          </Link>
        </div>
      </div>

      {/* Stat tiles */}
      {agents.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Agents" value={agents.length} icon={Cpu} />
          <StatTile label="Active" value={activeCount} accent="#007F4E" />
          <StatTile label="Total runs" value={totalRuns.toLocaleString()} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          containerClassName="w-[280px] max-w-full"
          placeholder="Search agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <AppSelect
          className="w-[150px]"
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as Agent["type"] | "")}
          options={[
            { label: "All types", value: "" },
            ...(Object.keys(TYPE_LABELS) as Agent["type"][]).map((t) => ({ label: TYPE_LABELS[t], value: t })),
          ]}
        />
        <AppSelect
          className="w-[150px]"
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as Agent["status"] | "")}
          options={[
            { label: "All statuses", value: "" },
            { label: "Active",      value: "active" },
            { label: "Inactive",    value: "inactive" },
            { label: "Deprecated",  value: "deprecated" },
          ]}
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[150px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyHint
          icon={Cpu}
          title={agents.length === 0 ? "No agents registered" : "No agents match your filters"}
          desc={agents.length === 0 ? "Agents are the reasoning steps in your workflows — register one to get started." : undefined}
          action={agents.length === 0 ? (
            <Link href={"/agents/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]">
              <Plus className="h-3.5 w-3.5" /> Register first agent
            </Link>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((agent) => {
            const toolCount = (agent.allowedToolIds ?? []).length;
            const isBrain = agent.type === "iterative_agent" || agent.type === "native_llm_agent";
            return (
              <div key={agent.id} className="group flex flex-col rounded-[12px] border border-[#E0E3E6] bg-white transition-colors hover:border-[#C9CED4]">
                {/* Header */}
                <div className="flex items-start gap-2.5 p-4">
                  <IconBadge
                    icon={isBrain ? BrainIcon : agent.type === "tool_agent" ? ToolIcon : AgentIcon}
                    tone={agent.type === "tool_agent" ? "tool" : "agent"}
                    size="sm"
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/agents/${agent.id}` as never} className="block truncate text-[14px] font-semibold text-[#0B0D0F] hover:text-[#007F4E]">
                      {agent.name}
                    </Link>
                    <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">
                      {agent.role || agent.description || "—"}
                    </p>
                  </div>
                  {statusChip(agent.status)}
                </div>

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-2 border-t border-[#ECEEEF] px-4 py-2.5">
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium", TYPE_COLORS[agent.type])}>
                    {TYPE_LABELS[agent.type]}
                  </span>
                  {agent.modelName && (
                    <span className="rounded-[6px] border border-[#E0E3E6] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[11px] text-[#4B5563]">
                      {agent.modelName}
                    </span>
                  )}
                  {toolCount > 0 && (
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#6B7280]">
                      <Wrench className="h-3 w-3" /> {toolCount}
                    </span>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
                  <span className="font-mono text-[11.5px] text-[#6B7280]">
                    {(agent.totalRuns ?? 0).toLocaleString()} runs · {timeAgo(agent.lastUsedAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    {confirmId === agent.id ? (
                      <>
                        <button type="button" onClick={() => handleDelete(agent.id)} disabled={deletingId === agent.id}
                          className="flex h-7 items-center gap-1 rounded-[6px] bg-[#FEF2F2] px-2 text-[11px] font-semibold text-[#DC2626] transition-colors hover:bg-[#FEE2E2] disabled:opacity-50">
                          {deletingId === agent.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)}
                          className="flex h-7 items-center rounded-[6px] px-2 text-[11px] text-[#6B7280] hover:bg-[#F3F4F5]">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <Link href={`/agents/${agent.id}` as never}
                          className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-[#4B5563] opacity-0 transition-opacity hover:bg-[#F3F4F5] hover:text-[#0B0D0F] group-hover:opacity-100">
                          View <ArrowRight className="h-3 w-3" />
                        </Link>
                        <button type="button" onClick={() => setConfirmId(agent.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#9CA3AF] opacity-0 transition-all hover:bg-[#FEF2F2] hover:text-[#DC2626] group-hover:opacity-100"
                          title="Delete agent">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
