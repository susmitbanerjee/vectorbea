import { type NextRequest, NextResponse } from "next/server";

import {
  type MockAgentRequest,
  markRunning,
  markTimeout,
  sleep,
} from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 65 s gives us room to sleep past the typical 60 s maxDurationSeconds job config
export const maxDuration = 65;

/**
 * Mock slow / timeout agent.
 *
 * POST /api/mock-agents/slow
 *
 * Sleeps for `?seconds=N` (default 35 s) before responding. This is longer
 * than the default `maxDurationSeconds: 300` job config, but you can set a
 * job's maxDurationSeconds to 10 s to trigger the timeout path.
 *
 * Optional query param:  ?seconds=N   (default 35, max 60)
 *
 * Useful for testing:
 *   - TIMEOUT run state display
 *   - The scheduler's maxDurationSeconds enforcement
 *   - The retry flow after a timeout
 *
 * Note: the run is marked TIMEOUT in the DB after sleeping, so the UI
 * updates immediately once the request completes.
 */
export async function POST(request: NextRequest) {
  const startedAt = new Date();
  let body: MockAgentRequest = {};
  try {
    body = (await request.json()) as MockAgentRequest;
  } catch {
    /* body is optional */
  }

  const rawSeconds = parseInt(request.nextUrl.searchParams.get("seconds") ?? "35", 10);
  const sleepSeconds = Math.min(60, Math.max(1, isNaN(rawSeconds) ? 35 : rawSeconds));

  await markRunning(body.agentRunId);

  // Sleep in 5-second chunks so we can log progress (visible in server logs)
  let remaining = sleepSeconds * 1000;
  const chunk = 5000;
  while (remaining > 0) {
    const wait = Math.min(chunk, remaining);
    await sleep(wait);
    remaining -= wait;
    console.log(
      `[mock-agents/slow] agentRunId=${body.agentRunId ?? "none"} ` +
        `still sleeping, ${Math.round(remaining / 1000)}s remaining…`,
    );
  }

  await markTimeout(body.agentRunId, startedAt);

  return NextResponse.json({
    status: "timeout",
    message: `Mock agent deliberately slept for ${sleepSeconds}s to trigger timeout behavior.`,
    sleepSeconds,
  });
}
