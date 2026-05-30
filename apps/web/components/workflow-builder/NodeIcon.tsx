/**
 * NodeIcon — centralized icon + color system for all workflow node types.
 * All node visuals derive from this single source of truth.
 */

import {
  AlertTriangle,
  BookmarkCheck,
  Bot,
  BotMessageSquare,
  BrainCircuit,
  Braces,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  Database,
  FileText,
  Flag,
  GitBranch,
  GitMerge,
  Globe2,
  Hash,
  Mail,
  MessageSquareText,
  Package,
  PlayCircle,
  RotateCcw,
  Send,
  Server,
  ShieldCheck,
  Split,
  Table2,
  TriangleAlert,
  UserCheck,
  Users,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import type { WFNodeType, WFNodeData } from "@/types/workflow-graph";

export interface NodeMeta {
  icon: React.ElementType;
  color: string;        // Hex accent color
  bgColor: string;      // Tailwind / CSS background
  borderColor: string;
  label: string;
  description: string;
}

export const NODE_META: Record<WFNodeType, NodeMeta> = {
  trigger: {
    icon: PlayCircle,
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Trigger",
    description: "Starts the workflow on schedule or event",
  },
  agent: {
    icon: BrainCircuit,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "Agent",
    description: "Reason, plan, and act with your agent",
  },
  llm: {
    icon: MessageSquareText,
    color: "#9333EA",
    bgColor: "#FAF5FF",
    borderColor: "#E9D5FF",
    label: "LLM Call",
    description: "Direct LLM inference with a configured model",
  },
  tool: {
    icon: Wrench,
    color: "#0891B2",
    bgColor: "#ECFEFF",
    borderColor: "#A5F3FC",
    label: "Tool",
    description: "Calls a registered tool or API",
  },
  approval: {
    icon: ShieldCheck,
    color: "#D97706",
    bgColor: "#FFFBEB",
    borderColor: "#FDE68A",
    label: "Approval Gate",
    description: "Pauses for human approval",
  },
  branch: {
    icon: GitBranch,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "Branch",
    description: "Conditional routing based on rules",
  },
  parallel: {
    icon: Split,
    color: "#0369A1",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    label: "Parallel",
    description: "Fan-out to multiple branches",
  },
  join: {
    icon: GitMerge,
    color: "#4F46E5",
    bgColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    label: "Join",
    description: "Merges parallel branches",
  },
  timer: {
    icon: Clock,
    color: "#D97706",
    bgColor: "#FFFBEB",
    borderColor: "#FDE68A",
    label: "Timer",
    description: "Sleep, wait, or delay execution",
  },
  artifact: {
    icon: FileText,
    color: "#475569",
    bgColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    label: "Artifact",
    description: "Creates or stores output data",
  },
  checkpoint: {
    icon: BookmarkCheck,
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Checkpoint",
    description: "Enables replay from this point",
  },
  end: {
    icon: CheckCircle2,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "End",
    description: "Completes the workflow",
  },
  http_tool: {
    icon: Globe2,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "HTTP",
    description: "Call an external API endpoint",
  },
  graphql_tool: {
    icon: Braces,
    color: "#E11D48",
    bgColor: "#FFF1F2",
    borderColor: "#FECDD3",
    label: "GraphQL",
    description: "GraphQL query or mutation",
  },
  db_read: {
    icon: Database,
    color: "#0369A1",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    label: "DB Read",
    description: "Read from database",
  },
  db_write: {
    icon: Database,
    color: "#DC2626",
    bgColor: "#FEF2F2",
    borderColor: "#FECACA",
    label: "DB Write",
    description: "Write to database",
  },
  mcp_tool: {
    icon: Wrench,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "MCP Tool",
    description: "Model Context Protocol tool",
  },
  grpc_tool: {
    icon: Server,
    color: "#1D4ED8",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "gRPC",
    description: "gRPC service call",
  },
  transform: {
    icon: Braces,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "Transform",
    description: "Shape or map data between steps",
  },
  webhook_wait: {
    icon: Webhook,
    color: "#0284C7",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    label: "Webhook Wait",
    description: "Pause and wait for inbound webhook",
  },
};

export function getNodeMeta(type: WFNodeType): NodeMeta {
  return NODE_META[type] ?? NODE_META.agent;
}

// ── Tool-type-specific icon overrides ────────────────────────────────────────
// When a node is of type "tool", use the toolType to pick a richer icon.

export const TOOL_TYPE_META: Record<string, NodeMeta> = {
  slack: {
    icon: Send,
    color: "#4A154B",
    bgColor: "#F4EDF7",
    borderColor: "#C9A8D4",
    label: "Slack",
    description: "Send or read Slack messages",
  },
  email: {
    icon: Mail,
    color: "#0072C6",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Email",
    description: "Send or receive email",
  },
  crm: {
    icon: Users,
    color: "#047857",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "CRM",
    description: "CRM record operation",
  },
  database_read: {
    icon: Database,
    color: "#0369A1",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    label: "DB Read",
    description: "Read from database",
  },
  database_write: {
    icon: Database,
    color: "#DC2626",
    bgColor: "#FEF2F2",
    borderColor: "#FECACA",
    label: "DB Write",
    description: "Write to database",
  },
  // backend-stored types that may appear from the API
  database: {
    icon: Table2,
    color: "#0369A1",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    label: "Database",
    description: "Database operation",
  },
  http: {
    icon: Globe2,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "HTTP",
    description: "HTTP API call",
  },
  mcp_tool: {
    icon: BotMessageSquare,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "MCP",
    description: "Model Context Protocol tool",
  },
  custom: {
    icon: BotMessageSquare,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "Custom",
    description: "Custom / MCP tool",
  },
  custom_function: {
    icon: Code2,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "Function",
    description: "Custom code function",
  },
  code: {
    icon: Code2,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "Function",
    description: "Code execution",
  },
  imported_tool: {
    icon: Package,
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Imported",
    description: "Imported / external tool",
  },
  builtin: {
    icon: Zap,
    color: "#9333EA",
    bgColor: "#FAF5FF",
    borderColor: "#E9D5FF",
    label: "Built-in",
    description: "Built-in platform tool",
  },
  llm_generate: {
    icon: MessageSquareText,
    color: "#9333EA",
    bgColor: "#FAF5FF",
    borderColor: "#E9D5FF",
    label: "LLM Gen",
    description: "LLM generation tool",
  },
  graphql: {
    icon: Braces,
    color: "#E11D48",
    bgColor: "#FFF1F2",
    borderColor: "#FECDD3",
    label: "GraphQL",
    description: "GraphQL operation",
  },
};

/**
 * Returns the best NodeMeta for a tool node.
 * Resolution order:
 *   1. toolConfig.uiToolType  — friendly name saved by the inspector (slack, email, database_read …)
 *   2. toolConfig.toolType    — may already be the friendly name (inspector now stores uiToolType there)
 *   3. generic tool fallback
 */
export function getToolNodeMeta(data: WFNodeData): NodeMeta {
  const cfg = data.toolConfig as (typeof data.toolConfig & { uiToolType?: string }) | undefined;
  const candidates = [cfg?.uiToolType, cfg?.toolType].filter(Boolean) as string[];
  for (const key of candidates) {
    const m = TOOL_TYPE_META[key];
    if (m) return m;
  }
  return NODE_META.tool;
}

// Status colors for preview/test run
export const PREVIEW_STATUS_COLORS: Record<string, { ring: string; dot: string; label: string }> = {
  running: { ring: "rgba(37,99,235,0.3)", dot: "bg-blue-500 animate-pulse", label: "Running" },
  succeeded: { ring: "rgba(5,150,105,0.3)", dot: "bg-emerald-500", label: "Succeeded" },
  failed: { ring: "rgba(220,38,38,0.3)", dot: "bg-red-500", label: "Failed" },
  waiting: { ring: "rgba(217,119,6,0.3)", dot: "bg-amber-500 animate-pulse", label: "Waiting" },
  skipped: { ring: "rgba(156,163,175,0.3)", dot: "bg-[#D1D5DB]", label: "Skipped" },
  idle: { ring: "transparent", dot: "", label: "" },
};

// ── LLM provider-aware meta helpers ──────────────────────────────────────────

import { detectLLMProvider } from "./LLMProviderIcon";
import type { LLMProviderMeta } from "./LLMProviderIcon";

export type { LLMProviderMeta };
export { detectLLMProvider };

/**
 * For LLM nodes — returns provider meta if detectable, else undefined.
 * Caller uses provider meta's Icon instead of the generic Sparkles icon.
 */
export function getLLMProviderForNode(data: WFNodeData): LLMProviderMeta | null {
  const llmCfg = data.llmConfig;
  if (llmCfg) return detectLLMProvider(llmCfg.provider, llmCfg.model);

  const agentCfg = data.agentConfig;
  if (agentCfg) return detectLLMProvider(agentCfg.modelName);

  return null;
}

// Re-export helpful icons
export { AlertTriangle, BrainCircuit, Globe2, RotateCcw, TriangleAlert, UserCheck, Zap };
