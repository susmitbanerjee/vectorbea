import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { evaluateAlerts } from "@/lib/server/alerts";

export const dynamic = "force-dynamic";

/**
 * POST /api/alerts/evaluate?workspaceId=...
 *
 * Evaluates all enabled alert rules for the workspace and persists any triggered events.
 *
 * IMPORTANT: This endpoint is intentionally callable by operations tooling
 * whenever alert rules should be evaluated immediately.
 * See docs/internal/alerting.md for invocation guidance.
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "alerts");
    const rate = consumeRateLimit(`alerts:evaluate:${workspaceId}:${auth.user.id}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for alert evaluations." }, { status: 429 });
    }
    const body = await request.json().catch(() => ({})) as { ruleIds?: string[] };
    const result = await evaluateAlerts(workspaceId, body.ruleIds);
    return NextResponse.json(result);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to evaluate alert rules");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

