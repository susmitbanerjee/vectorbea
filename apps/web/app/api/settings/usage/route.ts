import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import {
  getWorkspaceAuditVolume,
  getWorkspaceCapacity,
  getWorkspaceExecutionAccess,
  getWorkspacePolicy,
  getWorkspaceUsageCounters,
  type WorkspaceAuditVolume,
  type WorkspaceCapacity,
  type WorkspaceExecutionAccess,
  type WorkspacePolicy,
  type WorkspaceUsageCounters,
} from "@/lib/server/workspace-usage";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET /api/settings/usage

   THE LIMITS THAT ACTUALLY BIND, READ WHERE THEY ARE ENFORCED.

   This used to assemble a plan from a Supabase `organizations` row, meters from
   a Supabase `workspace_usage_monthly` table and an audit count from a Supabase
   `audit_logs` table. None of the three is provisioned in any environment —
   staging and production carry Supabase credentials for auth only, and
   `lib/auth/server.ts` describes the organisation model as removed — so the
   screen said "not provisioned" everywhere, while the real caps in
   `workspace_usage_policies` were live and refusing runs.

   Every source below is a table the runtime consults before it says no.

   FOUR INDEPENDENT SOURCES, REPORTED INDEPENDENTLY. Each settles on its own and
   reports either a value or why it is unavailable, so a workspace whose beta
   controls have not been created still sees its policy, its counters and its
   audit volume rather than one red box over the whole page. The response is
   always 200 when the caller is authorised: "we could not read one of four
   things" is a fact about the page, not a failure of the request. The only
   4xx/5xx left are the ones that really are about the request — no workspace,
   not a member, or the auth check itself failing.
══════════════════════════════════════════════════════════════════════════════ */

/** A value, or the reason it could not be read. Never a silent zero. */
export type SourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; code?: string };

export interface UsageResponse {
  policy: SourceResult<WorkspacePolicy>;
  usage: SourceResult<WorkspaceUsageCounters>;
  capacity: SourceResult<WorkspaceCapacity>;
  execution: SourceResult<WorkspaceExecutionAccess>;
  auditEvents: SourceResult<WorkspaceAuditVolume>;
}

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

    const [policy, usage, capacity, execution, auditEvents] = await Promise.all([
      settle(() => getWorkspacePolicy(workspaceId), "The workspace limits could not be read"),
      settle(() => getWorkspaceUsageCounters(workspaceId), "Usage counters could not be read"),
      settle(() => getWorkspaceCapacity(workspaceId), "Seats and workflows could not be counted"),
      settle(() => getWorkspaceExecutionAccess(workspaceId), "Execution access could not be read"),
      settle(() => getWorkspaceAuditVolume(workspaceId), "Audit events could not be counted"),
    ]);

    return NextResponse.json({
      policy,
      usage,
      capacity,
      execution,
      auditEvents,
    } satisfies UsageResponse);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load usage and limits");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
