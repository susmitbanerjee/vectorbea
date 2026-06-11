"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, RefreshCw, Trash2, ArrowRight, Wrench, Clock } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { IconBadge, ToolIcon, HttpIcon, DatabaseIcon, EmailIcon, CodeIcon } from "@/components/icons/vectorbea-icons";
import type { Tool } from "@/types/platform";
import { getTools, deleteTool } from "@/lib/repository";
import { AppSelect } from "@/components/ui/app-select";
import { SearchInput } from "@/components/ui/search-input";
import { Chip, EmptyHint } from "@/components/ui/page-kit";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOL_TYPE_LABELS: Record<string, string> = {
  http: "HTTP", database_read: "Database (Read)", database_write: "Database (Write)", database: "Database",
  email: "Email", crm: "CRM", mcp_tool: "MCP", custom_function: "Custom Function",
  imported_tool: "Imported Tool", code: "Code", custom: "Custom", builtin: "Built-in", llm_generate: "LLM Generate",
};

function displayToolType(tool: Tool): string {
  const ui = (tool.config as Record<string, unknown> | undefined)?.uiToolType as string | undefined;
  const key = ui ?? tool.type;
  return TOOL_TYPE_LABELS[key] ?? key.replace(/_/g, " ");
}

const RISK_TONE: Record<Tool["riskLevel"], "green" | "amber" | "red"> = {
  low: "green", medium: "amber", high: "amber", critical: "red",
};
const RISK_LABELS: Record<Tool["riskLevel"], string> = { low: "Low risk", medium: "Medium", high: "High", critical: "Critical" };

function toolIcon(type: string) {
  if (type.includes("http") || type.includes("graphql")) return { Icon: HttpIcon, tone: "http" as const };
  if (type.includes("database") || type.includes("db")) return { Icon: DatabaseIcon, tone: "database" as const };
  if (type.includes("email")) return { Icon: EmailIcon, tone: "email" as const };
  if (type.includes("code") || type.includes("function")) return { Icon: CodeIcon, tone: "tool" as const };
  return { Icon: ToolIcon, tone: "tool" as const };
}

function timeAgo(ts: string | null) {
  if (!ts) return "never";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<Tool["riskLevel"] | "">("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Tool["status"] | "">("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId]   = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteTool(id);
      toast.success("Tool deleted");
      setTools(prev => prev.filter(t => t.id !== id));
    } catch {
      toast.error("Failed to delete tool");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  async function load() {
    setLoading(true);
    try { setTools(await getTools()); }
    catch { toast.error("Failed to load tools."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const filtered = tools.filter((t) => {
    if (search) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
    }
    if (riskFilter && t.riskLevel !== riskFilter) return false;
    if (typeFilter && t.type !== typeFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  });

  const allTypes = [...new Set(tools.map((t) => t.type))].sort();
  const activeCount = tools.filter((t) => t.status === "active").length;
  const totalCalls = tools.reduce((s, t) => s + (t.totalCalls ?? 0), 0);

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Build</span>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.03em] text-[#0B0D0F]">Tools</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[12.5px] text-[#6B7280]">
            {loading ? "loading…" : (
              <>
                <span className="font-semibold text-[#0B0D0F]">{tools.length}</span> registered
                <span className="text-[#D7DBE0]">·</span>
                <span className="font-semibold text-[#007F4E]">{activeCount}</span> active
                <span className="text-[#D7DBE0]">·</span>
                <span className="font-semibold text-[#0B0D0F]">{totalCalls.toLocaleString()}</span> calls
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} title="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5 text-[#6B7280]", loading && "animate-spin")} />
          </button>
          <Link href={"/tools/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            <Plus className="h-4 w-4" /> New tool
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput containerClassName="w-[260px] max-w-full" placeholder="Search tools…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <AppSelect className="w-[150px]" value={riskFilter} onValueChange={(v) => setRiskFilter(v as Tool["riskLevel"] | "")}
          options={[{ label: "All risk", value: "" }, { label: "Low", value: "low" }, { label: "Medium", value: "medium" }, { label: "High", value: "high" }, { label: "Critical", value: "critical" }]} />
        {allTypes.length > 0 && (
          <AppSelect className="w-[150px]" value={typeFilter} onValueChange={(v) => setTypeFilter(v)}
            options={[{ label: "All types", value: "" }, ...allTypes.map((t) => ({ label: t.replace(/_/g, " "), value: t }))]} />
        )}
        <AppSelect className="w-[140px]" value={statusFilter} onValueChange={(v) => setStatusFilter(v as Tool["status"] | "")}
          options={[{ label: "All statuses", value: "" }, { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }]} />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[132px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyHint
          icon={Wrench}
          title={tools.length === 0 ? "No tools registered" : "No tools match your filters"}
          desc={tools.length === 0 ? "Tools let agents call APIs, databases, and services. Register one to use it in a workflow." : undefined}
          action={tools.length === 0 ? (
            <Link href={"/tools/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]"><Plus className="h-3.5 w-3.5" /> Register first tool</Link>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((tool) => {
            const ti = toolIcon(tool.type);
            return (
              <div key={tool.id} className="group flex flex-col overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white transition-all hover:border-[#C9CED4] hover:shadow-[0_6px_20px_rgba(11,13,15,0.05)]">
                {/* Header */}
                <div className="flex items-start gap-3 p-4">
                  <IconBadge icon={ti.Icon} tone={ti.tone} size="sm" className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/tools/${tool.id}` as never} className="block truncate text-[14.5px] font-semibold tracking-[-0.01em] text-[#0B0D0F] hover:text-[#007F4E]">{tool.name}</Link>
                    <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">{tool.description || displayToolType(tool)}</p>
                  </div>
                  {tool.status === "active" ? <Chip tone="green">Active</Chip> : <Chip tone="gray" dot={false}>Inactive</Chip>}
                </div>

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-2 border-t border-[#ECEEEF] px-4 py-2.5">
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10.5px] font-medium capitalize text-cyan-700">{displayToolType(tool)}</span>
                  <Chip tone={RISK_TONE[tool.riskLevel]} dot={tool.riskLevel !== "low"}>{RISK_LABELS[tool.riskLevel]}</Chip>
                  {tool.authConnectionRef && <span className="rounded-[6px] border border-[#E0E3E6] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[10.5px] text-[#6B7280]">{tool.authConnectionRef}</span>}
                </div>

                {/* Footer */}
                <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
                  <span className="flex items-center gap-2 font-mono text-[11.5px] text-[#6B7280]">
                    {(tool.totalCalls ?? 0).toLocaleString()} calls
                    <span className="text-[#D7DBE0]">·</span>
                    {tool.timeoutMs >= 1000 ? `${tool.timeoutMs / 1000}s` : `${tool.timeoutMs}ms`}
                    <span className="text-[#D7DBE0]">·</span>
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(tool.lastUsedAt)}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {confirmId === tool.id ? (
                      <>
                        <button type="button" onClick={() => handleDelete(tool.id)} disabled={deletingId === tool.id} className="flex h-7 items-center gap-1 rounded-[6px] bg-[#FEF2F2] px-2 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEE2E2] disabled:opacity-50">{deletingId === tool.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}</button>
                        <button type="button" onClick={() => setConfirmId(null)} className="flex h-7 items-center rounded-[6px] px-2 text-[11px] text-[#6B7280] hover:bg-[#F3F4F5]">Cancel</button>
                      </>
                    ) : (
                      <>
                        <Link href={`/tools/${tool.id}` as never} className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-[#4B5563] opacity-0 transition-opacity hover:bg-[#ECEEEF] hover:text-[#0B0D0F] group-hover:opacity-100">View <ArrowRight className="h-3 w-3" /></Link>
                        <button type="button" onClick={() => setConfirmId(tool.id)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#9CA3AF] opacity-0 transition-all hover:bg-[#FEF2F2] hover:text-[#DC2626] group-hover:opacity-100" title="Delete tool"><Trash2 className="h-3.5 w-3.5" /></button>
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
