/**
 * preproduction-agent-run.mock.ts
 *
 * Isolated mock data for the Agent Run Detail page.
 * Three complete scenarios — never import from page components directly.
 *
 * Scenario A — Customer Renewal Intelligence (SUCCEEDED + multi-agent + approval)
 * Scenario B — Payment Recovery Agent (FAILED + retries exhausted)
 * Scenario C — Contract Compliance Review (WAITING_FOR_APPROVAL)
 */

import type {
  AgentRunUiModel,
  RunTimelineEventUi,
  AgentExecutionSummary,
  RunStepUiModel,
  ApprovalUiModel,
  ArtifactUiModel,
  AuditLogUiModel,
} from "@/types/agent-run-ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = "2026-05-22T09:00:00.000Z";
function t(offsetSeconds: number) {
  return new Date(new Date(BASE).getTime() + offsetSeconds * 1000).toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO A — Customer Renewal Intelligence (SUCCEEDED)
// ═══════════════════════════════════════════════════════════════════════════════

const scenarioAAgents: AgentExecutionSummary[] = [
  {
    id: "agent-orch",
    name: "Orchestrator Agent",
    role: "Builds execution plan and coordinates specialist agents",
    status: "SUCCEEDED",
    startedAt: t(2),
    finishedAt: t(14),
    durationMs: 12000,
    stepsCount: 3,
    tokensUsed: 820,
    estimatedCostUsd: 0.004,
    toolsUsed: ["plan_execution", "create_artifact"],
    outputSummary: "Created execution plan with 4 downstream agents. Dispatched Customer Data Agent.",
  },
  {
    id: "agent-data",
    name: "Customer Data Agent",
    role: "Fetches usage metrics, account data, and support context",
    status: "SUCCEEDED",
    startedAt: t(15),
    finishedAt: t(53),
    durationMs: 38000,
    stepsCount: 5,
    tokensUsed: 0,
    estimatedCostUsd: 0,
    toolsUsed: ["usage-metrics-api.getCustomers", "support-api.getRecentTickets", "crm-api.getRenewalAccounts"],
    outputSummary: "Fetched 128 customer usage records and 342 support tickets. 23 accounts flagged for review.",
  },
  {
    id: "agent-risk",
    name: "Risk Analysis Agent",
    role: "Scores renewal risk using customer usage, tickets, and account context",
    status: "SUCCEEDED",
    startedAt: t(54),
    finishedAt: t(107),
    durationMs: 53000,
    stepsCount: 4,
    tokensUsed: 6200,
    estimatedCostUsd: 0.028,
    toolsUsed: ["gpt-4.1-mini", "create_artifact"],
    outputSummary: "Classified 128 customers: 94 low, 22 medium, 12 high risk. risk_report.json generated.",
  },
  {
    id: "agent-crm",
    name: "CRM Update Agent",
    role: "Prepares and writes enriched renewal-risk data to Salesforce after approval",
    status: "SUCCEEDED",
    startedAt: t(108),
    finishedAt: t(252),
    durationMs: 144000,
    stepsCount: 6,
    tokensUsed: 3840,
    estimatedCostUsd: 0.019,
    toolsUsed: ["crm-api.prepareBulkUpdate", "crm-api.updateRenewalRisk"],
    outputSummary: "Updated 12 high-risk CRM records. Approval gate cleared by Demo Owner.",
  },
  {
    id: "agent-notify",
    name: "Notification Agent",
    role: "Creates account manager summary and posts Slack notification",
    status: "SUCCEEDED",
    startedAt: t(253),
    finishedAt: t(271),
    durationMs: 18000,
    stepsCount: 3,
    tokensUsed: 1620,
    estimatedCostUsd: 0.010,
    toolsUsed: ["slack.postMessage"],
    outputSummary: "Posted account manager summary to #renewals. account_manager_summary.md created.",
  },
];

const scenarioATimeline: RunTimelineEventUi[] = [
  // ── Run lifecycle ──────────────────────────────────────────────────────
  {
    id: "a-ev-01", sequence: 1, type: "RUN_CREATED", status: "SUCCEEDED", source: "SCHEDULER",
    title: "Run created by scheduler",
    summary: "Triggered by weekly cron schedule · 0 2 * * 1",
    timestamp: t(0),
    metadataJson: { triggeredBy: "cron:0 2 * * 1", jobId: "job-cri-001", idempotencyKey: "cri-2026-05-22-week20" },
  },
  {
    id: "a-ev-02", sequence: 2, type: "RUN_QUEUED", status: "SUCCEEDED", source: "WORKER",
    title: "Run queued on default worker",
    summary: "Assigned to worker wkr-01HZB2 · queue: default",
    timestamp: t(0.5),
    metadataJson: { workerId: "wkr_01HZB2X8K9QRJM4N7VTCPD6WF", queue: "default" },
  },
  {
    id: "a-ev-03", sequence: 3, type: "RUN_STARTED", status: "SUCCEEDED", source: "WORKER",
    title: "Run started",
    summary: "Worker picked up run · execution beginning",
    timestamp: t(1),
    durationMs: 500,
  },
  {
    id: "a-ev-04", sequence: 4, type: "BUDGET_CHECK_PASSED", status: "SUCCEEDED", source: "SYSTEM",
    title: "Budget check passed",
    summary: "Token budget: 50,000 available · Cost budget: $1.00 available",
    timestamp: t(1.5),
    metadataJson: { tokenBudget: 50000, costBudgetUsd: 1.00, currentTokens: 0, currentCostUsd: 0 },
  },
  // ── Orchestrator Agent ─────────────────────────────────────────────────
  {
    id: "a-ev-05", sequence: 5, type: "AGENT_STARTED", status: "SUCCEEDED", source: "ORCHESTRATOR",
    title: "Orchestrator Agent started",
    agentName: "Orchestrator Agent",
    summary: "Building execution plan for Customer Renewal Intelligence pipeline",
    timestamp: t(2),
    startedAt: t(2),
  },
  {
    id: "a-ev-06", sequence: 6, type: "AGENT_PLAN_CREATED", status: "SUCCEEDED", source: "ORCHESTRATOR",
    title: "Execution plan created",
    agentName: "Orchestrator Agent",
    summary: "Plan: CustomerDataAgent → RiskAnalysisAgent → CRMUpdateAgent → NotificationAgent",
    timestamp: t(6),
    durationMs: 4000,
    outputJson: {
      plan: [
        { step: 1, agent: "Customer Data Agent", input: "all_customers", output: "customer_dataset" },
        { step: 2, agent: "Risk Analysis Agent", input: "customer_dataset", output: "risk_report" },
        { step: 3, agent: "CRM Update Agent", input: "risk_report", output: "crm_updates", requiresApproval: true },
        { step: 4, agent: "Notification Agent", input: "crm_updates", output: "notification" },
      ],
    },
  },
  {
    id: "a-ev-07", sequence: 7, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "ORCHESTRATOR",
    title: "Handoff → Customer Data Agent",
    agentName: "Orchestrator Agent",
    handoffTo: "Customer Data Agent",
    summary: "Orchestrator dispatching Customer Data Agent to fetch account data",
    timestamp: t(14),
    durationMs: 8000,
    metadataJson: { fromAgent: "Orchestrator Agent", toAgent: "Customer Data Agent", payload: { scope: "all_customers", renewalWindow: "Q3-2026" } },
  },
  {
    id: "a-ev-08", sequence: 8, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "ORCHESTRATOR",
    title: "Orchestrator Agent completed",
    agentName: "Orchestrator Agent",
    summary: "Pipeline plan created · 4 downstream agents queued",
    timestamp: t(14),
    durationMs: 12000,
    tokensUsed: 820,
    estimatedCostUsd: 0.004,
  },
  // ── Customer Data Agent ────────────────────────────────────────────────
  {
    id: "a-ev-09", sequence: 9, type: "AGENT_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "Customer Data Agent started",
    agentName: "Customer Data Agent",
    summary: "Fetching usage metrics, support tickets, and CRM renewal accounts",
    timestamp: t(15),
    startedAt: t(15),
  },
  {
    id: "a-ev-10", sequence: 10, type: "HTTP_CALL_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "HTTP call started — usage-metrics-api.getCustomers",
    agentName: "Customer Data Agent",
    toolName: "usage-metrics-api.getCustomers",
    summary: "GET https://internal.api/v2/customers/usage?window=30d",
    timestamp: t(16),
    inputJson: { endpoint: "GET /v2/customers/usage", params: { window: "30d", includeChurn: true } },
  },
  {
    id: "a-ev-11", sequence: 11, type: "HTTP_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "HTTP call completed — usage-metrics-api.getCustomers",
    agentName: "Customer Data Agent",
    toolName: "usage-metrics-api.getCustomers",
    summary: "Returned 128 customer records · 200 OK · 38ms",
    timestamp: t(16.5),
    durationMs: 530,
    outputJson: { status: 200, recordsReturned: 128, pageCount: 3 },
  },
  {
    id: "a-ev-12", sequence: 12, type: "HTTP_CALL_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "HTTP call started — support-api.getRecentTickets",
    agentName: "Customer Data Agent",
    toolName: "support-api.getRecentTickets",
    summary: "GET https://internal.api/v1/support/tickets?days=90&status=open",
    timestamp: t(18),
    inputJson: { endpoint: "GET /v1/support/tickets", params: { days: 90, status: "open" } },
  },
  {
    id: "a-ev-13", sequence: 13, type: "HTTP_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "HTTP call completed — support-api.getRecentTickets",
    agentName: "Customer Data Agent",
    toolName: "support-api.getRecentTickets",
    summary: "Returned 342 support tickets · 200 OK · 62ms",
    timestamp: t(18.8),
    durationMs: 810,
    outputJson: { status: 200, ticketsReturned: 342, openCritical: 12 },
  },
  {
    id: "a-ev-14", sequence: 14, type: "TOOL_CALL_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call started — crm-api.getRenewalAccounts",
    agentName: "Customer Data Agent",
    toolName: "crm-api.getRenewalAccounts",
    summary: "Fetching accounts up for renewal in Q3-2026",
    timestamp: t(20),
    inputJson: { tool: "crm-api.getRenewalAccounts", args: { quarter: "Q3-2026", minContractValue: 5000 } },
  },
  {
    id: "a-ev-15", sequence: 15, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call completed — crm-api.getRenewalAccounts",
    agentName: "Customer Data Agent",
    toolName: "crm-api.getRenewalAccounts",
    summary: "23 renewal accounts returned · Q3-2026",
    timestamp: t(21.2),
    durationMs: 1200,
    outputJson: { accountsReturned: 23, totalContractValue: 2840000, urgentRenewals: 7 },
  },
  {
    id: "a-ev-16", sequence: 16, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "Customer Data Agent completed",
    agentName: "Customer Data Agent",
    summary: "128 customers · 342 tickets · 23 renewal accounts fetched successfully",
    timestamp: t(53),
    durationMs: 38000,
  },
  {
    id: "a-ev-17", sequence: 17, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "AGENT",
    title: "Handoff → Risk Analysis Agent",
    agentName: "Customer Data Agent",
    handoffTo: "Risk Analysis Agent",
    summary: "Passing customer dataset to Risk Analysis Agent for churn/renewal risk scoring",
    timestamp: t(53.5),
    metadataJson: { fromAgent: "Customer Data Agent", toAgent: "Risk Analysis Agent", datasetSize: "1.2MB", recordCount: 128 },
  },
  // ── Risk Analysis Agent ────────────────────────────────────────────────
  {
    id: "a-ev-18", sequence: 18, type: "AGENT_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "Risk Analysis Agent started",
    agentName: "Risk Analysis Agent",
    summary: "Scoring 128 customers for renewal risk using LLM classification",
    timestamp: t(54),
    startedAt: t(54),
  },
  {
    id: "a-ev-19", sequence: 19, type: "LLM_CALL_STARTED", status: "SUCCEEDED", source: "LLM",
    title: "LLM call started — renewal risk classification",
    agentName: "Risk Analysis Agent",
    modelName: "gpt-4.1-mini",
    summary: "Classifying 128 customers into low/medium/high churn risk",
    timestamp: t(55),
    startedAt: t(55),
    inputJson: {
      model: "gpt-4.1-mini",
      prompt_tokens: 4800,
      system: "You are a B2B renewal risk scoring system. Classify each customer into low/medium/high risk based on usage trends, support tickets, and contract value.",
      messages: [{ role: "user", content: "Classify the following 128 customer records..." }],
    },
  },
  {
    id: "a-ev-20", sequence: 20, type: "LLM_CALL_COMPLETED", status: "SUCCEEDED", source: "LLM",
    title: "LLM call completed — risk classification returned",
    agentName: "Risk Analysis Agent",
    modelName: "gpt-4.1-mini",
    summary: "128 customers classified · 94 low · 22 medium · 12 high risk",
    timestamp: t(89),
    durationMs: 34000,
    tokensUsed: 6200,
    estimatedCostUsd: 0.028,
    outputJson: {
      classifications: { low: 94, medium: 22, high: 12 },
      highRiskCustomers: [
        { id: "cust_001", name: "Acme Corp", riskScore: 0.91, reason: "Usage down 40%, 3 critical tickets" },
        { id: "cust_002", name: "GlobalFin Ltd", riskScore: 0.87, reason: "No logins in 45 days" },
        { id: "cust_003", name: "NovaSoft Inc", riskScore: 0.82, reason: "Contract expiring, no renewal signals" },
      ],
      totalTokens: 6200,
      model: "gpt-4.1-mini",
    },
  },
  {
    id: "a-ev-21", sequence: 21, type: "LLM_OUTPUT_VALIDATED", status: "SUCCEEDED", source: "AGENT",
    title: "LLM output validated against schema",
    agentName: "Risk Analysis Agent",
    summary: "Risk classification schema validated · 128/128 records classified",
    timestamp: t(89.5),
    metadataJson: { schema: "RiskClassificationV2", valid: true, recordsValidated: 128, schemaVersion: "2.1.0" },
  },
  {
    id: "a-ev-22", sequence: 22, type: "ARTIFACT_CREATED", status: "SUCCEEDED", source: "AGENT",
    title: "Artifact created — risk_report.json",
    agentName: "Risk Analysis Agent",
    artifactName: "risk_report.json",
    summary: "Risk report artifact created · 12.7 KB",
    timestamp: t(90),
    metadataJson: { artifactId: "art-risk-001", name: "risk_report.json", size: "12.7KB", type: "json" },
    outputJson: { customersAnalyzed: 128, highRisk: 12, mediumRisk: 22, lowRisk: 94, generatedAt: t(90) },
  },
  {
    id: "a-ev-23", sequence: 23, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "Risk Analysis Agent completed",
    agentName: "Risk Analysis Agent",
    summary: "Risk scoring complete · 12 high-risk customers identified · risk_report.json generated",
    timestamp: t(107),
    durationMs: 53000,
    tokensUsed: 6200,
    estimatedCostUsd: 0.028,
  },
  {
    id: "a-ev-24", sequence: 24, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "AGENT",
    title: "Handoff → CRM Update Agent",
    agentName: "Risk Analysis Agent",
    handoffTo: "CRM Update Agent",
    summary: "Passing risk_report.json to CRM Update Agent for Salesforce enrichment",
    timestamp: t(107.5),
    metadataJson: { fromAgent: "Risk Analysis Agent", toAgent: "CRM Update Agent", artifactRef: "art-risk-001", requiresApproval: true },
  },
  // ── CRM Update Agent ───────────────────────────────────────────────────
  {
    id: "a-ev-25", sequence: 25, type: "AGENT_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "CRM Update Agent started",
    agentName: "CRM Update Agent",
    summary: "Preparing Salesforce bulk update payload for 12 high-risk accounts",
    timestamp: t(108),
    startedAt: t(108),
  },
  {
    id: "a-ev-26", sequence: 26, type: "TOOL_CALL_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call started — crm-api.prepareBulkUpdate",
    agentName: "CRM Update Agent",
    toolName: "crm-api.prepareBulkUpdate",
    summary: "Building CRM update payload for 12 high-risk accounts",
    timestamp: t(109),
    inputJson: { tool: "crm-api.prepareBulkUpdate", records: 12, riskLevel: "HIGH", source: "art-risk-001" },
  },
  {
    id: "a-ev-27", sequence: 27, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call completed — crm-api.prepareBulkUpdate",
    agentName: "CRM Update Agent",
    toolName: "crm-api.prepareBulkUpdate",
    summary: "CRM update payload ready · 12 UPSERT operations prepared",
    timestamp: t(111),
    durationMs: 2000,
    outputJson: { operationsCount: 12, operationType: "UPSERT", affectedFields: ["renewal_risk_score", "risk_reason", "priority_flag"], estimatedImpact: "HIGH" },
  },
  {
    id: "a-ev-28", sequence: 28, type: "APPROVAL_REQUESTED", status: "WAITING",
    source: "AGENT",
    title: "Approval requested — Approve CRM renewal-risk update",
    agentName: "CRM Update Agent",
    summary: "Run paused at approval gate. 12 CRM records will be updated with high-risk flags.",
    timestamp: t(112),
    approval: {
      id: "appr-cri-001",
      title: "Approve CRM renewal-risk update",
      message: "CRM Update Agent is about to write renewal-risk scores for 12 high-risk accounts to Salesforce. Review the payload before proceeding.",
      status: "APPROVED",
      decidedBy: "Demo Owner",
      decidedAt: t(230),
      decisionReason: "Reviewed the 12 records — all correct. Approve.",
    },
    metadataJson: { recordsAffected: 12, riskLevel: "HIGH", estimatedWriteTime: "~8s", reversible: true },
  },
  {
    id: "a-ev-29", sequence: 29, type: "APPROVAL_APPROVED", status: "SUCCEEDED",
    source: "HUMAN",
    title: "Approval granted — CRM renewal-risk update",
    actorName: "Demo Owner",
    summary: "Demo Owner approved · Reviewed the 12 records — all correct.",
    timestamp: t(230),
    approval: {
      id: "appr-cri-001",
      title: "Approve CRM renewal-risk update",
      message: "",
      status: "APPROVED",
      decidedBy: "Demo Owner",
      decidedAt: t(230),
      decisionReason: "Reviewed the 12 records — all correct. Approve.",
    },
  },
  {
    id: "a-ev-30", sequence: 30, type: "RUN_RESUMED", status: "SUCCEEDED", source: "SYSTEM",
    title: "Run resumed after approval",
    summary: "CRM Update Agent resuming · approval cleared",
    timestamp: t(230.5),
  },
  {
    id: "a-ev-31", sequence: 31, type: "TOOL_CALL_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call started — crm-api.updateRenewalRisk",
    agentName: "CRM Update Agent",
    toolName: "crm-api.updateRenewalRisk",
    summary: "Writing 12 renewal-risk records to Salesforce",
    timestamp: t(231),
    inputJson: { tool: "crm-api.updateRenewalRisk", operationCount: 12, dryRun: false },
  },
  {
    id: "a-ev-32", sequence: 32, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call completed — crm-api.updateRenewalRisk",
    agentName: "CRM Update Agent",
    toolName: "crm-api.updateRenewalRisk",
    summary: "12/12 CRM records updated successfully",
    timestamp: t(239),
    durationMs: 8000,
    outputJson: { recordsUpdated: 12, recordsFailed: 0, operationIds: ["op_001", "op_002", "op_003"] },
  },
  {
    id: "a-ev-33", sequence: 33, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "CRM Update Agent completed",
    agentName: "CRM Update Agent",
    summary: "12 CRM records updated · approval gate cleared by Demo Owner",
    timestamp: t(252),
    durationMs: 144000,
    tokensUsed: 3840,
    estimatedCostUsd: 0.019,
  },
  {
    id: "a-ev-34", sequence: 34, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "AGENT",
    title: "Handoff → Notification Agent",
    agentName: "CRM Update Agent",
    handoffTo: "Notification Agent",
    summary: "Passing CRM update confirmation to Notification Agent",
    timestamp: t(252.5),
    metadataJson: { fromAgent: "CRM Update Agent", toAgent: "Notification Agent", updatedRecords: 12 },
  },
  // ── Notification Agent ─────────────────────────────────────────────────
  {
    id: "a-ev-35", sequence: 35, type: "AGENT_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "Notification Agent started",
    agentName: "Notification Agent",
    summary: "Creating account manager summary and posting Slack notification",
    timestamp: t(253),
    startedAt: t(253),
  },
  {
    id: "a-ev-36", sequence: 36, type: "TOOL_CALL_STARTED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call started — slack.postMessage",
    agentName: "Notification Agent",
    toolName: "slack.postMessage",
    summary: "POST #renewals-ops — account manager renewal alert",
    timestamp: t(254),
    inputJson: { channel: "#renewals-ops", messageType: "renewal_risk_alert", highRiskCount: 12, approvedBy: "Demo Owner" },
  },
  {
    id: "a-ev-37", sequence: 37, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "Tool call completed — slack.postMessage",
    agentName: "Notification Agent",
    toolName: "slack.postMessage",
    summary: "Slack message posted · #renewals-ops · ts:1716368401.123",
    timestamp: t(254.8),
    durationMs: 810,
    outputJson: { ok: true, channel: "#renewals-ops", ts: "1716368401.123" },
  },
  {
    id: "a-ev-38", sequence: 38, type: "ARTIFACT_CREATED", status: "SUCCEEDED", source: "AGENT",
    title: "Artifact created — account_manager_summary.md",
    agentName: "Notification Agent",
    artifactName: "account_manager_summary.md",
    summary: "Account manager summary document created · 3.2 KB",
    timestamp: t(268),
    metadataJson: { artifactId: "art-summary-001", name: "account_manager_summary.md", size: "3.2KB", type: "markdown" },
  },
  {
    id: "a-ev-39", sequence: 39, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "AGENT",
    title: "Notification Agent completed",
    agentName: "Notification Agent",
    summary: "Slack notification sent · account_manager_summary.md created",
    timestamp: t(271),
    durationMs: 18000,
    tokensUsed: 1620,
    estimatedCostUsd: 0.010,
  },
  // ── Run succeeded ──────────────────────────────────────────────────────
  {
    id: "a-ev-40", sequence: 40, type: "RUN_SUCCEEDED", status: "SUCCEEDED", source: "WORKER",
    title: "Run succeeded",
    summary: "All 5 agents completed · 12 CRM records updated · approval granted · 12,480 tokens · $0.061",
    timestamp: t(158),
    durationMs: 158000,
    tokensUsed: 12480,
    estimatedCostUsd: 0.061,
    outputJson: {
      customersAnalyzed: 128,
      highRiskCustomers: 12,
      crmRecordsUpdated: 12,
      approvalRequired: true,
      approvalDecision: "APPROVED",
      notificationsCreated: 3,
      riskReportArtifact: "risk_report.json",
    },
  },
];

const scenarioASteps: RunStepUiModel[] = [
  { id: "s-a-01", index: 1, agentName: "Orchestrator Agent", type: "SYSTEM", name: "Build execution plan", status: "SUCCEEDED", startedAt: t(2), finishedAt: t(6), durationMs: 4000, tokensUsed: 820, estimatedCostUsd: 0.004 },
  { id: "s-a-02", index: 2, agentName: "Customer Data Agent", type: "HTTP_CALL", name: "Fetch usage metrics", status: "SUCCEEDED", startedAt: t(16), finishedAt: t(16.5), durationMs: 530 },
  { id: "s-a-03", index: 3, agentName: "Customer Data Agent", type: "HTTP_CALL", name: "Fetch support tickets", status: "SUCCEEDED", startedAt: t(18), finishedAt: t(18.8), durationMs: 810 },
  { id: "s-a-04", index: 4, agentName: "Customer Data Agent", type: "TOOL_CALL", name: "Get renewal accounts", status: "SUCCEEDED", startedAt: t(20), finishedAt: t(21.2), durationMs: 1200 },
  { id: "s-a-05", index: 5, agentName: "Risk Analysis Agent", type: "LLM_CALL", name: "Risk classification", status: "SUCCEEDED", startedAt: t(55), finishedAt: t(89), durationMs: 34000, tokensUsed: 6200, estimatedCostUsd: 0.028 },
  { id: "s-a-06", index: 6, agentName: "Risk Analysis Agent", type: "ARTIFACT", name: "Create risk_report.json", status: "SUCCEEDED", startedAt: t(89.5), finishedAt: t(90), durationMs: 500 },
  { id: "s-a-07", index: 7, agentName: "CRM Update Agent", type: "TOOL_CALL", name: "Prepare bulk CRM update", status: "SUCCEEDED", startedAt: t(109), finishedAt: t(111), durationMs: 2000, tokensUsed: 1200, estimatedCostUsd: 0.006 },
  { id: "s-a-08", index: 8, agentName: "CRM Update Agent", type: "APPROVAL_GATE", name: "Approve CRM renewal-risk update", status: "SUCCEEDED", startedAt: t(112), finishedAt: t(230), durationMs: 118000 },
  { id: "s-a-09", index: 9, agentName: "CRM Update Agent", type: "TOOL_CALL", name: "Write renewal risk to CRM", status: "SUCCEEDED", startedAt: t(231), finishedAt: t(239), durationMs: 8000, tokensUsed: 2640, estimatedCostUsd: 0.013 },
  { id: "s-a-10", index: 10, agentName: "Notification Agent", type: "TOOL_CALL", name: "Post Slack notification", status: "SUCCEEDED", startedAt: t(254), finishedAt: t(254.8), durationMs: 810 },
  { id: "s-a-11", index: 11, agentName: "Notification Agent", type: "LLM_CALL", name: "Generate account manager summary", status: "SUCCEEDED", startedAt: t(256), finishedAt: t(265), durationMs: 9000, tokensUsed: 1620, estimatedCostUsd: 0.010 },
];

const scenarioAApprovals: ApprovalUiModel[] = [
  {
    id: "appr-cri-001",
    title: "Approve CRM renewal-risk update",
    message: "CRM Update Agent is about to write renewal-risk scores for 12 high-risk accounts to Salesforce. These records will be updated: renewal_risk_score, risk_reason, priority_flag. This action is reversible.",
    status: "APPROVED",
    relatedAgent: "CRM Update Agent",
    relatedStep: "Approve CRM renewal-risk update",
    requestedAt: t(112),
    decidedAt: t(230),
    decidedBy: "Demo Owner",
    decisionReason: "Reviewed the 12 records — all correct. Approve.",
    payloadPreview: {
      operationsCount: 12,
      operationType: "UPSERT",
      targetSystem: "Salesforce",
      affectedFields: ["renewal_risk_score", "risk_reason", "priority_flag"],
      sampleRecord: { id: "cust_001", name: "Acme Corp", renewal_risk_score: 0.91, risk_reason: "Usage down 40%, 3 critical tickets", priority_flag: "HIGH" },
    },
  },
];

const scenarioAArtifacts: ArtifactUiModel[] = [
  { id: "art-plan-001", name: "execution_plan.json", type: "json", createdByAgent: "Orchestrator Agent", createdAt: t(6), sizeLabel: "2.1 KB", preview: { plan: [{ step: 1, agent: "Customer Data Agent" }, { step: 2, agent: "Risk Analysis Agent" }, { step: 3, agent: "CRM Update Agent", requiresApproval: true }, { step: 4, agent: "Notification Agent" }] } },
  { id: "art-data-001", name: "customer_usage_snapshot.json", type: "json", createdByAgent: "Customer Data Agent", createdAt: t(53), sizeLabel: "48.3 KB", preview: { totalCustomers: 128, fetchedAt: t(53), sources: ["usage-metrics-api", "support-api", "crm-api"] } },
  { id: "art-risk-001", name: "risk_report.json", type: "json", createdByAgent: "Risk Analysis Agent", createdAt: t(90), sizeLabel: "12.7 KB", preview: { customersAnalyzed: 128, highRisk: 12, mediumRisk: 22, lowRisk: 94 } },
  { id: "art-crm-001", name: "crm_update_payload.json", type: "json", createdByAgent: "CRM Update Agent", createdAt: t(111), sizeLabel: "8.4 KB", preview: { operationsCount: 12, operationType: "UPSERT" } },
  { id: "art-summary-001", name: "account_manager_summary.md", type: "markdown", createdByAgent: "Notification Agent", createdAt: t(268), sizeLabel: "3.2 KB", preview: "# Renewal Risk Summary\n\n**Run date:** 2026-05-22\n**High-risk accounts:** 12\n**CRM records updated:** 12\n\nSee Salesforce for full details." },
];

const scenarioAAuditLogs: AuditLogUiModel[] = [
  { id: "al-a-01", time: t(0), action: "RUN_CREATED", actor: "scheduler", entity: "run:run-cri-001", details: "Triggered by weekly cron schedule" },
  { id: "al-a-02", time: t(1), action: "RUN_STARTED", actor: "worker:wkr-01HZB2", entity: "run:run-cri-001", details: "Worker picked up run" },
  { id: "al-a-03", time: t(112), action: "APPROVAL_REQUESTED", actor: "agent:crm-update", entity: "approval:appr-cri-001", details: "12 CRM records pending human review" },
  { id: "al-a-04", time: t(230), action: "APPROVAL_APPROVED", actor: "user:demo-owner", entity: "approval:appr-cri-001", details: "Demo Owner approved — Reviewed the 12 records" },
  { id: "al-a-05", time: t(239), action: "CRM_UPDATE_EXECUTED", actor: "agent:crm-update", entity: "crm:bulk-op-001", details: "12/12 Salesforce records updated" },
  { id: "al-a-06", time: t(158), action: "RUN_SUCCEEDED", actor: "worker:wkr-01HZB2", entity: "run:run-cri-001", details: "All 5 agents completed successfully" },
];

export const scenarioAMock: AgentRunUiModel = {
  run: {
    id: "run-cri-001",
    jobId: "job-cri-001",
    jobName: "Customer Renewal Intelligence",
    title: "Customer Renewal Intelligence · Run #47",
    status: "SUCCEEDED",
    triggerSource: "SCHEDULE",
    attemptNumber: 1,
    environment: "Production",
    idempotencyKey: "cri-2026-05-22-week20",
    startedAt: t(1),
    finishedAt: t(158),
    durationMs: 158000,
    totalTokens: 12480,
    estimatedCostUsd: 0.061,
    currentAgent: undefined,
    currentStep: undefined,
  },
  agents: scenarioAAgents,
  timelineEvents: scenarioATimeline,
  steps: scenarioASteps,
  approvals: scenarioAApprovals,
  artifacts: scenarioAArtifacts,
  auditLogs: scenarioAAuditLogs,
  output: {
    customersAnalyzed: 128,
    highRiskCustomers: 12,
    crmRecordsUpdated: 12,
    approvalRequired: true,
    approvalDecision: "APPROVED",
    notificationsCreated: 3,
    riskReportArtifact: "risk_report.json",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO B — Payment Recovery Agent (FAILED)
// ═══════════════════════════════════════════════════════════════════════════════

const BASE_B = "2026-05-22T14:30:00.000Z";
function tb(s: number) { return new Date(new Date(BASE_B).getTime() + s * 1000).toISOString(); }

const scenarioBAgents: AgentExecutionSummary[] = [
  {
    id: "agent-b-orch", name: "Orchestrator Agent", role: "Coordinates payment recovery pipeline",
    status: "SUCCEEDED", startedAt: tb(1), finishedAt: tb(8), durationMs: 7000,
    stepsCount: 2, tokensUsed: 620, estimatedCostUsd: 0.003,
    toolsUsed: ["plan_execution"],
    outputSummary: "Dispatched Billing Analysis Agent and Payment Provider Agent.",
  },
  {
    id: "agent-b-billing", name: "Billing Analysis Agent", role: "Analyzes failed invoices and payment history",
    status: "SUCCEEDED", startedAt: tb(9), finishedAt: tb(28), durationMs: 19000,
    stepsCount: 2, tokensUsed: 1610, estimatedCostUsd: 0.007,
    toolsUsed: ["billing-api.getFailedInvoices"],
    outputSummary: "Found 7 failed invoices totalling $14,240. Retry candidates identified.",
  },
  {
    id: "agent-b-payment", name: "Payment Provider Agent", role: "Retries failed charges via payment provider API",
    status: "FAILED", startedAt: tb(29), finishedAt: tb(94), durationMs: 65000,
    stepsCount: 3, tokensUsed: 0, estimatedCostUsd: 0,
    toolsUsed: ["payment-provider.retryCharge"],
    outputSummary: "HTTP 429 rate_limit_exceeded after 2 attempts. Retry exhausted.",
  },
];

const scenarioBTimeline: RunTimelineEventUi[] = [
  { id: "b-ev-01", sequence: 1, type: "RUN_CREATED", status: "SUCCEEDED", source: "API", title: "Run created via API trigger", summary: "Manual trigger via POST /api/agent-jobs/job-pay-001/run", timestamp: tb(0) },
  { id: "b-ev-02", sequence: 2, type: "RUN_STARTED", status: "SUCCEEDED", source: "WORKER", title: "Run started", summary: "Worker wkr-02KCP5 picked up run", timestamp: tb(1) },
  { id: "b-ev-03", sequence: 3, type: "BUDGET_CHECK_PASSED", status: "SUCCEEDED", source: "SYSTEM", title: "Budget check passed", timestamp: tb(1.5), metadataJson: { tokenBudget: 20000, costBudgetUsd: 0.5 } },
  { id: "b-ev-04", sequence: 4, type: "AGENT_STARTED", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Orchestrator Agent started", agentName: "Orchestrator Agent", summary: "Building payment recovery pipeline", timestamp: tb(1) },
  { id: "b-ev-05", sequence: 5, type: "AGENT_PLAN_CREATED", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Execution plan created", agentName: "Orchestrator Agent", summary: "Plan: BillingAnalysisAgent → PaymentProviderAgent", timestamp: tb(4), outputJson: { plan: [{ step: 1, agent: "Billing Analysis Agent" }, { step: 2, agent: "Payment Provider Agent" }] } },
  { id: "b-ev-06", sequence: 6, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Handoff → Billing Analysis Agent", agentName: "Orchestrator Agent", handoffTo: "Billing Analysis Agent", summary: "Dispatching Billing Analysis Agent to identify failed invoices", timestamp: tb(8) },
  { id: "b-ev-07", sequence: 7, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Orchestrator Agent completed", agentName: "Orchestrator Agent", timestamp: tb(8), durationMs: 7000 },
  { id: "b-ev-08", sequence: 8, type: "AGENT_STARTED", status: "SUCCEEDED", source: "AGENT", title: "Billing Analysis Agent started", agentName: "Billing Analysis Agent", summary: "Fetching failed invoices from billing system", timestamp: tb(9) },
  { id: "b-ev-09", sequence: 9, type: "TOOL_CALL_STARTED", status: "SUCCEEDED", source: "AGENT", title: "Tool call started — billing-api.getFailedInvoices", agentName: "Billing Analysis Agent", toolName: "billing-api.getFailedInvoices", timestamp: tb(10), inputJson: { tool: "billing-api.getFailedInvoices", filters: { status: "failed", daysSince: 7 } } },
  { id: "b-ev-10", sequence: 10, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT", title: "Tool call completed — billing-api.getFailedInvoices", agentName: "Billing Analysis Agent", toolName: "billing-api.getFailedInvoices", summary: "7 failed invoices found · $14,240 total", timestamp: tb(12), durationMs: 2000, outputJson: { failedInvoices: 7, totalAmount: 14240, currency: "USD", retryable: 7 } },
  { id: "b-ev-11", sequence: 11, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "AGENT", title: "Billing Analysis Agent completed", agentName: "Billing Analysis Agent", summary: "7 failed invoices · $14,240 · all retry-eligible", timestamp: tb(28), durationMs: 19000 },
  { id: "b-ev-12", sequence: 12, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "AGENT", title: "Handoff → Payment Provider Agent", agentName: "Billing Analysis Agent", handoffTo: "Payment Provider Agent", summary: "Passing 7 invoices to Payment Provider Agent for retry", timestamp: tb(28.5), metadataJson: { fromAgent: "Billing Analysis Agent", toAgent: "Payment Provider Agent", invoiceCount: 7 } },
  { id: "b-ev-13", sequence: 13, type: "AGENT_STARTED", status: "FAILED", source: "AGENT", title: "Payment Provider Agent started", agentName: "Payment Provider Agent", summary: "Attempting to retry 7 failed charges via Stripe API", timestamp: tb(29) },
  {
    id: "b-ev-14", sequence: 14, type: "HTTP_CALL_STARTED", status: "FAILED", source: "AGENT",
    title: "HTTP call started — payment-provider.retryCharge (attempt 1)",
    agentName: "Payment Provider Agent", toolName: "payment-provider.retryCharge",
    summary: "POST https://api.stripe.com/v1/charges · 7 charge retries",
    timestamp: tb(30),
    inputJson: { method: "POST", url: "https://api.stripe.com/v1/charges", body: { invoiceIds: ["inv_001", "inv_002", "inv_003"], retryAll: true } },
  },
  {
    id: "b-ev-15", sequence: 15, type: "HTTP_CALL_FAILED", status: "FAILED", source: "AGENT",
    title: "HTTP call FAILED — payment-provider.retryCharge",
    agentName: "Payment Provider Agent", toolName: "payment-provider.retryCharge",
    summary: "HTTP 429 rate_limit_exceeded · Stripe rate limit hit",
    timestamp: tb(31.2),
    durationMs: 1200,
    errorMessage: "HTTP 429 Too Many Requests: rate_limit_exceeded — Request rate limit exceeded for charges endpoint. Retry after 30 seconds.",
    outputJson: { status: 429, error: "rate_limit_exceeded", message: "Request rate limit exceeded for charges endpoint. Retry after 30 seconds.", retryAfter: 30 },
  },
  { id: "b-ev-16", sequence: 16, type: "RETRY_SCHEDULED", status: "SUCCEEDED", source: "WORKER", title: "Retry scheduled — attempt 2", summary: "Backoff: 30s · attempt 2/2", timestamp: tb(31.5), metadataJson: { attempt: 2, maxAttempts: 2, backoffSeconds: 30, reason: "HTTP 429 rate_limit_exceeded" } },
  { id: "b-ev-17", sequence: 17, type: "RETRY_STARTED", status: "SUCCEEDED", source: "WORKER", title: "Retry started — attempt 2/2", summary: "Retrying after 30s backoff", timestamp: tb(61.5) },
  {
    id: "b-ev-18", sequence: 18, type: "HTTP_CALL_STARTED", status: "FAILED", source: "AGENT",
    title: "HTTP call started — payment-provider.retryCharge (attempt 2)",
    agentName: "Payment Provider Agent", toolName: "payment-provider.retryCharge",
    summary: "POST https://api.stripe.com/v1/charges · retry after 30s backoff",
    timestamp: tb(62),
    inputJson: { method: "POST", url: "https://api.stripe.com/v1/charges", attempt: 2, retryAfterMs: 30000 },
  },
  {
    id: "b-ev-19", sequence: 19, type: "HTTP_CALL_FAILED", status: "FAILED", source: "AGENT",
    title: "HTTP call FAILED — payment-provider.retryCharge (final)",
    agentName: "Payment Provider Agent", toolName: "payment-provider.retryCharge",
    summary: "HTTP 429 rate_limit_exceeded · second attempt also rate-limited",
    timestamp: tb(63.4),
    durationMs: 1400,
    errorMessage: "HTTP 429 Too Many Requests: rate_limit_exceeded — Rate limit still in effect. All retry attempts exhausted.",
    outputJson: { status: 429, error: "rate_limit_exceeded", message: "Rate limit still in effect." },
  },
  { id: "b-ev-20", sequence: 20, type: "RETRY_EXHAUSTED", status: "FAILED", source: "WORKER", title: "Retry exhausted — max attempts reached", summary: "2/2 attempts failed · payment provider rate limit", timestamp: tb(63.5), errorMessage: "Payment provider API returned 429 rate_limit_exceeded after 2 attempts. No more retries available.", metadataJson: { totalAttempts: 2, maxAttempts: 2, finalError: "HTTP 429 rate_limit_exceeded" } },
  { id: "b-ev-21", sequence: 21, type: "AGENT_FAILED", status: "FAILED", source: "AGENT", title: "Payment Provider Agent FAILED", agentName: "Payment Provider Agent", summary: "Rate limit exceeded after 2 attempts · partial recovery not possible", timestamp: tb(64), errorMessage: "Payment provider API returned 429 rate_limit_exceeded after 2 attempts." },
  { id: "b-ev-22", sequence: 22, type: "RUN_FAILED", status: "FAILED", source: "WORKER", title: "Run FAILED", summary: "Payment recovery failed · HTTP 429 after 2 attempts · Notification Agent not reached", timestamp: tb(94), durationMs: 94000, errorMessage: "Payment provider API returned 429 rate_limit_exceeded after 2 attempts. Retry policy exhausted.", outputJson: { invoicesProcessed: 0, invoicesFailed: 7, errorCode: "RATE_LIMIT_EXCEEDED", paymentProviderStatus: 429 } },
];

const scenarioBSteps: RunStepUiModel[] = [
  { id: "s-b-01", index: 1, agentName: "Orchestrator Agent", type: "SYSTEM", name: "Build payment recovery plan", status: "SUCCEEDED", startedAt: tb(1), finishedAt: tb(8), durationMs: 7000, tokensUsed: 620, estimatedCostUsd: 0.003 },
  { id: "s-b-02", index: 2, agentName: "Billing Analysis Agent", type: "TOOL_CALL", name: "Fetch failed invoices", status: "SUCCEEDED", startedAt: tb(10), finishedAt: tb(12), durationMs: 2000 },
  { id: "s-b-03", index: 3, agentName: "Payment Provider Agent", type: "HTTP_CALL", name: "Retry charges (attempt 1)", status: "FAILED", startedAt: tb(30), finishedAt: tb(31.2), durationMs: 1200, errorMessage: "HTTP 429 rate_limit_exceeded" },
  { id: "s-b-04", index: 4, agentName: "Payment Provider Agent", type: "HTTP_CALL", name: "Retry charges (attempt 2)", status: "FAILED", startedAt: tb(62), finishedAt: tb(63.4), durationMs: 1400, errorMessage: "HTTP 429 rate_limit_exceeded — final attempt" },
];

export const scenarioBMock: AgentRunUiModel = {
  run: {
    id: "run-pay-001",
    jobId: "job-pay-001",
    jobName: "Payment Recovery Agent",
    title: "Payment Recovery Agent · Run #12",
    status: "FAILED",
    triggerSource: "MANUAL",
    attemptNumber: 1,
    environment: "Production",
    idempotencyKey: "pay-recovery-2026-05-22-1430",
    startedAt: tb(1),
    finishedAt: tb(94),
    durationMs: 94000,
    totalTokens: 2230,
    estimatedCostUsd: 0.013,
    errorMessage: "Payment provider API returned 429 rate_limit_exceeded after 2 attempts. Retry policy exhausted.",
  },
  agents: scenarioBAgents,
  timelineEvents: scenarioBTimeline,
  steps: scenarioBSteps,
  approvals: [],
  artifacts: [],
  auditLogs: [
    { id: "al-b-01", time: tb(0), action: "RUN_CREATED", actor: "api", entity: "run:run-pay-001", details: "Manual trigger via API" },
    { id: "al-b-02", time: tb(1), action: "RUN_STARTED", actor: "worker:wkr-02KCP5", entity: "run:run-pay-001", details: "Worker started execution" },
    { id: "al-b-03", time: tb(31.2), action: "HTTP_CALL_FAILED", actor: "agent:payment-provider", entity: "run:run-pay-001", details: "HTTP 429 rate_limit_exceeded · attempt 1" },
    { id: "al-b-04", time: tb(63.4), action: "HTTP_CALL_FAILED", actor: "agent:payment-provider", entity: "run:run-pay-001", details: "HTTP 429 rate_limit_exceeded · attempt 2" },
    { id: "al-b-05", time: tb(94), action: "RUN_FAILED", actor: "worker:wkr-02KCP5", entity: "run:run-pay-001", details: "Retry exhausted after 2 attempts" },
  ],
  partialOutput: {
    invoicesProcessed: 0,
    invoicesFailed: 7,
    billingAnalysisComplete: true,
    paymentProviderError: "HTTP 429 rate_limit_exceeded",
    retryAttempts: 2,
    notificationAgentStatus: "NOT_REACHED",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO C — Contract Compliance Review (WAITING_FOR_APPROVAL)
// ═══════════════════════════════════════════════════════════════════════════════

const BASE_C = "2026-05-22T10:15:00.000Z";
function tc(s: number) { return new Date(new Date(BASE_C).getTime() + s * 1000).toISOString(); }

export const scenarioCMock: AgentRunUiModel = {
  run: {
    id: "run-ccr-001",
    jobId: "job-ccr-001",
    jobName: "Contract Compliance Review",
    title: "Contract Compliance Review · Run #8",
    status: "WAITING_FOR_APPROVAL",
    triggerSource: "SCHEDULE",
    attemptNumber: 1,
    environment: "Production",
    idempotencyKey: "ccr-2026-05-22-week20",
    startedAt: tc(1),
    totalTokens: 5840,
    estimatedCostUsd: 0.029,
    currentAgent: "CRM Update Agent",
    currentStep: "Waiting for approval — Send redlines to Acme Corp",
  },
  agents: [
    {
      id: "agent-c-orch", name: "Orchestrator Agent", role: "Coordinates compliance review pipeline",
      status: "SUCCEEDED", startedAt: tc(1), finishedAt: tc(8), durationMs: 7000,
      stepsCount: 2, tokensUsed: 540, estimatedCostUsd: 0.003,
      toolsUsed: ["plan_execution"],
      outputSummary: "Dispatched Document Analysis Agent.",
    },
    {
      id: "agent-c-doc", name: "Document Analysis Agent", role: "Extracts clauses and flags compliance issues",
      status: "SUCCEEDED", startedAt: tc(9), finishedAt: tc(62), durationMs: 53000,
      stepsCount: 4, tokensUsed: 3200, estimatedCostUsd: 0.016,
      toolsUsed: ["contract-api.getContracts", "pdf-parser.extractClauses"],
      outputSummary: "3 contracts analyzed · 7 compliance issues flagged · redlines prepared.",
    },
    {
      id: "agent-c-legal", name: "Legal Review Agent", role: "Sends redlines to counterparty after approval",
      status: "WAITING", startedAt: tc(63), finishedAt: undefined, durationMs: undefined,
      stepsCount: 1, tokensUsed: 2100, estimatedCostUsd: 0.010,
      toolsUsed: ["email-api.sendRedlines"],
      outputSummary: "Waiting for human approval before sending redlines to legal@acmecorp.com.",
    },
  ],
  timelineEvents: [
    { id: "c-ev-01", sequence: 1, type: "RUN_CREATED", status: "SUCCEEDED", source: "SCHEDULER", title: "Run created by scheduler", summary: "Weekday contract compliance check · 0 9 * * 1-5", timestamp: tc(0) },
    { id: "c-ev-02", sequence: 2, type: "RUN_STARTED", status: "SUCCEEDED", source: "WORKER", title: "Run started", timestamp: tc(1) },
    { id: "c-ev-03", sequence: 3, type: "BUDGET_CHECK_PASSED", status: "SUCCEEDED", source: "SYSTEM", title: "Budget check passed", timestamp: tc(1.5) },
    { id: "c-ev-04", sequence: 4, type: "AGENT_STARTED", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Orchestrator Agent started", agentName: "Orchestrator Agent", timestamp: tc(1) },
    { id: "c-ev-05", sequence: 5, type: "AGENT_PLAN_CREATED", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Execution plan created", agentName: "Orchestrator Agent", summary: "Plan: DocumentAnalysisAgent → LegalReviewAgent", timestamp: tc(5) },
    { id: "c-ev-06", sequence: 6, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Handoff → Document Analysis Agent", agentName: "Orchestrator Agent", handoffTo: "Document Analysis Agent", timestamp: tc(8) },
    { id: "c-ev-07", sequence: 7, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "ORCHESTRATOR", title: "Orchestrator Agent completed", agentName: "Orchestrator Agent", timestamp: tc(8), durationMs: 7000 },
    { id: "c-ev-08", sequence: 8, type: "AGENT_STARTED", status: "SUCCEEDED", source: "AGENT", title: "Document Analysis Agent started", agentName: "Document Analysis Agent", timestamp: tc(9) },
    { id: "c-ev-09", sequence: 9, type: "TOOL_CALL_STARTED", status: "SUCCEEDED", source: "AGENT", title: "Tool call started — contract-api.getContracts", agentName: "Document Analysis Agent", toolName: "contract-api.getContracts", timestamp: tc(10) },
    { id: "c-ev-10", sequence: 10, type: "TOOL_CALL_COMPLETED", status: "SUCCEEDED", source: "AGENT", title: "Tool call completed — contract-api.getContracts", agentName: "Document Analysis Agent", toolName: "contract-api.getContracts", summary: "3 contracts fetched for review", timestamp: tc(12), durationMs: 2000, outputJson: { contractsReturned: 3, totalPages: 147, counterparty: "Acme Corp" } },
    { id: "c-ev-11", sequence: 11, type: "LLM_CALL_STARTED", status: "SUCCEEDED", source: "LLM", title: "LLM call started — clause extraction & compliance", agentName: "Document Analysis Agent", modelName: "claude-3.5-sonnet", timestamp: tc(14) },
    { id: "c-ev-12", sequence: 12, type: "LLM_CALL_COMPLETED", status: "SUCCEEDED", source: "LLM", title: "LLM call completed — 7 compliance issues flagged", agentName: "Document Analysis Agent", modelName: "claude-3.5-sonnet", summary: "3 contracts analyzed · 7 issues · 3 redlines prepared", timestamp: tc(58), durationMs: 44000, tokensUsed: 3200, estimatedCostUsd: 0.016, outputJson: { contractsAnalyzed: 3, complianceIssues: 7, redlinesPrepared: 3, riskLevel: "HIGH" } },
    { id: "c-ev-13", sequence: 13, type: "AGENT_COMPLETED", status: "SUCCEEDED", source: "AGENT", title: "Document Analysis Agent completed", agentName: "Document Analysis Agent", timestamp: tc(62), durationMs: 53000 },
    { id: "c-ev-14", sequence: 14, type: "AGENT_HANDOFF", status: "SUCCEEDED", source: "AGENT", title: "Handoff → Legal Review Agent", agentName: "Document Analysis Agent", handoffTo: "Legal Review Agent", timestamp: tc(62.5), metadataJson: { redlinesPrepared: 3, requiresApproval: true, counterparty: "Acme Corp" } },
    { id: "c-ev-15", sequence: 15, type: "AGENT_STARTED", status: "WAITING", source: "AGENT", title: "Legal Review Agent started", agentName: "Legal Review Agent", timestamp: tc(63) },
    {
      id: "c-ev-16", sequence: 16, type: "APPROVAL_REQUESTED", status: "WAITING", source: "AGENT",
      title: "Approval requested — Send redlines to Acme Corp",
      agentName: "Legal Review Agent",
      summary: "Run paused at approval gate. Review the proposed action before the agent continues.",
      timestamp: tc(64),
      approval: { id: "appr-ccr-001", title: "Send redlines to Acme Corp", message: "Legal Review Agent is about to send 3 redlined contracts to legal@acmecorp.com. This will notify the counterparty of compliance issues.", status: "PENDING" },
      metadataJson: { redlineCount: 3, recipient: "legal@acmecorp.com", contracts: ["MSA-2024-001.pdf", "SLA-2024-003.pdf", "DPA-2024-007.pdf"], riskLevel: "HIGH" },
    },
  ],
  steps: [
    { id: "s-c-01", index: 1, agentName: "Orchestrator Agent", type: "SYSTEM", name: "Build compliance review plan", status: "SUCCEEDED", startedAt: tc(1), finishedAt: tc(8), durationMs: 7000, tokensUsed: 540, estimatedCostUsd: 0.003 },
    { id: "s-c-02", index: 2, agentName: "Document Analysis Agent", type: "TOOL_CALL", name: "Fetch contracts", status: "SUCCEEDED", startedAt: tc(10), finishedAt: tc(12), durationMs: 2000 },
    { id: "s-c-03", index: 3, agentName: "Document Analysis Agent", type: "LLM_CALL", name: "Analyze clauses and prepare redlines", status: "SUCCEEDED", startedAt: tc(14), finishedAt: tc(58), durationMs: 44000, tokensUsed: 3200, estimatedCostUsd: 0.016 },
    { id: "s-c-04", index: 4, agentName: "Legal Review Agent", type: "LLM_CALL", name: "Draft cover letter for redlines", status: "SUCCEEDED", startedAt: tc(63), finishedAt: tc(65), durationMs: 2000, tokensUsed: 2100, estimatedCostUsd: 0.010 },
    { id: "s-c-05", index: 5, agentName: "Legal Review Agent", type: "APPROVAL_GATE", name: "Send redlines to Acme Corp", status: "WAITING" },
  ],
  approvals: [
    {
      id: "appr-ccr-001",
      title: "Send redlines to Acme Corp",
      message: "Legal Review Agent is about to send 3 redlined contracts to legal@acmecorp.com. Review the attached redlines before approving. This will notify the counterparty of 7 identified compliance issues.",
      status: "PENDING",
      relatedAgent: "Legal Review Agent",
      relatedStep: "Send redlines to Acme Corp",
      requestedAt: tc(64),
      payloadPreview: {
        recipient: "legal@acmecorp.com",
        cc: ["contracts@vectorbee.com", "legal@vectorbee.com"],
        attachments: ["MSA-2024-001-redlined.pdf", "SLA-2024-003-redlined.pdf", "DPA-2024-007-redlined.pdf"],
        complianceIssues: 7,
        riskLevel: "HIGH",
        subject: "Contract Review — Compliance Redlines (Vectorbee × Acme Corp)",
      },
    },
  ],
  artifacts: [
    { id: "art-c-01", name: "compliance_analysis.json", type: "json", createdByAgent: "Document Analysis Agent", createdAt: tc(60), sizeLabel: "14.2 KB", preview: { contractsAnalyzed: 3, issues: 7, redlines: 3 } },
    { id: "art-c-02", name: "redlines_package.pdf", type: "text", createdByAgent: "Legal Review Agent", createdAt: tc(65), sizeLabel: "284 KB", preview: "3 redlined contract documents — MSA, SLA, DPA" },
  ],
  auditLogs: [
    { id: "al-c-01", time: tc(0), action: "RUN_CREATED", actor: "scheduler", entity: "run:run-ccr-001", details: "Weekday compliance schedule" },
    { id: "al-c-02", time: tc(1), action: "RUN_STARTED", actor: "worker:wkr-01HZB2", entity: "run:run-ccr-001", details: "Worker started execution" },
    { id: "al-c-03", time: tc(64), action: "APPROVAL_REQUESTED", actor: "agent:legal-review", entity: "approval:appr-ccr-001", details: "Send redlines to legal@acmecorp.com · HIGH risk" },
  ],
};

// ─── Export helpers ───────────────────────────────────────────────────────────

export type MockScenario = "success" | "failed" | "waiting";

export function getMockScenario(scenario: MockScenario): AgentRunUiModel {
  switch (scenario) {
    case "success": return scenarioAMock;
    case "failed":  return scenarioBMock;
    case "waiting": return scenarioCMock;
  }
}
