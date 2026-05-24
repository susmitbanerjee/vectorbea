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
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "Trigger",
    description: "Starts the workflow",
  },
  agent: {
    icon: Bot,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    label: "Agent",
    description: "Runs a Vectorbea agent",
  },
  llm: {
    icon: Sparkles,
    color: "#9333EA",
    bgColor: "#FAF5FF",
    borderColor: "#E9D5FF",
    label: "LLM Call",
    description: "Direct LLM inference",
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
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Branch",
    description: "Conditional routing",
  },
  parallel: {
    icon: SplitSquareHorizontal,
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
    description: "Sleep / wait / delay",
  },
  artifact: {
    icon: FileJson,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    label: "Artifact",
    description: "Creates or stores output",
  },
  checkpoint: {
    icon: Milestone,
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    label: "Checkpoint",
    description: "Enables replay from this point",
  },
  end: {
    icon: CheckCircle2,
    color: "#6B7280",
    bgColor: "#F9FAFB",
    borderColor: "#E5E7EB",
    label: "End",
    description: "Completes the workflow",
  },
};

export function getNodeMeta(type: WFNodeType): NodeMeta {
  return NODE_META[type] ?? NODE_META.agent;
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

// Re-export helpful icons
export { AlertTriangle, Brain, Globe, RotateCcw, UserCheck, Zap };
