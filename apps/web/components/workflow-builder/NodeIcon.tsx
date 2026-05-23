/**
 * NodeIcon — centralized icon + color system for all workflow node types.
 * All node visuals derive from this single source of truth.
 */

import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Clock,
  FileJson,
  GitBranch,
  GitMerge,
  Globe,
  Milestone,
  Play,
  RotateCcw,
  ShieldCheck,
  SplitSquareHorizontal,
  Sparkles,
  UserCheck,
  Wrench,
  Zap,
} from "lucide-react";
import type { WFNodeType } from "@/types/workflow-graph";

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
    icon: Play,
    color: "#34D399",
    bgColor: "rgba(52,211,153,0.12)",
    borderColor: "rgba(52,211,153,0.35)",
    label: "Trigger",
    description: "Starts the workflow",
  },
  agent: {
    icon: Bot,
    color: "#A78BFA",
    bgColor: "rgba(167,139,250,0.12)",
    borderColor: "rgba(167,139,250,0.35)",
    label: "Agent",
    description: "Runs a Vectorbea agent",
  },
  llm: {
    icon: Sparkles,
    color: "#C084FC",
    bgColor: "rgba(192,132,252,0.12)",
    borderColor: "rgba(192,132,252,0.35)",
    label: "LLM Call",
    description: "Direct LLM inference",
  },
  tool: {
    icon: Wrench,
    color: "#22D3EE",
    bgColor: "rgba(34,211,238,0.12)",
    borderColor: "rgba(34,211,238,0.35)",
    label: "Tool",
    description: "Calls a registered tool or API",
  },
  approval: {
    icon: ShieldCheck,
    color: "#FCD34D",
    bgColor: "rgba(252,211,77,0.10)",
    borderColor: "rgba(252,211,77,0.35)",
    label: "Approval Gate",
    description: "Pauses for human approval",
  },
  branch: {
    icon: GitBranch,
    color: "#38BDF8",
    bgColor: "rgba(56,189,248,0.12)",
    borderColor: "rgba(56,189,248,0.35)",
    label: "Branch",
    description: "Conditional routing",
  },
  parallel: {
    icon: SplitSquareHorizontal,
    color: "#67E8F9",
    bgColor: "rgba(103,232,249,0.10)",
    borderColor: "rgba(103,232,249,0.30)",
    label: "Parallel",
    description: "Fan-out to multiple branches",
  },
  join: {
    icon: GitMerge,
    color: "#818CF8",
    bgColor: "rgba(129,140,248,0.12)",
    borderColor: "rgba(129,140,248,0.35)",
    label: "Join",
    description: "Merges parallel branches",
  },
  timer: {
    icon: Clock,
    color: "#FB923C",
    bgColor: "rgba(251,146,60,0.12)",
    borderColor: "rgba(251,146,60,0.35)",
    label: "Timer",
    description: "Sleep / wait / delay",
  },
  artifact: {
    icon: FileJson,
    color: "#4ADE80",
    bgColor: "rgba(74,222,128,0.10)",
    borderColor: "rgba(74,222,128,0.30)",
    label: "Artifact",
    description: "Creates or stores output",
  },
  checkpoint: {
    icon: Milestone,
    color: "#60A5FA",
    bgColor: "rgba(96,165,250,0.12)",
    borderColor: "rgba(96,165,250,0.35)",
    label: "Checkpoint",
    description: "Enables replay from this point",
  },
  end: {
    icon: CheckCircle2,
    color: "#94A3B8",
    bgColor: "rgba(148,163,184,0.10)",
    borderColor: "rgba(148,163,184,0.30)",
    label: "End",
    description: "Completes the workflow",
  },
};

export function getNodeMeta(type: WFNodeType): NodeMeta {
  return NODE_META[type] ?? NODE_META.agent;
}

// Status colors for preview/test run
export const PREVIEW_STATUS_COLORS: Record<string, { ring: string; dot: string; label: string }> = {
  running: { ring: "rgba(56,189,248,0.5)", dot: "bg-sky-400 animate-pulse", label: "Running" },
  succeeded: { ring: "rgba(52,211,153,0.4)", dot: "bg-emerald-400", label: "Succeeded" },
  failed: { ring: "rgba(248,113,113,0.5)", dot: "bg-red-400", label: "Failed" },
  waiting: { ring: "rgba(252,211,77,0.5)", dot: "bg-amber-400 animate-pulse", label: "Waiting" },
  skipped: { ring: "rgba(148,163,184,0.3)", dot: "bg-slate-500", label: "Skipped" },
  idle: { ring: "transparent", dot: "", label: "" },
};

// Re-export helpful icons
export { AlertTriangle, Brain, Globe, RotateCcw, UserCheck, Zap };
