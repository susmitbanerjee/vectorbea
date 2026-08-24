import { NextRequest, NextResponse } from "next/server";

import { appQuery } from "@/lib/server/app-db";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { requireAuthenticatedUser } from "@/lib/server/settings-auth";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET /api/workspaces/member-counts

   The workspace switcher renders "{n} members" under every workspace, and n was
   always 0: the count comes from `Workspace.members`, which only the mock
   transport ever populates. `/api/me` — the Kotlin route the switcher actually
   resolves scope from — returns `{ id, name, slug, role }` and no count, so
   `w.members ?? 0` rendered a confident zero next to a workspace with people in
   it. A number that is always wrong is worse than no number, because nobody can
   tell it apart from a real one.

   SCOPED TO THE CALLER'S OWN MEMBERSHIPS. Counting members of a workspace is a
   fact about that workspace, so it is only returned for workspaces the caller
   is an active member of — the join below is the authorisation, not a filter
   applied afterwards, so there is no shape of request that leaks another
   tenant's headcount.
══════════════════════════════════════════════════════════════════════════════ */

export interface MemberCounts {
  /** Workspace id → active member count. */
  counts: Record<string, number>;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.error) {
      // The switcher must not break when there is no session — it renders for
      // signed-out and mock-session shells too. An empty map means "no counts
      // to show", which the client treats as "say nothing" rather than "zero".
      return NextResponse.json({ counts: {} } satisfies MemberCounts);
    }

    const rows = await appQuery<{ workspace_id: string; members: string }>(
      `SELECT m.workspace_id, count(*) AS members
         FROM workspace_members m
        WHERE m.status = 'active'
          AND m.workspace_id IN (
            SELECT mine.workspace_id FROM workspace_members mine
             WHERE mine.user_id = $1::uuid AND mine.status = 'active')
        GROUP BY m.workspace_id`,
      [auth.user.id],
    );

    const counts: Record<string, number> = {};
    for (const row of rows) {
      const value = Number(row.members);
      if (Number.isFinite(value)) counts[row.workspace_id] = value;
    }

    return NextResponse.json({ counts } satisfies MemberCounts);
  } catch (error) {
    const safe = toSafeApiError(error, "Member counts could not be read");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
