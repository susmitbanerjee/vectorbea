import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import {
  getRubricWithDetails,
  updateRubric,
  deleteRubric,
} from "@/lib/server/rubrics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { BehavioralPromptType } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const rubric = await getRubricWithDetails(id);
    if (!rubric || rubric.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rubric);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to get rubric");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    // Ownership check
    const existing = await getRubricWithDetails(id);
    if (!existing || existing.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as {
      name?: string;
      promptType?: BehavioralPromptType;
      goal?: string | null;
      passThreshold?: number;
      judgeModel?: string | null;
      judgeProvider?: string | null;
      isLocked?: boolean;
    };

    if (existing.isLocked && body.isLocked === undefined) {
      return NextResponse.json(
        { error: "Rubric is locked. Enterprise admin must unlock before editing." },
        { status: 403 },
      );
    }
    if (body.isLocked !== undefined) {
      await assertFeatureAccess(workspaceId, "enterprise_rubric_locking");
    }

    if (body.passThreshold !== undefined &&
        (body.passThreshold < 0 || body.passThreshold > 100)) {
      return NextResponse.json({ error: "passThreshold must be 0-100" }, { status: 400 });
    }

    const updated = await updateRubric(id, body);
    return NextResponse.json(updated);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update rubric");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const existing = await getRubricWithDetails(id);
    if (!existing || existing.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing.isLocked) {
      return NextResponse.json(
        { error: "Rubric is locked. Enterprise admin must unlock before deleting." },
        { status: 403 },
      );
    }

    await deleteRubric(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete rubric");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
