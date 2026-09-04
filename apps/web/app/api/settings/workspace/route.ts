import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertWorkspaceMember,
  requireWorkspaceRole,
} from "@/lib/server/assert-workspace-member";
import { recordAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { auditActor } from "@/lib/server/settings-auth";
import {
  deleteWorkspace,
  getWorkspaceFootprint,
  getWorkspaceIdentity,
  renameWorkspace,
  WORKSPACE_LIMITS,
} from "@/lib/server/workspace-settings";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET / PATCH / DELETE /api/settings/workspace

   RENAME NEEDS ADMIN. DELETE NEEDS OWNER. The gap is deliberate: renaming is
   cosmetic and reversible, deleting is neither, and giving both to the same
   role means the person who can fix a typo can also end the workspace.

   DELETE REQUIRES THE NAME TYPED BACK. Not as UI decoration — the route
   verifies it. A confirmation that a client can skip is not a confirmation,
   and this is the one call in the product with no undo.

   The audit row is written BEFORE the purge. `audit_log` survives the workspace
   by design (it refuses DELETE by trigger), but a row written afterwards would
   have nothing to prove the deletion was authorised if the purge itself failed
   halfway. Written first, it is the record of the attempt as well as the act.
══════════════════════════════════════════════════════════════════════════════ */

const PatchSchema = z
  .object({
    name: z.string().trim().min(1, "A workspace needs a name.").max(WORKSPACE_LIMITS.NAME_MAX).optional(),
    slug: z.string().trim().min(1).max(WORKSPACE_LIMITS.SLUG_MAX).optional(),
  })
  .refine((value) => value.name !== undefined || value.slug !== undefined, {
    message: "Send a name or a slug to change.",
  });

function workspaceIdFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("workspaceId")?.trim() || null;
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = workspaceIdFrom(request);
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const identity = await getWorkspaceIdentity(workspaceId);
    if (!identity) return NextResponse.json({ error: "That workspace no longer exists." }, { status: 404 });

    // The footprint is only meaningful to somebody who could act on it, and it
    // is several counting queries — so it is computed for owners only.
    const footprint =
      auth.user.role === "owner" ? await getWorkspaceFootprint(workspaceId).catch(() => null) : null;

    return NextResponse.json({ ...identity, yourRole: auth.user.role, footprint });
  } catch (error) {
    const safe = toSafeApiError(error, "The workspace could not be loaded");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const workspaceId = workspaceIdFrom(request);
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const denied = requireWorkspaceRole(
      auth.user.role,
      "admin",
      "Renaming this workspace needs the admin or owner role.",
    );
    if (denied) {
      const actor = auditActor(auth.user);
      void recordAuditEvent({
        workspaceId,
        action: AuditAction.SETTINGS_UPDATE,
        targetType: "workspace",
        targetId: workspaceId,
        result: "denied",
        ...actor,
        request,
      });
      return denied;
    }

    const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That change is not valid." },
        { status: 400 },
      );
    }

    const before = await getWorkspaceIdentity(workspaceId);
    const after = await renameWorkspace(workspaceId, parsed.data);

    void recordAuditEvent({
      workspaceId,
      action: AuditAction.SETTINGS_UPDATE,
      targetType: "workspace",
      targetId: workspaceId,
      before: before ? { name: before.name, slug: before.slug } : null,
      after: { name: after.name, slug: after.slug },
      ...auditActor(auth.user),
      request,
    });

    return NextResponse.json({ ...after, yourRole: auth.user.role });
  } catch (error) {
    if (error instanceof Error && /name|slug|taken|characters|exists/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const safe = toSafeApiError(error, "The workspace could not be saved");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const workspaceId = workspaceIdFrom(request);
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const actor = auditActor(auth.user);
    const denied = requireWorkspaceRole(
      auth.user.role,
      "owner",
      "Deleting a workspace needs the owner role.",
    );
    if (denied) {
      void recordAuditEvent({
        workspaceId,
        action: AuditAction.DATA_DELETE,
        targetType: "workspace",
        targetId: workspaceId,
        result: "denied",
        ...actor,
        request,
      });
      return denied;
    }

    const identity = await getWorkspaceIdentity(workspaceId);
    if (!identity) return NextResponse.json({ error: "That workspace no longer exists." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { confirmName?: string };
    if (body.confirmName?.trim() !== identity.name) {
      return NextResponse.json(
        {
          error: `Type the workspace name exactly — "${identity.name}" — to confirm.`,
          code: "confirmation_mismatch",
        },
        { status: 400 },
      );
    }

    const footprint = await getWorkspaceFootprint(workspaceId);

    // Written first, and awaited: this is the one row that must exist whether
    // or not the purge below completes.
    await recordAuditEvent({
      workspaceId,
      action: AuditAction.DATA_DELETE,
      targetType: "workspace",
      targetId: workspaceId,
      before: { name: identity.name, slug: identity.slug, rows: footprint.total },
      after: null,
      ...actor,
      request,
    });

    const result = await deleteWorkspace(workspaceId);
    return NextResponse.json({
      deleted: true,
      name: identity.name,
      rowsRemoved: result.deletedRows,
      tablesCleared: result.tablesCleared,
    });
  } catch (error) {
    if (error instanceof Error && /was not deleted/i.test(error.message)) {
      // The purge refused to commit an incomplete deletion. That is a 500 with
      // a truthful message, not a 400 the user can fix by retrying.
      return NextResponse.json({ error: error.message, code: "incomplete_purge" }, { status: 500 });
    }
    const safe = toSafeApiError(error, "The workspace could not be deleted");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
