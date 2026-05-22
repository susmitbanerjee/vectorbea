"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Globe,
  RefreshCw,
  Settings,
  Shield,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobStatusBadge, RunStatusBadge, TriggerBadge } from "@/components/scheduler/status-badge";
import { cronToHumanText } from "@/lib/cron-humanizer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BudgetPolicy {
  maxTokensPerRun: number | null;
  maxCostUsdPerRun: number | null;
  maxRunsPerDay: number | null;
  maxRunsPerMonth: number | null;
}

interface AgentJob {
  id: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  triggerType: "MANUAL" | "CRON";
  cronExpression: string | null;
  timezone: string;
  endpointUrl: string;
  httpMethod: string;
  headersJson: unknown;
  maxDurationSeconds: number;
  maxRetries: number;
  retryBackoffSeconds: number;
  requireApprovalBeforeRun: boolean;
  requireApprovalBeforeExternalAction: boolean;
  createdAt: string;
  updatedAt: string;
  budgetPolicy: BudgetPolicy | null;
}

interface AgentRun {
  id: string;
  status: string;
  triggerSource: string;
  attemptNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  estimatedCostUsd: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface Stats {
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
}

interface BudgetUsage {
  runsToday: number;
  runsThisMonth: number;
  tokensToday: number | null;
  costTodayUsd: number | null;
  costThisMonthUsd: number | null;
}

interface JobDetail {
  job: AgentJob;
  recentRuns: AgentRun[];
  stats: Stats;
  budgetUsage: BudgetUsage;
}

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  metadataJson: unknown;
  createdAt: string;
  actor: { name: string | null; email: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDur(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ─── Section label ────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm first:pt-0 last:pb-0 border-b border-border last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

// ─── Budget progress bar ─────────────────────────────────────────────────────

function BudgetBar({
  label,
  used,
  limit,
  format,
}: {
  label: string;
  used: number | null;
  limit: number | null;
  format?: (n: number) => string;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  if (limit == null) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{used != null ? fmt(used) : "—"} <span className="text-muted-foreground font-normal">/ no limit</span></span>
        </div>
      </div>
    );
  }

  const pct = used != null ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color =
    pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {used != null ? fmt(used) : "—"}
          <span className="text-muted-foreground font-normal"> / {fmt(limit)}</span>
          {used != null && (
            <span className={`ml-1.5 ${pct >= 100 ? "text-red-500" : pct >= 80 ? "text-amber-500" : "text-emerald-600"}`}>
              ({pct}%)
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${used != null ? pct : 0}%` }}
        />
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgentJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobRes, auditRes] = await Promise.all([
        fetch(`/api/agent-jobs/${id}`),
        fetch(`/api/agent-jobs/${id}/audit-logs`),
      ]);
      if (!jobRes.ok) throw new Error("Not found");
      const jobData = (await jobRes.json()) as JobDetail;
      setDetail(jobData);
      if (auditRes.ok) {
        const auditData = (await auditRes.json()) as { logs: AuditLog[] };
        setAuditLogs(auditData.logs);
      }
    } catch {
      toast.error("Failed to load job details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function handleAction(action: "pause" | "resume" | "archive" | "run") {
    setActing(true);
    try {
      if (action === "run") {
        const res = await fetch(`/api/agent-jobs/${id}/runs`, { method: "POST" });
        if (!res.ok) {
          const b = (await res.json()) as { error?: string };
          throw new Error(b.error ?? "Failed");
        }
        toast.success("Run queued.");
      } else if (action === "archive") {
        const res = await fetch(`/api/agent-jobs/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        toast.success("Job archived.");
        router.push("/agent-jobs");
        return;
      } else {
        const res = await fetch(`/api/agent-jobs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: action === "pause" ? "PAUSED" : "ACTIVE" }),
        });
        if (!res.ok) throw new Error();
        toast.success(`Job ${action === "pause" ? "paused" : "resumed"}.`);
      }
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 p-8">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-[14px] bg-muted" />
        <div className="h-32 animate-pulse rounded-[14px] bg-muted" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-64 items-center justify-center p-8 text-sm text-muted-foreground">
        Job not found.{" "}
        <Link href="/agent-jobs" className="ml-1 text-primary hover:underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  const { job, recentRuns, stats, budgetUsage } = detail;

  return (
    <div className="space-y-5 p-8">
      {/* Header */}
      <div>
        <Link
          href="/agent-jobs"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Agent Jobs
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold">{job.name}</h1>
              <JobStatusBadge status={job.status} />
            </div>
            {job.description && (
              <p className="mt-1 text-sm text-muted-foreground">{job.description}</p>
            )}
          </div>
          {job.status !== "ARCHIVED" && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAction("run")}
                disabled={acting || job.status === "PAUSED"}
              >
                <Zap className="h-3.5 w-3.5" />
                Run now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAction(job.status === "ACTIVE" ? "pause" : "resume")}
                disabled={acting}
              >
                {job.status === "ACTIVE" ? "Pause" : "Resume"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm("Archive this job? It will stop running.")) {
                    void handleAction("archive");
                  }
                }}
                disabled={acting}
              >
                Archive
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Runs", value: stats.totalRuns },
          { label: "Succeeded", value: stats.successCount },
          { label: "Failed", value: stats.failureCount },
          {
            label: "Success Rate",
            value: stats.successRate !== null ? `${stats.successRate}%` : "—",
          },
        ].map(({ label, value }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Schedule */}
        <Section icon={Clock} title="Schedule">
          <Row label="Trigger type" value={<Badge variant={job.triggerType === "CRON" ? "default" : "outline"}>{job.triggerType}</Badge>} />
          {job.cronExpression && (
            <>
              <Row label="Cron expression" value={<code className="font-mono text-xs">{job.cronExpression}</code>} />
              <Row label="Schedule" value={cronToHumanText(job.cronExpression, job.timezone)} />
              <Row label="Timezone" value={job.timezone} />
            </>
          )}
          <Row label="Created" value={fmt(job.createdAt)} />
          <Row label="Updated" value={fmt(job.updatedAt)} />
        </Section>

        {/* Endpoint */}
        <Section icon={Globe} title="Endpoint">
          <Row label="URL" value={<span className="break-all font-mono text-xs">{job.endpointUrl}</span>} />
          <Row label="Method" value={<Badge variant="outline">{job.httpMethod}</Badge>} />
        </Section>

        {/* Retry policy */}
        <Section icon={RefreshCw} title="Retry Policy">
          <Row label="Max duration" value={`${job.maxDurationSeconds}s`} />
          <Row label="Max retries" value={job.maxRetries} />
          <Row label="Retry backoff" value={`${job.retryBackoffSeconds}s`} />
        </Section>

        {/* Approval */}
        <Section icon={Shield} title="Approval Gates">
          <Row
            label="Before each run"
            value={
              <Badge variant={job.requireApprovalBeforeRun ? "warning" : "outline"}>
                {job.requireApprovalBeforeRun ? "Required" : "Not required"}
              </Badge>
            }
          />
          <Row
            label="Before external actions"
            value={
              <Badge variant={job.requireApprovalBeforeExternalAction ? "warning" : "outline"}>
                {job.requireApprovalBeforeExternalAction ? "Required" : "Not required"}
              </Badge>
            }
          />
        </Section>

        {/* Budget — always show if policy exists, with live usage */}
        {job.budgetPolicy && (
          <Section icon={Wallet} title="Budget &amp; Usage">
            <div className="space-y-4">
              {/* Run count limits with progress bars */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Run Counts</p>
                <BudgetBar
                  label="Runs today"
                  used={budgetUsage.runsToday}
                  limit={job.budgetPolicy.maxRunsPerDay}
                />
                <BudgetBar
                  label="Runs this month"
                  used={budgetUsage.runsThisMonth}
                  limit={job.budgetPolicy.maxRunsPerMonth}
                />
              </div>

              {/* Cost limits with progress bars */}
              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cost</p>
                <BudgetBar
                  label="Cost today"
                  used={budgetUsage.costTodayUsd}
                  limit={null}
                  format={(n) => `$${n.toFixed(2)}`}
                />
                <BudgetBar
                  label="Cost this month"
                  used={budgetUsage.costThisMonthUsd}
                  limit={null}
                  format={(n) => `$${n.toFixed(2)}`}
                />
              </div>

              {/* Per-run limits (static config) */}
              <div className="space-y-0 pt-2 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Per-Run Limits</p>
                <Row
                  label="Max tokens/run"
                  value={job.budgetPolicy.maxTokensPerRun
                    ? `${job.budgetPolicy.maxTokensPerRun.toLocaleString()} tokens`
                    : "—"}
                />
                <Row
                  label="Max cost/run"
                  value={job.budgetPolicy.maxCostUsdPerRun
                    ? `$${Number(job.budgetPolicy.maxCostUsdPerRun).toFixed(2)}`
                    : "—"}
                />
                {budgetUsage.tokensToday != null && (
                  <Row
                    label="Tokens today"
                    value={budgetUsage.tokensToday.toLocaleString()}
                  />
                )}
              </div>
            </div>
          </Section>
        )}
      </div>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentRuns.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No runs yet. Use &ldquo;Run now&rdquo; to trigger the first execution.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Status", "Trigger", "Attempt", "Started", "Duration", ""].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <RunStatusBadge status={run.status as never} />
                      </td>
                      <td className="px-5 py-3">
                        <TriggerBadge source={run.triggerSource as never} />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">#{run.attemptNumber}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmt(run.startedAt ?? run.createdAt)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDur(run.durationMs)}</td>
                      <td className="px-5 py-3">
                        <Link href={`/agent-runs/${run.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit logs */}
      {auditLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Audit Log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex items-start justify-between px-5 py-3 text-sm">
                  <div>
                    <span className="font-mono text-xs font-medium">{log.action}</span>
                    {log.actor && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        by {log.actor.name ?? log.actor.email}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmt(log.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
