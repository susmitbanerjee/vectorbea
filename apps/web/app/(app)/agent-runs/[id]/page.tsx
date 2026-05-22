"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle, ChevronDown, ChevronRight, Clock, User, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunStatusBadge, TriggerBadge } from "@/components/scheduler/status-badge";

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

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDur(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function stepStatusColor(status: string) {
  const map: Record<string, string> = {
    SUCCEEDED: "bg-emerald-500",
    FAILED: "bg-red-500",
    RUNNING: "bg-blue-500 animate-pulse",
    PENDING: "bg-muted-foreground/30",
    SKIPPED: "bg-muted-foreground/20",
  };
  return map[status] ?? "bg-muted-foreground/30";
}

// ─── Expandable JSON ─────────────────────────────────────────────────────────

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === null || value === undefined) return null;
  const json = JSON.stringify(value, null, 2);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label}
      </button>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">{json}</pre>
      )}
    </div>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({ step, index }: { step: Step; index: number }) {
  const stepTypeLabelMap: Record<string, string> = {
    HTTP_CALL: "HTTP Call",
    LLM_CALL: "LLM Call",
    TOOL_CALL: "Tool Call",
    APPROVAL_GATE: "Approval Gate",
    SYSTEM: "System",
    ERROR: "Error",
  };

  return (
    <div className="flex gap-4">
      {/* Timeline indicator */}
      <div className="flex flex-col items-center">
        <div className={`mt-1 h-3 w-3 rounded-full shrink-0 ${stepStatusColor(step.status)}`} />
        {index < 99 && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{step.name}</span>
          <Badge variant="outline" className="text-[10px]">
            {stepTypeLabelMap[step.stepType] ?? step.stepType}
          </Badge>
          <Badge
            variant={
              step.status === "SUCCEEDED"
                ? "success"
                : step.status === "FAILED"
                  ? "destructive"
                  : "outline"
            }
            className="text-[10px]"
          >
            {step.status}
          </Badge>
          {step.tokensUsed != null && (
            <span className="text-xs text-muted-foreground">{step.tokensUsed.toLocaleString()} tokens</span>
          )}
          {step.estimatedCostUsd != null && (
            <span className="text-xs text-muted-foreground">${step.estimatedCostUsd.toFixed(4)}</span>
          )}
        </div>

        {step.errorMessage && (
          <p className="mt-1.5 text-xs text-red-500">{step.errorMessage}</p>
        )}

        <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
          {step.startedAt && <span>Started: {fmt(step.startedAt)}</span>}
          {step.finishedAt && <span>Finished: {fmt(step.finishedAt)}</span>}
        </div>

        <JsonBlock label="Input" value={step.inputJson} />
        <JsonBlock label="Output" value={step.outputJson} />
      </div>
    </div>
  );
}

// ─── Run metadata grid ────────────────────────────────────────────────────────

function RunMetaGrid({ run }: { run: AgentRun }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Job</p>
        <Link href={`/agent-jobs/${run.agentJob.id}`} className="mt-1 block text-sm font-medium hover:underline">{run.agentJob.name}</Link>
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Trigger</p>
        <div className="mt-1"><TriggerBadge source={run.triggerSource as never} /></div>
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Attempt</p>
        <p className="mt-1 text-sm font-medium">#{run.attemptNumber}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Duration</p>
        <p className="mt-1 text-sm font-medium">{fmtDur(run.durationMs)}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Tokens</p>
        <p className="mt-1 text-sm font-medium">{run.totalTokens?.toLocaleString() ?? "—"}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Est. Cost</p>
        <p className="mt-1 text-sm font-medium">{run.estimatedCostUsd != null ? `$${run.estimatedCostUsd.toFixed(4)}` : "—"}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Started</p>
        <p className="mt-1 text-sm font-medium">{fmt(run.startedAt)}</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">Finished</p>
        <p className="mt-1 text-sm font-medium">{fmt(run.finishedAt)}</p>
      </Card>
    </div>
  );
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
        // If job is paused, offer to force-retry
        if (b.code === "JOB_PAUSED") {
          setForcePausedPending(true);
          toast.warning("Job is paused. Click 'Retry anyway' to proceed.", {
            duration: 8000,
          });
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

  if (loading) {
    return (
      <div className="space-y-4 p-8">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded-[14px] bg-muted" />
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

  return (
    <div className="space-y-5 p-8">
      {/* Header */}
      <div>
        <Link
          href={`/agent-jobs/${run.agentJob.id}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {run.agentJob.name}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold">Run Detail</h1>
              <RunStatusBadge status={run.status as never} />
              {run.attemptNumber > 1 && (
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Attempt #{run.attemptNumber}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground font-mono">{run.id}</p>
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
          <div className="flex flex-wrap gap-2">
            {canCancel && (
              <Button variant="outline" size="sm" onClick={() => void handleCancel()} disabled={acting}>
                Cancel
              </Button>
            )}
            {canRetry && !forcePausedPending && (
              <Button size="sm" onClick={() => void handleRetry(false)} disabled={acting}>
                {acting ? "Retrying…" : "Retry Run"}
              </Button>
            )}
            {canRetry && forcePausedPending && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForcePausedPending(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleRetry(true)}
                  disabled={acting}
                >
                  Retry anyway (job paused)
                </Button>
              </>
            )}
            {/* Replay from checkpoint — placeholder for future implementation */}
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="Checkpoint-based replay is not yet implemented"
              className="cursor-not-allowed opacity-40"
            >
              Replay from step…
            </Button>
            {run.status === "WAITING_FOR_APPROVAL" && (
              <Link
                href="/approvals"
                className="inline-flex h-8 items-center rounded-md bg-primary/[0.08] border border-primary/20 px-3 text-xs font-medium text-primary hover:bg-primary/[0.14]"
              >
                Review approval →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Retry warnings (e.g. job is paused) */}
      {retryWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 space-y-1">
          {retryWarnings.map((w, i) => (
            <p key={i}><strong>Warning:</strong> {w}</p>
          ))}
        </div>
      )}

      {/* Error banner */}
      {run.errorMessage && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <strong>Error:</strong> {run.errorMessage}
        </div>
      )}

      {/* Metadata */}
      <RunMetaGrid run={run} />

      {/* Idempotency key */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Idempotency key:</span>
        <code className="font-mono">{run.idempotencyKey}</code>
      </div>

      {/* Step timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
        </CardHeader>
        <CardContent>
          {run.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
          ) : (
            <div className="space-y-0">
              {run.steps.map((step, i) => (
                <StepCard key={step.id} step={step} index={i} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approval history */}
      {run.approvalRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Approval Requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {run.approvalRequests.map((ap) => (
              <div
                key={ap.id}
                className={`rounded-lg border p-4 space-y-2 ${
                  ap.status === "PENDING"
                    ? "border-amber-500/20 bg-amber-500/[0.03]"
                    : ap.status === "APPROVED"
                      ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                      : "border-red-500/20 bg-red-500/[0.03]"
                }`}
              >
                {/* Title row */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{ap.title}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    ap.status === "PENDING"
                      ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                      : ap.status === "APPROVED"
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : "bg-red-500/10 text-red-600 border-red-500/20"
                  }`}>
                    {ap.status === "PENDING" && <Clock className="h-3 w-3" />}
                    {ap.status === "APPROVED" && <CheckCircle className="h-3 w-3" />}
                    {ap.status === "REJECTED" && <XCircle className="h-3 w-3" />}
                    {ap.status.charAt(0) + ap.status.slice(1).toLowerCase()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Requested {fmt(ap.requestedAt)}
                  </span>
                </div>

                {/* Message */}
                <p className="text-sm text-muted-foreground leading-relaxed">{ap.message}</p>

                {/* Decision */}
                {ap.decidedAt && (
                  <div className="flex items-start gap-2 pt-1">
                    <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="text-xs">
                      <span className="font-medium">
                        {ap.status === "APPROVED" ? "Approved" : "Rejected"} by{" "}
                        {ap.decidedBy?.name ?? ap.decidedBy?.email ?? "Unknown"}
                      </span>
                      <span className="text-muted-foreground"> · {fmt(ap.decidedAt)}</span>
                      {ap.decisionReason && (
                        <p className="mt-0.5 text-muted-foreground">
                          &ldquo;{ap.decisionReason}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Pending CTA */}
                {ap.status === "PENDING" && (
                  <div className="pt-1">
                    <Link
                      href="/approvals"
                      className="inline-flex h-7 items-center rounded-md bg-primary/[0.08] border border-primary/20 px-3 text-xs font-medium text-primary hover:bg-primary/[0.14]"
                    >
                      Review in Approvals →
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Output JSON */}
      {Boolean(run.outputJson) && (
        <Card>
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-4 text-xs">
              {JSON.stringify(run.outputJson, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
