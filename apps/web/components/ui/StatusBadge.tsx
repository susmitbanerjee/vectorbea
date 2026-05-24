import { cn } from "@/lib/utils";
import type { RunStatus, TimelineEventStatus } from "@/types/agent-run-ui";

type StatusVariant = RunStatus | TimelineEventStatus;

const STATUS_STYLES: Record<string, string> = {
  // Run statuses
  QUEUED:               "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]",
  RUNNING:              "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
  WAITING_FOR_APPROVAL: "border-amber-200 bg-amber-50  text-amber-700",
  SUCCEEDED:            "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED:               "border-red-200   bg-red-50    text-red-700",
  CANCELLED:            "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]",
  TIMEOUT:              "border-orange-200 bg-orange-50 text-orange-700",
  // Timeline event statuses
  PENDING:              "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]",
  WAITING:              "border-amber-200 bg-amber-50  text-amber-700",
  SKIPPED:              "border-[#E5E7EB] bg-white     text-[#9CA3AF]",
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
