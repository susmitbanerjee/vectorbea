"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, RefreshCw, Trash2, ArrowRight, Cpu, Wrench } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/icons/vectorbea-icons";
import { ProviderIcon } from "@/components/ui/provider-icon";
import type { Agent } from "@/types/platform";
import { getAgents, deleteAgent } from "@/lib/repository";
import { AppSelect } from "@/components/ui/app-select";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyHint } from "@/components/ui/page-kit";

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

// model → provider (for the BYOK logo + label)
function providerInfo(model: string): { label: string; type: string } | null {
  const m = (model ?? "").toLowerCase();
  if (!m) return null;
  if (/(gpt|^o1|^o3|chatgpt|davinci|text-embedding)/.test(m)) return { label: "OpenAI", type: "openai" };
  if (m.includes("claude")) return { label: "Anthropic", type: "anthropic" };
  if (m.includes("gemini") || m.includes("bison") || m.includes("palm")) return { label: "Google", type: "google" };
  if (m.includes("qwen")) return { label: "Qwen", type: "qwen" };
  if (m.includes("llama")) return { label: "Llama", type: "meta" };
  if (m.includes("mistral") || m.includes("mixtral")) return { label: "Mistral", type: "mistral" };
  if (m.includes("deepseek")) return { label: "DeepSeek", type: "deepseek" };
  if (m.includes("grok")) return { label: "Grok", type: "grok" };
  return { label: "Model", type: "generic" };
}

function timeAgo(ts: string | null) {
  if (!ts) return "never";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const STATUS: Record<Agent["status"], { dot: string; label: string; color: string }> = {
  active:     { dot: "bg-emerald-500", label: "Active",     color: "#047857" },
  inactive:   { dot: "bg-[#C9CED4]",   label: "Inactive",   color: "#9CA3AF" },
  deprecated: { dot: "bg-red-500",     label: "Deprecated", color: "#DC2626" },
};

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
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.03em] text-[#0B0D0F]">Agents</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[12.5px] text-[#6B7280]">
            {loading ? "loading…" : (
              <>
                <span className="font-semibold text-[#0B0D0F]">{agents.length}</span> registered
                <span className="text-[#D7DBE0]">·</span>
                <span className="font-semibold text-[#007F4E]">{activeCount}</span> active
                <span className="text-[#D7DBE0]">·</span>
                <span className="font-semibold text-[#0B0D0F]">{totalRuns.toLocaleString()}</span> runs
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} title="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5 text-[#6B7280]", loading && "animate-spin")} />
          </button>
          <Link href={"/agents/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            <Plus className="h-4 w-4" /> New agent
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput containerClassName="w-[280px] max-w-full" placeholder="Search agents…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <AppSelect className="w-[150px]" value={typeFilter} onValueChange={(v) => setTypeFilter(v as Agent["type"] | "")}
          options={[{ label: "All types", value: "" }, ...(Object.keys(TYPE_LABELS) as Agent["type"][]).map((t) => ({ label: TYPE_LABELS[t], value: t }))]} />
        <AppSelect className="w-[150px]" value={statusFilter} onValueChange={(v) => setStatusFilter(v as Agent["status"] | "")}
          options={[{ label: "All statuses", value: "" }, { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }, { label: "Deprecated", value: "deprecated" }]} />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[124px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyHint
          icon={Cpu}
          title={agents.length === 0 ? "No agents registered" : "No agents match your filters"}
          desc={agents.length === 0 ? "Agents are the reasoning steps in your workflows — register one to get started." : undefined}
          action={agents.length === 0 ? (
            <Link href={"/agents/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]"><Plus className="h-3.5 w-3.5" /> Register first agent</Link>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((agent) => {
            const prov = providerInfo(agent.modelName);
            const toolCount = (agent.allowedToolIds ?? []).length;
            const st = STATUS[agent.status];
            return (
              <div key={agent.id} className="group flex flex-col overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white transition-all hover:border-[#C9CED4] hover:shadow-[0_6px_20px_rgba(11,13,15,0.05)]">
                {/* Header — node-card aesthetic */}
                <div className="flex items-start gap-3 p-4">
                  {prov ? (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[#E0E3E6] bg-white">
                      <ProviderIcon providerType={prov.type} className="h-[18px] w-[18px]" />
                    </span>
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[#9CCFBB] bg-[#E6F4EF] text-[#007F4E]">
                      <AgentIcon className="h-[18px] w-[18px]" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/agents/${agent.id}` as never} className="block truncate text-[14.5px] font-semibold tracking-[-0.01em] text-[#0B0D0F] hover:text-[#007F4E]">
                      {agent.name}
                    </Link>
                    <p className="mt-0.5 truncate font-mono text-[11.5px] text-[#6B7280]">
                      {agent.modelName
                        ? <>{agent.modelName}{prov && prov.type !== "generic" && <span className="text-[#9CA3AF]"> · BYOK {prov.label}</span>}</>
                        : <span className="text-[#9CA3AF]">{TYPE_LABELS[agent.type]}</span>}
                    </p>
                  </div>
                </div>

                {/* Role / description strip */}
                {(agent.role || agent.description) && (
                  <p className="-mt-1 truncate px-4 pb-3 text-[12.5px] text-[#4B5563]">{agent.role || agent.description}</p>
                )}

                {/* Footer — muted status row */}
                <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
                  <span className="flex items-center gap-2 font-mono text-[11.5px] text-[#6B7280]">
                    <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
                    <span style={{ color: st.color }} className="font-semibold">{st.label}</span>
                    <span className="text-[#D7DBE0]">·</span>
                    {(agent.totalRuns ?? 0).toLocaleString()} runs
                    {toolCount > 0 && <><span className="text-[#D7DBE0]">·</span><span className="inline-flex items-center gap-0.5"><Wrench className="h-3 w-3" />{toolCount}</span></>}
                    <span className="text-[#D7DBE0]">·</span>
                    {timeAgo(agent.lastUsedAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    {confirmId === agent.id ? (
                      <>
                        <button type="button" onClick={() => handleDelete(agent.id)} disabled={deletingId === agent.id} className="flex h-7 items-center gap-1 rounded-[6px] bg-[#FEF2F2] px-2 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEE2E2] disabled:opacity-50">{deletingId === agent.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}</button>
                        <button type="button" onClick={() => setConfirmId(null)} className="flex h-7 items-center rounded-[6px] px-2 text-[11px] text-[#6B7280] hover:bg-[#F3F4F5]">Cancel</button>
                      </>
                    ) : (
                      <>
                        <Link href={`/agents/${agent.id}` as never} className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-[#4B5563] opacity-0 transition-opacity hover:bg-[#ECEEEF] hover:text-[#0B0D0F] group-hover:opacity-100">View <ArrowRight className="h-3 w-3" /></Link>
                        <button type="button" onClick={() => setConfirmId(agent.id)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#9CA3AF] opacity-0 transition-all hover:bg-[#FEF2F2] hover:text-[#DC2626] group-hover:opacity-100" title="Delete agent"><Trash2 className="h-3.5 w-3.5" /></button>
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
