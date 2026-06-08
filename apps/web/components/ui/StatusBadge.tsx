import { cn } from "@/lib/utils";
import type { RunStatus, TimelineEventStatus } from "@/types/agent-run-ui";

type StatusVariant = RunStatus | TimelineEventStatus;

const STATUS_STYLES: Record<string, string> = {
  // Run statuses
  QUEUED:               "border-sky-200 bg-sky-50 text-sky-700",
  RUNNING:              "border-teal-200 bg-teal-50 text-teal-700",
  WAITING_FOR_APPROVAL: "border-amber-200 bg-amber-50 text-amber-800",
  SUCCEEDED:            "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED:               "border-red-200 bg-red-50 text-red-700",
  CANCELLED:            "border-slate-200 bg-slate-100 text-slate-500",
  TIMEOUT:              "border-orange-200 bg-orange-50 text-orange-700",
  // Timeline event statuses
  PENDING:              "border-slate-200 bg-slate-50 text-slate-500",
  WAITING:              "border-amber-200 bg-amber-50 text-amber-800",
  SKIPPED:              "border-slate-200 bg-white text-slate-400",
};

const LABEL_MAP: Record<string, string> = {
  WAITING_FOR_APPROVAL: "Waiting for approval",
  QUEUED:               "Queued",
  RUNNING:              "Running",
  SUCCEEDED:            "Succeeded",
  FAILED:               "Failed",
  CANCELLED:            "Cancelled",
  TIMEOUT:              "Timed out",
  PENDING:              "Pending",
  WAITING:              "Waiting",
  SKIPPED:              "Skipped",
};

const DOT_COLORS: Record<string, string> = {
  QUEUED:               "bg-sky-400",
  RUNNING:              "bg-teal-500",
  WAITING_FOR_APPROVAL: "bg-amber-500",
  SUCCEEDED:            "bg-emerald-500",
  FAILED:               "bg-red-500",
  CANCELLED:            "bg-slate-400",
  TIMEOUT:              "bg-orange-500",
  PENDING:              "bg-slate-400",
  WAITING:              "bg-amber-500",
  SKIPPED:              "bg-slate-300",
};

const ANIMATE_PULSE = new Set(["RUNNING", "WAITING_FOR_APPROVAL", "WAITING"]);

interface StatusBadgeProps {
  status: StatusVariant;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ status, dot = true, className }: StatusBadgeProps) {
  const styles  = STATUS_STYLES[status] ?? "border-slate-200 bg-slate-50 text-slate-500";
  const dotColor = DOT_COLORS[status] ?? "bg-slate-400";
  const label   = LABEL_MAP[status] ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
  const pulse   = ANIMATE_PULSE.has(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold leading-none",
        styles,
        className,
      )}
    >
      {dot && (
        <span className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          dotColor,
          pulse && "animate-pulse",
        )} />
      )}
      {label}
    </span>
  );
}
