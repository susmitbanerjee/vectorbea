/**
 * All custom workflow node components.
 * Each node type has its own visual display with relevant metadata chips.
 */

"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Bot, Clock, GitBranch, Layers, RotateCcw, ShieldCheck, Zap } from "lucide-react";
import { BaseNode, Chip } from "./BaseNode";
import type { WFNodeData } from "@/types/workflow-graph";

type WFNode = Node<WFNodeData>;

// ─── Trigger Node ─────────────────────────────────────────────────────────────

export const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.triggerConfig;
  return (
    <BaseNode data={data} selected={selected} handles="bottom-only" width={200}>
      {cfg?.triggerType && (
        <Chip color="#34D399">{cfg.triggerType === "cron" ? "Schedule" : cfg.triggerType}</Chip>
      )}
      {cfg?.cronExpression && <Chip>{cfg.cronExpression}</Chip>}
      {cfg?.webhookPath && <Chip>/{cfg.webhookPath}</Chip>}
    </BaseNode>
  );
});

// ─── Agent Node ───────────────────────────────────────────────────────────────

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.agentConfig;
  return (
    <BaseNode data={data} selected={selected} width={240}>
      {cfg?.agentName && <Chip color="#A78BFA"><Bot className="h-2.5 w-2.5" />{cfg.agentName}</Chip>}
      {cfg?.modelName && <Chip>{cfg.modelName}</Chip>}
      {cfg?.retryPolicy?.maxAttempts && cfg.retryPolicy.maxAttempts > 1 && (
        <Chip color="#FB923C"><RotateCcw className="h-2.5 w-2.5" />×{cfg.retryPolicy.maxAttempts}</Chip>
      )}
      {cfg?.checkpointEnabled && <Chip color="#60A5FA">checkpoint</Chip>}
    </BaseNode>
  );
});

// ─── LLM Node ────────────────────────────────────────────────────────────────

export const LlmNode = memo(function LlmNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.llmConfig;
  return (
    <BaseNode data={data} selected={selected} width={220}>
      {cfg?.provider && <Chip>{cfg.provider}</Chip>}
      {cfg?.model && <Chip color="#C084FC">{cfg.model}</Chip>}
      {cfg?.validationEnabled && <Chip color="#34D399">validated</Chip>}
    </BaseNode>
  );
});

// ─── Tool Node ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  read_only: "#34D399",
  low_risk_write: "#60A5FA",
  high_risk_write: "#FCD34D",
  irreversible: "#F87171",
};

export const ToolNode = memo(function ToolNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.toolConfig;
  const riskColor = cfg?.riskLevel ? RISK_COLORS[cfg.riskLevel] : undefined;
  return (
    <BaseNode data={data} selected={selected} width={220}>
      {cfg?.toolName && <Chip color="#22D3EE">{cfg.toolName}</Chip>}
      {cfg?.toolType && <Chip>{cfg.toolType}</Chip>}
      {cfg?.riskLevel && <Chip color={riskColor}>{cfg.riskLevel.replace(/_/g, " ")}</Chip>}
      {cfg?.requireApproval && <Chip color="#FCD34D"><ShieldCheck className="h-2.5 w-2.5" />approval</Chip>}
    </BaseNode>
  );
});

// ─── Approval Node ────────────────────────────────────────────────────────────

export const ApprovalNode = memo(function ApprovalNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.approvalConfig;
  const riskColor = cfg?.riskLevel ? RISK_COLORS[cfg.riskLevel] : "#FCD34D";
  return (
    <BaseNode data={data} selected={selected} width={240}>
      {cfg?.riskLevel && <Chip color={riskColor}>{cfg.riskLevel.replace(/_/g, " ")}</Chip>}
      {cfg?.approverRole && <Chip color="#FCD34D">{cfg.approverRole}</Chip>}
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
      {cfg?.trueLabel && <Chip color="#34D399">✓ {cfg.trueLabel}</Chip>}
      {cfg?.falseLabel && <Chip color="#F87171">✗ {cfg.falseLabel}</Chip>}
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
      {cfg?.checkpointName && <Chip color="#60A5FA">{cfg.checkpointName}</Chip>}
      {cfg?.replayEnabled && <Chip color="#60A5FA">replay enabled</Chip>}
      {cfg?.stateKeys && cfg.stateKeys.length > 0 && (
        <Chip>{cfg.stateKeys.length} state keys</Chip>
      )}
    </BaseNode>
  );
});

// ─── End Node ─────────────────────────────────────────────────────────────────

export const EndNode = memo(function EndNode({ data, selected }: NodeProps<WFNode>) {
  const cfg = data.endConfig;
  const statusColor = cfg?.terminalStatus === "failed" ? "#F87171" : cfg?.terminalStatus === "cancelled" ? "#FCD34D" : "#34D399";
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
