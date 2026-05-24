import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  SkipForward,
  Sparkles,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunTimelineEventType } from "@/lib/run-timeline";

interface EventTypeConfig {
  icon: React.ReactNode;
  label: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  dotClass: string;
}

const EVENT_TYPE_CONFIG: Partial<Record<RunTimelineEventType, EventTypeConfig>> = {
  RUN_CREATED: {
    icon: <CircleDot className="h-3 w-3" />,
    label: "Run Created",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/60",
    borderClass: "border-border",
    dotClass: "bg-muted-foreground/60",
  },
  RUN_QUEUED: {
    icon: <Clock className="h-3 w-3" />,
    label: "Queued",
    textClass: "text-sky-600",
    bgClass: "bg-sky-500/10",
    borderClass: "border-sky-500/20",
    dotClass: "bg-sky-500",
  },
  RUN_STARTED: {
    icon: <Play className="h-3 w-3" />,
    label: "Run Started",
    textClass: "text-blue-600",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
    dotClass: "bg-blue-500",
  },
  RUN_SUCCEEDED: {
    icon: <Zap className="h-3 w-3" />,
    label: "Succeeded",
    textClass: "text-emerald-600",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
    dotClass: "bg-emerald-500",
  },
  RUN_FAILED: {
    icon: <XCircle className="h-3 w-3" />,
    label: "Failed",
    textClass: "text-red-600",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    dotClass: "bg-red-500",
  },
  RUN_CANCELLED: {
    icon: <XCircle className="h-3 w-3" />,
    label: "Cancelled",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/60",
    borderClass: "border-border",
    dotClass: "bg-muted-foreground/40",
  },
  RUN_TIMEOUT: {
    icon: <AlertTriangle className="h-3 w-3" />,
    label: "Timeout",
    textClass: "text-orange-600",
    bgClass: "bg-orange-500/10",
    borderClass: "border-orange-500/20",
    dotClass: "bg-orange-500",
  },
  RUN_RESUMED: {
    icon: <RefreshCw className="h-3 w-3" />,
    label: "Resumed",
    textClass: "text-blue-600",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
    dotClass: "bg-blue-500",
  },
  BUDGET_CHECK_PASSED: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Budget ✓",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/60",
    borderClass: "border-border",
    dotClass: "bg-muted-foreground/40",
  },
  BUDGET_CHECK_FAILED: {
    icon: <XCircle className="h-3 w-3" />,
    label: "Budget ✗",
    textClass: "text-red-600",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    dotClass: "bg-red-500",
  },
  POLICY_CHECK_PASSED: {
    icon: <ShieldCheck className="h-3 w-3" />,
    label: "Policy ✓",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/60",
    borderClass: "border-border",
    dotClass: "bg-muted-foreground/40",
  },
  POLICY_CHECK_FAILED: {
    icon: <ShieldX className="h-3 w-3" />,
    label: "Policy ✗",
    textClass: "text-red-600",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    dotClass: "bg-red-500",
  },
  STEP_STARTED: {
    icon: <Bot className="h-3 w-3" />,
    label: "Step",
    textClass: "text-blue-600",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
    dotClass: "bg-blue-500",
  },
  STEP_SUCCEEDED: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Step ✓",
    textClass: "text-emerald-600",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
    dotClass: "bg-emerald-500",
  },
  STEP_FAILED: {
    icon: <XCircle className="h-3 w-3" />,
    label: "Step ✗",
    textClass: "text-red-600",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    dotClass: "bg-red-500",
  },
  STEP_SKIPPED: {
    icon: <SkipForward className="h-3 w-3" />,
    label: "Skipped",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/60",
    borderClass: "border-border",
    dotClass: "bg-muted-foreground/30",
  },
  LLM_CALL_STARTED: {
    icon: <Sparkles className="h-3 w-3" />,
    label: "LLM Call",
    textClass: "text-purple-600",
    bgClass: "bg-purple-500/10",
    borderClass: "border-purple-500/20",
    dotClass: "bg-purple-500",
  },
  LLM_CALL_SUCCEEDED: {
    icon: <Sparkles className="h-3 w-3" />,
    label: "LLM ✓",
    textClass: "text-purple-600",
    bgClass: "bg-purple-500/10",
    borderClass: "border-purple-500/20",
    dotClass: "bg-purple-500",
  },
  LLM_CALL_FAILED: {
    icon: <Sparkles className="h-3 w-3" />,
    label: "LLM ✗",
    textClass: "text-red-600",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    dotClass: "bg-red-500",
  },
  TOOL_CALL_STARTED: {
    icon: <Wrench className="h-3 w-3" />,
    label: "Tool Call",
    textClass: "text-cyan-600",
    bgClass: "bg-cyan-500/10",
    borderClass: "border-cyan-500/20",
    dotClass: "bg-cyan-500",
  },
  TOOL_CALL_SUCCEEDED: {
    icon: <Wrench className="h-3 w-3" />,
    label: "Tool ✓",
    textClass: "text-cyan-600",
    bgClass: "bg-cyan-500/10",
    borderClass: "border-cyan-500/20",
    dotClass: "bg-cyan-500",
  },
  TOOL_CALL_FAILED: {
    icon: <Wrench className="h-3 w-3" />,
    label: "Tool ✗",
    textClass: "text-red-600",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    dotClass: "bg-red-500",
  },
  APPROVAL_PAUSED: {
    icon: <Clock className="h-3 w-3" />,
    label: "Paused",
    textClass: "text-amber-600",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
    dotClass: "bg-amber-500",
  },
  APPROVAL_REQUESTED: {
    icon: <ShieldCheck className="h-3 w-3" />,
    label: "Approval",
    textClass: "text-amber-600",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
    dotClass: "bg-amber-500",
  },
  APPROVAL_APPROVED: {
    icon: <ShieldCheck className="h-3 w-3" />,
    label: "Approved",
    textClass: "text-emerald-600",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
    dotClass: "bg-emerald-500",
  },
  APPROVAL_REJECTED: {
    icon: <ShieldX className="h-3 w-3" />,
    label: "Rejected",
    textClass: "text-red-600",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
    dotClass: "bg-red-500",
  },
  APPROVAL_EXPIRED: {
    icon: <Clock className="h-3 w-3" />,
    label: "Expired",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/60",
    borderClass: "border-border",
    dotClass: "bg-muted-foreground/40",
  },
  RETRY_QUEUED: {
    icon: <RefreshCw className="h-3 w-3" />,
    label: "Retry ⟳",
    textClass: "text-orange-600",
    bgClass: "bg-orange-500/10",
    borderClass: "border-orange-500/20",
    dotClass: "bg-orange-500",
  },
  RETRY_STARTED: {
    icon: <RefreshCw className="h-3 w-3" />,
    label: "Retry",
    textClass: "text-orange-600",
    bgClass: "bg-orange-500/10",
    borderClass: "border-orange-500/20",
    dotClass: "bg-orange-500",
  },
};

const FALLBACK_CONFIG: EventTypeConfig = {
  icon: <CircleDot className="h-3 w-3" />,
  label: "Event",
  textClass: "text-muted-foreground",
  bgClass: "bg-muted/60",
  borderClass: "border-border",
  dotClass: "bg-muted-foreground/40",
};

export function getEventTypeConfig(type: RunTimelineEventType): EventTypeConfig {
  return EVENT_TYPE_CONFIG[type] ?? FALLBACK_CONFIG;
}

interface EventTypeBadgeProps {
  type: RunTimelineEventType;
  className?: string;
}

export function EventTypeBadge({ type, className }: EventTypeBadgeProps) {
  const cfg = getEventTypeConfig(type);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        cfg.bgClass,
        cfg.borderClass,
        cfg.textClass,
        className,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

/** Small colored dot for the timeline rail */
export function EventTypeDot({
  type,
  className,
}: {
  type: RunTimelineEventType;
  className?: string;
}) {
  const cfg = getEventTypeConfig(type);
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 rounded-full shrink-0", cfg.dotClass, className)}
    />
  );
}
