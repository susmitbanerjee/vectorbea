import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  deleteEvaluationDataset,
  getEvaluationDataset,
  listDatasetItems,
} from "@/lib/server/evaluation-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

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

    const dataset = await getEvaluationDataset(workspaceId, id);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    // Optionally include items if ?includeItems=1
    if (request.nextUrl.searchParams.get("includeItems") === "1") {
      const items = await listDatasetItems(workspaceId, id);
      return NextResponse.json({ ...dataset, items });
    }

    return NextResponse.json(dataset);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load evaluation dataset");
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

    const dataset = await getEvaluationDataset(workspaceId, id);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    if (dataset.origin === "baseline") {
      // Delegate deletion to baseline_datasets table
      const { createVectorBeaAdminClient } = await import("@/lib/supabase-admin");
      const supabase = createVectorBeaAdminClient();
      const { error } = await supabase
        .from("baseline_datasets")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      await deleteEvaluationDataset(workspaceId, id);
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete evaluation dataset");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
