import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";
import { checkRunUsageWithinBudget } from "@/server/services/budget-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/agent-runs/:id/report-usage ───────────────────────────────────
//
// Called by the agent worker once a run finishes to record token/cost usage
// and check per-run budget limits.
//
// Request body:
//   {
//     totalTokens?: number          (integer, nullable)
//     estimatedCostUsd?: number     (decimal, nullable)
//     status?: "SUCCEEDED" | "FAILED" | "TIMEOUT"
//     errorMessage?: string
//   }
//
// Behavior:
//   1. Write usage to the run row (totalTokens, estimatedCostUsd, status, durationMs)
//   2. Run per-run budget check (tokens + cost)
//   3. If over budget, override status → FAILED with budget error message
//   4. Return updated run status + any budget violation

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    let body: {
      totalTokens?: number | null;
      estimatedCostUsd?: number | null;
      status?: "SUCCEEDED" | "FAILED" | "TIMEOUT";
      errorMessage?: string | null;
      durationMs?: number | null;
    };

    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // ── 1. Find the run ──────────────────────────────────────────────────────
    const run = await db.agentRun.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true, startedAt: true },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const cancellableStatuses = ["CANCELLED", "FAILED", "SUCCEEDED", "TIMEOUT"];
    if (cancellableStatuses.includes(run.status)) {
      return NextResponse.json(
        { error: "Run already in a terminal state", currentStatus: run.status },
        { status: 409 },
      );
    }

    const now = new Date();
    const durationMs =
      body.durationMs ??
      (run.startedAt ? now.getTime() - new Date(run.startedAt).getTime() : null);

    // ── 2. Persist usage regardless of budget outcome ────────────────────────
    await db.agentRun.update({
      where: { id },
      data: {
        totalTokens: body.totalTokens ?? undefined,
        estimatedCostUsd: body.estimatedCostUsd ?? undefined,
        status: body.status ?? "SUCCEEDED",
        finishedAt: now,
        durationMs: durationMs ?? undefined,
        errorMessage: body.errorMessage ?? null,
      },
    });

    // ── 3. Per-run budget check ──────────────────────────────────────────────
    const violation = await checkRunUsageWithinBudget(id, organizationId, userId);

    if (violation) {
      // Override to FAILED with budget error message
      await db.agentRun.update({
        where: { id },
        data: {
          status: "FAILED",
          errorMessage: violation.message,
        },
      });

      return NextResponse.json({
        id,
        status: "FAILED",
        budgetViolation: {
          field: violation.field,
          limit: violation.limit,
          actual: violation.actual,
          message: violation.message,
        },
      });
    }

    return NextResponse.json({
      id,
      status: body.status ?? "SUCCEEDED",
      budgetViolation: null,
    });
  } catch (err) {
    console.error("[agent-runs/report-usage]", err);
    return NextResponse.json({ error: "Failed to report usage" }, { status: 500 });
  }
}
