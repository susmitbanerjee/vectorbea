import { type NextRequest, NextResponse } from "next/server";

import {
  type MockAgentRequest,
  type MockSuccessPayload,
  markRunning,
  markSucceeded,
  randomInt,
  sleep,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 30 s — plenty for the 1-2 s mock delay
export const maxDuration = 30;

/**
 * Mock successful agent.
 *
 * POST /api/mock-agents/success
 *
 * Simulates an agent that:
 *   1. Runs an LLM call (Analyze records)
 *   2. Runs a tool call (Prepare action plan)
 *   3. Completes successfully after 1-2 seconds
 *
 * If `agentRunId` is provided in the body the scheduler run record is
 * updated in the DB (RUNNING → SUCCEEDED) so the result is immediately
 * visible in the Vectorbea UI.
 */
export async function POST(request: NextRequest) {
  const startedAt = new Date();
  let body: MockAgentRequest = {};
  try {
    body = (await request.json()) as MockAgentRequest;
  } catch {
    /* body is optional */
  }

  // Simulate processing time (1–2 s)
  const delay = randomInt(1000, 2000);
  await markRunning(body.agentRunId);
  await sleep(delay);

  const usage = { totalTokens: 2500, estimatedCostUsd: 0.01 };

  const payload: MockSuccessPayload = {
    status: "succeeded",
    output: { summary: "Mock agent completed successfully." },
    steps: [
      {
        type: "LLM_CALL",
        name: "Analyze records",
        tokensUsed: 2500,
        estimatedCostUsd: 0.01,
        input: { records: 10 },
        output: { result: "ok" },
      },
      {
        type: "TOOL_CALL",
        name: "Prepare action plan",
        input: {},
        output: { actions: 3 },
      },
    ],
    usage,
  };

  await markSucceeded(body.agentRunId, usage, startedAt);

  return NextResponse.json(payload);
}
