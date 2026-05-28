"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Search, Wrench } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Tool } from "@/types/platform";
import { getTools } from "@/lib/repository";

// ─── Constants ────────────────────────────────────────────────────────────────

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
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Tool
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-3 text-[12px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-8 rounded-lg border border-border/60 bg-background px-3 text-[12px] text-muted-foreground focus:outline-none"
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value as Tool["riskLevel"] | "")}
        >
          <option value="">All risk levels</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        {allTypes.length > 0 && (
          <select
            className="h-8 rounded-lg border border-border/60 bg-background px-3 text-[12px] text-muted-foreground focus:outline-none"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {allTypes.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        )}
        <select
          className="h-8 rounded-lg border border-border/60 bg-background px-3 text-[12px] text-muted-foreground focus:outline-none"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as Tool["status"] | "")}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
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
            <Wrench className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">
              {tools.length === 0 ? "No tools registered" : "No tools match your filters"}
            </p>
            {tools.length === 0 && (
              <Link
                href={"/tools/new" as never}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
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
                      <Link
                        href={`/tools/${tool.id}` as never}
                        className="block font-mono text-[13px] font-medium hover:underline"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {tool.name}
                      </Link>
                      {tool.description && (
                        <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-muted-foreground">{tool.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700 capitalize">
                        {tool.type.replace(/_/g, " ")}
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
                      {tool.totalCalls.toLocaleString()}
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
