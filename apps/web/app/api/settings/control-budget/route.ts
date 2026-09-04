import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertWorkspaceMember,
  requireWorkspaceRole,
} from "@/lib/server/assert-workspace-member";
import {
  getWorkspaceControlBudget,
  saveWorkspaceControlBudget,
} from "@/lib/server/control-budget";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

const BudgetSchema = z.object({
  reliabilityTarget: z.number().min(0.9).max(0.99999).nullable(),
  dailySpendLimitUsd: z.number().positive().max(10_000_000).nullable(),
  approvalSlaMinutes: z.number().int().min(5).max(10_080).nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    return NextResponse.json(await getWorkspaceControlBudget(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load operational budget");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const forbidden = requireWorkspaceRole(
      auth.user.role,
      "admin",
      "Only workspace admins can change operational budgets.",
    );
    if (forbidden) return forbidden;
    const parsed = BudgetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Budget values are outside the supported range.", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json(await saveWorkspaceControlBudget({ workspaceId, ...parsed.data }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to save operational budget");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
