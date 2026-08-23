import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getWorkspaceUsage } from "@/lib/server/usage-quotas";
import { getWorkspacePlanLimits, getWorkspaceMonthlyAuditCount, getWorkspaceMemberCount } from "@/lib/server/workspace-limits";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET /api/settings/usage

   FOUR INDEPENDENT SOURCES, REPORTED INDEPENDENTLY.

   This was a `Promise.all` over the quota ledger, the plan, the audit count and
   the seat count, wrapped in one try/catch. Any one of them failing took the
   whole response to 503 — so a workspace missing only `vectorbea.audit_logs`
   showed "required database migrations are missing" on a page where the plan,
   every usage meter and the seat count were perfectly readable. One absent
   table blanked a screen that was three-quarters working.

   Each source now settles on its own and reports either a value or why it is
   unavailable. The response is always 200 when the caller is authorised,
   because "we could not read one of four things" is a fact about the page, not
   a failure of the request — and the screen can then show what it has and name
   what it cannot. The only 4xx/5xx left are the ones that really are about the
   request: no workspace, not a member, or the auth check itself failing.
══════════════════════════════════════════════════════════════════════════════ */

/** A value, or the reason it could not be read. Never a silent zero. */
export type SourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; code?: string };

async function settle<T>(load: () => Promise<T>, fallbackMessage: string): Promise<SourceResult<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    const safe = toSafeApiError(error, fallbackMessage);
    return { ok: false, reason: safe.message, code: safe.code };
  }
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const [snapshot, plan, auditEvents, members] = await Promise.all([
      settle(() => getWorkspaceUsage(workspaceId), "Usage meters could not be read"),
      settle(() => getWorkspacePlanLimits(workspaceId), "The plan could not be read"),
      settle(() => getWorkspaceMonthlyAuditCount(workspaceId), "Audit events could not be counted"),
      settle(() => getWorkspaceMemberCount(workspaceId), "Seats could not be counted"),
    ]);

    return NextResponse.json({
      meters: snapshot,
      plan,
      // Composed rather than nested so the screen does not have to know that a
      // seat count and its limit come from two different systems.
      seats: members.ok && plan.ok
        ? { ok: true as const, value: { used: members.value, limit: plan.value.maxSeats } }
        : members.ok
          ? { ok: false as const, reason: plan.ok ? "" : plan.reason, code: plan.ok ? undefined : plan.code }
          : { ok: false as const, reason: members.reason, code: members.code },
      auditEvents: auditEvents.ok && plan.ok
        ? { ok: true as const, value: { used: auditEvents.value, limit: plan.value.monthlyAuditLimit } }
        : auditEvents.ok
          ? { ok: false as const, reason: plan.ok ? "" : plan.reason, code: plan.ok ? undefined : plan.code }
          : { ok: false as const, reason: auditEvents.reason, code: auditEvents.code },
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load usage and limits");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
