import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import {
  getBehavioralDataset,
  updateBehavioralItem,
  deleteBehavioralItem,
} from "@/lib/server/behavioral-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { RiskLevel } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id: datasetId, itemId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const dataset = await getBehavioralDataset(workspaceId, datasetId);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const body = await request.json().catch(() => ({})) as {
      input?: string;
      context?: string | null;
      tags?: string[];
      riskLevel?: RiskLevel;
      referenceOutput?: string | null;
      metadata?: Record<string, unknown> | null;
    };

    const item = await updateBehavioralItem(itemId, body);
    return NextResponse.json(item);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update dataset item");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id: datasetId, itemId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const dataset = await getBehavioralDataset(workspaceId, datasetId);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    await deleteBehavioralItem(itemId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete dataset item");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
