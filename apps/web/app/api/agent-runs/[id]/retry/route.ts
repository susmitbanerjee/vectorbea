import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import {
  RetryBlockedError,
  retryAgentRun,
} from "@/server/services/agent-run-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/agent-runs/:id/retry ─────────────────────────────────────────
//
// Request body (optional):
//   { forcePaused?: boolean }
//
// Returns 201 on success:
//   { run: { id, attemptNumber }, warnings: string[] }
//
// Returns 4xx on blocked retry:
//   { error, code, detail? }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    let forcePaused = false;
    try {
      const body = (await request.json()) as { forcePaused?: boolean };
      forcePaused = body.forcePaused === true;
    } catch {
      // body is optional
    }

    const result = await retryAgentRun(organizationId, userId, id, { forcePaused });

    return NextResponse.json(
      {
        run: { id: result.runId, attemptNumber: result.attemptNumber },
        warnings: result.warnings,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof RetryBlockedError) {
      const status =
        err.code === "NOT_FOUND"
          ? 404
          : err.code === "INVALID_STATUS"
            ? 422
            : 409; // all blocked-by-policy cases → 409 Conflict

      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }

    console.error("[agent-runs/retry]", err);
    return NextResponse.json({ error: "Failed to retry run" }, { status: 500 });
  }
}
