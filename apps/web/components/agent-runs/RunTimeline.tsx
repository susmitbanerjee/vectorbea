"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Clock, ShieldAlert, User } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StepTypeBadge, StepStatusDot, ApprovalStatusBadge } from "@/components/agent-runs/StatusBadge";
import { JsonViewer } from "@/components/agent-runs/JsonViewer";
import type { MockStep } from "@/mocks/agent-run.mock";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDur(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── Single timeline item ─────────────────────────────────────────────────────

function RunTimelineItem({
  step,
  isLast,
}: {
  step: MockStep;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);

  const hasCost = step.tokensUsed != null || step.estimatedCostUsd != null;
  const hasApproval = step.stepType === "APPROVAL_GATE" && step.approval;

  return (
    <div className="flex gap-4">
      {/* Left rail: dot + line */}
      <div className="flex flex-col items-center pt-1">
        <StepStatusDot status={step.status} />
        {!isLast && (
          <div
            className={cn(
              "mt-1 w-px flex-1",
              step.status === "SUCCEEDED" ? "bg-emerald-500/30" : "bg-border",
            )}
          />
        )}
      </div>

      {/* Content */}
      <div className={cn("flex-1 pb-5", isLast && "pb-0")}>
        {/* Header row */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group w-full text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground/60 select-none">
              {String(step.stepIndex).padStart(2, "0")}
            </span>
            <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {step.name}
            </span>
            <StepTypeBadge type={step.stepType} />
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                step.status === "SUCCEEDED"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : step.status === "FAILED"
                    ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400"
                    : step.status === "RUNNING"
                      ? "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "border-border bg-muted/50 text-muted-foreground",
              )}
            >
              {step.status}
            </span>
            {hasCost && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {step.tokensUsed != null && `${step.tokensUsed.toLocaleString()} tokens`}
                {step.tokensUsed != null && step.estimatedCostUsd != null && " · "}
                {step.estimatedCostUsd != null && `$${step.estimatedCostUsd.toFixed(4)}`}
              </span>
            )}
          </div>

          {/* Time + duration */}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {fmt(step.startedAt)}
              {step.finishedAt && ` → ${fmt(step.finishedAt)}`}
            </span>
            {step.durationMs != null && (
              <span>{fmtDur(step.durationMs)}</span>
            )}
          </div>
        </button>

        {/* Description (always visible) */}
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {step.description}
        </p>

        {/* Error */}
        {step.errorMessage && (
          <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">{step.errorMessage}</p>
          </div>
        )}

        {/* Approval gate detail */}
        {hasApproval && (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-4 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-foreground">
                {step.approval!.title}
              </span>
              <ApprovalStatusBadge status={step.approval!.status} />
            </div>
            <p className="text-sm text-muted-foreground">{step.approval!.message}</p>
            {step.approval!.decidedAt && step.approval!.decidedBy && (
              <div className="flex items-start gap-2 border-t border-border/50 pt-2.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {step.approval!.decidedBy.name}
                    </span>
                    <span className="text-muted-foreground">
                      {step.approval!.status === "APPROVED" ? "approved" : "rejected"}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      {new Date(step.approval!.decidedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  </div>
                  {step.approval!.decisionReason && (
                    <p className="mt-1 text-muted-foreground italic">
                      &ldquo;{step.approval!.decisionReason}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expandable JSON — only shown when row is clicked open */}
        {open && (
          <div className="mt-3 space-y-1">
            <JsonViewer label="Input" value={step.inputJson} defaultOpen />
            <JsonViewer label="Output" value={step.outputJson} defaultOpen />
          </div>
        )}

        {/* Collapsed toggle hint */}
        {!open && (step.inputJson != null || step.outputJson != null) && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            + Show input / output JSON
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Timeline container ────────────────────────────────────────────────────────

interface RunTimelineProps {
  steps: MockStep[];
}

export function RunTimeline({ steps }: RunTimelineProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No steps recorded.</p>
        ) : (
          <div>
            {steps.map((step, i) => (
              <RunTimelineItem
                key={step.id}
                step={step}
                isLast={i === steps.length - 1}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
