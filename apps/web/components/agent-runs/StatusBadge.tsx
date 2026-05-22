import { cn } from "@/lib/utils";
import type { RunStatus, StepType, StepStatus } from "@/mocks/agent-run.mock";

// ─── Run status badge ─────────────────────────────────────────────────────────

const RUN_STATUS_MAP: Record<
  RunStatus,
  { label: string; dotClass: string; textClass: string; bgClass: string; borderClass: string }
> = {
  QUEUED: {
    label: "Queued",
    dotClass: "bg-muted-foreground/50",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/50",
    borderClass: "border-border",
  },
  RUNNING: {
    label: "Running",
    dotClass: "bg-blue-500 animate-pulse",
    textClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
  },
  WAITING_FOR_APPROVAL: {
    label: "Awaiting Approval",
    dotClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
  },
  SUCCEEDED: {
    label: "Succeeded",
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
  },
  FAILED: {
    label: "Failed",
    dotClass: "bg-red-500",
    textClass: "text-red-600 dark:text-red-400",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
  },
  CANCELLED: {
    label: "Cancelled",
    dotClass: "bg-muted-foreground/50",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/50",
    borderClass: "border-border",
  },
  TIMEOUT: {
    label: "Timeout",
    dotClass: "bg-orange-500",
    textClass: "text-orange-600 dark:text-orange-400",
    bgClass: "bg-orange-500/10",
    borderClass: "border-orange-500/20",
  },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = RUN_STATUS_MAP[status] ?? RUN_STATUS_MAP.QUEUED;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
        s.bgClass,
        s.borderClass,
        s.textClass,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dotClass)} />
      {s.label}
    </span>
  );
}

// ─── Step type badge ──────────────────────────────────────────────────────────

const STEP_TYPE_MAP: Record<
  StepType,
  { label: string; textClass: string; bgClass: string; borderClass: string }
> = {
  SYSTEM: {
    label: "System",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/60",
    borderClass: "border-border",
  },
  LLM_CALL: {
    label: "LLM Call",
    textClass: "text-purple-600 dark:text-purple-400",
    bgClass: "bg-purple-500/10",
    borderClass: "border-purple-500/20",
  },
  TOOL_CALL: {
    label: "Tool Call",
    textClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
  },
  HTTP_CALL: {
    label: "HTTP Call",
    textClass: "text-sky-600 dark:text-sky-400",
    bgClass: "bg-sky-500/10",
    borderClass: "border-sky-500/20",
  },
  APPROVAL_GATE: {
    label: "Approval Gate",
    textClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
  },
  ERROR: {
    label: "Error",
    textClass: "text-red-600 dark:text-red-400",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
  },
};

export function StepTypeBadge({ type }: { type: StepType }) {
  const s = STEP_TYPE_MAP[type] ?? STEP_TYPE_MAP.SYSTEM;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        s.bgClass,
        s.borderClass,
        s.textClass,
      )}
    >
      {s.label}
    </span>
  );
}

// ─── Step status dot ──────────────────────────────────────────────────────────

const STEP_STATUS_DOT: Record<StepStatus, string> = {
  PENDING: "bg-muted-foreground/30 border-2 border-border",
  RUNNING: "bg-blue-500 animate-pulse ring-2 ring-blue-500/30",
  SUCCEEDED: "bg-emerald-500",
  FAILED: "bg-red-500",
  SKIPPED: "bg-muted-foreground/20",
};

export function StepStatusDot({ status }: { status: StepStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-3 w-3 rounded-full shrink-0",
        STEP_STATUS_DOT[status] ?? "bg-muted",
      )}
    />
  );
}

// ─── Approval status badge ────────────────────────────────────────────────────

export function ApprovalStatusBadge({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" }) {
  const map = {
    PENDING: {
      label: "Pending",
      classes: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
    },
    APPROVED: {
      label: "Approved",
      classes: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
    },
    REJECTED: {
      label: "Rejected",
      classes: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
    },
    EXPIRED: {
      label: "Expired",
      classes: "bg-muted/50 text-muted-foreground border-border",
    },
  };
  const { label, classes } = map[status] ?? map.EXPIRED;
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold", classes)}>
      {label}
    </span>
  );
}
