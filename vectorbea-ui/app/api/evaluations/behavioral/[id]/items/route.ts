import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import {
  getBehavioralDataset,
  listBehavioralItems,
  createBehavioralItem,
  bulkCreateBehavioralItems,
} from "@/lib/server/behavioral-datasets";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { RiskLevel } from "@/lib/api";

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

    // Verify dataset belongs to workspace
    const dataset = await getBehavioralDataset(workspaceId, id);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    return NextResponse.json(await listBehavioralItems(id));
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
    const { id: datasetId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const dataset = await getBehavioralDataset(workspaceId, datasetId);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const body = await request.json().catch(() => ({})) as {
      // Single item
      input?: string;
      context?: string | null;
      tags?: string[];
      riskLevel?: RiskLevel;
      referenceOutput?: string | null;
      sourceTraceId?: string | null;
      // Bulk
      items?: Array<{
        input: string;
        context?: string | null;
        tags?: string[];
        riskLevel?: RiskLevel;
        referenceOutput?: string | null;
      }>;
    };

    // Bulk import
    if (Array.isArray(body.items)) {
      const valid = body.items.filter((i) => i.input?.trim());
      if (valid.length === 0) {
        return NextResponse.json({ error: "No valid items to import" }, { status: 400 });
      }
      const count = await bulkCreateBehavioralItems(datasetId, valid);
      return NextResponse.json({ inserted: count }, { status: 201 });
    }

    // Single item
    if (!body.input?.trim()) {
      return NextResponse.json({ error: "input is required" }, { status: 400 });
    }
    const item = await createBehavioralItem({
      datasetId,
      input: body.input,
      context: body.context,
      tags: body.tags,
      riskLevel: body.riskLevel,
      referenceOutput: body.referenceOutput,
      sourceTraceId: body.sourceTraceId,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create dataset item");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
