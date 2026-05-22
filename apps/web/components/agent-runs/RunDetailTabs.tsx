"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, Coins, History, List, ScrollText, Zap } from "lucide-react";
import Link from "next/link";
import { CheckCircle, User, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { RunExecutionTimeline } from "@/components/agent-runs/RunExecutionTimeline";
import type { RunTimelineEvent } from "@/lib/run-timeline";

// ─── Local helpers ─────────────────────────────────────────────────────────

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDur(ms: number | null | undefined) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── Shared types (mirrors AgentRun from page) ─────────────────────────────

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

// ─── Steps tab ────────────────────────────────────────────────────────────

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

function StepRow({ step, index, isLast }: { step: Step; index: number; isLast: boolean }) {
  const stepTypeLabel: Record<string, string> = {
    HTTP_CALL: "HTTP",
    LLM_CALL: "LLM",
    TOOL_CALL: "Tool",
    APPROVAL_GATE: "Approval",
    SYSTEM: "System",
    ERROR: "Error",
  };

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={cn("mt-1.5 h-2.5 w-2.5 rounded-full shrink-0", stepStatusColor(step.status))} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className="flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{step.name}</span>
          <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {stepTypeLabel[step.stepType] ?? step.stepType}
          </span>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-semibold",
              step.status === "SUCCEEDED"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : step.status === "FAILED"
                  ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400"
                  : "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            {step.status}
          </span>
          {step.tokensUsed != null && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <Zap className="h-3 w-3" />
              {step.tokensUsed.toLocaleString()}
            </span>
          )}
          {step.estimatedCostUsd != null && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <Coins className="h-3 w-3" />${step.estimatedCostUsd.toFixed(4)}
            </span>
          )}
        </div>
        {step.errorMessage && (
          <p className="mt-1 text-xs text-red-500 font-mono">{step.errorMessage}</p>
        )}
        <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
          {step.startedAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />{fmt(step.startedAt)}
            </span>
          )}
          {step.finishedAt && step.startedAt && (
            <span>{fmtDur(new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime())}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Audit log tab (placeholder — links to /settings/audit) ──────────────

function AuditLogTab({ runId }: { runId: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <ScrollText className="h-8 w-8 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Audit log</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Full audit trail for run <code className="font-mono">{runId.slice(0, 14)}…</code> is
          available in the audit log viewer.
        </p>
      </div>
      <Link
        href="/settings/audit"
        className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted transition-colors"
      >
        Open audit log →
      </Link>
    </div>
  );
}

// ─── Raw tab ──────────────────────────────────────────────────────────────

function RawTab({ run }: { run: AgentRun }) {
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted/40 p-4 text-[11px] leading-relaxed">
      {JSON.stringify(run, null, 2)}
    </pre>
  );
}

// ─── Approval section (shared between tabs) ────────────────────────────────

function ApprovalSection({ approvals }: { approvals: ApprovalRecord[] }) {
  if (approvals.length === 0) return null;
  return (
    <div className="space-y-3">
      {approvals.map((ap) => (
        <div
          key={ap.id}
          className={cn(
            "rounded-lg border p-4 space-y-2",
            ap.status === "PENDING"
              ? "border-amber-500/20 bg-amber-500/[0.03]"
              : ap.status === "APPROVED"
                ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                : "border-red-500/20 bg-red-500/[0.03]",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{ap.title}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                ap.status === "PENDING"
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                  : ap.status === "APPROVED"
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                    : "bg-red-500/10 text-red-600 border-red-500/20",
              )}
            >
              {ap.status === "PENDING" && <Clock className="h-3 w-3" />}
              {ap.status === "APPROVED" && <CheckCircle className="h-3 w-3" />}
              {ap.status === "REJECTED" && <XCircle className="h-3 w-3" />}
              {ap.status.charAt(0) + ap.status.slice(1).toLowerCase()}
            </span>
            <span className="text-xs text-muted-foreground">Requested {fmt(ap.requestedAt)}</span>
          </div>
          <p className="text-sm text-muted-foreground">{ap.message}</p>
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
                  <p className="mt-0.5 text-muted-foreground">&ldquo;{ap.decisionReason}&rdquo;</p>
                )}
              </div>
            </div>
          )}
          {ap.status === "PENDING" && (
            <Link
              href="/approvals"
              className="inline-flex h-7 items-center rounded-md bg-primary/[0.08] border border-primary/20 px-3 text-xs font-medium text-primary hover:bg-primary/[0.14]"
            >
              Review in Approvals →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────

interface RunDetailTabsProps {
  run: AgentRun;
  timelineEvents: RunTimelineEvent[];
  defaultTab?: "timeline" | "steps" | "output" | "audit" | "raw";
}

export function RunDetailTabs({
  run,
  timelineEvents,
  defaultTab = "timeline",
}: RunDetailTabsProps) {
  const hasOutput = Boolean(run.outputJson);
  const stepsDone = run.steps.filter((s) => s.status === "SUCCEEDED").length;

  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      {/* ── Tab list ───────────────────────────────────────────────────── */}
      <TabsList className="h-9">
        <TabsTrigger value="timeline" className="gap-1.5 text-xs">
          <History className="h-3.5 w-3.5" />
          Timeline
          <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
            {timelineEvents.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="steps" className="gap-1.5 text-xs">
          <List className="h-3.5 w-3.5" />
          Steps
          <span className="ml-0.5 text-[10px] text-muted-foreground">
            {stepsDone}/{run.steps.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="output" className="gap-1.5 text-xs">
          <Zap className="h-3.5 w-3.5" />
          Output
        </TabsTrigger>
        <TabsTrigger value="audit" className="gap-1.5 text-xs">
          <ScrollText className="h-3.5 w-3.5" />
          Audit Log
        </TabsTrigger>
        <TabsTrigger value="raw" className="gap-1.5 text-xs">
          Raw
        </TabsTrigger>
      </TabsList>

      {/* ── Timeline tab (primary) ─────────────────────────────────────── */}
      <TabsContent value="timeline" className="mt-0">
        <RunExecutionTimeline events={timelineEvents} />
      </TabsContent>

      {/* ── Steps tab ─────────────────────────────────────────────────── */}
      <TabsContent value="steps" className="mt-0">
        <Card>
          <CardHeader>
            <CardTitle>Steps ({run.steps.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {run.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
            ) : (
              <div className="space-y-0">
                {[...run.steps]
                  .sort((a, b) => a.stepIndex - b.stepIndex)
                  .map((step, i) => (
                    <StepRow
                      key={step.id}
                      step={step}
                      index={i}
                      isLast={i === run.steps.length - 1}
                    />
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        {run.approvalRequests.length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Approval Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <ApprovalSection approvals={run.approvalRequests} />
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ── Output tab ────────────────────────────────────────────────── */}
      <TabsContent value="output" className="mt-0">
        <Card>
          <CardHeader>
            <CardTitle>Run Output</CardTitle>
          </CardHeader>
          <CardContent>
            {hasOutput ? (
              <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted/40 p-4 text-[11px] leading-relaxed">
                {JSON.stringify(run.outputJson, null, 2)}
              </pre>
            ) : (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                No output — run did not complete successfully.
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Audit log tab ─────────────────────────────────────────────── */}
      <TabsContent value="audit" className="mt-0">
        <Card>
          <CardContent className="pt-6">
            <AuditLogTab runId={run.id} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Raw tab ───────────────────────────────────────────────────── */}
      <TabsContent value="raw" className="mt-0">
        <Card>
          <CardHeader>
            <CardTitle>Raw API Response</CardTitle>
          </CardHeader>
          <CardContent>
            <RawTab run={run} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
