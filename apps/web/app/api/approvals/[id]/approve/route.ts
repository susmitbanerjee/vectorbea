import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/approvals/:id/approve ────────────────────────────────────────
// Approves a pending approval request and resumes the agent run.
//
// Request body: { reason?: string }
//
// Behavior:
//   1. Guard: approval must be PENDING and belong to this org
//   2. Mark ApprovalRequest APPROVED (with decidedAt + decidedByUserId)
//   3. Mark AgentRun RUNNING
//   4. Write AuditLog
//   5. Call agent endpointUrl with resume payload (best-effort, outside transaction)

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    let reason: string | undefined;
    try {
      const body = (await request.json()) as { reason?: string };
      reason = typeof body.reason === "string" ? body.reason.trim() || undefined : undefined;
    } catch {
      // body is optional — ignore parse errors
    }

    // ── 1. Load approval (must be PENDING + org-scoped) ─────────────────────
    const approval = await db.approvalRequest.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        status: true,
        agentRunId: true,
        agentRun: {
          select: {
            id: true,
            status: true,
            agentJob: {
              select: {
                id: true,
                endpointUrl: true,
                httpMethod: true,
                headersJson: true,
              },
            },
          },
        },
      },
    });

    if (!approval) {
      return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
    }

    if (approval.status !== "PENDING") {
      return NextResponse.json(
        {
          error: "Approval already decided",
          detail: `This request was already ${approval.status.toLowerCase()}.`,
          currentStatus: approval.status,
        },
        { status: 409 },
      );
    }

    const now = new Date();

    // ── 2–4. Approve + resume run + audit log (atomic) ───────────────────────
    await db.$transaction([
      db.approvalRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          decidedAt: now,
          decidedByUserId: userId,
          decisionReason: reason ?? null,
        },
      }),
      db.agentRun.update({
        where: { id: approval.agentRunId },
        data: { status: "RUNNING" },
      }),
      db.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          entityType: "ApprovalRequest",
          entityId: id,
          action: "approval.approved",
          metadataJson: {
            agentRunId: approval.agentRunId,
            reason: reason ?? null,
          },
        },
      }),
    ]);

    // ── 5. Resume run — call endpoint (best-effort, outside transaction) ─────
    void resumeAgentRun(approval, id).catch((err: unknown) => {
      console.error("[approvals/approve] resume call failed:", err);
    });

    return NextResponse.json({
      id,
      status: "APPROVED",
      agentRunId: approval.agentRunId,
      resumed: true,
    });
  } catch (err) {
    console.error("[approvals/[id]/approve]", err);
    return NextResponse.json({ error: "Failed to approve request" }, { status: 500 });
  }
}

// ─── Resume helper ────────────────────────────────────────────────────────────

async function resumeAgentRun(
  approval: {
    id: string;
    agentRunId: string;
    agentRun: {
      id: string;
      agentJob: { id: string; endpointUrl: string; httpMethod: string; headersJson: unknown };
    };
  },
  approvalId: string,
) {
  const { agentRun } = approval;
  const { endpointUrl, httpMethod, headersJson } = agentRun.agentJob;

  // Parse any custom headers stored on the job
  let extraHeaders: Record<string, string> = {};
  if (headersJson && typeof headersJson === "object" && !Array.isArray(headersJson)) {
    extraHeaders = headersJson as Record<string, string>;
  }

  const payload = {
    agentRunId: agentRun.id,
    resumeFromApproval: true,
    approvalId,
    approvalDecision: "APPROVED",
  };

  const response = await fetch(endpointUrl, {
    method: httpMethod ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000), // 10 s timeout for the resume call
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(`Endpoint responded ${response.status}: ${text}`);
  }
}
