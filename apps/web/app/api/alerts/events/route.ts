import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { listAlertEvents, listAlertRules } from "@/lib/server/alerts";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "alerts");
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "100", 10);
    const [events, rules] = await Promise.all([
      listAlertEvents(workspaceId, isNaN(limit) ? 100 : limit),
      listAlertRules(workspaceId),
    ]);
    const ruleNameById = new Map(rules.map((rule) => [rule.id, rule.name]));
    return NextResponse.json(
      events.map((event) => ({
        ...event,
        ruleName: ruleNameById.get(event.ruleId) ?? null,
      })),
    );
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load alert events");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
