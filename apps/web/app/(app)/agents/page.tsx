"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Agent } from "@/types/platform";
import { getAgents } from "@/lib/repository";
import { AppSelect } from "@/components/ui/app-select";
import { SearchInput } from "@/components/ui/search-input";

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
  router_agent:                 "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Agent["type"] | "">("");
  const [statusFilter, setStatusFilter] = useState<Agent["status"] | "">("");

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

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title" style={{ color: "var(--text-primary)" }}>
            Agent Registry
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${agents.length} agent${agents.length !== 1 ? "s" : ""} registered`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 transition-colors hover:bg-muted disabled:opacity-40"
            style={{ background: "var(--surface-1)" }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <Link
            href={"/agents/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:bg-[#1E293B]"
          >
            <Plus className="h-4 w-4" />
            New Agent
          </Link>
        </div>
      </div>

      {/* ── Filters — horizontal row ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mt-4 mb-4">
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

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60" style={{ background: "var(--surface-1)" }}>
        {loading ? (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted ml-auto" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <Bot className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">
              {agents.length === 0 ? "No agents registered" : "No agents match your filters"}
            </p>
            {agents.length === 0 && (
              <Link
                href={"/agents/new" as never}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[13px] font-semibold text-white hover:bg-[#1E293B]"
              >
                <Plus className="h-3.5 w-3.5" />
                Register first agent
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/10">
                  {["Agent", "Type", "Role", "Model", "Tools", "Status", "Runs", "Last used", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((agent) => (
                  <tr key={agent.id} className="group transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/agents/${agent.id}` as never}
                        className="block text-[13px] font-medium hover:underline"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {agent.name}
                      </Link>
                      {agent.description && (
                        <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-muted-foreground">
                          {agent.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", TYPE_COLORS[agent.type])}>
                        {TYPE_LABELS[agent.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-muted-foreground max-w-[140px]">
                      <span className="truncate block">{agent.role || <span className="opacity-40">—</span>}</span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-muted-foreground">
                      {agent.modelName || <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-muted-foreground">
                      {(agent.allowedToolIds ?? []).length > 0 ? (
                        <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium">
                          {(agent.allowedToolIds ?? []).length}
                        </span>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        agent.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : agent.status === "deprecated"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]",
                      )}>
                        {agent.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                      {(agent.totalRuns ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-muted-foreground">
                      {timeAgo(agent.lastUsedAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/agents/${agent.id}` as never}
                        className="text-[11px] text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
