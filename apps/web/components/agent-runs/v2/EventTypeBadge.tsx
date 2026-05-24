import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock,
  FileCode2,
  Globe,
  ListChecks,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Sparkles,
  SkipForward,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineEventType } from "@/types/agent-run-ui";

// ─── Config ───────────────────────────────────────────────────────────────────

interface EventConfig {
  icon: React.ReactNode;
  label: string;
  color: string;       // tailwind text color
  bg: string;          // tailwind bg
  border: string;      // tailwind border
  dot: string;         // dot color class
}

const EVENT_CONFIG: Partial<Record<TimelineEventType, EventConfig>> = {
  RUN_CREATED: { icon: <CircleDot className="h-3 w-3" />, label: "Created", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-border", dot: "bg-slate-400" },
  RUN_QUEUED: { icon: <Clock className="h-3 w-3" />, label: "Queued", color: "text-[#6B7280]", bg: "bg-[#F9FAFB]", border: "border-[#E5E7EB]", dot: "bg-[#9CA3AF]" },
  RUN_STARTED: { icon: <Play className="h-3 w-3" />, label: "Started", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/25", dot: "bg-blue-500" },
  RUN_PAUSED: { icon: <Clock className="h-3 w-3" />, label: "Paused", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25", dot: "bg-amber-500" },
  RUN_RESUMED: { icon: <RefreshCw className="h-3 w-3" />, label: "Resumed", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/25", dot: "bg-blue-500" },
  RUN_SUCCEEDED: { icon: <Zap className="h-3 w-3" />, label: "Succeeded", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", dot: "bg-emerald-500" },
  RUN_FAILED: { icon: <XCircle className="h-3 w-3" />, label: "Failed", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  RUN_CANCELLED: { icon: <XCircle className="h-3 w-3" />, label: "Cancelled", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-border", dot: "bg-slate-400" },
  RUN_TIMED_OUT: { icon: <AlertTriangle className="h-3 w-3" />, label: "Timed Out", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/25", dot: "bg-orange-500" },
  BUDGET_CHECK_PASSED: { icon: <CheckCircle2 className="h-3 w-3" />, label: "Budget ✓", color: "text-muted-foreground", bg: "bg-muted/40", border: "border-border/60", dot: "bg-slate-300" },
  BUDGET_CHECK_FAILED: { icon: <XCircle className="h-3 w-3" />, label: "Budget ✗", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  POLICY_CHECK_PASSED: { icon: <ShieldCheck className="h-3 w-3" />, label: "Policy ✓", color: "text-muted-foreground", bg: "bg-muted/40", border: "border-border/60", dot: "bg-slate-300" },
  POLICY_CHECK_FAILED: { icon: <ShieldX className="h-3 w-3" />, label: "Policy ✗", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  AGENT_SELECTED: { icon: <Bot className="h-3 w-3" />, label: "Agent Selected", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25", dot: "bg-violet-500" },
  AGENT_STARTED: { icon: <Bot className="h-3 w-3" />, label: "Agent Started", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25", dot: "bg-violet-500" },
  AGENT_PLAN_CREATED: { icon: <ListChecks className="h-3 w-3" />, label: "Plan Created", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25", dot: "bg-violet-400" },
  AGENT_HANDOFF: { icon: <ArrowRight className="h-3 w-3" />, label: "Handoff →", color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/25", dot: "bg-cyan-500" },
  AGENT_COMPLETED: { icon: <Bot className="h-3 w-3" />, label: "Agent Done", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25", dot: "bg-violet-400" },
  AGENT_FAILED: { icon: <Bot className="h-3 w-3" />, label: "Agent Failed", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  STEP_STARTED: { icon: <Play className="h-3 w-3" />, label: "Step", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/25", dot: "bg-blue-400" },
  STEP_COMPLETED: { icon: <CheckCircle2 className="h-3 w-3" />, label: "Step ✓", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", dot: "bg-emerald-500" },
  STEP_FAILED: { icon: <XCircle className="h-3 w-3" />, label: "Step ✗", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  LLM_CALL_STARTED: { icon: <Sparkles className="h-3 w-3" />, label: "LLM Call", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/25", dot: "bg-purple-500" },
  LLM_CALL_COMPLETED: { icon: <Sparkles className="h-3 w-3" />, label: "LLM ✓", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/25", dot: "bg-purple-500" },
  LLM_CALL_FAILED: { icon: <Sparkles className="h-3 w-3" />, label: "LLM ✗", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  LLM_OUTPUT_VALIDATED: { icon: <CheckCircle2 className="h-3 w-3" />, label: "LLM Valid ✓", color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/25", dot: "bg-purple-400" },
  TOOL_CALL_STARTED: { icon: <Wrench className="h-3 w-3" />, label: "Tool Call", color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/25", dot: "bg-cyan-500" },
  TOOL_CALL_COMPLETED: { icon: <Wrench className="h-3 w-3" />, label: "Tool ✓", color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/25", dot: "bg-cyan-500" },
  TOOL_CALL_FAILED: { icon: <Wrench className="h-3 w-3" />, label: "Tool ✗", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  HTTP_CALL_STARTED: { icon: <Globe className="h-3 w-3" />, label: "HTTP Call", color: "text-teal-600 dark:text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/25", dot: "bg-teal-500" },
  HTTP_CALL_COMPLETED: { icon: <Globe className="h-3 w-3" />, label: "HTTP ✓", color: "text-teal-600 dark:text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/25", dot: "bg-teal-500" },
  HTTP_CALL_FAILED: { icon: <Globe className="h-3 w-3" />, label: "HTTP ✗", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  APPROVAL_REQUESTED: { icon: <ShieldCheck className="h-3 w-3" />, label: "Approval", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25", dot: "bg-amber-500" },
  APPROVAL_APPROVED: { icon: <ShieldCheck className="h-3 w-3" />, label: "Approved", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", dot: "bg-emerald-500" },
  APPROVAL_REJECTED: { icon: <ShieldX className="h-3 w-3" />, label: "Rejected", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-500" },
  APPROVAL_EXPIRED: { icon: <Clock className="h-3 w-3" />, label: "Expired", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-border", dot: "bg-slate-400" },
  RETRY_SCHEDULED: { icon: <RefreshCw className="h-3 w-3" />, label: "Retry ⟳", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/25", dot: "bg-orange-500" },
  RETRY_STARTED: { icon: <RefreshCw className="h-3 w-3" />, label: "Retry", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/25", dot: "bg-orange-500" },
  RETRY_EXHAUSTED: { icon: <AlertTriangle className="h-3 w-3" />, label: "Exhausted", color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/25", dot: "bg-red-600" },
  ARTIFACT_CREATED: { icon: <FileCode2 className="h-3 w-3" />, label: "Artifact", color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/25", dot: "bg-indigo-500" },
};

const FALLBACK: EventConfig = {
  icon: <CircleDot className="h-3 w-3" />,
  label: "Event",
  color: "text-muted-foreground",
  bg: "bg-muted/50",
  border: "border-border",
  dot: "bg-slate-400",
};

export function getEventConfig(type: TimelineEventType): EventConfig {
  return EVENT_CONFIG[type] ?? FALLBACK;
}

// Compact system events that should render smaller
const COMPACT_TYPES: TimelineEventType[] = [
  "RUN_CREATED", "RUN_QUEUED", "BUDGET_CHECK_PASSED", "POLICY_CHECK_PASSED",
  "RUN_RESUMED", "AGENT_SELECTED", "AGENT_HANDOFF", "LLM_OUTPUT_VALIDATED",
];
export function isCompactEvent(type: TimelineEventType): boolean {
  return COMPACT_TYPES.includes(type);
}

// ─── Exported badge ───────────────────────────────────────────────────────────

export function EventTypeBadge({ type, className }: { type: TimelineEventType; className?: string }) {
  const cfg = getEventConfig(type);
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap",
      cfg.bg, cfg.border, cfg.color, className,
    )}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

export function EventDot({ type, className }: { type: TimelineEventType; className?: string }) {
  const cfg = getEventConfig(type);
  return <span className={cn("inline-block rounded-full shrink-0", cfg.dot, className)} />;
}

// Larger icon for the rail
export function EventRailIcon({ type }: { type: TimelineEventType }) {
  const cfg = getEventConfig(type);
  const isFailed = type.includes("FAILED") || type.includes("EXHAUSTED");
  const isSuccess = type.includes("SUCCEEDED") || type.includes("COMPLETED") || type.includes("APPROVED");
  const isWaiting = type.includes("PAUSED") || type === "APPROVAL_REQUESTED";

  return (
    <span className={cn(
      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
      isFailed ? "border-red-500/30 bg-red-500/10 text-red-500" :
      isWaiting ? "border-amber-500/30 bg-amber-500/10 text-amber-500" :
      isSuccess ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" :
      `${cfg.border} ${cfg.bg} ${cfg.color}`,
    )}>
      <span className="[&>svg]:h-2.5 [&>svg]:w-2.5">{cfg.icon}</span>
    </span>
  );
}

export { COMPACT_TYPES };
