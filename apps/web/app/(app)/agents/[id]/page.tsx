"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  GitBranch,
  History,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Agent, AgentRun, Tool } from "@/types/platform";
import { getAgent, getTools, getRunsForAgent, deleteAgent, updateAgent } from "@/lib/repository";

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<Agent["type"], string> = {
  native_llm_agent:             "Native LLM",
  tool_agent:                   "Tool Agent",
  router_agent:                 "Router",
  approval_agent:               "Approval",
  imported_langgraph_node:      "LangGraph Node",
  iterative_agent:              "Iterative Agent",
  external_instrumented_agent:  "External",
};

const TYPE_COLORS: Record<Agent["type"], string> = {
  native_llm_agent:             "bg-violet-50 text-violet-700 border-violet-200",
  tool_agent:                   "bg-cyan-50 text-cyan-700 border-cyan-200",
  router_agent:                 "bg-sky-50 text-sky-700 border-sky-200",
  approval_agent:               "bg-amber-50 text-amber-700 border-amber-200",
  iterative_agent:              "bg-violet-50 text-violet-700 border-violet-200",
  imported_langgraph_node:      "bg-purple-50 text-purple-700 border-purple-200",
  external_instrumented_agent:  "bg-teal-50 text-teal-700 border-teal-200",
};

const RISK_COLORS: Record<Tool["riskLevel"], string> = {
  low:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium:   "bg-amber-500/10  text-amber-700  border-amber-500/20",
  high:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  critical: "bg-red-500/10    text-red-400    border-red-500/20",
};

const STATUS_DOT: Record<AgentRun["status"], string> = {
  succeeded:            "bg-emerald-400",
  failed:               "bg-red-400",
  running:              "bg-sky-400 animate-pulse",
  waiting_for_approval: "bg-amber-400",
  queued:               "bg-slate-400",
  paused:               "bg-slate-400",
  cancelled:            "bg-slate-500",
  timed_out:            "bg-orange-400",
};

type Tab = "overview" | "instructions" | "tools" | "policies" | "runs" | "versions";

function timeAgo(ts: string | null) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function KVRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className="text-right text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [allowedTools, setAllowedTools] = useState<Tool[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [allTools, setAllTools] = useState<Tool[]>([]);

  // ── Inline edit state ───────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    role: string;
    instructions: string;
    modelProvider: string;
    modelName: string;
    temperature: number;
    maxIterations: number;
    allowedToolIds: string[];
  } | null>(null);

  function startEdit() {
    if (!agent) return;
    setDraft({
      name: agent.name,
      description: agent.description ?? "",
      role: agent.role ?? "",
      instructions: agent.instructions ?? "",
      modelProvider: agent.modelProvider ?? "",
      modelName: agent.modelName ?? "",
      temperature: agent.temperature,
      maxIterations: agent.maxIterations,
      allowedToolIds: [...(agent.allowedToolIds ?? [])],
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
  }

  function toggleAllowedTool(toolId: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      allowedToolIds: draft.allowedToolIds.includes(toolId)
        ? draft.allowedToolIds.filter((tid) => tid !== toolId)
        : [...draft.allowedToolIds, toolId],
    });
  }

  async function saveEdit() {
    if (!agent || !draft) return;
    setSaving(true);
    try {
      const updated = await updateAgent(agent.id, {
        name: draft.name.trim(),
        description: draft.description,
        role: draft.role,
        instructions: draft.instructions,
        modelProvider: draft.modelProvider,
        modelName: draft.modelName,
        temperature: draft.temperature,
        maxIterations: draft.maxIterations,
        allowedToolIds: draft.allowedToolIds,
      });
      if (!updated) throw new Error("update failed");
      setAgent(updated);
      setAllowedTools(allTools.filter((t) => (updated.allowedToolIds ?? []).includes(t.id)));
      setEditing(false);
      setDraft(null);
      toast.success("Agent updated.");
    } catch {
      toast.error("Failed to update agent.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete agent "${agent?.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteAgent(id);
      toast.success("Agent deleted.");
      router.push("/agents" as never);
    } catch {
      toast.error("Failed to delete agent.");
      setDeleting(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [a, allTools, agentRuns] = await Promise.all([
          getAgent(id),
          getTools(),
          getRunsForAgent(id),
        ]);
        setAgent(a);
        setAllTools(allTools);
        setAllowedTools(allTools.filter((t) => (a?.allowedToolIds ?? []).includes(t.id)));
        setRuns(agentRuns);
      } catch {
        toast.error("Failed to load agent.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Agent not found.{" "}
        <Link href={"/agents" as never} className="text-primary hover:underline">← Back to registry</Link>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview",     label: "Overview",     icon: Bot },
    { id: "instructions", label: "Instructions", icon: GitBranch },
    { id: "tools",        label: "Tools",        icon: Wrench },
    { id: "policies",     label: "Policies",     icon: Shield },
    { id: "runs",         label: "Recent Runs",  icon: History },
    { id: "versions",     label: "Versions",     icon: Clock },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb + header */}
      <div className="space-y-4 px-6 pb-0 pt-6 lg:px-8">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Link href={"/agents" as never} className="flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            Agent Registry
          </Link>
          <span>/</span>
          <span style={{ color: "var(--text-primary)" }}>{agent.name}</span>
        </div>

        <div className="flex items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)" }}
          >
            <Bot className="h-6 w-6 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                {agent.name}
              </h1>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", TYPE_COLORS[agent.type])}>
                {TYPE_LABELS[agent.type]}
              </span>
              <span className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                agent.status === "active"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]",
              )}>
                {agent.status}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {agent.role && <>{agent.role} · </>}
              {agent.description || "No description"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!editing ? (
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                style={{ background: "var(--surface-2)" }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={saving}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-40"
                >
                  {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
              </>
            )}
            <Link
              href={"/agents/new" as never}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              style={{ background: "var(--surface-1)" }}
            >
              Clone
            </Link>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
            >
              {deleting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="sticky top-0 z-10 mt-4 px-6 lg:px-8"
        style={{ borderBottom: "1px solid #E2E8F0", background: "#FFFFFF" }}
      >
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(({ id: tid, label, icon: Icon }) => (
            <button
              key={tid}
              type="button"
              onClick={() => setTab(tid)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12px] font-medium transition-none whitespace-nowrap",
                tab === tid
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {tid === "tools" && allowedTools.length > 0 && (
                <span className="ml-1 rounded-full px-1.5 py-px text-[10px] tabular-nums" style={{ background: "#F1F5F9", color: "#64748B" }}>
                  {allowedTools.length}
                </span>
              )}
              {tid === "runs" && runs.length > 0 && (
                <span className="ml-1 rounded-full px-1.5 py-px text-[10px] tabular-nums" style={{ background: "#F1F5F9", color: "#64748B" }}>
                  {runs.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-8">

        {/* Overview */}
        {tab === "overview" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Identity</h2>
              {editing && draft ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">Name</label>
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="h-8 w-full rounded-lg border border-border/60 px-2.5 text-[12px]"
                      style={{ background: "var(--surface-2)" }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">Role</label>
                    <input
                      value={draft.role}
                      onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                      className="h-8 w-full rounded-lg border border-border/60 px-2.5 text-[12px]"
                      style={{ background: "var(--surface-2)" }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-muted-foreground">Description</label>
                    <textarea
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      rows={3}
                      className="w-full rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px]"
                      style={{ background: "var(--surface-2)" }}
                    />
                  </div>
                  <div className="divide-y divide-border/30">
                    <KVRow label="ID" value={<code className="font-mono text-[11px]">{agent.id}</code>} />
                    <KVRow label="Slug" value={<code className="font-mono text-[11px]">{agent.slug}</code>} />
                    <KVRow label="Type" value={TYPE_LABELS[agent.type]} />
                    <KVRow label="Status" value={agent.status} />
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  <KVRow label="ID" value={<code className="font-mono text-[11px]">{agent.id}</code>} />
                  <KVRow label="Slug" value={<code className="font-mono text-[11px]">{agent.slug}</code>} />
                  <KVRow label="Type" value={TYPE_LABELS[agent.type]} />
                  <KVRow label="Role" value={agent.role || "—"} />
                  <KVRow label="Status" value={agent.status} />
                  <KVRow label="Total runs" value={(agent.totalRuns ?? 0).toLocaleString()} />
                  <KVRow label="Last used" value={timeAgo(agent.lastUsedAt)} />
                  <KVRow label="Created" value={timeAgo(agent.createdAt)} />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Model Config</h2>
              {editing && draft ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">Provider</label>
                      <input
                        value={draft.modelProvider}
                        onChange={(e) => setDraft({ ...draft, modelProvider: e.target.value })}
                        className="h-8 w-full rounded-lg border border-border/60 px-2.5 text-[12px]"
                        style={{ background: "var(--surface-2)" }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">Model</label>
                      <input
                        value={draft.modelName}
                        onChange={(e) => setDraft({ ...draft, modelName: e.target.value })}
                        className="h-8 w-full rounded-lg border border-border/60 px-2.5 font-mono text-[12px]"
                        style={{ background: "var(--surface-2)" }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">Temperature</label>
                      <input
                        type="number"
                        step="0.1"
                        value={draft.temperature}
                        onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })}
                        className="h-8 w-full rounded-lg border border-border/60 px-2.5 text-[12px]"
                        style={{ background: "var(--surface-2)" }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">Max iterations</label>
                      <input
                        type="number"
                        value={draft.maxIterations}
                        onChange={(e) => setDraft({ ...draft, maxIterations: Number(e.target.value) })}
                        className="h-8 w-full rounded-lg border border-border/60 px-2.5 text-[12px]"
                        style={{ background: "var(--surface-2)" }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  <KVRow label="Provider" value={agent.modelProvider || "—"} />
                  <KVRow label="Model" value={<code className="font-mono text-[11px]">{agent.modelName || "—"}</code>} />
                  <KVRow label="Temperature" value={String(agent.temperature)} />
                  <KVRow label="Max iterations" value={String(agent.maxIterations)} />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4 lg:col-span-2" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Quick stats</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Total runs",    value: (agent.totalRuns ?? 0).toLocaleString() },
                  { label: "Allowed tools", value: (agent.allowedToolIds ?? []).length },
                  { label: "Last active",   value: timeAgo(agent.lastUsedAt) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-border/40 px-4 py-3" style={{ background: "var(--surface-2)" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
                    <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight" style={{ color: "var(--text-primary)" }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        {tab === "instructions" && (
          <div className="rounded-xl border border-border/60 overflow-hidden" style={{ background: "var(--surface-1)" }}>
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>System Prompt</h2>
              <span className="text-[11px] text-muted-foreground">{(agent.instructions ?? "").length} chars</span>
            </div>
            {editing && draft ? (
              <textarea
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                rows={16}
                placeholder="You are an assistant that..."
                className="min-h-[300px] w-full resize-y px-5 py-4 font-mono text-[12px] leading-6 outline-none"
                style={{ background: "transparent", color: "var(--text-primary)" }}
              />
            ) : agent.instructions ? (
              <pre className="min-h-[300px] px-5 py-4 font-mono text-[12px] leading-6 text-muted-foreground whitespace-pre-wrap">
                {agent.instructions}
              </pre>
            ) : (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <p className="text-sm text-muted-foreground">No instructions configured.</p>
                <p className="text-[11px] text-muted-foreground/60">Add a system prompt to guide this agent&apos;s behavior.</p>
              </div>
            )}
          </div>
        )}

        {/* Tools */}
        {tab === "tools" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {editing && draft ? draft.allowedToolIds.length : allowedTools.length} allowed tool{(editing && draft ? draft.allowedToolIds.length : allowedTools.length) !== 1 ? "s" : ""}
              </p>
              <Link href={"/tools/new" as never} className="text-[12px] text-primary hover:underline">
                Register tool →
              </Link>
            </div>
            {editing && draft ? (
              allTools.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-16 text-center" style={{ background: "var(--surface-1)" }}>
                  <Wrench className="h-8 w-8 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">No tools registered yet.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {allTools.map((tool) => {
                    const checked = draft.allowedToolIds.includes(tool.id);
                    return (
                      <button
                        type="button"
                        key={tool.id}
                        onClick={() => toggleAllowedTool(tool.id)}
                        className={cn(
                          "group flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                          checked ? "border-primary/40" : "border-border/60 hover:border-border",
                        )}
                        style={{ background: checked ? "rgba(37,99,235,0.05)" : "var(--surface-1)" }}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
                          <Wrench className="h-4 w-4 text-cyan-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                            {tool.name}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{tool.description}</p>
                        </div>
                        <div className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                          checked ? "border-primary bg-primary text-white" : "border-border/60",
                        )}>
                          {checked && <Check className="h-3 w-3" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : allowedTools.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-16 text-center" style={{ background: "var(--surface-1)" }}>
                <Wrench className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No tools allowed for this agent.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {allowedTools.map((tool) => (
                  <Link
                    key={tool.id}
                    href={`/tools/${tool.id}` as never}
                    className="group flex items-start gap-3 rounded-xl border border-border/60 p-4 transition-colors hover:border-border"
                    style={{ background: "var(--surface-1)" }}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
                      <Wrench className="h-4 w-4 text-cyan-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[13px] font-medium group-hover:underline" style={{ color: "var(--text-primary)" }}>
                        {tool.name}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{tool.description}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-px text-[9px] text-cyan-700 capitalize">
                          {tool.type.replace(/_/g, " ")}
                        </span>
                        <span className={cn("rounded-full border px-1.5 py-px text-[9px]", RISK_COLORS[tool.riskLevel])}>
                          {tool.riskLevel.replace(/_/g, " ")}
                        </span>
                        {tool.idempotent && (
                          <span className="rounded-full border border-slate-500/20 bg-slate-500/10 px-1.5 py-px text-[9px] text-slate-400">
                            idempotent
                          </span>
                        )}
                      </div>
                    </div>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 mt-0.5" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Policies */}
        {tab === "policies" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Memory Policy</h2>
              <div className="divide-y divide-border/30">
                <KVRow label="Type" value={agent.memoryPolicy?.type ?? "—"} />
                {agent.memoryPolicy?.retentionDays !== undefined && (
                  <KVRow label="Retention" value={`${agent.memoryPolicy.retentionDays} days`} />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Retry Policy</h2>
              <div className="divide-y divide-border/30">
                <KVRow label="Max attempts" value={agent.retryPolicy?.maxAttempts ?? "—"} />
                <KVRow label="Backoff type" value={agent.retryPolicy?.backoffType ?? "—"} />
                <KVRow label="Backoff base" value={agent.retryPolicy ? `${agent.retryPolicy.backoffMs}ms` : "—"} />
              </div>
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Timeout Policy</h2>
              <div className="divide-y divide-border/30">
                <KVRow label="Step timeout" value={agent.timeoutPolicy ? `${agent.timeoutPolicy.stepTimeoutMs / 1000}s` : "—"} />
                <KVRow label="Run timeout"  value={agent.timeoutPolicy ? `${agent.timeoutPolicy.runTimeoutMs / 1000}s`  : "—"} />
              </div>
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Approval Policy</h2>
              <div className="divide-y divide-border/30">
                <KVRow
                  label="Requires approval"
                  value={
                    agent.approvalPolicy?.requireApproval ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">Yes</span>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )
                  }
                />
                {agent.approvalPolicy?.requireApproval && agent.approvalPolicy.onTimeout && (
                  <KVRow label="On timeout" value={agent.approvalPolicy.onTimeout.replace(/_/g, " ")} />
                )}
                {agent.approvalPolicy?.requireApproval && agent.approvalPolicy.timeoutMs && (
                  <KVRow label="Timeout" value={`${agent.approvalPolicy.timeoutMs / 1000}s`} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Recent Runs */}
        {tab === "runs" && (
          <div className="space-y-3">
            {runs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-16 text-center" style={{ background: "var(--surface-1)" }}>
                <History className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No runs recorded for this agent yet.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/60" style={{ background: "var(--surface-1)" }}>
                <div className="border-b border-border/60 px-5 py-3">
                  <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {runs.length} run{runs.length !== 1 ? "s" : ""} involving this agent
                  </h2>
                </div>
                <div className="divide-y divide-border/40">
                  {runs.map((run) => (
                    <Link
                      key={run.id}
                      href={`/runs/${run.id}` as never}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/20"
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[run.status])} />
                      <span className="flex-1 truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                        {run.workflowName}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {fmtDuration(run.durationMs)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {timeAgo(run.startedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Versions */}
        {tab === "versions" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-16 text-center" style={{ background: "var(--surface-1)" }}>
            <Clock className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">Version history is not yet available.</p>
            <p className="text-[11px] text-muted-foreground/60">Agent versions will be tracked when you save changes.</p>
          </div>
        )}

      </div>
    </div>
  );
}
