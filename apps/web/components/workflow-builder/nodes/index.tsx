/**
 * All custom workflow node components.
 * Each node type has its own visual display with relevant metadata chips.
 */

"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Bot, BrainCircuit, Clock, GitBranch, Layers, RotateCcw, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { BaseNode, Chip } from "./BaseNode";
import { TOOL_TYPE_META } from "@/components/workflow-builder/NodeIcon";
import { detectLLMProvider } from "@/components/workflow-builder/LLMProviderIcon";
import type { WFNodeData } from "@/types/workflow-graph";

type WFNode = Node<WFNodeData>;

// ─── Trigger Node ─────────────────────────────────────────────────────────────

export const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.triggerConfig;
  return (
    <BaseNode data={data} selected={selected} handles="bottom-only" width={200}>
      {cfg?.triggerType && (
        <Chip color="#059669">{cfg.triggerType === "cron" ? "Schedule" : cfg.triggerType}</Chip>
      )}
      {cfg?.cronExpression && <Chip>{cfg.cronExpression}</Chip>}
      {cfg?.webhookPath && <Chip>/{cfg.webhookPath}</Chip>}
    </BaseNode>
  );
});

// ─── Agent Node ───────────────────────────────────────────────────────────────

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.agentConfig;
  const provider = detectLLMProvider(cfg?.modelName);
  const accentColor = provider?.color ?? "#7C3AED";
  const brainEnabled = (cfg as Record<string, unknown> | undefined)?.brainEnabled === true;

  return (
    <BaseNode data={data} selected={selected} width={brainEnabled ? 260 : 240}>
      {/* Brain badge — shown when iterative loop is enabled */}
      {brainEnabled && (
        <div
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 mb-0.5"
          style={{
            background: "linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)",
            border: "1px solid #C4B5FD",
            boxShadow: "0 0 8px rgba(124,58,237,0.15)",
          }}
        >
          <BrainCircuit className="h-3 w-3 shrink-0" style={{ color: "#7C3AED" }} />
          <span className="text-[9.5px] font-bold uppercase tracking-wider" style={{ color: "#6D28D9" }}>
            Iterative Brain
          </span>
          <Sparkles className="h-2.5 w-2.5 shrink-0" style={{ color: "#A78BFA" }} />
        </div>
      )}

      {/* Agent name chip */}
      {cfg?.agentName && <Chip color={accentColor}><Bot className="h-2.5 w-2.5" />{cfg.agentName}</Chip>}

      {/* Model/provider */}
      {provider
        ? <Chip color={provider.color}>{provider.label}</Chip>
        : cfg?.modelName && <Chip>{cfg.modelName}</Chip>
      }

      {/* Brain limits when enabled */}
      {brainEnabled && (cfg as Record<string, unknown> | undefined)?.maxIterations != null && (
        <Chip color="#7C3AED">
          <BrainCircuit className="h-2.5 w-2.5" />
          {`${(cfg as Record<string, unknown>).maxIterations} iters`}
        </Chip>
      )}

      {cfg?.retryPolicy?.maxAttempts && cfg.retryPolicy.maxAttempts > 1 && (
        <Chip color="#FB923C"><RotateCcw className="h-2.5 w-2.5" />×{cfg.retryPolicy.maxAttempts}</Chip>
      )}
      {cfg?.checkpointEnabled && <Chip color="#2563EB">checkpoint</Chip>}
    </BaseNode>
  );
});

// ─── LLM Node ────────────────────────────────────────────────────────────────

export const LlmNode = memo(function LlmNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.llmConfig;
  const provider = detectLLMProvider(cfg?.provider, cfg?.model);
  return (
    <BaseNode data={data} selected={selected} width={220}>
      {provider
        ? <Chip color={provider.color}>{provider.label}</Chip>
        : cfg?.provider && <Chip>{cfg.provider}</Chip>
      }
      {cfg?.model && <Chip color={provider?.color ?? "#C084FC"}>{cfg.model}</Chip>}
      {cfg?.validationEnabled && <Chip color="#059669">validated</Chip>}
    </BaseNode>
  );
});

// ─── Tool Node ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  low: "#059669",
  medium: "#2563EB",
  high: "#D97706",
  critical: "#DC2626",
};

export const ToolNode = memo(function ToolNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.toolConfig;
  const riskColor = cfg?.riskLevel ? RISK_COLORS[cfg.riskLevel] : undefined;

  // Resolve display type label from TOOL_TYPE_META (prefers uiToolType stored in config)
  const extCfg = cfg as (typeof cfg & { uiToolType?: string }) | undefined;
  const resolvedType = extCfg?.uiToolType ?? cfg?.toolType;
  const typeMeta = resolvedType ? TOOL_TYPE_META[resolvedType] : undefined;
  const typeLabel = typeMeta?.label ?? resolvedType?.replace(/_/g, " ");
  const typeColor = typeMeta?.color ?? "#0891B2";

  return (
    <BaseNode data={data} selected={selected} width={220}>
      {cfg?.toolName && <Chip color={typeColor}>{cfg.toolName}</Chip>}
      {typeLabel && <Chip color={typeColor}>{typeLabel}</Chip>}
      {cfg?.riskLevel && <Chip color={riskColor}>{cfg.riskLevel}</Chip>}
      {cfg?.requireApproval && <Chip color="#D97706"><ShieldCheck className="h-2.5 w-2.5" />approval</Chip>}
    </BaseNode>
  );
});

// ─── Approval Node ────────────────────────────────────────────────────────────

export const ApprovalNode = memo(function ApprovalNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.approvalConfig;
  const riskColor = cfg?.riskLevel ? (RISK_COLORS[cfg.riskLevel] ?? "#D97706") : "#D97706";
  return (
    <BaseNode data={data} selected={selected} width={240}>
      {cfg?.riskLevel && <Chip color={riskColor}>{cfg.riskLevel.replace(/_/g, " ")}</Chip>}
      {cfg?.approverRole && <Chip color="#D97706">{cfg.approverRole}</Chip>}
      {cfg?.timeoutMs && cfg.timeoutMs > 0 && (
        <Chip><Clock className="h-2.5 w-2.5" />{Math.round(cfg.timeoutMs / 3600000)}h timeout</Chip>
      )}
    </BaseNode>
  );
});

// ─── Branch Node ──────────────────────────────────────────────────────────────

export const BranchNode = memo(function BranchNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.branchConfig;
  return (
    <BaseNode data={data} selected={selected} width={220}>
      {cfg?.conditionExpression && (
        <span className="w-full truncate rounded bg-black/20 px-2 py-1 font-mono text-[9px] text-sky-300/80">
          {cfg.conditionExpression.length > 30 ? cfg.conditionExpression.slice(0, 30) + "…" : cfg.conditionExpression}
        </span>
      )}
      {cfg?.trueLabel && <Chip color="#059669">✓ {cfg.trueLabel}</Chip>}
      {cfg?.falseLabel && <Chip color="#DC2626">✗ {cfg.falseLabel}</Chip>}
    </BaseNode>
  );
});

// ─── Parallel Node ────────────────────────────────────────────────────────────

export const ParallelNode = memo(function ParallelNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.parallelConfig;
  const branches = cfg?.branchNames ?? [];
  return (
    <BaseNode data={data} selected={selected} width={240}>
      <Chip color="#67E8F9">
        <Layers className="h-2.5 w-2.5" />
        {branches.length > 0 ? `${branches.length} branches` : "fan-out"}
      </Chip>
      {cfg?.executionMode && cfg.executionMode !== "all" && (
        <Chip color="#67E8F9">{cfg.executionMode}</Chip>
      )}
      {cfg?.maxConcurrency && <Chip>max {cfg.maxConcurrency}</Chip>}
    </BaseNode>
  );
});

// ─── Join Node ────────────────────────────────────────────────────────────────

export const JoinNode = memo(function JoinNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.joinConfig;
  return (
    <BaseNode data={data} selected={selected} width={220}>
      <Chip color="#818CF8">
        <GitBranch className="h-2.5 w-2.5" />
        {cfg?.joinPolicy?.replace(/_/g, " ") ?? "wait all"}
      </Chip>
      {cfg?.incomingBranchCount && (
        <Chip color="#818CF8">{cfg.incomingBranchCount} branches</Chip>
      )}
    </BaseNode>
  );
});

// ─── Timer Node ───────────────────────────────────────────────────────────────

export const TimerNode = memo(function TimerNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.timerConfig;
  const delayLabel = cfg?.delayMs
    ? cfg.delayMs >= 60000
      ? `${Math.round(cfg.delayMs / 60000)}m`
      : `${Math.round(cfg.delayMs / 1000)}s`
    : null;
  return (
    <BaseNode data={data} selected={selected} width={200}>
      {delayLabel && <Chip color="#FB923C"><Clock className="h-2.5 w-2.5" />{delayLabel}</Chip>}
      {cfg?.resumePolicy && <Chip>{cfg.resumePolicy}</Chip>}
    </BaseNode>
  );
});

// ─── Artifact Node ────────────────────────────────────────────────────────────

export const ArtifactNode = memo(function ArtifactNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.artifactConfig;
  return (
    <BaseNode data={data} selected={selected} width={200}>
      {cfg?.artifactName && <Chip color="#4ADE80">{cfg.artifactName}</Chip>}
      {cfg?.artifactType && <Chip>{cfg.artifactType}</Chip>}
    </BaseNode>
  );
});

// ─── Checkpoint Node ──────────────────────────────────────────────────────────

export const CheckpointNode = memo(function CheckpointNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.checkpointConfig;
  return (
    <BaseNode data={data} selected={selected} width={220}>
      {cfg?.checkpointName && <Chip color="#2563EB">{cfg.checkpointName}</Chip>}
      {cfg?.replayEnabled && <Chip color="#2563EB">replay enabled</Chip>}
      {cfg?.stateKeys && cfg.stateKeys.length > 0 && (
        <Chip>{cfg.stateKeys.length} state keys</Chip>
      )}
    </BaseNode>
  );
});

// ─── End Node ─────────────────────────────────────────────────────────────────

export const EndNode = memo(function EndNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.endConfig;
  const statusColor = cfg?.terminalStatus === "failed" ? "#DC2626" : cfg?.terminalStatus === "cancelled" ? "#D97706" : "#059669";
  return (
    <BaseNode data={data} selected={selected} handles="top-only" width={180}>
      {cfg?.terminalStatus && <Chip color={statusColor}>{cfg.terminalStatus}</Chip>}
    </BaseNode>
  );
});

// ─── nodeTypes map for React Flow ─────────────────────────────────────────────

export const nodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  llm: LlmNode,
  tool: ToolNode,
  approval: ApprovalNode,
  branch: BranchNode,
  parallel: ParallelNode,
  join: JoinNode,
  timer: TimerNode,
  artifact: ArtifactNode,
  checkpoint: CheckpointNode,
  end: EndNode,
};
