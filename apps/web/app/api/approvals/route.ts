import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/approvals ──────────────────────────────────────────────────────
// Query params: status, agentJobId, agentRunId, page, pageSize

export async function GET(request: NextRequest) {
  try {
    const { organizationId } = await getMockSession();
    const sp = request.nextUrl.searchParams;

    const status = sp.get("status") ?? undefined;
    const agentJobId = sp.get("agentJobId") ?? undefined;
    const agentRunId = sp.get("agentRunId") ?? undefined;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10)));

    // Validate status if provided
    const validStatuses = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    const where = {
      organizationId,
      ...(status && { status: status as "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" }),
      ...(agentRunId && { agentRunId }),
      // Filter by agentJobId via the nested run relation
      ...(agentJobId && { agentRun: { agentJobId } }),
    };

    const [total, approvals] = await db.$transaction([
      db.approvalRequest.count({ where }),
      db.approvalRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          message: true,
          status: true,
          requestedBySystem: true,
          requestedAt: true,
          decidedAt: true,
          decisionReason: true,
          decidedByUserId: true,
          agentRunStepId: true,
          agentRun: {
            select: {
              id: true,
              status: true,
              triggerSource: true,
              agentJob: { select: { id: true, name: true } },
            },
          },
          decidedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
    ]);

    return NextResponse.json({
      approvals,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("[approvals GET]", err);
    return NextResponse.json({ error: "Failed to fetch approvals" }, { status: 500 });
  }
}
