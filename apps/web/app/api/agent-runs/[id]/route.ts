import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId } = await getMockSession();
    const { id } = await params;

    const run = await db.agentRun.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        status: true,
        triggerSource: true,
        attemptNumber: true,
        idempotencyKey: true,
        originalRunId: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        totalTokens: true,
        estimatedCostUsd: true,
        inputJson: true,
        outputJson: true,
        errorMessage: true,
        createdAt: true,
        agentJob: { select: { id: true, name: true, organizationId: true } },
        steps: {
          orderBy: { stepIndex: "asc" },
          select: {
            id: true,
            stepIndex: true,
            stepType: true,
            name: true,
            status: true,
            inputJson: true,
            outputJson: true,
            errorMessage: true,
            tokensUsed: true,
            estimatedCostUsd: true,
            startedAt: true,
            finishedAt: true,
          },
        },
        approvalRequests: {
          orderBy: { requestedAt: "asc" },
          select: {
            id: true,
            title: true,
            message: true,
            status: true,
            requestedBySystem: true,
            requestedAt: true,
            decidedAt: true,
            decisionReason: true,
            agentRunStepId: true,
            decidedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    return NextResponse.json({
      run: {
        ...run,
        estimatedCostUsd: run.estimatedCostUsd ? Number(run.estimatedCostUsd) : null,
        steps: run.steps.map((s) => ({
          ...s,
          estimatedCostUsd: s.estimatedCostUsd ? Number(s.estimatedCostUsd) : null,
        })),
      },
    });
  } catch (err) {
    console.error("[agent-runs/[id]]", err);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }
}
