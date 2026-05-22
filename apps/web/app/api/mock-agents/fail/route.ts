import { type NextRequest, NextResponse } from "next/server";

import {
  type MockAgentRequest,
  type MockFailurePayload,
  markFailed,
  markRunning,
  sleep,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Mock failing agent.
 *
 * POST /api/mock-agents/fail
 *
 * Simulates an agent that hits an external API rate-limit and fails
 * after a brief startup delay (~300 ms). Useful for testing:
 *   - FAILED run state display
 *   - Retry flow
 *   - Error message propagation
 *
 * Optional query param:  ?errorMessage=custom+error+text
 * Overrides the default error message.
 */
export async function POST(request: NextRequest) {
  const startedAt = new Date();
  let body: MockAgentRequest = {};
  try {
    body = (await request.json()) as MockAgentRequest;
  } catch {
    /* body is optional */
  }

  const customMessage = request.nextUrl.searchParams.get("errorMessage");
  const errorMessage = customMessage ?? "Mock CRM API rate limit exceeded. Retry after 60 s.";

  await markRunning(body.agentRunId);
  await sleep(300); // brief startup, then fail

  const payload: MockFailurePayload = {
    status: "failed",
    errorMessage,
  };

  await markFailed(body.agentRunId, errorMessage, startedAt);

  return NextResponse.json(payload, { status: 200 }); // 200 — scheduler inspects status field
}
