import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";

/**
 * GET /api/platform/summary?workspaceId=<id>
 *
 * Returns lightweight counts for the platform dashboard overview.
 * Each query is individually guarded so the endpoint never returns 500
 * even if a table doesn't exist yet (e.g. migration not yet applied).
 */

async function safeCount(sql: Prisma.Sql): Promise<number> {
  try {
    const rows = await db.$queryRaw<{ count: string }[]>(sql);
    return parseInt(rows[0]?.count ?? "0", 10);
  } catch {
    return 0;
  }
}

async function safeSum(sql: Prisma.Sql): Promise<number> {
  try {
    const rows = await db.$queryRaw<{ total: string | null }[]>(sql);
    return parseFloat(rows[0]?.total ?? "0") || 0;
  } catch {
    return 0;
  }
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const [
    totalWorkflows,
    activeWorkflows,
    totalAgents,
    totalTools,
    totalRuns,
    runningRuns,
    waitingApprovals,
    failedRuns24h,
    succeededRuns24h,
    totalTokens24h,
    totalCostRaw24h,
  ] = await Promise.all([
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_workflows WHERE workspace_id = ${workspaceId}::uuid`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_workflows WHERE workspace_id = ${workspaceId}::uuid AND status = 'active'`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_agents WHERE workspace_id = ${workspaceId}::uuid`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_tools WHERE workspace_id = ${workspaceId}::uuid`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_runs WHERE workspace_id = ${workspaceId}::uuid`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_runs WHERE workspace_id = ${workspaceId}::uuid AND status = 'running'`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_runs WHERE workspace_id = ${workspaceId}::uuid AND status = 'waiting_for_approval'`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_runs WHERE workspace_id = ${workspaceId}::uuid AND status = 'failed' AND created_at > now() - interval '24 hours'`),
    safeCount(Prisma.sql`SELECT COUNT(*) as count FROM vectorbea.platform_runs WHERE workspace_id = ${workspaceId}::uuid AND status = 'succeeded' AND created_at > now() - interval '24 hours'`),
    safeSum(Prisma.sql`SELECT COALESCE(SUM(total_tokens), 0) as total FROM vectorbea.platform_runs WHERE workspace_id = ${workspaceId}::uuid AND created_at > now() - interval '24 hours'`),
    safeSum(Prisma.sql`SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM vectorbea.platform_runs WHERE workspace_id = ${workspaceId}::uuid AND created_at > now() - interval '24 hours'`),
  ]);

  return NextResponse.json({
    totalWorkflows,
    activeWorkflows,
    totalAgents,
    totalTools,
    totalRuns,
    runningRuns,
    waitingApprovals,
    failedRuns24h,
    succeededRuns24h,
    totalTokens24h,
    totalCost24h: totalCostRaw24h,
    connectedWorkers: 0, // future: query workers table
  });
}
