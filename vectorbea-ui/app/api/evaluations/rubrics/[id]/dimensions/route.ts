import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import {
  getRubricWithDetails,
  listDimensions,
  createDimension,
  validateDimensionWeights,
} from "@/lib/server/rubrics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rubricId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const rubric = await getRubricWithDetails(rubricId);
    if (!rubric || rubric.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Rubric not found" }, { status: 404 });
    }
    if (rubric.isLocked) {
      return NextResponse.json(
        { error: "Rubric is locked. Enterprise admin must unlock before editing dimensions." },
        { status: 403 },
      );
    }

    return NextResponse.json(await listDimensions(rubricId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load dimensions");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rubricId } = await params;
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
      scaleMin?: number;
      scaleMax?: number;
      passThreshold?: number;
      ord?: number;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (body.weight === undefined || body.weight < 0 || body.weight > 100) {
      return NextResponse.json({ error: "weight must be 0-100" }, { status: 400 });
    }

    // Warn if new total would exceed 100 but do not hard-block (UI handles this)
    const existingDims = rubric.dimensions ?? [];
    const newTotal = existingDims.reduce((s, d) => s + d.weight, 0) + body.weight;
    const weightWarning = newTotal > 100
      ? `Total dimension weight will be ${newTotal} (exceeds 100)`
      : null;

    const dimension = await createDimension({
      rubricId,
      name: body.name,
      description: body.description,
      weight: body.weight,
      scaleMin: body.scaleMin,
      scaleMax: body.scaleMax,
      passThreshold: body.passThreshold,
      ord: body.ord ?? existingDims.length,
    });

    return NextResponse.json({ ...dimension, weightWarning }, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create dimension");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
