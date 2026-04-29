import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { getRubricWithDetails, updateDimension, deleteDimension } from "@/lib/server/rubrics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dimId: string }> },
) {
  try {
    const { id: rubricId, dimId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const rubric = await getRubricWithDetails(rubricId);
    if (!rubric || rubric.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Rubric not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as {
      name?: string;
      description?: string | null;
      weight?: number;
      passThreshold?: number;
      ord?: number;
    };

    if (body.weight !== undefined && (body.weight < 0 || body.weight > 100)) {
      return NextResponse.json({ error: "weight must be 0-100" }, { status: 400 });
    }

    const dim = await updateDimension(dimId, body);
    return NextResponse.json(dim);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update dimension");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dimId: string }> },
) {
  try {
    const { id: rubricId, dimId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const rubric = await getRubricWithDetails(rubricId);
    if (!rubric || rubric.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Rubric not found" }, { status: 404 });
    }

    await deleteDimension(dimId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete dimension");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
