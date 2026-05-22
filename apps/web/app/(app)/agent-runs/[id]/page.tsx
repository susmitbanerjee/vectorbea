"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Clock, Key, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { RunStatusBadge, TriggerBadge } from "@/components/scheduler/status-badge";
import { RunDetailTabs } from "@/components/agent-runs/RunDetailTabs";
import { buildRunTimelineEvents } from "@/lib/run-timeline";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Step {
  id: string;
  stepIndex: number;
  stepType: string;
  name: string;
  status: string;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  tokensUsed: number | null;
  estimatedCostUsd: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

interface ApprovalRecord {
  id: string;
  title: string;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  requestedBySystem: boolean;
  requestedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  agentRunStepId: string | null;
  decidedBy: { id: string; name: string | null; email: string } | null;
}

interface AgentRun {
  id: string;
  status: string;
  triggerSource: string;
  attemptNumber: number;
  idempotencyKey: string;
  originalRunId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  createdAt: string;
  agentJob: { id: string; name: string };
  steps: Step[];
  approvalRequests: ApprovalRecord[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDur(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTs(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgentRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [retryWarnings, setRetryWarnings] = useState<string[]>([]);
  const [forcePausedPending, setForcePausedPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent-runs/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data = (await res.json()) as { run: AgentRun };
      setRun(data.run);
    } catch {
      toast.error("Failed to load run details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function handleRetry(forcePaused = false) {
    setActing(true);
    setRetryWarnings([]);
    setForcePausedPending(false);
    try {
      const res = await fetch(`/api/agent-runs/${id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forcePaused }),
      });

      if (!res.ok) {
        const b = (await res.json()) as { error?: string; code?: string };
        if (b.code === "JOB_PAUSED") {
          setForcePausedPending(true);
          toast.warning("Job is paused. Click 'Retry anyway' to proceed.", { duration: 8000 });
          return;
        }
        throw new Error(b.error ?? "Failed to retry");
      }

      const data = (await res.json()) as { run: { id: string }; warnings: string[] };
      if (data.warnings.length > 0) setRetryWarnings(data.warnings);
      toast.success(`Retry queued (attempt #${run?.attemptNumber != null ? run.attemptNumber + 1 : "?"}).`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retry.");
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    setActing(true);
    try {
      const res = await fetch(`/api/agent-runs/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const b = (await res.json()) as { error?: string };
        throw new Error(b.error);
      }
      toast.success("Run cancelled.");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel.");
    } finally {
      setActing(false);
    }
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 p-6 lg:p-8">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-10 w-64 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
        <div className="h-[60vh] animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-64 items-center justify-center p-8 text-sm text-muted-foreground">
        Run not found.
      </div>
    );
  }

  const canRetry = ["FAILED", "TIMEOUT", "CANCELLED"].includes(run.status);
  const canCancel = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"].includes(run.status);
  const isRetry = run.triggerSource === "RETRY" && run.originalRunId != null;

  // Build timeline events from live API data
  const timelineEvents = buildRunTimelineEvents(run);

  return (
    <div className="min-h-full p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-5">

        {/* ── Breadcrumb ───────────────────────────────────────────────── */}
        <Link
          href={`/agent-jobs/${run.agentJob.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {run.agentJob.name}
        </Link>

        {/* ── Title row ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">
                {run.agentJob.name} — Run
              </h1>
              <RunStatusBadge status={run.status as never} />
              {run.attemptNumber > 1 && (
                <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  Attempt #{run.attemptNumber}
                </span>
              )}
            </div>
            <p className="font-mono text-xs text-muted-foreground">{run.id}</p>
            {isRetry && (
              <p className="text-xs text-muted-foreground">
                Retry of{" "}
                <Link
                  href={`/agent-runs/${run.originalRunId}`}
                  className="font-mono text-foreground hover:underline"
                >
                  {run.originalRunId?.slice(0, 14)}…
                </Link>
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {canCancel && (
              <Button variant="outline" size="sm" onClick={() => void handleCancel()} disabled={acting}>
                Cancel
              </Button>
            )}
            {canRetry && !forcePausedPending && (
              <Button size="sm" onClick={() => void handleRetry(false)} disabled={acting} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                {acting ? "Retrying…" : "Retry Run"}
              </Button>
            )}
            {canRetry && forcePausedPending && (
              <>
                <Button variant="outline" size="sm" onClick={() => setForcePausedPending(false)}>
                  Cancel
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void handleRetry(true)} disabled={acting}>
                  Retry anyway (job paused)
                </Button>
              </>
            )}
            {run.status === "WAITING_FOR_APPROVAL" && (
              <Link
                href="/approvals"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
              >
                Review approval →
              </Link>
            )}
          </div>
        </div>

        {/* ── Retry warnings ───────────────────────────────────────────── */}
        {retryWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 space-y-1">
            {retryWarnings.map((w, i) => (
              <p key={i}><strong>Warning:</strong> {w}</p>
            ))}
          </div>
        )}

        {/* ── Error banner ─────────────────────────────────────────────── */}
        {run.errorMessage && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm text-red-600 dark:text-red-400">
            <span className="font-semibold">Error: </span>
            {run.errorMessage}
          </div>
        )}

        {/* ── Metadata strip ───────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs">
          <MetaItem label="Trigger">
            <TriggerBadge source={run.triggerSource as never} />
          </MetaItem>
          <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Started">
            {fmtTs(run.startedAt)}
          </MetaItem>
          {run.finishedAt && (
            <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Finished">
              {fmtTs(run.finishedAt)}
            </MetaItem>
          )}
          <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Duration">
            {fmtDur(run.durationMs)}
          </MetaItem>
          {run.totalTokens != null && (
            <MetaItem label="Tokens">{run.totalTokens.toLocaleString()}</MetaItem>
          )}
          {run.estimatedCostUsd != null && (
            <MetaItem label="Est. cost">${run.estimatedCostUsd.toFixed(4)}</MetaItem>
          )}
          <MetaItem icon={<Key className="h-3 w-3" />} label="Idempotency key">
            <code className="font-mono text-[10px]">{run.idempotencyKey}</code>
          </MetaItem>
        </div>

        {/* ── Tabbed detail view ───────────────────────────────────────── */}
        <RunDetailTabs run={run} timelineEvents={timelineEvents} />

      </div>
    </div>
  );
}

// ─── MetaItem helper ─────────────────────────────────────────────────────────

function MetaItem({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}
