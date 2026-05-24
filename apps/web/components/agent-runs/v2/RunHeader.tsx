"use client";

import Link from "next/link";
import { ArrowLeft, Check, Clock, Copy, Key, RefreshCw, Tag } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_MAP = {
  SUCCEEDED: { label: "Succeeded", dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  FAILED: { label: "Failed", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  RUNNING: { label: "Running", dot: "bg-blue-500 animate-pulse", text: "text-[#1D4ED8]", bg: "bg-[#EFF6FF]", border: "border-[#BFDBFE]" },
  QUEUED: { label: "Queued", dot: "bg-[#9CA3AF]", text: "text-[#6B7280]", bg: "bg-[#F9FAFB]", border: "border-[#E5E7EB]" },
  WAITING_FOR_APPROVAL: { label: "Waiting for Approval", dot: "bg-amber-500 animate-pulse", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  CANCELLED: { label: "Cancelled", dot: "bg-[#D1D5DB]", text: "text-[#6B7280]", bg: "bg-[#F9FAFB]", border: "border-[#E5E7EB]" },
  TIMEOUT: { label: "Timed Out", dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
};

function fmtDur(ms?: number) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTs(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={e => void copy(e)} className="ml-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RunHeaderProps {
  model: AgentRunUiModel;
  isMock?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function RunHeaderV2({ model, isMock = false, onRetry, onCancel }: RunHeaderProps) {
  const { run } = model;
  const scfg = STATUS_MAP[run.status] ?? STATUS_MAP.QUEUED;
  const canRetry = ["FAILED", "TIMEOUT", "CANCELLED"].includes(run.status);
  const canCancel = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"].includes(run.status);
  const dur = fmtDur(run.durationMs);

  return (
    <div className="space-y-4">
      {/* Breadcrumb + mock badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/agent-jobs/${run.jobId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {run.jobName}
        </Link>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            {run.environment}
          </span>
          {isMock && (
            <span className="inline-flex items-center rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              ⚠ Mock data
            </span>
          )}
        </div>
      </div>

      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{run.title}</h1>
            {/* Status badge */}
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold",
              scfg.bg, scfg.border, scfg.text,
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", scfg.dot)} />
              {scfg.label}
            </span>
            {run.attemptNumber > 1 && (
              <span className="rounded-md border border-orange-500/25 bg-orange-500/10 px-2 py-0.5 text-[11px] font-semibold text-orange-600 dark:text-orange-400">
                Attempt #{run.attemptNumber}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span>{run.id}</span>
            <CopyButton text={run.id} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {canCancel && onCancel && (
            <button type="button" onClick={onCancel}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Cancel
            </button>
          )}
          {canRetry && onRetry && (
            <button type="button" onClick={onRetry}
              className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry Run
            </button>
          )}
          {run.status === "WAITING_FOR_APPROVAL" && (
            <Link href="/approvals"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10")}>
              Review approval →
            </Link>
          )}
          <Link href={`/agent-jobs/${run.jobId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5")}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to job
          </Link>
        </div>
      </div>

      {/* Error banner */}
      {run.errorMessage && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span className="font-semibold">Error: </span>{run.errorMessage}
        </div>
      )}

      {/* Metadata strip */}
      <div
        className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl px-4 py-3 text-xs"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
      >
        <MetaItem icon={<Tag className="h-3.5 w-3.5" />} label="Trigger">{run.triggerSource}</MetaItem>
        <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Started">{fmtTs(run.startedAt)}</MetaItem>
        {run.finishedAt && <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Finished">{fmtTs(run.finishedAt)}</MetaItem>}
        {dur && <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Duration">{dur}</MetaItem>}
        <MetaItem icon={<Key className="h-3 w-3" />} label="Idempotency key">
          <code className="font-mono text-[11px]">{run.idempotencyKey}</code>
          <CopyButton text={run.idempotencyKey} />
        </MetaItem>
      </div>
    </div>
  );
}

function MetaItem({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-muted-foreground">{label}:</span>
      <span className="flex items-center gap-0.5 font-medium text-foreground">{children}</span>
    </div>
  );
}
