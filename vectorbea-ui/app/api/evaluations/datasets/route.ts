import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  createEvaluationDataset,
  listEvaluationDatasets,
} from "@/lib/server/evaluation-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { EvaluationDatasetType } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    return NextResponse.json(await listEvaluationDatasets(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load evaluation datasets");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({})) as {
      name?: string;
      description?: string;
      datasetType?: EvaluationDatasetType;
      promptName?: string;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const ALLOWED_TYPES: EvaluationDatasetType[] = ["manual", "imported", "runtime", "golden", "mixed"];
    const datasetType: EvaluationDatasetType = ALLOWED_TYPES.includes(body.datasetType as EvaluationDatasetType)
      ? (body.datasetType as EvaluationDatasetType)
      : "manual";

    const dataset = await createEvaluationDataset({
      workspaceId,
      name: body.name,
      description: body.description,
      datasetType,
      promptName: body.promptName,
      createdBy: auth.user.id,
    });

    return NextResponse.json(dataset, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create evaluation dataset");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
