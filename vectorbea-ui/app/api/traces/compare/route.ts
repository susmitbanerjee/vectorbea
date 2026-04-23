import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { buildTraceComparison } from "@/lib/server/trace-compare";
import { isRuntimeTraceRow, mapAuditRowToTraceDetail, type AuditLogTraceRow } from "@/lib/server/traces";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

async function loadTraceRow(workspaceId: string, traceId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select(
      "id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", traceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as AuditLogTraceRow;
  return isRuntimeTraceRow(row) ? mapAuditRowToTraceDetail(row) : null;
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    const leftId = request.nextUrl.searchParams.get("left")?.trim();
    const rightId = request.nextUrl.searchParams.get("right")?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    if (!leftId || !rightId) {
      return NextResponse.json({ error: "left and right trace ids are required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const [left, right] = await Promise.all([
      loadTraceRow(workspaceId, leftId),
      loadTraceRow(workspaceId, rightId),
    ]);

    if (!left || !right) {
      return NextResponse.json({ error: "One or both traces were not found" }, { status: 404 });
    }

    return NextResponse.json(buildTraceComparison(left, right));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to compare traces" },
      { status: 500 },
    );
  }
}
