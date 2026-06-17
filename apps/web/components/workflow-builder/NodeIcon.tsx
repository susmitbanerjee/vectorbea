/**
 * NodeIcon — centralized icon + color system for all workflow node types.
 * All node visuals derive from this single source of truth.
 */

import {
  AlertTriangle,
  Braces,
  BotMessageSquare,
  BrainCircuit,
  Code2,
  Database,
  Globe2,
  MessageSquareText,
  Package,
  RotateCcw,
  Server,
  Table2,
  TriangleAlert,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import {
  TriggerIcon,
  AgentIcon,
  LlmIcon,
  BrainChipIcon,
  DatabaseIcon,
  HttpIcon,
  WebhookIcon,
  EmailIcon,
  ApprovalIcon,
  EndIcon,
  CheckpointIcon,
  BranchIcon,
  ParallelIcon,
  JoinIcon,
  TimerIcon,
  ArtifactIcon,
  McpIcon,
  GraphqlIcon,
  ToolIcon,
} from "./NodeIcons";
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
    icon: Zap,                         // ⚡ lightning — instant, reactive start
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Trigger",
    description: "Starts the workflow on schedule or event",
  },
  agent: {
    icon: AgentIcon,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "AI Agent",
    description: "Reason, plan, and act with your agent",
  },
  llm: {
    icon: LlmIcon,
    color: "#7C3AED",
    bgColor: "#FAF5FF",
    borderColor: "#E9D5FF",
    label: "LLM Call",
    description: "Direct LLM inference with a configured model",
  },
  tool: {
    icon: ToolIcon,
    color: "#0891B2",
    bgColor: "#ECFEFF",
    borderColor: "#A5F3FC",
    label: "Tool",
    description: "Calls a registered tool or API",
  },
  approval: {
    icon: ApprovalIcon,
    color: "#D97706",
    bgColor: "#FFFBEB",
    borderColor: "#FDE68A",
    label: "Human Approval",
    description: "Pauses until a person approves or rejects",
  },
  branch: {
    icon: BranchIcon,
    color: "#0369A1",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    label: "Branch",
    description: "Conditional routing based on rules",
  },
  parallel: {
    icon: ParallelIcon,
    color: "#4F46E5",
    bgColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    label: "Parallel Step",
    description: "Run multiple branches at once · fan-out",
  },
  join: {
    icon: JoinIcon,
    color: "#4F46E5",
    bgColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    label: "Merge Results",
    description: "Wait for and combine parallel branches · join",
  },
  timer: {
    icon: TimerIcon,
    color: "#D97706",
    bgColor: "#FFFBEB",
    borderColor: "#FDE68A",
    label: "Wait",
    description: "Pause for a duration or until a time · timer",
  },
  artifact: {
    icon: ArtifactIcon,
    color: "#475569",
    bgColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    label: "Saved Output",
    description: "Store and name a result · artifact",
  },
  checkpoint: {
    icon: CheckpointIcon,
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Checkpoint",
    description: "Enables replay from this point",
  },
  end: {
    icon: EndIcon,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "End",
    description: "Completes the workflow",
  },
  http_tool: {
    icon: HttpIcon,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "HTTP",
    description: "Call an external API endpoint",
  },
  graphql_tool: {
    icon: GraphqlIcon,
    color: "#E11D48",
    bgColor: "#FFF1F2",
    borderColor: "#FECDD3",
    label: "GraphQL",
    description: "GraphQL query or mutation",
  },
  db_read: {
    icon: DatabaseIcon,
    color: "#0369A1",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    label: "DB Read",
    description: "Read from database",
  },
  db_write: {
    icon: DatabaseIcon,
    color: "#DC2626",
    bgColor: "#FEF2F2",
    borderColor: "#FECACA",
    label: "DB Write",
    description: "Write to database",
  },
  mcp_tool: {
    icon: McpIcon,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "MCP Tool",
    description: "Model Context Protocol tool",
  },
  grpc_tool: {
    icon: HttpIcon,
    color: "#1D4ED8",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "gRPC",
    description: "gRPC service call",
  },
  transform: {
    icon: BrainChipIcon,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "Transform",
    description: "Shape or map data between steps",
  },
  webhook_wait: {
    icon: WebhookIcon,
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
  email: {
    icon: EmailIcon,
    color: "#EA4335",
    bgColor: "#FEF2F2",
    borderColor: "#FECACA",
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
  running: { ring: "rgba(15,118,110,0.3)", dot: "bg-teal-600 animate-pulse", label: "Running" },
  succeeded: { ring: "rgba(0,127,78,0.3)", dot: "bg-emerald-600", label: "Succeeded" },
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
