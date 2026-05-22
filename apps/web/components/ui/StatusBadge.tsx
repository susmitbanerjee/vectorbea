import { cn } from "@/lib/utils";
import type { RunStatus, TimelineEventStatus } from "@/types/agent-run-ui";

type StatusVariant = RunStatus | TimelineEventStatus;

const STATUS_STYLES: Record<string, string> = {
  // Run statuses
  QUEUED:               "border-slate-500/20  bg-slate-500/10  text-slate-600  dark:text-slate-400",
  RUNNING:              "border-blue-500/20   bg-blue-500/10   text-blue-600   dark:text-blue-400",
  WAITING_FOR_APPROVAL: "border-amber-500/20  bg-amber-500/10  text-amber-600  dark:text-amber-400",
  SUCCEEDED:            "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  FAILED:               "border-red-500/20    bg-red-500/10    text-red-600    dark:text-red-400",
  CANCELLED:            "border-slate-500/20  bg-slate-500/10  text-slate-500  dark:text-slate-400",
  TIMEOUT:              "border-orange-500/20 bg-orange-500/10 text-orange-600  dark:text-orange-400",
  // Timeline event statuses
  PENDING:              "border-slate-500/20  bg-slate-500/10  text-slate-500",
  WAITING:              "border-amber-500/20  bg-amber-500/10  text-amber-600",
  SKIPPED:              "border-slate-500/20  bg-transparent   text-muted-foreground",
};

const DOT_COLORS: Record<string, string> = {
  QUEUED:               "bg-slate-400",
  RUNNING:              "bg-blue-500 animate-pulse",
  WAITING_FOR_APPROVAL: "bg-amber-500 animate-pulse",
  SUCCEEDED:            "bg-emerald-500",
  FAILED:               "bg-red-500",
  CANCELLED:            "bg-slate-400",
  TIMEOUT:              "bg-orange-500",
  PENDING:              "bg-slate-400",
  WAITING:              "bg-amber-500",
  SKIPPED:              "bg-slate-300",
};

interface StatusBadgeProps {
  status: StatusVariant;
  /** Show a pulsing dot before the label */
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ status, dot = false, className }: StatusBadgeProps) {
  const styles = STATUS_STYLES[status] ?? "border-border bg-muted text-muted-foreground";
  const dotColor = DOT_COLORS[status] ?? "bg-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        styles,
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />}
      {status.replace(/_/g, " ")}
    </span>
  );
}
