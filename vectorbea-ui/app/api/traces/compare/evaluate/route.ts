import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { buildTraceComparison, evaluateTraceReplay, toMetadataEvaluation } from "@/lib/server/trace-compare";
import { isRuntimeTraceRow, mapAuditRowToTraceDetail, type AuditLogTraceRow } from "@/lib/server/traces";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

export const dynamic = "force-dynamic";

async function loadRawTrace(workspaceId: string, traceId: string) {
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
  return (data ?? null) as AuditLogTraceRow | null;
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "evaluations");
    const rate = consumeRateLimit(`traces:compare-evaluate:${workspaceId}:${auth.user.id}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for compare evaluation." }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      leftTraceId?: string;
      rightTraceId?: string;
    };
    const leftTraceId = body.leftTraceId?.trim();
    const rightTraceId = body.rightTraceId?.trim();

    if (!leftTraceId || !rightTraceId) {
      return NextResponse.json({ error: "leftTraceId and rightTraceId are required" }, { status: 400 });
    }

    const [leftRow, rightRow] = await Promise.all([
      loadRawTrace(workspaceId, leftTraceId),
      loadRawTrace(workspaceId, rightTraceId),
    ]);

    if (!leftRow || !rightRow) {
      return NextResponse.json({ error: "One or both traces were not found" }, { status: 404 });
    }
    if (!isRuntimeTraceRow(leftRow) || !isRuntimeTraceRow(rightRow)) {
      return NextResponse.json({ error: "Evaluation can only run on runtime execution traces." }, { status: 422 });
    }

    const left = mapAuditRowToTraceDetail(leftRow);
    const right = mapAuditRowToTraceDetail(rightRow);
    const evaluation = {
      ...evaluateTraceReplay(left, right),
      runId: randomUUID(),
    };

    const rightMetadata = normalizeTraceMetadataV1(rightRow.metadata ?? {});
    const nextMetadata = {
      ...rightMetadata,
      evaluation: toMetadataEvaluation(evaluation),
      tags: {
        ...(rightMetadata.tags ?? {}),
        ...(rightRow.id && leftRow.id ? { replay_of: right.replayOf ?? leftRow.id } : {}),
      },
      custom: {
        ...(rightMetadata.custom ?? {}),
        replay: {
          ...((rightMetadata.custom?.replay && typeof rightMetadata.custom.replay === "object")
            ? (rightMetadata.custom.replay as Record<string, unknown>)
            : {}),
          source_trace_id: leftRow.id,
        },
      },
    };

    const supabase = createVectorBeaAdminClient();
    const { data: updated, error: updateError } = await supabase
      .from("audit_logs")
      .update({ metadata: nextMetadata })
      .eq("workspace_id", workspaceId)
      .eq("id", rightRow.id)
      .select(
        "id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at",
      )
      .single();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json(buildTraceComparison(left, mapAuditRowToTraceDetail(updated as AuditLogTraceRow)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to evaluate trace replay" },
      { status: 500 },
    );
  }
}
