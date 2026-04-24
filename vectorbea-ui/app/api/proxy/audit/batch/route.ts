import { NextRequest, NextResponse } from "next/server";

import { consumeRateLimit } from "@/lib/server/rate-limit";
import { authenticateRuntimeApiKey } from "@/lib/server/runtime-api-key";
import { enforceJsonBodySize } from "@/lib/server/security";
import { assertQuotaAvailable } from "@/lib/server/usage-quotas";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { buildTraceMetadataV1 } from "@/lib/trace-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const payloadTooLarge = enforceJsonBodySize(request, 512 * 1024);
    if (payloadTooLarge) return payloadTooLarge;

    const auth = await authenticateRuntimeApiKey(request);
    if (!auth.ok) return auth.response;

    const workspaceId = auth.workspaceId;
    const rate = consumeRateLimit(`proxy:audit-batch:${workspaceId}`, 300, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for audit ingestion." }, { status: 429 });
    }

    const payload = (await request.json()) as AuditEntry[];
    const entries = Array.isArray(payload) ? payload : [payload];
    if (entries.length === 0) {
      return NextResponse.json({ inserted: 0 }, { status: 201 });
    }

    await assertQuotaAvailable(workspaceId, "runtime_traces", entries.length);

    const supabase = createVectorBeaAdminClient();
    const missingNameIds = entries
      .filter((entry) => entry.promptVersionId && !entry.promptName)
      .map((entry) => entry.promptVersionId as string);

    const versionMeta = new Map<string, { promptName: string; versionTag: string }>();

    if (missingNameIds.length > 0) {
      const { data: versions } = await supabase
        .from("prompt_versions")
        .select("id, version_tag, prompts!inner(name)")
        .in("id", missingNameIds);

      for (const version of versions ?? []) {
        const promptRow = Array.isArray(version.prompts) ? version.prompts[0] : version.prompts;
        versionMeta.set(version.id, {
          promptName: (promptRow as { name: string })?.name ?? "",
          versionTag: version.version_tag ?? "",
        });
      }
    }

    const rows = entries.map((entry) => {
      const promptMeta = entry.promptVersionId ? versionMeta.get(entry.promptVersionId) : undefined;
      const promptName = entry.promptName || promptMeta?.promptName || "";
      const versionTag = entry.versionTag || promptMeta?.versionTag || "";

      return {
        workspace_id: workspaceId,
        prompt_version_id: entry.promptVersionId ?? null,
        proxy_latency_ms: entry.proxyLatencyMs ?? 0,
        llm_latency_ms: entry.llmLatencyMs ?? 0,
        token_count: entry.tokenCount ?? 0,
        prompt_name: promptName,
        version_tag: versionTag,
        metadata: buildTraceMetadataV1({
          metadata: entry.metadata ?? {},
          useType: "runtime",
          workspaceId,
          promptVersionId: entry.promptVersionId ?? null,
          promptName,
          versionTag,
          proxyLatencyMs: entry.proxyLatencyMs ?? 0,
          llmLatencyMs: entry.llmLatencyMs ?? 0,
          tokenCount: entry.tokenCount ?? 0,
        }),
      };
    });

    const { error: insertError } = await supabase.from("audit_logs").insert(rows);
    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({ inserted: rows.length }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const quotaExceeded = message.toLowerCase().includes("quota exceeded");
    return NextResponse.json(
      { error: quotaExceeded ? message : "Failed to ingest runtime events" },
      { status: quotaExceeded ? 402 : 500 },
    );
  }
}

