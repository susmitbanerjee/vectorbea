"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  History,
  KeyRound,
  RefreshCw,
  ScrollText,
  Shield,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { RunEvent, Tool } from "@/types/platform";
import { getTool, getCallsForTool } from "@/lib/repository";

// ─── Constants ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<Tool["riskLevel"], string> = {
  low:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium:   "bg-amber-50  text-amber-700  border-amber-200",
  high:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  critical: "bg-red-50    text-red-700    border-red-200",
};

const RISK_LABELS: Record<Tool["riskLevel"], string> = {
  low:      "Low",
  medium:   "Medium",
  high:     "High",
  critical: "Critical",
};

type Tab = "overview" | "schema" | "auth" | "calls" | "policies";

function timeAgo(ts: string | null | undefined) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDuration(ms: number | undefined) {
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

export default function ToolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tool, setTool] = useState<Tool | null>(null);
  const [calls, setCalls] = useState<RunEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [t, c] = await Promise.all([getTool(id), getCallsForTool(id)]);
        setTool(t);
        setCalls(c as RunEvent[]);
      } catch {
        toast.error("Failed to load tool.");
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
  if (!tool) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Tool not found.{" "}
        <Link href={"/tools" as never} className="text-primary hover:underline">← Back to registry</Link>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview",  label: "Overview",     icon: Wrench },
    { id: "schema",    label: "Schema",        icon: ScrollText },
    { id: "auth",      label: "Auth",          icon: KeyRound },
    { id: "calls",     label: "Recent Calls",  icon: History },
    { id: "policies",  label: "Policies",      icon: Shield },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="space-y-4 px-6 pb-0 pt-6 lg:px-8">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Link href={"/tools" as never} className="flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            Tool Registry
          </Link>
          <span>/</span>
          <span style={{ color: "var(--text-primary)" }}>{tool.name}</span>
        </div>

        <div className="flex items-start gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)" }}
          >
            <Wrench className="h-6 w-6 text-cyan-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-[18px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                {tool.name}
              </h1>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", RISK_COLORS[tool.riskLevel])}>
                {RISK_LABELS[tool.riskLevel]}
              </span>
              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700 capitalize">
                {tool.type.replace(/_/g, " ")}
              </span>
              <span className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                tool.status === "active"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]",
              )}>
                {tool.status}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{tool.description || "No description"}</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="sticky top-0 z-10 mt-4 px-6 lg:px-8"
        style={{ borderBottom: "1px solid rgba(148,163,184,0.09)", background: "rgba(9,14,24,0.96)" }}
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
              {tid === "calls" && calls.length > 0 && (
                <span className="ml-1 rounded-full px-1.5 py-px text-[10px] tabular-nums" style={{ background: "rgba(148,163,184,0.12)", color: "var(--text-faint)" }}>
                  {calls.length}
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
              <div className="divide-y divide-border/30">
                <KVRow label="ID" value={<code className="font-mono text-[11px]">{tool.id}</code>} />
                <KVRow label="Slug" value={<code className="font-mono text-[11px]">{tool.slug}</code>} />
                <KVRow label="Type" value={<span className="capitalize">{tool.type.replace(/_/g, " ")}</span>} />
                <KVRow label="Risk level" value={RISK_LABELS[tool.riskLevel]} />
                <KVRow label="Status" value={tool.status} />
              </div>
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Usage</h2>
              <div className="divide-y divide-border/30">
                <KVRow label="Total calls" value={tool.totalCalls.toLocaleString()} />
                <KVRow label="Last used" value={timeAgo(tool.lastUsedAt)} />
                <KVRow label="Created" value={timeAgo(tool.createdAt)} />
                <KVRow label="Updated" value={timeAgo(tool.updatedAt)} />
              </div>
            </div>

            {tool.httpConfig && (
              <div className="rounded-xl border border-border/60 p-5 lg:col-span-2" style={{ background: "var(--surface-1)" }}>
                <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>HTTP Endpoint</h2>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-sky-50 px-2 py-0.5 font-mono text-[11px] text-sky-700">
                    {tool.httpConfig.method}
                  </code>
                  <code className="flex-1 truncate font-mono text-[12px] text-muted-foreground">
                    {tool.httpConfig.url}
                  </code>
                </div>
                {Object.keys(tool.httpConfig.headers).length > 0 && (
                  <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/20 p-3 font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(tool.httpConfig.headers, null, 2)}
                  </pre>
                )}
                {tool.httpConfig.bodyTemplate && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] text-muted-foreground">Body template</p>
                    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/20 p-3 font-mono text-[10px] text-muted-foreground">
                      {tool.httpConfig.bodyTemplate}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-border/60 px-5 py-3.5 lg:col-span-2" style={{ background: "var(--surface-1)" }}>
              <div className="flex flex-wrap gap-4 text-[12px]">
                <span className="text-muted-foreground">Timeout: <strong className="text-foreground">{tool.timeoutMs >= 1000 ? `${tool.timeoutMs / 1000}s` : `${tool.timeoutMs}ms`}</strong></span>
                <span className="text-muted-foreground">Idempotent: <strong className="text-foreground">{tool.idempotent ? "Yes" : "No"}</strong></span>
                <span className="text-muted-foreground">Retry: <strong className="text-foreground">{tool.retryPolicy.maxAttempts}× {tool.retryPolicy.backoffType}</strong></span>
              </div>
            </div>
          </div>
        )}

        {/* Schema */}
        {tab === "schema" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-border/60 overflow-hidden" style={{ background: "var(--surface-1)" }}>
              <div className="border-b border-border/60 px-5 py-3">
                <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Input Schema</h2>
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[11px] leading-5 text-muted-foreground">
                {JSON.stringify(tool.inputSchema, null, 2) || "{}"}
              </pre>
            </div>
            <div className="rounded-xl border border-border/60 overflow-hidden" style={{ background: "var(--surface-1)" }}>
              <div className="border-b border-border/60 px-5 py-3">
                <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Output Schema</h2>
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[11px] leading-5 text-muted-foreground">
                {JSON.stringify(tool.outputSchema, null, 2) || "{}"}
              </pre>
            </div>
          </div>
        )}

        {/* Auth */}
        {tab === "auth" && (
          <div className="space-y-5">
            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Connection</h2>
              {tool.authConnectionRef ? (
                <div className="divide-y divide-border/30">
                  <KVRow
                    label="Connection ref"
                    value={<code className="font-mono text-[11px]">{tool.authConnectionRef}</code>}
                  />
                  <KVRow label="Status" value={
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                      configured
                    </span>
                  } />
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  No auth connection configured. This tool does not require authentication.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-2 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Manage connections</h2>
              <p className="mb-3 text-[12px] text-muted-foreground">
                Create and manage named connections in the Connections settings page.
                Each connection stores credentials securely and can be referenced by any tool.
              </p>
              <Link
                href={"/settings/sdk" as never}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                style={{ background: "var(--surface-2)" }}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Open Connections
              </Link>
            </div>
          </div>
        )}

        {/* Recent Calls */}
        {tab === "calls" && (
          <div className="space-y-3">
            {calls.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-16 text-center" style={{ background: "var(--surface-1)" }}>
                <History className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No calls recorded for this tool yet.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/60" style={{ background: "var(--surface-1)" }}>
                <div className="border-b border-border/60 px-5 py-3">
                  <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {calls.length} recent call{calls.length !== 1 ? "s" : ""}
                  </h2>
                </div>
                <div className="divide-y divide-border/40">
                  {calls.slice(0, 50).map((call) => (
                    <Link
                      key={call.id}
                      href={`/runs/${call.runId}` as never}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/20"
                    >
                      <span className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        call.status === "ok" ? "bg-emerald-400" : call.status === "error" ? "bg-red-400" : "bg-slate-400",
                      )} />
                      <code className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {call.runId}
                      </code>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {fmtDuration(call.durationMs)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {timeAgo(call.timestamp)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Policies */}
        {tab === "policies" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Retry Policy</h2>
              <div className="divide-y divide-border/30">
                <KVRow label="Max attempts" value={tool.retryPolicy.maxAttempts} />
                <KVRow label="Backoff type" value={tool.retryPolicy.backoffType} />
                <KVRow label="Backoff base" value={`${tool.retryPolicy.backoffMs}ms`} />
              </div>
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Execution</h2>
              <div className="divide-y divide-border/30">
                <KVRow label="Timeout" value={`${tool.timeoutMs >= 1000 ? `${tool.timeoutMs / 1000}s` : `${tool.timeoutMs}ms`}`} />
                <KVRow label="Idempotent" value={tool.idempotent ? "Yes" : "No"} />
                <KVRow label="Risk level" value={RISK_LABELS[tool.riskLevel]} />
              </div>
            </div>

            <div className="rounded-xl border border-border/60 px-5 py-4 lg:col-span-2" style={{ background: "var(--surface-1)" }}>
              <h2 className="mb-2 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Risk implications</h2>
              <p className="text-[12px] text-muted-foreground leading-5">
                {tool.riskLevel === "low" && "This tool only reads data. It is safe to retry without side effects."}
                {tool.riskLevel === "medium" && "This tool writes data but mutations are easy to undo or are idempotent. Use with care on retry."}
                {tool.riskLevel === "high" && "This tool modifies important data. Approval may be required before execution in production workflows."}
                {tool.riskLevel === "critical" && "This tool cannot be undone. Common examples: sending messages, processing payments, deleting records. Always gate with an approval step."}
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
