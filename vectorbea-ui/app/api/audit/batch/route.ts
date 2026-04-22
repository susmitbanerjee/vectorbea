import { NextRequest, NextResponse } from "next/server";

import { buildTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
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

const ALLOWED_UI_AUDIT_ACTIONS = new Set(["update", "publish", "create", "delete"]);

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
          error: `Free plan monthly audit limit reached (${auditLimit} events). Please upgrade to the Team plan.`,
        },
        { status: 429 },
      );
    }

    const payload = (await request.json()) as AuditEntry[];
    const entries = Array.isArray(payload) ? payload : [payload];
    const hasInvalidEntry = entries.some((entry) => {
      const action = typeof entry.metadata?.action === "string" ? entry.metadata.action.trim() : "";
      return !ALLOWED_UI_AUDIT_ACTIONS.has(action);
    });

    if (hasInvalidEntry) {
      return NextResponse.json(
        { error: "Only prompt change events from the UI can be written to audit logs." },
        { status: 400 },
      );
    }

    const supabase = createVectorBeaAdminClient();

    const missingVersionIds = entries
      .filter((entry) =>
        entry.promptVersionId &&
        (!entry.promptName || !entry.versionTag),
      )
      .map((entry) => entry.promptVersionId as string);

    const versionMeta = new Map<string, { promptName: string; versionTag: string }>();

    if (missingVersionIds.length > 0) {
      const { data: versions, error: versionsError } = await supabase
        .from("prompt_versions")
        .select("id, version_tag, prompts!inner(name)")
        .in("id", missingVersionIds);

      if (versionsError) {
        throw new Error(versionsError.message);
      }

      for (const version of versions ?? []) {
        const promptRow = Array.isArray(version.prompts) ? version.prompts[0] : version.prompts;
        versionMeta.set(version.id, {
          promptName: (promptRow as { name?: string } | null)?.name ?? "",
          versionTag: version.version_tag ?? "",
        });
      }
    }

    const rows = entries.map((entry) => {
      const meta = entry.promptVersionId ? versionMeta.get(entry.promptVersionId) : undefined;
      const metadata = buildTraceMetadataV1({
        metadata: entry.metadata ?? {},
        useType: "audit",
        workspaceId,
        promptVersionId: entry.promptVersionId ?? null,
        promptName: entry.promptName || meta?.promptName || "",
        versionTag: entry.versionTag || meta?.versionTag || "",
        proxyLatencyMs: entry.proxyLatencyMs ?? 0,
        llmLatencyMs: entry.llmLatencyMs ?? 0,
        tokenCount: entry.tokenCount ?? 0,
      });
      const metadataPrompt = metadata.prompt ?? {};

      return {
        workspace_id: workspaceId,
        prompt_version_id: entry.promptVersionId ?? null,
        proxy_latency_ms: entry.proxyLatencyMs ?? 0,
        llm_latency_ms: entry.llmLatencyMs ?? 0,
        token_count: entry.tokenCount ?? 0,
        prompt_name:
          entry.promptName ||
          (typeof metadataPrompt.name === "string" ? metadataPrompt.name : "") ||
          meta?.promptName ||
          "",
        version_tag:
          entry.versionTag ||
          (typeof metadataPrompt.version_tag === "string" ? metadataPrompt.version_tag : "") ||
          meta?.versionTag ||
          "",
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
