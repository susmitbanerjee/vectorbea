import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import {
  listRubricsForDataset,
  createRubric,
} from "@/lib/server/rubrics";
import { getBehavioralDataset } from "@/lib/server/behavioral-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { BehavioralPromptType } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    const datasetId = request.nextUrl.searchParams.get("datasetId")?.trim();
    if (!workspaceId || !datasetId) {
      return NextResponse.json({ error: "workspaceId and datasetId required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");
    return NextResponse.json(await listRubricsForDataset(datasetId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load rubrics");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const body = await request.json().catch(() => ({})) as {
      datasetId?: string;
      name?: string;
      promptType?: BehavioralPromptType;
      goal?: string | null;
      passThreshold?: number;
      judgeModel?: string | null;
      judgeProvider?: string | null;
    };

    if (!body.datasetId?.trim()) {
      return NextResponse.json({ error: "datasetId is required" }, { status: 400 });
    }
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Verify dataset belongs to workspace
    const dataset = await getBehavioralDataset(workspaceId, body.datasetId);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    if (body.passThreshold !== undefined &&
        (body.passThreshold < 0 || body.passThreshold > 100)) {
      return NextResponse.json({ error: "passThreshold must be 0-100" }, { status: 400 });
    }

    const rubric = await createRubric({
      workspaceId,
      datasetId: body.datasetId,
      promptId: dataset.promptId,
      name: body.name,
      promptType: body.promptType,
      goal: body.goal,
      passThreshold: body.passThreshold,
      judgeModel: body.judgeModel,
      judgeProvider: body.judgeProvider,
      createdBy: auth.user.id,
    });

    return NextResponse.json(rubric, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create rubric");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
