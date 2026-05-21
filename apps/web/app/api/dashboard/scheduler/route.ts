import { NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { organizationId } = await getMockSession();

    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [activeJobs, runsToday, failedToday, waitingApprovals, succeededToday] =
      await db.$transaction([
        db.agentJob.count({ where: { organizationId, status: "ACTIVE" } }),
        db.agentRun.count({ where: { organizationId, createdAt: { gte: dayStart } } }),
        db.agentRun.count({
          where: { organizationId, createdAt: { gte: dayStart }, status: { in: ["FAILED", "TIMEOUT"] } },
        }),
        db.agentRun.count({ where: { organizationId, status: "WAITING_FOR_APPROVAL" } }),
        db.agentRun.count({
          where: { organizationId, createdAt: { gte: dayStart }, status: "SUCCEEDED" },
        }),
      ]);

    const costAgg = await db.agentRun.aggregate({
      where: { organizationId, createdAt: { gte: dayStart } },
      _sum: { estimatedCostUsd: true },
    });

    const recentRuns = await db.agentRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        triggerSource: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        estimatedCostUsd: true,
        errorMessage: true,
        createdAt: true,
        agentJob: { select: { id: true, name: true } },
      },
    });

    const totalCompleted = succeededToday + failedToday;
    const successRate = totalCompleted > 0 ? Math.round((succeededToday / totalCompleted) * 100) : null;

    return NextResponse.json({
      activeJobs,
      runsToday,
      failedRuns: failedToday,
      waitingApprovals,
      estimatedCostToday: Number(costAgg._sum.estimatedCostUsd ?? 0),
      successRate,
      recentRuns: recentRuns.map((r) => ({
        ...r,
        estimatedCostUsd: r.estimatedCostUsd ? Number(r.estimatedCostUsd) : null,
      })),
    });
  } catch (err) {
    console.error("[dashboard/scheduler]", err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
