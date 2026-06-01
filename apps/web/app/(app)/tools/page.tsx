"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { IconBadge, ToolIcon, HttpIcon, DatabaseIcon, EmailIcon, CodeIcon } from "@/components/icons/vectorbea-icons";
import type { Tool } from "@/types/platform";
import { getTools } from "@/lib/repository";
import { AppSelect } from "@/components/ui/app-select";
import { SearchInput } from "@/components/ui/search-input";

// ─── Constants ────────────────────────────────────────────────────────────────

// Maps uiToolType (stored in config by createTool) → human label.
// Falls back to capitalising the raw API type when uiToolType is absent.
const TOOL_TYPE_LABELS: Record<string, string> = {
  http:             "HTTP",
  database_read:    "Database (Read)",
  database_write:   "Database (Write)",
  database:         "Database",
  email:            "Email",
  crm:              "CRM",
  mcp_tool:         "MCP",
  custom_function:  "Custom Function",
  imported_tool:    "Imported Tool",
  code:             "Code",
  custom:           "Custom",
  builtin:          "Built-in",
  llm_generate:     "LLM Generate",
};

function displayToolType(tool: Tool): string {
  const ui = (tool.config as Record<string, unknown> | undefined)?.uiToolType as string | undefined;
  const key = ui ?? tool.type;
  return TOOL_TYPE_LABELS[key] ?? key.replace(/_/g, " ");
}

const RISK_COLORS: Record<Tool["riskLevel"], string> = {
  low:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium:   "bg-amber-50   text-amber-700   border-amber-200",
  high:     "bg-orange-50  text-orange-700  border-orange-200",
  critical: "bg-red-50     text-red-700     border-red-200",
};

const RISK_LABELS: Record<Tool["riskLevel"], string> = {
  low:      "Low",
  medium:   "Medium",
  high:     "High",
  critical: "Critical",
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

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<Tool["riskLevel"] | "">("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Tool["status"] | "">("");

  async function load() {
    setLoading(true);
    try {
      setTools(await getTools());
    } catch {
      toast.error("Failed to load tools.");
    } finally {
      setLoading(false);
    }
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

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title" style={{ color: "var(--text-primary)" }}>
            Tool Registry
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${tools.length} tool${tools.length !== 1 ? "s" : ""} registered`}
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
            href={"/tools/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:bg-[#1E293B]"
          >
            <Plus className="h-4 w-4" />
            New Tool
          </Link>
        </div>
      </div>

      {/* ── Filters — horizontal row, New Tool stays in header above ── */}
      <div className="flex flex-wrap items-center gap-2 mt-4 mb-4">
        <SearchInput
          containerClassName="w-[280px] max-w-full"
          placeholder="Search tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <AppSelect
          className="w-[160px]"
          value={riskFilter}
          onValueChange={(v) => setRiskFilter(v as Tool["riskLevel"] | "")}
          options={[
            { label: "All risk levels", value: "" },
            { label: "Low",      value: "low" },
            { label: "Medium",   value: "medium" },
            { label: "High",     value: "high" },
            { label: "Critical", value: "critical" },
          ]}
        />
        {allTypes.length > 0 && (
          <AppSelect
            className="w-[160px]"
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v)}
            options={[
              { label: "All types", value: "" },
              ...allTypes.map((t) => ({ label: t.replace(/_/g, " "), value: t })),
            ]}
          />
        )}
        <AppSelect
          className="w-[150px]"
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as Tool["status"] | "")}
          options={[
            { label: "All statuses", value: "" },
            { label: "Active",   value: "active" },
            { label: "Inactive", value: "inactive" },
          ]}
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60" style={{ background: "var(--surface-1)" }}>
        {loading ? (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-56 animate-pulse rounded bg-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted ml-auto" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <IconBadge icon={ToolIcon} tone="tool" size="lg" />
            <p className="text-sm font-medium text-muted-foreground">
              {tools.length === 0 ? "No tools registered" : "No tools match your filters"}
            </p>
            {tools.length === 0 && (
              <Link
                href={"/tools/new" as never}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[13px] font-semibold text-white hover:bg-[#1E293B]"
              >
                <Plus className="h-3.5 w-3.5" />
                Register first tool
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/10">
                  {["Tool", "Type", "Risk Level", "Auth / Connection", "Timeout", "Status", "Calls", "Last used", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((tool) => (
                  <tr key={tool.id} className="group transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <IconBadge
                          icon={
                            tool.type.includes("http") || tool.type.includes("graphql") ? HttpIcon :
                            tool.type.includes("database") || tool.type.includes("db") ? DatabaseIcon :
                            tool.type.includes("email") ? EmailIcon :
                            tool.type.includes("code") || tool.type.includes("function") ? CodeIcon :
                            ToolIcon
                          }
                          tone={
                            tool.type.includes("http") ? "http" :
                            tool.type.includes("database") || tool.type.includes("db") ? "database" :
                            tool.type.includes("email") ? "email" :
                            "tool"
                          }
                          size="sm"
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/tools/${tool.id}` as never}
                            className="block text-[13px] font-medium hover:underline"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {tool.name}
                          </Link>
                          {tool.description && (
                            <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-muted-foreground">{tool.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700 capitalize">
                        {displayToolType(tool)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", RISK_COLORS[tool.riskLevel])}>
                        {RISK_LABELS[tool.riskLevel]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-muted-foreground">
                      {tool.authConnectionRef ? (
                        <code className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px]">{tool.authConnectionRef}</code>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                      {tool.timeoutMs >= 1000 ? `${tool.timeoutMs / 1000}s` : `${tool.timeoutMs}ms`}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        tool.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]",
                      )}>
                        {tool.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                      {(tool.totalCalls ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-muted-foreground">
                      {timeAgo(tool.lastUsedAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/tools/${tool.id}` as never}
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
