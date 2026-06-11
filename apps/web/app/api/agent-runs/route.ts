import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { organizationId } = await getMockSession();
    const sp = request.nextUrl.searchParams;
    const agentJobId = sp.get("agentJobId") ?? undefined;
    const status = sp.get("status") ?? undefined;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10)));

    const where = {
      organizationId,
      ...(agentJobId && { agentJobId }),
      ...(status && { status: status as never }),
    };

    const [total, runs] = await db.$transaction([
      db.agentRun.count({ where }),
      db.agentRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          triggerSource: true,
          attemptNumber: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          estimatedCostUsd: true,
          totalTokens: true,
          errorMessage: true,
          createdAt: true,
          agentJob: { select: { id: true, name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      runs: runs.map((r) => ({ ...r, estimatedCostUsd: r.estimatedCostUsd ? Number(r.estimatedCostUsd) : null })),
      pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error("[agent-runs]", err);
    return NextResponse.json({ error: "Failed to list runs" }, { status: 500 });
  }
}
