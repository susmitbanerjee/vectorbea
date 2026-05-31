"use client";
import type { StepType } from "@/types/runs";
import {
  Bot, Database, Globe2, Mail, CheckSquare, GitBranch,
  GitMerge, Clock, Webhook, Zap, Settings, BrainCircuit,
} from "lucide-react";

const ICONS: Record<StepType, { icon: React.ElementType; color: string; bg: string }> = {
  trigger:         { icon: Zap,          color: "#2563EB", bg: "#EFF6FF" },
  llm_agent:       { icon: BrainCircuit, color: "#7C3AED", bg: "#F5F3FF" },
  tool_agent:      { icon: Bot,          color: "#0891B2", bg: "#ECFEFF" },
  http_call:       { icon: Globe2,       color: "#059669", bg: "#ECFDF5" },
  db_query:        { icon: Database,     color: "#0369A1", bg: "#F0F9FF" },
  approval:        { icon: CheckSquare,  color: "#D97706", bg: "#FFFBEB" },
  parallel_branch: { icon: GitMerge,     color: "#0891B2", bg: "#ECFEFF" },
  condition:       { icon: GitBranch,    color: "#7C3AED", bg: "#F5F3FF" },
  timer:           { icon: Clock,        color: "#D97706", bg: "#FFFBEB" },
  email:           { icon: Mail,         color: "#059669", bg: "#ECFDF5" },
  webhook:         { icon: Webhook,      color: "#0891B2", bg: "#ECFEFF" },
  system:          { icon: Settings,     color: "#64748B", bg: "#F8FAFC" },
};

export function StepTypeIcon({
  type, size = 28,
}: {
  type: StepType; size?: number;
}) {
  const cfg = ICONS[type] ?? ICONS.system;
  const Icon = cfg.icon;
  const iconSize = Math.round(size * 0.45);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: cfg.bg, border: `1px solid ${cfg.color}22` }}
    >
      <Icon style={{ width: iconSize, height: iconSize, color: cfg.color }} />
    </span>
  );
}
