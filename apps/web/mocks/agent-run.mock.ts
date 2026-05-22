/**
 * Mock data for the Agent Run detail page demo.
 *
 * ⚠️  THIS IS MOCK / DEV DATA — not connected to any real database or API.
 *
 * Used by:  /agent-runs/mock
 *
 * Two scenarios are exported:
 *   - successRunMock   Full CRM Enrichment run: trigger → approval → succeed
 *   - failedRunMock    Same job, fails at "Call CRM API" with a rate-limit error
 *
 * When real AgentRun API endpoints are ready, replace calls to these mocks
 * with GET /api/agent-runs/:id (see apps/web/app/api/agent-runs/[id]/route.ts).
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT";

export type StepType =
  | "SYSTEM"
  | "LLM_CALL"
  | "TOOL_CALL"
  | "HTTP_CALL"
  | "APPROVAL_GATE"
  | "ERROR";

export type StepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export type ApprovalDecision = "APPROVED" | "REJECTED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export type TriggerSource = "MANUAL" | "SCHEDULE" | "RETRY";

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface MockApproval {
  id: string;
  title: string;
  message: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: { id: string; name: string; email: string } | null;
  decisionReason: string | null;
}

export interface MockStep {
  id: string;
  stepIndex: number;
  stepType: StepType;
  name: string;
  status: StepStatus;
  description: string;
  inputJson: Record<string, unknown> | null;
  outputJson: Record<string, unknown> | null;
  errorMessage: string | null;
  tokensUsed: number | null;
  estimatedCostUsd: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Only present on APPROVAL_GATE steps */
  approval?: MockApproval;
}

export interface MockAuditEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  details: string;
}

export interface MockRun {
  /** Mock flag — remove or ignore once connected to real API */
  __isMock: true;
  id: string;
  jobId: string;
  jobName: string;
  status: RunStatus;
  triggerSource: TriggerSource;
  attemptNumber: number;
  idempotencyKey: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  outputJson: Record<string, unknown> | null;
  errorMessage: string | null;
  steps: MockStep[];
  /** Top-level approval records for this run (matches /api/approvals shape) */
  approvals: MockApproval[];
  auditTrail: MockAuditEntry[];
}

// ─── Scenario A: Successful run with approval ─────────────────────────────────

const APPROVAL_ID = "appr_mock_crm_001";
const JOB_ID = "job_seed_crm_approval_vectorbea";

const sharedApproval: MockApproval = {
  id: APPROVAL_ID,
  title: "Approve CRM update",
  message:
    "The agent has analyzed 128 customer records and wants to update the status of 12 accounts in the CRM. Please review the proposed changes before allowing the write operation.",
  status: "APPROVED",
  requestedAt: "2025-05-22T09:01:08.000Z",
  decidedAt: "2025-05-22T09:01:30.000Z",
  decidedBy: {
    id: "user_seed_owner_vectorbea",
    name: "Demo Owner",
    email: "seed@vectorbea.com",
  },
  decisionReason: "Payload looks safe. Approved for demo.",
};

export const successRunMock: MockRun = {
  __isMock: true,
  id: "run_mock_crm_success_001",
  jobId: JOB_ID,
  jobName: "CRM Enrichment Agent",
  status: "SUCCEEDED",
  triggerSource: "MANUAL",
  attemptNumber: 1,
  idempotencyKey: "manual:2025-05-22T09:00:00.000Z",
  startedAt: "2025-05-22T09:00:01.000Z",
  finishedAt: "2025-05-22T09:01:43.000Z",
  durationMs: 102_000,
  totalTokens: 8_420,
  estimatedCostUsd: 0.037,
  outputJson: {
    message: "CRM enrichment completed successfully",
    recordsAnalyzed: 128,
    recordsUpdated: 12,
    approvalRequired: true,
    approvalDecision: "APPROVED",
    riskLevel: "LOW",
  },
  errorMessage: null,

  steps: [
    {
      id: "step_mock_001",
      stepIndex: 1,
      stepType: "SYSTEM",
      name: "Run initialized",
      status: "SUCCEEDED",
      description: "Vectorbea created the run and prepared the execution context.",
      inputJson: {
        agentRunId: "run_mock_crm_success_001",
        jobId: JOB_ID,
        triggerSource: "MANUAL",
        attemptNumber: 1,
      },
      outputJson: {
        contextReady: true,
        executionEnvironment: "production",
      },
      errorMessage: null,
      tokensUsed: null,
      estimatedCostUsd: null,
      startedAt: "2025-05-22T09:00:01.000Z",
      finishedAt: "2025-05-22T09:00:02.100Z",
      durationMs: 1_100,
    },
    {
      id: "step_mock_002",
      stepIndex: 2,
      stepType: "LLM_CALL",
      name: "Analyze customer records",
      status: "SUCCEEDED",
      description:
        "Agent reviewed 128 customer records and identified enrichment opportunities.",
      inputJson: {
        model: "gpt-4o",
        systemPrompt:
          "You are a CRM analyst. Review the provided customer records and identify which accounts need enrichment.",
        userMessage:
          "Analyze the following 128 customer records and return a prioritized list of enrichment opportunities.",
        recordCount: 128,
        temperature: 0.2,
      },
      outputJson: {
        model: "gpt-4o",
        tokensPrompt: 4_200,
        tokensCompletion: 1_000,
        analysisResult: {
          totalRecords: 128,
          highPriorityAccounts: 12,
          mediumPriorityAccounts: 31,
          lowPriorityAccounts: 85,
          recommendedActions: [
            "Update industry classification for 12 accounts",
            "Refresh contact details for 8 accounts",
            "Add missing ARR values for 4 accounts",
          ],
        },
      },
      errorMessage: null,
      tokensUsed: 5_200,
      estimatedCostUsd: 0.022,
      startedAt: "2025-05-22T09:00:02.100Z",
      finishedAt: "2025-05-22T09:00:47.600Z",
      durationMs: 45_500,
    },
    {
      id: "step_mock_003",
      stepIndex: 3,
      stepType: "TOOL_CALL",
      name: "Prepare CRM update payload",
      status: "SUCCEEDED",
      description:
        "Agent created a structured CRM update plan for 12 customer records.",
      inputJson: {
        tool: "build_crm_payload",
        analysisOutput: { highPriorityAccounts: 12 },
        targetFields: ["industry", "contactEmail", "arr"],
      },
      outputJson: {
        payloadReady: true,
        recordCount: 12,
        estimatedChanges: [
          { field: "industry", affectedRecords: 12 },
          { field: "contactEmail", affectedRecords: 8 },
          { field: "arr", affectedRecords: 4 },
        ],
        requiresApproval: true,
      },
      errorMessage: null,
      tokensUsed: 1_800,
      estimatedCostUsd: 0.008,
      startedAt: "2025-05-22T09:00:47.600Z",
      finishedAt: "2025-05-22T09:01:07.800Z",
      durationMs: 20_200,
    },
    {
      id: "step_mock_004",
      stepIndex: 4,
      stepType: "APPROVAL_GATE",
      name: "Approval required before CRM update",
      status: "SUCCEEDED",
      description:
        "Run paused until a human approved the CRM modification.",
      inputJson: {
        approvalTitle: "Approve CRM update",
        approvalMessage:
          "Agent wants to update 12 customer records. Review the proposed changes.",
        recordsAffected: 12,
        riskLevel: "LOW",
      },
      outputJson: {
        approvalId: APPROVAL_ID,
        decision: "APPROVED",
        decidedBy: "Demo Owner",
        decidedAt: "2025-05-22T09:01:30.000Z",
        waitDurationMs: 22_200,
      },
      errorMessage: null,
      tokensUsed: null,
      estimatedCostUsd: null,
      startedAt: "2025-05-22T09:01:07.800Z",
      finishedAt: "2025-05-22T09:01:30.000Z",
      durationMs: 22_200,
      approval: sharedApproval,
    },
    {
      id: "step_mock_005",
      stepIndex: 5,
      stepType: "TOOL_CALL",
      name: "Update CRM records",
      status: "SUCCEEDED",
      description: "Agent updated 12 CRM records after approval.",
      inputJson: {
        tool: "crm_bulk_update",
        endpoint: "https://api.crm.internal/v2/accounts/bulk",
        recordIds: [
          "acc_001", "acc_004", "acc_007", "acc_012",
          "acc_015", "acc_019", "acc_023", "acc_031",
          "acc_038", "acc_045", "acc_051", "acc_066",
        ],
        fields: ["industry", "contactEmail", "arr"],
        approvalId: APPROVAL_ID,
      },
      outputJson: {
        success: true,
        recordsUpdated: 12,
        recordsFailed: 0,
        crmJobId: "crm_job_98234",
        durationMs: 810,
      },
      errorMessage: null,
      tokensUsed: 1_420,
      estimatedCostUsd: 0.007,
      startedAt: "2025-05-22T09:01:30.000Z",
      finishedAt: "2025-05-22T09:01:43.000Z",
      durationMs: 13_000,
    },
  ],

  approvals: [sharedApproval],

  auditTrail: [
    {
      id: "al_mock_001",
      timestamp: "2025-05-22T09:00:00.800Z",
      action: "RUN_CREATED",
      actor: "Demo Owner",
      details: "Manual trigger — job: CRM Enrichment Agent",
    },
    {
      id: "al_mock_002",
      timestamp: "2025-05-22T09:00:01.000Z",
      action: "RUN_STARTED",
      actor: "System",
      details: "Worker picked up run — attempt #1",
    },
    {
      id: "al_mock_003",
      timestamp: "2025-05-22T09:00:47.600Z",
      action: "STEP_COMPLETED",
      actor: "System",
      details: "Step 2 completed — LLM_CALL: Analyze customer records (5,200 tokens)",
    },
    {
      id: "al_mock_004",
      timestamp: "2025-05-22T09:01:08.000Z",
      action: "APPROVAL_REQUESTED",
      actor: "System",
      details: `Approval created (id: ${APPROVAL_ID}) — 12 CRM records pending write`,
    },
    {
      id: "al_mock_005",
      timestamp: "2025-05-22T09:01:30.000Z",
      action: "APPROVAL_APPROVED",
      actor: "Demo Owner",
      details: "Decision: APPROVED — \"Payload looks safe. Approved for demo.\"",
    },
    {
      id: "al_mock_006",
      timestamp: "2025-05-22T09:01:30.100Z",
      action: "RUN_RESUMED",
      actor: "System",
      details: "Run resumed after approval — continuing from step 5",
    },
    {
      id: "al_mock_007",
      timestamp: "2025-05-22T09:01:43.000Z",
      action: "RUN_SUCCEEDED",
      actor: "System",
      details: "Run finished — duration: 1m 42s — 8,420 tokens — $0.037",
    },
  ],
};

// ─── Scenario B: Failed run ───────────────────────────────────────────────────

export const failedRunMock: MockRun = {
  __isMock: true,
  id: "run_mock_crm_failed_002",
  jobId: JOB_ID,
  jobName: "CRM Enrichment Agent",
  status: "FAILED",
  triggerSource: "MANUAL",
  attemptNumber: 1,
  idempotencyKey: "manual:2025-05-22T11:00:00.000Z",
  startedAt: "2025-05-22T11:00:01.000Z",
  finishedAt: "2025-05-22T11:01:04.000Z",
  durationMs: 63_000,
  totalTokens: 5_200,
  estimatedCostUsd: 0.022,
  outputJson: null,
  errorMessage: "CRM API rate limit exceeded. Retry after 60 seconds. (HTTP 429 from api.crm.internal)",

  steps: [
    {
      id: "step_mock_f01",
      stepIndex: 1,
      stepType: "SYSTEM",
      name: "Run initialized",
      status: "SUCCEEDED",
      description: "Vectorbea created the run and prepared the execution context.",
      inputJson: {
        agentRunId: "run_mock_crm_failed_002",
        jobId: JOB_ID,
        triggerSource: "MANUAL",
        attemptNumber: 1,
      },
      outputJson: { contextReady: true },
      errorMessage: null,
      tokensUsed: null,
      estimatedCostUsd: null,
      startedAt: "2025-05-22T11:00:01.000Z",
      finishedAt: "2025-05-22T11:00:02.100Z",
      durationMs: 1_100,
    },
    {
      id: "step_mock_f02",
      stepIndex: 2,
      stepType: "LLM_CALL",
      name: "Analyze customer records",
      status: "SUCCEEDED",
      description:
        "Agent reviewed 128 customer records and identified enrichment opportunities.",
      inputJson: {
        model: "gpt-4o",
        recordCount: 128,
        temperature: 0.2,
      },
      outputJson: {
        totalRecords: 128,
        highPriorityAccounts: 12,
      },
      errorMessage: null,
      tokensUsed: 5_200,
      estimatedCostUsd: 0.022,
      startedAt: "2025-05-22T11:00:02.100Z",
      finishedAt: "2025-05-22T11:00:47.600Z",
      durationMs: 45_500,
    },
    {
      id: "step_mock_f03",
      stepIndex: 3,
      stepType: "TOOL_CALL",
      name: "Call CRM API",
      status: "FAILED",
      description:
        "Agent attempted to write to the CRM API but was rate-limited.",
      inputJson: {
        tool: "crm_bulk_update",
        endpoint: "https://api.crm.internal/v2/accounts/bulk",
        recordIds: ["acc_001", "acc_004", "acc_007"],
        retryAttempt: 1,
      },
      outputJson: null,
      errorMessage:
        "CRM API rate limit exceeded. Retry after 60 seconds. (HTTP 429 from api.crm.internal)",
      tokensUsed: null,
      estimatedCostUsd: null,
      startedAt: "2025-05-22T11:00:47.600Z",
      finishedAt: "2025-05-22T11:01:04.000Z",
      durationMs: 16_400,
    },
  ],

  approvals: [],

  auditTrail: [
    {
      id: "al_mock_f01",
      timestamp: "2025-05-22T11:00:00.800Z",
      action: "RUN_CREATED",
      actor: "Demo Owner",
      details: "Manual trigger — job: CRM Enrichment Agent",
    },
    {
      id: "al_mock_f02",
      timestamp: "2025-05-22T11:00:01.000Z",
      action: "RUN_STARTED",
      actor: "System",
      details: "Worker picked up run — attempt #1",
    },
    {
      id: "al_mock_f03",
      timestamp: "2025-05-22T11:00:47.600Z",
      action: "STEP_COMPLETED",
      actor: "System",
      details: "Step 2 completed — LLM_CALL: Analyze customer records (5,200 tokens)",
    },
    {
      id: "al_mock_f04",
      timestamp: "2025-05-22T11:01:04.000Z",
      action: "RUN_FAILED",
      actor: "System",
      details: "Step 3 failed — CRM API rate limit exceeded (HTTP 429)",
    },
  ],
};
