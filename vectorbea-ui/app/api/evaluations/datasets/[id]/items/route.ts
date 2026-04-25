import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  addDatasetItems,
  deleteDatasetItem,
  getEvaluationDataset,
  listDatasetItems,
} from "@/lib/server/evaluation-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { EvaluationDatasetItemSourceType } from "@/lib/api";

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

    return NextResponse.json(await listDatasetItems(workspaceId, id));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load dataset items");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(
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
      return NextResponse.json({ error: "Cannot add items to a legacy baseline dataset. Convert it to an evaluation dataset first." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as {
      items?: Array<{
        sourceType?: string;
        input?: string;
        expectedOutput?: string;
        traceId?: string;
        metadata?: Record<string, unknown>;
        notes?: string;
        isGolden?: boolean;
      }>;
    };

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "items array is required" }, { status: 400 });
    }

    const ALLOWED_SOURCE_TYPES: EvaluationDatasetItemSourceType[] = [
      "manual", "runtime_trace", "golden_trace", "imported",
    ];

    const items = body.items.map((item) => ({
      sourceType: ALLOWED_SOURCE_TYPES.includes(item.sourceType as EvaluationDatasetItemSourceType)
        ? (item.sourceType as EvaluationDatasetItemSourceType)
        : "manual" as EvaluationDatasetItemSourceType,
      input: item.input ?? "",
      expectedOutput: item.expectedOutput ?? null,
      traceId: item.traceId ?? null,
      metadata: item.metadata ?? null,
      notes: item.notes ?? null,
      isGolden: item.isGolden ?? false,
    }));

    const added = await addDatasetItems({ workspaceId, datasetId: id, items });
    return NextResponse.json(added, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to add dataset items");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await params; // satisfy Next.js 15 requirement even though id unused here
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const itemId = request.nextUrl.searchParams.get("itemId")?.trim();
    if (!itemId) return NextResponse.json({ error: "itemId query param required" }, { status: 400 });

    await deleteDatasetItem(workspaceId, itemId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete dataset item");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
