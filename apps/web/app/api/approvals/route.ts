import { NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { organizationId } = await getMockSession();

    const approvals = await db.approvalRequest.findMany({
      where: { organizationId, status: "PENDING" },
      orderBy: { requestedAt: "asc" },
      select: {
        id: true,
        title: true,
        message: true,
        requestedAt: true,
        status: true,
        agentRun: {
          select: {
            id: true,
            status: true,
            agentJob: { select: { id: true, name: true } },
          },
        },
      },
    });

    return NextResponse.json({ approvals });
  } catch (err) {
    console.error("[approvals]", err);
    return NextResponse.json({ error: "Failed to fetch approvals" }, { status: 500 });
  }
}
