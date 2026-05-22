"use client";

/**
 * /audit-logs
 *
 * Workspace-level agent-run audit log viewer.
 * Shows every significant action taken by agents, workers, and operators
 * across all runs in this workspace — sourced from /api/audit-logs.
 *
 * Previously this page showed legacy sidecar/prompt-call data.
 * It has been replaced to show agent-run audit events.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkspaceAuditEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  actorType: "SYSTEM" | "WORKER" | "HUMAN" | "API";
  entityType: "RUN" | "JOB" | "APPROVAL" | "WORKER";
  entityId: string;
  entityLabel: string;
  runId?: string;
  jobName?: string;
  details: string;
  severity: "INFO" | "WARNING" | "ERROR";
}

// ─── Action style helpers ─────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { color: string; icon: React.ElementType }> = {
  RUN_CREATED:        { color: "text-blue-500",    icon: Activity },
  RUN_STARTED:        { color: "text-blue-500",    icon: Activity },
  RUN_SUCCEEDED:      { color: "text-emerald-500", icon: CheckCircle2 },
  RUN_FAILED:         { color: "text-red-500",     icon: XCircle },
  RUN_CANCELLED:      { color: "text-slate-500",   icon: XCircle },
  APPROVAL_REQUESTED: { color: "text-amber-500",   icon: ShieldCheck },
  APPROVAL_APPROVED:  { color: "text-emerald-500", icon: CheckCircle2 },
  APPROVAL_REJECTED:  { color: "text-red-500",     icon: XCircle },
  RETRY_SCHEDULED:    { color: "text-orange-500",  icon: RefreshCw },
  RETRY_EXHAUSTED:    { color: "text-red-500",     icon: AlertTriangle },
  BUDGET_EXCEEDED:    { color: "text-red-500",     icon: AlertTriangle },
  HTTP_CALL_FAILED:   { color: "text-red-500",     icon: AlertTriangle },
  JOB_PAUSED:         { color: "text-amber-500",   icon: AlertTriangle },
  JOB_RESUMED:        { color: "text-emerald-500", icon: CheckCircle2 },
  WORKER_CONNECTED:   { color: "text-emerald-500", icon: Activity },
  WORKER_DISCONNECTED:{ color: "text-red-500",     icon: AlertTriangle },
};

function getActionStyle(action: string) {
  return ACTION_STYLES[action] ?? { color: "text-muted-foreground", icon: Activity };
}

const SEVERITY_BADGE: Record<string, string> = {
  INFO:    "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  WARNING: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ERROR:   "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
};

// ─── Static mock entries (replace with fetch once API exists) ─────────────────

function buildMockEntries(): WorkspaceAuditEntry[] {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  return [
    { id: "al-01", timestamp: ago(2 * 60000), action: "RUN_SUCCEEDED", actor: "worker-1", actorType: "WORKER", entityType: "RUN", entityId: "run-cri-001", entityLabel: "run-cri-001", jobName: "Customer Renewal Intelligence", runId: "run-cri-001", details: "Run completed in 2m 38s · 12,480 tokens · $0.061", severity: "INFO" },
    { id: "al-02", timestamp: ago(3 * 60000), action: "APPROVAL_APPROVED", actor: "Demo Owner", actorType: "HUMAN", entityType: "APPROVAL", entityId: "appr-cri-001", entityLabel: "Approve CRM updates", jobName: "Customer Renewal Intelligence", runId: "run-cri-001", details: "Reviewed and approved 12 Salesforce UPSERT records", severity: "INFO" },
    { id: "al-03", timestamp: ago(4 * 60000), action: "APPROVAL_REQUESTED", actor: "worker-1", actorType: "WORKER", entityType: "APPROVAL", entityId: "appr-cri-001", entityLabel: "Approve CRM updates", jobName: "Customer Renewal Intelligence", runId: "run-cri-001", details: "Agent paused — awaiting human approval before CRM write", severity: "WARNING" },
    { id: "al-04", timestamp: ago(6 * 60000), action: "RUN_STARTED", actor: "scheduler", actorType: "SYSTEM", entityType: "RUN", entityId: "run-cri-001", entityLabel: "run-cri-001", jobName: "Customer Renewal Intelligence", runId: "run-cri-001", details: "Triggered by scheduler · attempt 1", severity: "INFO" },
    { id: "al-05", timestamp: ago(12 * 60000), action: "RUN_FAILED", actor: "worker-1", actorType: "WORKER", entityType: "RUN", entityId: "run-pay-001", entityLabel: "run-pay-001", jobName: "Payment Recovery Agent", runId: "run-pay-001", details: "HTTP 429 rate_limit_exceeded · 2 retries exhausted", severity: "ERROR" },
    { id: "al-06", timestamp: ago(13 * 60000), action: "RETRY_EXHAUSTED", actor: "worker-1", actorType: "WORKER", entityType: "RUN", entityId: "run-pay-001", entityLabel: "run-pay-001", jobName: "Payment Recovery Agent", runId: "run-pay-001", details: "Max retries (2) reached · final attempt failed with HTTP 402", severity: "ERROR" },
    { id: "al-07", timestamp: ago(14 * 60000), action: "RETRY_SCHEDULED", actor: "worker-1", actorType: "WORKER", entityType: "RUN", entityId: "run-pay-001", entityLabel: "run-pay-001", jobName: "Payment Recovery Agent", runId: "run-pay-001", details: "Attempt 2 scheduled after 30s backoff", severity: "WARNING" },
    { id: "al-08", timestamp: ago(15 * 60000), action: "HTTP_CALL_FAILED", actor: "worker-1", actorType: "WORKER", entityType: "RUN", entityId: "run-pay-001", entityLabel: "run-pay-001", jobName: "Payment Recovery Agent", runId: "run-pay-001", details: "POST https://api.stripe.com/v1/charges → HTTP 429 rate_limit_exceeded", severity: "ERROR" },
    { id: "al-09", timestamp: ago(16 * 60000), action: "RUN_STARTED", actor: "scheduler", actorType: "SYSTEM", entityType: "RUN", entityId: "run-pay-001", entityLabel: "run-pay-001", jobName: "Payment Recovery Agent", runId: "run-pay-001", details: "Triggered by API · attempt 1", severity: "INFO" },
    { id: "al-10", timestamp: ago(25 * 60000), action: "WORKER_CONNECTED", actor: "worker-1", actorType: "WORKER", entityType: "WORKER", entityId: "worker-1", entityLabel: "worker-1", details: "Worker process connected to scheduler · handling up to 8 concurrent runs", severity: "INFO" },
  ];
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type SeverityFilter = "all" | "INFO" | "WARNING" | "ERROR";
type EntityFilter = "all" | "RUN" | "APPROVAL" | "JOB" | "WORKER";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [entries, setEntries] = useState<WorkspaceAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) { setEntries(buildMockEntries()); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/audit-logs?workspaceId=${encodeURIComponent(activeWorkspaceId)}&limit=100`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: unknown) => { if (Array.isArray(data)) setEntries(data as WorkspaceAuditEntry[]); })
      .catch(() => { setEntries(buildMockEntries()); })
      .finally(() => setLoading(false));
  }, [activeWorkspaceId]);

  const filtered = entries.filter(e =>
    (severity === "all" || e.severity === severity) &&
    (entityFilter === "all" || e.entityType === entityFilter),
  );

  const errorCount = entries.filter(e => e.severity === "ERROR").length;
  const warningCount = entries.filter(e => e.severity === "WARNING").length;

  return (
    <div className="min-h-full">
      <AppHeader
        title="Audit Logs"
        subtitle="Every significant action taken by agents, workers, and operators across all runs."
      />

      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">

        {/* Summary strip */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{entries.length}</span> events recorded
          </span>
          {errorCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />{errorCount} error{errorCount !== 1 ? "s" : ""}
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />{warningCount} warning{warningCount !== 1 ? "s" : ""}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">For run-level audit →</span>
            <Link
              href={"/agent-runs" as never}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Agent Runs <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {/* Severity */}
          {(["all", "INFO", "WARNING", "ERROR"] as SeverityFilter[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors",
                severity === s
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {s === "all" ? "All severities" : s}
            </button>
          ))}
          <span className="mx-1 self-center text-border/60">·</span>
          {/* Entity type */}
          {(["all", "RUN", "APPROVAL", "JOB", "WORKER"] as EntityFilter[]).map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setEntityFilter(e)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors",
                entityFilter === e
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {e === "all" ? "All entities" : e}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border/50">
          {/* Header */}
          <div className="grid grid-cols-[120px_1fr_180px_100px] gap-0 border-b border-border/50 bg-muted/30 px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Time</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Action / Details</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Actor</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Severity</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading audit events…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Activity className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No events match the current filter</p>
            </div>
          ) : (
            filtered.map((entry, i) => {
              const { color, icon: Icon } = getActionStyle(entry.action);
              const isExpanded = expandedId === entry.id;
              const isLast = i === filtered.length - 1;

              return (
                <div
                  key={entry.id}
                  className={cn(!isLast && "border-b border-border/30")}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="grid w-full grid-cols-[120px_1fr_180px_100px] gap-0 px-4 py-3 text-left transition-colors hover:bg-muted/20"
                  >
                    {/* Time */}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {relativeTime(entry.timestamp)}
                    </span>

                    {/* Action + details */}
                    <div className="min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
                        <span className={cn("font-mono text-[11px] font-semibold", color)}>
                          {entry.action}
                        </span>
                        {entry.jobName && (
                          <span className="truncate text-[11px] text-muted-foreground">
                            · {entry.jobName}
                          </span>
                        )}
                        <ChevronDown className={cn(
                          "ml-auto h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform",
                          isExpanded && "rotate-180",
                        )} />
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{entry.details}</p>
                    </div>

                    {/* Actor */}
                    <div className="min-w-0 pr-4">
                      <span className="truncate font-mono text-[11px] text-foreground">{entry.actor}</span>
                      <span className="ml-1.5 rounded border border-border/50 px-1 py-px font-mono text-[9px] text-muted-foreground/60">
                        {entry.actorType}
                      </span>
                    </div>

                    {/* Severity */}
                    <span className={cn(
                      "inline-flex h-fit items-center self-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      SEVERITY_BADGE[entry.severity],
                    )}>
                      {entry.severity}
                    </span>
                  </button>

                  {/* Expanded row */}
                  {isExpanded && (
                    <div className="border-t border-border/20 bg-muted/10 px-4 py-3">
                      <div className="flex flex-wrap gap-4 text-[11px]">
                        <div>
                          <span className="font-mono font-semibold uppercase tracking-widest text-muted-foreground/50">Entity</span>
                          <p className="mt-0.5 font-mono text-foreground">{entry.entityType} · {entry.entityId}</p>
                        </div>
                        {entry.runId && (
                          <div>
                            <span className="font-mono font-semibold uppercase tracking-widest text-muted-foreground/50">Run</span>
                            <p className="mt-0.5">
                              <Link
                                href={`/agent-runs/${entry.runId}` as never}
                                className="font-mono text-primary hover:underline"
                              >
                                {entry.runId} →
                              </Link>
                            </p>
                          </div>
                        )}
                        <div>
                          <span className="font-mono font-semibold uppercase tracking-widest text-muted-foreground/50">Timestamp</span>
                          <p className="mt-0.5 font-mono text-foreground">
                            {new Date(entry.timestamp).toLocaleString(undefined, {
                              month: "short", day: "numeric", year: "numeric",
                              hour: "2-digit", minute: "2-digit", second: "2-digit",
                            })}
                          </p>
                        </div>
                        <div className="flex-1">
                          <span className="font-mono font-semibold uppercase tracking-widest text-muted-foreground/50">Details</span>
                          <p className="mt-0.5 text-foreground">{entry.details}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Developer note */}
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Developer note</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Workspace audit log sourced from{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">GET /api/audit-logs</code>.{" "}
            Per-run audit detail is available inside each run under the{" "}
            <Link href={"/agent-runs/mock" as never} className="text-primary hover:underline">Audit tab</Link>.{" "}
            Currently showing mock data — connect the API endpoint to enable live data.
          </p>
        </div>
      </div>
    </div>
  );
}
