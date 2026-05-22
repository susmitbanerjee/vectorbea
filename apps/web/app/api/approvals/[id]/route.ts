import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── GET /api/approvals/:id ──────────────────────────────────────────────────
// Returns full approval detail: request + run + job + step (if any)

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId } = await getMockSession();
    const { id } = await params;

    const approval = await db.approvalRequest.findFirst({
      where: { id, organizationId },
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
        agentRun: {
          select: {
            id: true,
            status: true,
            triggerSource: true,
            attemptNumber: true,
            startedAt: true,
            finishedAt: true,
            durationMs: true,
            errorMessage: true,
            createdAt: true,
            agentJob: {
              select: {
                id: true,
                name: true,
                description: true,
                endpointUrl: true,
                httpMethod: true,
                requireApprovalBeforeExternalAction: true,
              },
            },
          },
        },
        agentRunStep: {
          select: {
            id: true,
            stepIndex: true,
            stepType: true,
            name: true,
            status: true,
            inputJson: true,
            errorMessage: true,
          },
        },
        decidedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!approval) {
      return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
    }

    return NextResponse.json({ approval });
  } catch (err) {
    console.error("[approvals/[id] GET]", err);
    return NextResponse.json({ error: "Failed to fetch approval" }, { status: 500 });
  }
}
