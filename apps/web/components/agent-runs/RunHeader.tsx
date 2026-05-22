import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Key,
  RefreshCw,
  ScrollText,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { RunStatusBadge } from "@/components/agent-runs/StatusBadge";
import type { MockRun } from "@/mocks/agent-run.mock";
import { cn } from "@/lib/utils";

interface RunHeaderProps {
  run: MockRun;
  onRetry?: () => void;
  isMock?: boolean;
}

function fmt(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
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
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: "Manual trigger",
  SCHEDULE: "Scheduled (cron)",
  RETRY: "Retry",
};

export function RunHeader({ run, onRetry, isMock = true }: RunHeaderProps) {
  const canRetry = ["FAILED", "TIMEOUT", "CANCELLED"].includes(run.status);

  return (
    <div className="space-y-4">
      {/* Breadcrumb + mock badge */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/agent-jobs/${run.jobId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {run.jobName}
        </Link>

        {isMock && (
          <span className="inline-flex items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            ⚠ Mock data — not connected to API
          </span>
        )}
      </div>

      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">
              {run.jobName} — Run
            </h1>
            <RunStatusBadge status={run.status} />
            <span className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Attempt #{run.attemptNumber}
            </span>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{run.id}</p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {canRetry && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry run
            </Button>
          )}
          <Link
            href={`/agent-jobs/${run.jobId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to job
          </Link>
          <Link
            href="/audit-logs"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5")}
          >
            <ScrollText className="h-3.5 w-3.5" />
            View audit log
          </Link>
        </div>
      </div>

      {/* Metadata strip */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs">
        <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Started">
          {fmt(run.startedAt)}
        </MetaItem>
        {run.finishedAt && (
          <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Finished">
            {fmt(run.finishedAt)}
          </MetaItem>
        )}
        <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Duration">
          {fmtDur(run.durationMs)}
        </MetaItem>
        <MetaItem label="Trigger">
          {TRIGGER_LABEL[run.triggerSource] ?? run.triggerSource}
        </MetaItem>
        <MetaItem label="Job">
          <Link
            href={`/agent-jobs/${run.jobId}`}
            className="font-medium text-foreground hover:underline"
          >
            {run.jobName}
          </Link>
        </MetaItem>
        <MetaItem icon={<Key className="h-3 w-3" />} label="Idempotency key">
          <code className={cn("font-mono text-[10px]")}>{run.idempotencyKey}</code>
        </MetaItem>
      </div>

      {/* Error banner */}
      {run.errorMessage && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <span className="font-semibold">Error: </span>
          {run.errorMessage}
        </div>
      )}
    </div>
  );
}

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
