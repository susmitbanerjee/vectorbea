import { type NextRequest, NextResponse } from "next/server";

import {
  type MockAgentRequest,
  type MockApprovalPayload,
  type MockSuccessPayload,
  markRunning,
  markSucceeded,
  markWaitingForApproval,
  sleep,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Mock approval-required agent.
 *
 * POST /api/mock-agents/approval
 *
 * ── First call (no approval yet) ─────────────────────────────────────────────
 * Body: { agentRunId: "..." }
 *
 * The agent analyzes records, decides it needs human sign-off before writing
 * to the CRM, and pauses. The scheduler run moves to WAITING_FOR_APPROVAL and
 * an ApprovalRequest is created in the DB (visible in /approvals).
 *
 * Response:
 * {
 *   "status": "requires_approval",
 *   "approval": { "title": "...", "message": "..." },
 *   "partialOutput": { "recordsToUpdate": 12 }
 * }
 *
 * ── Resume call (after approval) ─────────────────────────────────────────────
 * Body: {
 *   agentRunId: "...",
 *   resumeFromApproval: true,
 *   approvalId: "...",
 *   approvalDecision: "APPROVED"
 * }
 *
 * The scheduler sends this after the operator approves the request.
 * The agent completes the CRM update and the run finishes as SUCCEEDED.
 *
 * Response: MockSuccessPayload
 */
export async function POST(request: NextRequest) {
  const startedAt = new Date();
  let body: MockAgentRequest = {};
  try {
    body = (await request.json()) as MockAgentRequest;
  } catch {
    /* body is optional */
  }

  await markRunning(body.agentRunId);
  await sleep(500); // brief analysis phase

  // ── Resume path ───────────────────────────────────────────────────────────
  if (body.resumeFromApproval === true) {
    await sleep(800); // simulate writing to CRM

    const usage = { totalTokens: 500, estimatedCostUsd: 0.002 };
    const payload: MockSuccessPayload = {
      status: "succeeded",
      output: {
        message: "Approved action completed. 12 CRM records updated.",
        approvalId: body.approvalId,
        decision: body.approvalDecision,
      },
      steps: [
        {
          type: "TOOL_CALL",
          name: "Update CRM records",
          input: { records: 12 },
          output: { updated: 12, failed: 0 },
        },
      ],
      usage,
    };

    await markSucceeded(body.agentRunId, usage, startedAt);
    return NextResponse.json(payload);
  }

  // ── First call path: pause and request approval ───────────────────────────
  const approvalDetails = {
    title: "Approve CRM update",
    message:
      "The agent has analyzed 12 customer records and wants to update their status in the CRM. " +
      "Please review before allowing the write operation.",
  };

  const approvalId = await markWaitingForApproval(body.agentRunId, approvalDetails);

  const payload: MockApprovalPayload = {
    status: "requires_approval",
    approval: approvalDetails,
    partialOutput: {
      recordsToUpdate: 12,
      approvalId,
    },
  };

  return NextResponse.json(payload);
}
