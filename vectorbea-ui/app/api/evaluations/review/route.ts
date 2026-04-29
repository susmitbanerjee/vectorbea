import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { listReviewQueue, updateReviewItem } from "@/lib/server/provider-arena-governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

function toReviewView(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    workspaceId: String(row.workspace_id ?? ""),
    evaluationRunId: String(row.evaluation_run_id ?? ""),
    datasetItemId: row.dataset_item_id ? String(row.dataset_item_id) : null,
    evaluationExecutionId: row.evaluation_execution_id ? String(row.evaluation_execution_id) : null,
    pairwiseComparisonId: row.pairwise_comparison_id ? String(row.pairwise_comparison_id) : null,
    status: String(row.status ?? "open"),
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    reason: String(row.reason ?? ""),
    severity: String(row.severity ?? "medium"),
    reviewerDecision: row.reviewer_decision ? String(row.reviewer_decision) : null,
    reviewerNotes: row.reviewer_notes ? String(row.reviewer_notes) : null,
    createdAt: String(row.created_at ?? ""),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "human_review_queue");
    const status = request.nextUrl.searchParams.get("status")?.trim() ?? null;
    const runId = request.nextUrl.searchParams.get("runId")?.trim() ?? null;
    const severity = request.nextUrl.searchParams.get("severity")?.trim() ?? null;
    const rows = await listReviewQueue(workspaceId);
    const filtered = rows.filter((row) => {
      if (status && String(row.status) !== status) return false;
      if (runId && String(row.evaluation_run_id) !== runId) return false;
      if (severity && String(row.severity) !== severity) return false;
      return true;
    });
    return NextResponse.json(filtered.map((row) => toReviewView(row as Record<string, unknown>)));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load review queue");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "human_review_queue");

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      status?: "open" | "in_review" | "resolved" | "dismissed";
      assignedTo?: string | null;
      reviewerDecision?: string | null;
      reviewerNotes?: string | null;
    };
    if (!body.id?.trim()) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const updated = await updateReviewItem({
      workspaceId,
      id: body.id.trim(),
      status: body.status,
      assignedTo: body.assignedTo,
      reviewerDecision: body.reviewerDecision,
      reviewerNotes: body.reviewerNotes,
    });
    return NextResponse.json(toReviewView(updated as Record<string, unknown>));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update review item");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
