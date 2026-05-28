/**
 * Vectorbee Workflow Builder Templates
 *
 * Pre-built workflow graphs for common AI agent patterns.
 * The "Customer Renewal Intelligence" template is the flagship demo
 * and shows parallel branches, join/merge, approval gates, and branching.
 */

import type { WorkflowGraph, WorkflowTemplate } from "@/types/workflow-graph";

// ─── Helper: edge factory ─────────────────────────────────────────────────────

function edge(
  id: string,
  source: string,
  target: string,
  type: "default" | "success" | "failure" | "conditional_true" | "conditional_false" | "parallel" | "approval_approved" | "approval_rejected" | "join" = "default",
  label?: string,
  sourceHandle?: string,
  targetHandle?: string,
) {
  return {
    id,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    data: { edgeType: type, label },
  };
}

// ─── Template 1: Sequential Agent Pipeline ────────────────────────────────────

const SEQUENTIAL_PIPELINE: WorkflowGraph = {
  nodes: [
    {
      id: "n-trigger",
      type: "trigger",
      position: { x: 300, y: 0 },
      data: {
        label: "Manual Trigger",
        nodeType: "trigger",
        triggerConfig: { triggerType: "manual", description: "Start the pipeline manually" },
      },
    },
    {
      id: "n-agent1",
      type: "agent",
      position: { x: 300, y: 130 },
      data: {
        label: "Data Collection Agent",
        nodeType: "agent",
        description: "Fetches and prepares data for analysis",
        agentConfig: { checkpointEnabled: true, retryPolicy: { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 } },
      },
    },
    {
      id: "n-approval",
      type: "approval",
      position: { x: 300, y: 280 },
      data: {
        label: "Review Data Quality",
        nodeType: "approval",
        approvalConfig: { title: "Approve Data Quality", message: "Please verify the collected data before proceeding.", riskLevel: "medium" },
      },
    },
    {
      id: "n-tool",
      type: "tool",
      position: { x: 300, y: 430 },
      data: {
        label: "Write Results",
        nodeType: "tool",
        description: "Persists analysis results to the database",
        toolConfig: { riskLevel: "medium" },
      },
    },
    {
      id: "n-end",
      type: "end",
      position: { x: 300, y: 560 },
      data: { label: "Complete", nodeType: "end" },
    },
  ],
  edges: [
    edge("e1", "n-trigger", "n-agent1", "default"),
    edge("e2", "n-agent1", "n-approval", "success"),
    edge("e3", "n-approval", "n-tool", "approval_approved", "Approved"),
    edge("e4", "n-tool", "n-end", "success"),
  ],
};

// ─── Template 2: Parallel Context Collection ──────────────────────────────────

const PARALLEL_COLLECTION: WorkflowGraph = {
  nodes: [
    { id: "n-trigger", type: "trigger", position: { x: 400, y: 0 },
      data: { label: "Manual Trigger", nodeType: "trigger", triggerConfig: { triggerType: "manual" } } },
    { id: "n-parallel", type: "parallel", position: { x: 400, y: 120 },
      data: { label: "Parallel Data Fetch", nodeType: "parallel",
        parallelConfig: { executionMode: "all", branchNames: ["Source A", "Source B", "Source C"] } } },
    { id: "n-a1", type: "tool", position: { x: 100, y: 280 },
      data: { label: "Fetch Source A", nodeType: "tool", toolConfig: { riskLevel: "low" } } },
    { id: "n-a2", type: "tool", position: { x: 400, y: 280 },
      data: { label: "Fetch Source B", nodeType: "tool", toolConfig: { riskLevel: "low" } } },
    { id: "n-a3", type: "tool", position: { x: 700, y: 280 },
      data: { label: "Fetch Source C", nodeType: "tool", toolConfig: { riskLevel: "low" } } },
    { id: "n-join", type: "join", position: { x: 400, y: 420 },
      data: { label: "Merge Context", nodeType: "join", joinConfig: { joinPolicy: "wait_all", incomingBranchCount: 3 } } },
    { id: "n-llm", type: "llm", position: { x: 400, y: 550 },
      data: { label: "LLM Analysis", nodeType: "llm",
        llmConfig: { provider: "openai", model: "gpt-4.1", prompt: "Analyze the collected context and produce a summary.", validationEnabled: true } } },
    { id: "n-end", type: "end", position: { x: 400, y: 680 },
      data: { label: "Complete", nodeType: "end" } },
  ],
  edges: [
    edge("e1", "n-trigger", "n-parallel"),
    edge("e2", "n-parallel", "n-a1", "parallel", "Source A"),
    edge("e3", "n-parallel", "n-a2", "parallel", "Source B"),
    edge("e4", "n-parallel", "n-a3", "parallel", "Source C"),
    edge("e5", "n-a1", "n-join", "join"),
    edge("e6", "n-a2", "n-join", "join"),
    edge("e7", "n-a3", "n-join", "join"),
    edge("e8", "n-join", "n-llm"),
    edge("e9", "n-llm", "n-end", "success"),
  ],
};

// ─── Template 3: Human Approval Before Write ──────────────────────────────────

const HUMAN_APPROVAL_FLOW: WorkflowGraph = {
  nodes: [
    { id: "n-trigger", type: "trigger", position: { x: 300, y: 0 },
      data: { label: "API Trigger", nodeType: "trigger", triggerConfig: { triggerType: "api" } } },
    { id: "n-agent", type: "agent", position: { x: 300, y: 130 },
      data: { label: "Prepare Update", nodeType: "agent", description: "Analyzes the request and prepares the data payload",
        agentConfig: { checkpointEnabled: true } } },
    { id: "n-tool-prep", type: "tool", position: { x: 300, y: 280 },
      data: { label: "Validate & Stage", nodeType: "tool", toolConfig: { riskLevel: "low" } } },
    { id: "n-approval", type: "approval", position: { x: 300, y: 430 },
      data: { label: "Approval Gate", nodeType: "approval",
        approvalConfig: { title: "Approve Write Operation", message: "Review the staged changes before they are committed.", riskLevel: "high", approverRole: "admin" } } },
    { id: "n-tool-write", type: "tool", position: { x: 150, y: 580 },
      data: { label: "Commit Write", nodeType: "tool", toolConfig: { riskLevel: "high" } } },
    { id: "n-end-ok", type: "end", position: { x: 150, y: 710 },
      data: { label: "Committed", nodeType: "end" } },
    { id: "n-end-rej", type: "end", position: { x: 460, y: 580 },
      data: { label: "Rejected", nodeType: "end", endConfig: { terminalStatus: "cancelled" } } },
  ],
  edges: [
    edge("e1", "n-trigger", "n-agent"),
    edge("e2", "n-agent", "n-tool-prep", "success"),
    edge("e3", "n-tool-prep", "n-approval", "success"),
    edge("e4", "n-approval", "n-tool-write", "approval_approved", "Approved"),
    edge("e5", "n-approval", "n-end-rej", "approval_rejected", "Rejected"),
    edge("e6", "n-tool-write", "n-end-ok", "success"),
  ],
};

// ─── Template 4: Failure Recovery Flow ───────────────────────────────────────

const FAILURE_RECOVERY: WorkflowGraph = {
  nodes: [
    { id: "n-trigger", type: "trigger", position: { x: 300, y: 0 },
      data: { label: "Scheduled Trigger", nodeType: "trigger", triggerConfig: { triggerType: "cron", cronExpression: "0 6 * * *" } } },
    { id: "n-agent", type: "agent", position: { x: 300, y: 130 },
      data: { label: "Main Agent", nodeType: "agent",
        agentConfig: { retryPolicy: { maxAttempts: 3, backoffType: "exponential", backoffMs: 5000 }, checkpointEnabled: true } } },
    { id: "n-branch", type: "branch", position: { x: 300, y: 280 },
      data: { label: "Check Result", nodeType: "branch",
        branchConfig: { conditionExpression: "output.success === true", trueLabel: "Success", falseLabel: "Failed" } } },
    { id: "n-notify-ok", type: "tool", position: { x: 100, y: 420 },
      data: { label: "Notify Success", nodeType: "tool", toolConfig: { riskLevel: "low" } } },
    { id: "n-timer", type: "timer", position: { x: 500, y: 420 },
      data: { label: "Wait 30s", nodeType: "timer", timerConfig: { delayMs: 30000 } } },
    { id: "n-retry-agent", type: "agent", position: { x: 500, y: 550 },
      data: { label: "Retry Agent", nodeType: "agent", description: "Fallback execution with simplified parameters" } },
    { id: "n-notify-fail", type: "tool", position: { x: 500, y: 680 },
      data: { label: "Alert On-Call", nodeType: "tool", toolConfig: { riskLevel: "low" } } },
    { id: "n-ckpt", type: "checkpoint", position: { x: 100, y: 550 },
      data: { label: "Save Checkpoint", nodeType: "checkpoint",
        checkpointConfig: { checkpointName: "post-success", replayEnabled: true } } },
    { id: "n-end", type: "end", position: { x: 300, y: 800 },
      data: { label: "Complete", nodeType: "end" } },
  ],
  edges: [
    edge("e1", "n-trigger", "n-agent"),
    edge("e2", "n-agent", "n-branch", "success"),
    edge("e3", "n-branch", "n-notify-ok", "conditional_true", "Success"),
    edge("e4", "n-branch", "n-timer", "conditional_false", "Failed"),
    edge("e5", "n-notify-ok", "n-ckpt", "success"),
    edge("e6", "n-timer", "n-retry-agent"),
    edge("e7", "n-retry-agent", "n-notify-fail", "failure"),
    edge("e8", "n-ckpt", "n-end"),
    edge("e9", "n-notify-fail", "n-end"),
  ],
};

// ─── Template 5: Customer Renewal Intelligence (flagship) ─────────────────────

export const CUSTOMER_RENEWAL_GRAPH: WorkflowGraph = {
  nodes: [
    // ── Trigger ────────────────────────────────────────────────────────────────
    {
      id: "n-trigger",
      type: "trigger",
      position: { x: 400, y: 0 },
      data: {
        label: "Daily Schedule",
        nodeType: "trigger",
        triggerConfig: {
          triggerType: "cron",
          cronExpression: "0 7 * * 1-5",
          timezone: "America/New_York",
          description: "Runs each weekday at 7am ET",
        },
      },
    },

    // ── Fetch Customer Data ───────────────────────────────────────────────────
    {
      id: "n-fetch",
      type: "agent",
      position: { x: 400, y: 130 },
      data: {
        label: "Fetch Customer Data",
        nodeType: "agent",
        description: "Pulls CRM account data, contracts, and usage metrics",
        agentConfig: {
          agentName: "Customer Data Agent",
          role: "Data Collection",
          modelName: "gpt-4.1-mini",
          checkpointEnabled: true,
          retryPolicy: { maxAttempts: 3, backoffType: "exponential", backoffMs: 2000 },
        },
      },
    },

    // ── Parallel Split ────────────────────────────────────────────────────────
    {
      id: "n-parallel",
      type: "parallel",
      position: { x: 400, y: 270 },
      data: {
        label: "Parallel Analysis",
        nodeType: "parallel",
        parallelConfig: {
          executionMode: "all",
          branchNames: ["Usage Analysis", "Support Tickets", "CRM Account"],
          maxConcurrency: 3,
        },
      },
    },

    // ── Branch 1: Usage Analysis ──────────────────────────────────────────────
    {
      id: "n-usage",
      type: "agent",
      position: { x: 50, y: 420 },
      data: {
        label: "Usage Analysis",
        nodeType: "agent",
        description: "Analyzes product usage patterns and engagement scores",
        agentConfig: {
          agentName: "Usage Analysis Agent",
          role: "Usage Analytics",
          modelName: "gpt-4.1-mini",
          checkpointEnabled: false,
          retryPolicy: { maxAttempts: 2, backoffType: "exponential", backoffMs: 1000 },
        },
      },
    },

    // ── Branch 2: Support Ticket Analysis ────────────────────────────────────
    {
      id: "n-support",
      type: "agent",
      position: { x: 400, y: 420 },
      data: {
        label: "Support Ticket Analysis",
        nodeType: "agent",
        description: "Summarizes recent support tickets and sentiment",
        agentConfig: {
          agentName: "Support Analysis Agent",
          role: "Support Analytics",
          modelName: "gpt-4.1-mini",
          checkpointEnabled: false,
          retryPolicy: { maxAttempts: 2, backoffType: "exponential", backoffMs: 1000 },
        },
      },
    },

    // ── Branch 3: CRM Account Analysis ───────────────────────────────────────
    {
      id: "n-crm-analysis",
      type: "agent",
      position: { x: 750, y: 420 },
      data: {
        label: "CRM Account Analysis",
        nodeType: "agent",
        description: "Extracts renewal dates, ARR, and account health from CRM",
        agentConfig: {
          agentName: "CRM Analysis Agent",
          role: "CRM Analytics",
          modelName: "gpt-4.1-mini",
          checkpointEnabled: false,
          retryPolicy: { maxAttempts: 2, backoffType: "exponential", backoffMs: 1000 },
        },
      },
    },

    // ── Join / Merge ──────────────────────────────────────────────────────────
    {
      id: "n-join",
      type: "join",
      position: { x: 400, y: 570 },
      data: {
        label: "Join Context",
        nodeType: "join",
        joinConfig: {
          joinPolicy: "wait_all",
          incomingBranchCount: 3,
          timeoutMs: 120000,
          onTimeout: "fail",
        },
      },
    },

    // ── Checkpoint ────────────────────────────────────────────────────────────
    {
      id: "n-ckpt",
      type: "checkpoint",
      position: { x: 400, y: 700 },
      data: {
        label: "Save Analysis State",
        nodeType: "checkpoint",
        checkpointConfig: {
          checkpointName: "post-parallel-analysis",
          stateKeys: ["usageScore", "supportSentiment", "accountHealth"],
          replayEnabled: true,
        },
      },
    },

    // ── Risk Analysis Agent ───────────────────────────────────────────────────
    {
      id: "n-risk",
      type: "agent",
      position: { x: 400, y: 840 },
      data: {
        label: "Risk Analysis Agent",
        nodeType: "agent",
        description: "Scores renewal risk using all collected context",
        agentConfig: {
          agentName: "Risk Analysis Agent",
          role: "Risk Scoring",
          modelName: "gpt-4.1",
          checkpointEnabled: true,
          retryPolicy: { maxAttempts: 2, backoffType: "exponential", backoffMs: 3000 },
        },
      },
    },

    // ── Branch: High Risk? ────────────────────────────────────────────────────
    {
      id: "n-branch",
      type: "branch",
      position: { x: 400, y: 980 },
      data: {
        label: "High Risk?",
        nodeType: "branch",
        description: "Routes to approval path if risk score ≥ 0.7",
        branchConfig: {
          conditionExpression: "output.riskScore >= 0.7",
          trueLabel: "High Risk",
          falseLabel: "Low Risk",
        },
      },
    },

    // ── High Risk Path: Approval Gate ─────────────────────────────────────────
    {
      id: "n-approval",
      type: "approval",
      position: { x: 150, y: 1130 },
      data: {
        label: "Approve CRM Update",
        nodeType: "approval",
        approvalConfig: {
          title: "High-Risk Renewal — Action Required",
          message: "This account has a renewal risk score ≥ 0.7. Please review the analysis and approve the recommended CRM action.",
          riskLevel: "high",
          approverRole: "account_manager",
          timeoutMs: 86400000,
          onTimeoutAction: "pause",
        },
      },
    },

    // ── High Risk Path: CRM Update Agent ─────────────────────────────────────
    {
      id: "n-crm-update",
      type: "agent",
      position: { x: 150, y: 1280 },
      data: {
        label: "CRM Update Agent",
        nodeType: "agent",
        description: "Updates account risk score and creates renewal task in CRM",
        agentConfig: {
          agentName: "CRM Update Agent",
          role: "CRM Write",
          modelName: "gpt-4.1-mini",
          checkpointEnabled: true,
          retryPolicy: { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 },
        },
      },
    },

    // ── High Risk Path: Notification Agent ───────────────────────────────────
    {
      id: "n-notify",
      type: "tool",
      position: { x: 150, y: 1420 },
      data: {
        label: "Send Slack Alert",
        nodeType: "tool",
        description: "Posts high-risk renewal alert to #account-health",
        toolConfig: { riskLevel: "low", toolName: "Slack Notify" },
      },
    },

    // ── Low Risk Path: Summary ────────────────────────────────────────────────
    {
      id: "n-low-risk",
      type: "llm",
      position: { x: 660, y: 1130 },
      data: {
        label: "Low Risk Summary",
        nodeType: "llm",
        description: "Generates a brief summary for healthy accounts",
        llmConfig: {
          provider: "openai",
          model: "gpt-4.1-mini",
          prompt: "Generate a brief renewal health summary for this low-risk account.",
          validationEnabled: false,
        },
      },
    },

    // ── Artifact ──────────────────────────────────────────────────────────────
    {
      id: "n-artifact",
      type: "artifact",
      position: { x: 660, y: 1280 },
      data: {
        label: "Renewal Report",
        nodeType: "artifact",
        artifactConfig: { artifactName: "renewal-report.json", artifactType: "json" },
      },
    },

    // ── End ───────────────────────────────────────────────────────────────────
    {
      id: "n-end",
      type: "end",
      position: { x: 400, y: 1560 },
      data: { label: "Complete", nodeType: "end" },
    },
  ],
  edges: [
    // Trigger → Fetch
    edge("e-trigger-fetch", "n-trigger", "n-fetch"),

    // Fetch → Parallel Split
    edge("e-fetch-parallel", "n-fetch", "n-parallel", "success"),

    // Parallel Split → 3 branches
    edge("e-parallel-usage", "n-parallel", "n-usage", "parallel", "Usage"),
    edge("e-parallel-support", "n-parallel", "n-support", "parallel", "Support"),
    edge("e-parallel-crm", "n-parallel", "n-crm-analysis", "parallel", "CRM"),

    // 3 branches → Join
    edge("e-usage-join", "n-usage", "n-join", "join"),
    edge("e-support-join", "n-support", "n-join", "join"),
    edge("e-crm-join", "n-crm-analysis", "n-join", "join"),

    // Join → Checkpoint
    edge("e-join-ckpt", "n-join", "n-ckpt"),

    // Checkpoint → Risk Analysis
    edge("e-ckpt-risk", "n-ckpt", "n-risk"),

    // Risk → Branch
    edge("e-risk-branch", "n-risk", "n-branch", "success"),

    // Branch: high risk path
    edge("e-branch-approval", "n-branch", "n-approval", "conditional_true", "High Risk ≥ 0.7"),

    // Branch: low risk path
    edge("e-branch-lowrisk", "n-branch", "n-low-risk", "conditional_false", "Low Risk < 0.7"),

    // Approval → CRM Update
    edge("e-approval-crm", "n-approval", "n-crm-update", "approval_approved", "Approved"),

    // Approval rejected → End
    edge("e-approval-end", "n-approval", "n-end", "approval_rejected", "Rejected"),

    // CRM Update → Notify
    edge("e-crm-notify", "n-crm-update", "n-notify", "success"),

    // Notify → End
    edge("e-notify-end", "n-notify", "n-end", "success"),

    // Low risk → Artifact
    edge("e-lowrisk-artifact", "n-low-risk", "n-artifact", "success"),

    // Artifact → End
    edge("e-artifact-end", "n-artifact", "n-end", "success"),
  ],
};

// ─── Templates registry ───────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "sequential-pipeline",
    name: "Sequential Agent Pipeline",
    description: "A linear flow: Agent → Approval Gate → Tool Write → End",
    complexity: "simple",
    tags: ["sequential", "approval", "tool"],
    graph: SEQUENTIAL_PIPELINE,
  },
  {
    id: "parallel-collection",
    name: "Parallel Context Collection",
    description: "Fan out to 3 data sources in parallel, merge, then analyze with LLM",
    complexity: "intermediate",
    tags: ["parallel", "join", "llm"],
    graph: PARALLEL_COLLECTION,
  },
  {
    id: "human-approval-flow",
    name: "Human Approval Before Write",
    description: "Agent prepares, human approves, tool writes — with rejection path",
    complexity: "simple",
    tags: ["approval", "human-in-the-loop"],
    graph: HUMAN_APPROVAL_FLOW,
  },
  {
    id: "failure-recovery",
    name: "Failure Recovery Flow",
    description: "Agent with retry, branch on success/fail, fallback execution path",
    complexity: "intermediate",
    tags: ["retry", "failure", "branch", "checkpoint"],
    graph: FAILURE_RECOVERY,
  },
  {
    id: "customer-renewal",
    name: "Customer Renewal Intelligence",
    description: "The flagship demo: parallel analysis, risk scoring, approval gate, CRM update",
    complexity: "advanced",
    tags: ["parallel", "join", "approval", "branch", "checkpoint", "artifact"],
    graph: CUSTOMER_RENEWAL_GRAPH,
  },
];

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
