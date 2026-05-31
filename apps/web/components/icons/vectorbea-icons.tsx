/**
 * Vectorbea Icon System — single source of truth for all product icons.
 *
 * Usage:
 *   import { IconBadge, WorkflowIcon, AgentIcon } from "@/components/icons/vectorbea-icons";
 *
 *   <IconBadge tone="agent" size="md" />       — styled badge (bg + border + icon)
 *   <AgentIcon className="h-5 w-5" />          — raw icon at any size
 */

import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  BookmarkCheck,
  Bot,
  BrainCircuit,
  Braces,
  CalendarClock,
  CheckCircle2,
  CircleCheck,
  Clock,
  Code2,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  Flag,
  GitBranch,
  GitMerge,
  Globe2,
  Hash,
  KeyRound,
  Layers,
  List,
  Loader2,
  LogOut,
  Mail,
  MessageSquareText,
  MousePointerClick,
  Package,
  PlayCircle,
  Plug,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Split,
  Table2,
  Timer,
  TriangleAlert,
  UserCheck,
  Users,
  Webhook,
  Wrench,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Tone definitions ─────────────────────────────────────────────────────────

export type IconTone =
  | "default"
  | "workflow"
  | "trigger"
  | "agent"
  | "brain"
  | "tool"
  | "http"
  | "database"
  | "email"
  | "webhook"
  | "approval"
  | "condition"
  | "parallel"
  | "timer"
  | "schedule"
  | "checkpoint"
  | "artifact"
  | "end"
  | "success"
  | "warning"
  | "danger"
  | "muted"
  | "info";

export interface ToneConfig {
  iconColor: string;
  bgColor: string;
  borderColor: string;
}

export const TONE_MAP: Record<IconTone, ToneConfig> = {
  default:    { iconColor: "#475569", bgColor: "#F8FAFC", borderColor: "#E2E8F0" },
  workflow:   { iconColor: "#2563EB", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
  trigger:    { iconColor: "#2563EB", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
  agent:      { iconColor: "#7C3AED", bgColor: "#F5F3FF", borderColor: "#DDD6FE" },
  brain:      { iconColor: "#9333EA", bgColor: "#FAF5FF", borderColor: "#E9D5FF" },
  tool:       { iconColor: "#0891B2", bgColor: "#ECFEFF", borderColor: "#A5F3FC" },
  http:       { iconColor: "#059669", bgColor: "#ECFDF5", borderColor: "#A7F3D0" },
  database:   { iconColor: "#0369A1", bgColor: "#F0F9FF", borderColor: "#BAE6FD" },
  email:      { iconColor: "#0072C6", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
  webhook:    { iconColor: "#0284C7", bgColor: "#F0F9FF", borderColor: "#BAE6FD" },
  approval:   { iconColor: "#D97706", bgColor: "#FFFBEB", borderColor: "#FDE68A" },
  condition:  { iconColor: "#7C3AED", bgColor: "#F5F3FF", borderColor: "#DDD6FE" },
  parallel:   { iconColor: "#0369A1", bgColor: "#F0F9FF", borderColor: "#BAE6FD" },
  timer:      { iconColor: "#D97706", bgColor: "#FFFBEB", borderColor: "#FDE68A" },
  schedule:   { iconColor: "#0891B2", bgColor: "#ECFEFF", borderColor: "#A5F3FC" },
  checkpoint: { iconColor: "#2563EB", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
  artifact:   { iconColor: "#475569", bgColor: "#F8FAFC", borderColor: "#E2E8F0" },
  end:        { iconColor: "#059669", bgColor: "#ECFDF5", borderColor: "#A7F3D0" },
  success:    { iconColor: "#059669", bgColor: "#ECFDF5", borderColor: "#BBF7D0" },
  warning:    { iconColor: "#D97706", bgColor: "#FFFBEB", borderColor: "#FDE68A" },
  danger:     { iconColor: "#DC2626", bgColor: "#FEF2F2", borderColor: "#FECACA" },
  muted:      { iconColor: "#94A3B8", bgColor: "#F8FAFC", borderColor: "#E2E8F0" },
  info:       { iconColor: "#2563EB", bgColor: "#EFF6FF", borderColor: "#BFDBFE" },
};

// ─── Badge sizes ──────────────────────────────────────────────────────────────

export type BadgeSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CONFIG: Record<BadgeSize, { badge: number; icon: number; radius: string }> = {
  xs: { badge: 20, icon: 10, radius: "6px" },
  sm: { badge: 28, icon: 13, radius: "8px"  },
  md: { badge: 36, icon: 16, radius: "10px" },
  lg: { badge: 44, icon: 20, radius: "12px" },
  xl: { badge: 56, icon: 26, radius: "14px" },
};

// ─── IconBadge: the main visual building block ────────────────────────────────

interface IconBadgeProps {
  icon: LucideIcon;
  tone?: IconTone;
  size?: BadgeSize;
  className?: string;
  /** Override icon color */
  color?: string;
}

export function IconBadge({ icon: Icon, tone = "default", size = "md", className, color }: IconBadgeProps) {
  const cfg = TONE_MAP[tone];
  const sz = SIZE_CONFIG[size];
  const iconColor = color ?? cfg.iconColor;

  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{
        width: sz.badge,
        height: sz.badge,
        borderRadius: sz.radius,
        background: cfg.bgColor,
        border: `1px solid ${cfg.borderColor}`,
      }}
    >
      <Icon style={{ width: sz.icon, height: sz.icon, color: iconColor }} strokeWidth={1.75} />
    </span>
  );
}

// ─── Named icon exports (raw Lucide icons, aliased semantically) ──────────────

// Workflow / Builder
export const WorkflowIcon      = GitBranch;
export const FlowIcon          = Layers;
export const CanvasIcon        = Layers;
export const ConnectorIcon     = Hash;
export const BranchIcon        = GitBranch;
export const ParallelIcon      = Split;
export const ConditionIcon     = GitBranch;
export const JoinIcon          = GitMerge;
export const StartIcon         = PlayCircle;
export const EndIcon           = CircleCheck;
export const NodeIcon          = Cpu;

// Agentic AI
export const AgentIcon         = Bot;
export const AIAgentIcon       = BrainCircuit;
export const BrainIcon         = BrainCircuit;
export const LLMIcon           = MessageSquareText;
export const PromptIcon        = MessageSquareText;
export const MemoryIcon        = BookmarkCheck;
export const ReasoningIcon     = BrainCircuit;
export const SelfCorrectionIcon = RotateCcw;
export const ProviderIcon      = Sparkles;
export const ToolCallingIcon   = Wrench;

// Tools / Integrations
export const ToolIcon          = Wrench;
export const HttpIcon          = Globe2;
export const WebhookIcon       = Webhook;
export const DatabaseIcon      = Database;
export const SQLIcon           = Table2;
export const EmailIcon         = Mail;
export const FileIcon          = FileText;
export const BrowserIcon       = Globe2;
export const SearchIcon        = Hash;
export const CodeIcon          = Code2;
export const FunctionIcon      = Code2;
export const ScheduleIcon      = CalendarClock;
export const CronIcon          = CalendarClock;
export const MCPIcon           = Braces;
export const ServerIcon        = Server;
export const IntegrationIcon   = Plug;

// Execution / Runtime
export const RunIcon           = PlayCircle;
export const RunningIcon       = Loader2;
export const CompletedIcon     = CheckCircle2;
export const FailedIcon        = XCircle;
export const RetryIcon         = RotateCcw;
export const ResumeIcon        = PlayCircle;
export const CancelIcon        = XCircle;
export const WaitingIcon       = Clock;
export const TimeoutIcon       = Timer;
export const RateLimitIcon     = AlertTriangle;
export const BudgetIcon        = Hash;
export const CostIcon          = Hash;
export const LogsIcon          = List;
export const TimelineIcon      = List;
export const EventHistoryIcon  = List;
export const WorkerIcon        = Cpu;
export const QueueIcon         = Layers;
export const CheckpointIcon    = BookmarkCheck;
export const DurableIcon       = ShieldCheck;
export const ArtifactIcon      = FileText;

// Human-in-the-loop
export const ApprovalIcon      = UserCheck;
export const ReviewIcon        = BadgeCheck;
export const RejectIcon        = XCircle;
export const DecisionIcon      = UserCheck;
export const ManualActionIcon  = MousePointerClick;

// Status
export const SuccessIcon       = CheckCircle2;
export const WarningIcon       = TriangleAlert;
export const ErrorIcon         = AlertTriangle;
export const MutedIcon         = Hash;
export const SpinnerIcon       = Loader2;
export const RefreshIcon       = RefreshCw;

// Settings / Admin
export const SettingsIcon      = Settings2;
export const ConnectionsIcon   = Plug;
export const MembersIcon       = Users;
export const APIKeyIcon        = KeyRound;
export const SecurityIcon      = ShieldCheck;
export const SignOutIcon       = LogOut;
export const NotificationsIcon = Bell;
export const ExternalLinkIcon  = ExternalLink;

// Trigger types
export const ManualTriggerIcon  = MousePointerClick;
export const TriggerIcon        = PlayCircle;
export const ZapIcon            = Zap;

// ─── NodeTypeBadge: used in node cards, palette items, and list views ────────

interface NodeTypeBadgeProps {
  /** Node type string */
  type: string;
  size?: BadgeSize;
  className?: string;
}

const NODE_TYPE_TO_TONE: Record<string, IconTone> = {
  trigger:      "trigger",
  agent:        "agent",
  llm:          "brain",
  tool:         "tool",
  approval:     "approval",
  branch:       "condition",
  parallel:     "parallel",
  join:         "parallel",
  timer:        "timer",
  artifact:     "artifact",
  checkpoint:   "checkpoint",
  end:          "end",
  http_tool:    "http",
  graphql_tool: "danger",
  db_read:      "database",
  db_write:     "danger",
  mcp_tool:     "agent",
  grpc_tool:    "info",
  transform:    "http",
  webhook_wait: "webhook",
};

const NODE_TYPE_TO_ICON: Record<string, LucideIcon> = {
  trigger:      PlayCircle,
  agent:        BrainCircuit,
  llm:          MessageSquareText,
  tool:         Wrench,
  approval:     UserCheck,
  branch:       GitBranch,
  parallel:     Split,
  join:         GitMerge,
  timer:        Clock,
  artifact:     FileText,
  checkpoint:   BookmarkCheck,
  end:          CircleCheck,
  http_tool:    Globe2,
  graphql_tool: Braces,
  db_read:      Database,
  db_write:     Database,
  mcp_tool:     Braces,
  grpc_tool:    Server,
  transform:    Braces,
  webhook_wait: Webhook,
};

export function NodeTypeBadge({ type, size = "md", className }: NodeTypeBadgeProps) {
  const tone = NODE_TYPE_TO_TONE[type] ?? "default";
  const icon = NODE_TYPE_TO_ICON[type] ?? Cpu;
  return <IconBadge icon={icon} tone={tone} size={size} className={className} />;
}

// ─── StatusIcon: execution status with consistent visual language ─────────────

interface StatusIconProps {
  status: "running" | "succeeded" | "failed" | "waiting" | "queued" | "cancelled" | "skipped" | "idle";
  size?: number;
  className?: string;
}

const STATUS_CONFIG = {
  running:   { icon: Loader2,      color: "#2563EB", animate: "animate-spin" },
  succeeded: { icon: CheckCircle2, color: "#059669", animate: "" },
  failed:    { icon: XCircle,      color: "#DC2626", animate: "" },
  waiting:   { icon: Clock,        color: "#D97706", animate: "" },
  queued:    { icon: Layers,       color: "#94A3B8", animate: "" },
  cancelled: { icon: XCircle,      color: "#94A3B8", animate: "" },
  skipped:   { icon: Hash,         color: "#CBD5E1", animate: "" },
  idle:      { icon: Hash,         color: "#CBD5E1", animate: "" },
};

export function StatusIcon({ status, size = 16, className }: StatusIconProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  const Icon = cfg.icon;
  return (
    <Icon
      className={cn(cfg.animate, className)}
      style={{ width: size, height: size, color: cfg.color }}
      strokeWidth={1.75}
    />
  );
}

// ─── StatusDot: small colored dot for status indicators ──────────────────────

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const colorMap: Record<string, string> = {
    running:   "bg-blue-500 animate-pulse",
    succeeded: "bg-emerald-500",
    failed:    "bg-red-500",
    waiting:   "bg-amber-400 animate-pulse",
    queued:    "bg-slate-400",
    cancelled: "bg-slate-400",
    skipped:   "bg-slate-300",
    active:    "bg-emerald-500",
    inactive:  "bg-slate-300",
    paused:    "bg-amber-400",
  };
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full shrink-0",
        colorMap[status] ?? "bg-slate-300",
        className,
      )}
    />
  );
}
