import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { resolveAuditLlmLatencyMs, resolveAuditProxyLatencyMs } from "@/lib/server/audit-latency";
import { buildTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceMonthlyAuditCount,
  getWorkspacePlanLimits,
} from "@/lib/server/workspace-limits";

export const dynamic = "force-dynamic";

type AuditEntry = {
  promptVersionId?: string;
  proxyLatencyMs?: number;
  llmLatencyMs?: number;
  tokenCount?: number;
  promptName?: string;
  versionTag?: string;
  metadata?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required." },
        { status: 400 },
      );
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const planLimits = await getWorkspacePlanLimits(workspaceId);
    const auditCount = await getWorkspaceMonthlyAuditCount(workspaceId);
    const auditLimit = Math.max(planLimits.monthlyAuditLimit ?? 100, 100);

    if (planLimits.planTier === "free" && auditCount >= auditLimit) {
      return NextResponse.json(
        {
          error: `Free plan monthly audit limit reached (${auditLimit} events). Please upgrade to Plus or Pro.`,
        },
        { status: 429 },
      );
    }

    const payload = (await request.json()) as AuditEntry[];
    const entries = Array.isArray(payload) ? payload : [payload];

    const supabase = createVectorBeaAdminClient();

    const rows = entries.map((e) => {
      const metadata = buildTraceMetadataV1({
        metadata: e.metadata ?? {},
        useType: "runtime",
        workspaceId,
        promptVersionId: e.promptVersionId ?? null,
        promptName: e.promptName ?? "",
        versionTag: e.versionTag ?? "",
        proxyLatencyMs: e.proxyLatencyMs ?? 0,
        llmLatencyMs: e.llmLatencyMs ?? 0,
        tokenCount: e.tokenCount ?? 0,
      });
      const proxyLatencyMs = resolveAuditProxyLatencyMs(e.proxyLatencyMs, metadata);
      const llmLatencyMs = resolveAuditLlmLatencyMs(e.llmLatencyMs, metadata);
      return {
        workspace_id: workspaceId,
        prompt_version_id: e.promptVersionId ?? null,
        proxy_latency_ms: proxyLatencyMs,
        llm_latency_ms: llmLatencyMs,
        token_count: e.tokenCount ?? 0,
        prompt_name: e.promptName || metadata.prompt?.name || "",
        version_tag: e.versionTag || metadata.prompt?.version_tag || "",
        metadata,
      };
    });

    const { error } = await supabase.from("audit_logs").insert(rows);
    if (error) throw new Error(error.message);

    return NextResponse.json({ inserted: rows.length }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to insert audit logs" },
      { status: 500 },
    );
  }
}
