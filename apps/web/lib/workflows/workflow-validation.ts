/**
 * Vectorbee Workflow Graph Validation
 */

import type { Node, Edge } from "@xyflow/react";
import type { WFNodeData, WFEdgeData, ValidationResult, ValidationIssue } from "@/types/workflow-graph";

type WFNode = Node<WFNodeData>;
type WFEdge = Edge<WFEdgeData>;

export function validateWorkflowGraph(nodes: WFNode[], edges: WFEdge[]): ValidationResult {
  const issues: ValidationIssue[] = [];

  const triggerNodes = nodes.filter((n) => n.data.nodeType === "trigger");
  const endNodes = nodes.filter((n) => n.data.nodeType === "end");
  const nonEndNodes = nodes.filter((n) => n.data.nodeType !== "trigger" && n.data.nodeType !== "end");

  // 1. Exactly one trigger
  if (triggerNodes.length === 0) {
    issues.push({ severity: "error", code: "NO_TRIGGER", message: "Workflow must have a trigger node." });
  } else if (triggerNodes.length > 1) {
    issues.push({ severity: "error", code: "MULTIPLE_TRIGGERS", message: "Workflow can only have one trigger." });
  }

  // 2. At least one end
  if (endNodes.length === 0) {
    issues.push({ severity: "warning", code: "NO_END", message: "Workflow has no End node." });
  }

  // 3. Every non-trigger node needs incoming edges
  for (const node of nonEndNodes) {
    const hasIncoming = edges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      issues.push({
        nodeId: node.id, severity: "error", code: "NO_INCOMING",
        message: `"${node.data.label}" has no incoming connection — it is disconnected.`,
      });
    }
  }

  // 4. Non-terminal nodes need outgoing edges
  const terminalTypes = new Set(["end"]);
  for (const node of nodes) {
    if (terminalTypes.has(node.data.nodeType)) continue;
    const hasOutgoing = edges.some((e) => e.source === node.id);
    if (!hasOutgoing) {
      issues.push({
        nodeId: node.id, severity: "warning", code: "NO_OUTGOING",
        message: `"${node.data.label}" has no outgoing connection.`,
      });
    }
  }

  // 5. Branch nodes need true + false paths
  for (const node of nodes.filter((n) => n.data.nodeType === "branch")) {
    const outgoing = edges.filter((e) => e.source === node.id);
    const hasTrue = outgoing.some((e) => e.data?.edgeType === "conditional_true");
    const hasFalse = outgoing.some((e) => e.data?.edgeType === "conditional_false");
    if (!hasTrue) issues.push({ nodeId: node.id, severity: "warning", code: "BRANCH_NO_TRUE", message: `"${node.data.label}" is missing the True path.` });
    if (!hasFalse) issues.push({ nodeId: node.id, severity: "warning", code: "BRANCH_NO_FALSE", message: `"${node.data.label}" is missing the False path.` });
    if (!node.data.branchConfig?.conditionExpression) {
      issues.push({ nodeId: node.id, severity: "error", code: "BRANCH_NO_CONDITION", message: `"${node.data.label}" has no condition expression.` });
    }
  }

  // 6. Parallel nodes need ≥ 2 outgoing
  for (const node of nodes.filter((n) => n.data.nodeType === "parallel")) {
    const outgoing = edges.filter((e) => e.source === node.id);
    if (outgoing.length < 2) {
      issues.push({ nodeId: node.id, severity: "warning", code: "PARALLEL_FEW_BRANCHES", message: `"${node.data.label}" should have at least 2 outgoing branches.` });
    }
  }

  // 7. Join nodes need ≥ 2 incoming
  for (const node of nodes.filter((n) => n.data.nodeType === "join")) {
    const incoming = edges.filter((e) => e.target === node.id);
    if (incoming.length < 2) {
      issues.push({ nodeId: node.id, severity: "warning", code: "JOIN_FEW_INCOMING", message: `"${node.data.label}" should have at least 2 incoming branches.` });
    }
  }

  // 8. Approval nodes need approved/rejected paths
  for (const node of nodes.filter((n) => n.data.nodeType === "approval")) {
    const outgoing = edges.filter((e) => e.source === node.id);
    const hasApproved = outgoing.some((e) => e.data?.edgeType === "approval_approved");
    const hasRejected = outgoing.some((e) => e.data?.edgeType === "approval_rejected");
    if (!hasApproved) issues.push({ nodeId: node.id, severity: "warning", code: "APPROVAL_NO_APPROVED", message: `"${node.data.label}" is missing the Approved path.` });
    if (!hasRejected) issues.push({ nodeId: node.id, severity: "info", code: "APPROVAL_NO_REJECTED", message: `"${node.data.label}" has no Rejected path — run will fail on rejection.` });
  }

  // 9. Agent nodes should have agentId
  for (const node of nodes.filter((n) => n.data.nodeType === "agent")) {
    if (!node.data.agentConfig?.agentId && !node.data.agentConfig?.agentName) {
      issues.push({ nodeId: node.id, severity: "info", code: "AGENT_NO_ID", message: `"${node.data.label}" has no agent assigned.` });
    }
  }

  // 10. LLM nodes should have model
  for (const node of nodes.filter((n) => n.data.nodeType === "llm")) {
    if (!node.data.llmConfig?.model) {
      issues.push({ nodeId: node.id, severity: "error", code: "LLM_NO_MODEL", message: `"${node.data.label}" has no model selected.` });
    }
  }

  // Replay support
  const hasCheckpoints = nodes.some((n) => n.data.nodeType === "checkpoint" || n.data.agentConfig?.checkpointEnabled);
  const hasExternalNodes = false; // no imported nodes in native builder
  const replaySupport: ValidationResult["replaySupport"] =
    hasCheckpoints ? "full" : hasExternalNodes ? "partial" : nodes.length > 2 ? "full" : "none";

  return {
    valid: !issues.some((i) => i.severity === "error"),
    issues,
    replaySupport,
  };
}
