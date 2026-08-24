import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertWorkspaceMember,
  requireWorkspaceRole,
} from "@/lib/server/assert-workspace-member";
import {
  createAccessRequest,
  listAccessRequests,
  REASON_MAX,
} from "@/lib/server/access-requests";
import { recordAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { auditActor } from "@/lib/server/settings-auth";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET / POST /api/settings/access-requests

   The two limits a workspace owner cannot lift themselves — real execution and
   usage capacity — are set by Vectorbea, not by the tenant. This is the record
   of asking, backed by `usage_limit_requests` (V015), so a request is a row a
   reviewer can find rather than an email somebody remembers receiving.

   READING IS FOR ANY MEMBER; ASKING NEEDS ADMIN. A viewer should be able to see
   that capacity has already been requested — otherwise three people file the
   same request — but the ask itself commits the workspace to a change in what
   it may do, and that is an admin decision.
══════════════════════════════════════════════════════════════════════════════ */

const BodySchema = z.object({
  kind: z.enum(["real_execution", "capacity", "seats"]),
  changes: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  reason: z.string().max(REASON_MAX).nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    return NextResponse.json({
      requests: await listAccessRequests(workspaceId),
      yourRole: auth.user.role,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Requests could not be loaded");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const denied = requireWorkspaceRole(
      auth.user.role,
      "admin",
      "Requesting a change to this workspace's limits needs the admin or owner role.",
    );
    if (denied) return denied;

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That request is not valid." },
        { status: 400 },
      );
    }

    const actor = auditActor(auth.user);
    const created = await createAccessRequest({
      workspaceId,
      // The dev bypass has no real user id; the request is still recorded, with
      // a null requester, rather than being refused on a laptop.
      userId: actor.actorId,
      kind: parsed.data.kind,
      changes: parsed.data.changes,
      reason: parsed.data.reason ?? null,
    });

    void recordAuditEvent({
      workspaceId,
      action: AuditAction.LIMIT_REQUEST,
      targetType: "workspace",
      targetId: workspaceId,
      after: { kind: created.kind, changes: created.changes },
      ...actor,
      request,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /already|context|characters|Tell us/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const safe = toSafeApiError(error, "The request could not be recorded");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
