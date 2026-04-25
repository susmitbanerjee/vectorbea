import { NextRequest, NextResponse } from "next/server";

import { consumeRateLimit } from "@/lib/server/rate-limit";
import { resolveAuditLlmLatencyMs, resolveAuditProxyLatencyMs } from "@/lib/server/audit-latency";
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function resolveProxyLatency(entry: AuditEntry): number {
  return resolveAuditProxyLatencyMs(entry.proxyLatencyMs, entry.metadata);
}

function resolveLlmLatency(entry: AuditEntry): number {
  return resolveAuditLlmLatencyMs(entry.llmLatencyMs, entry.metadata);
}

function resolveTokenCount(entry: AuditEntry): number {
  const metadata = asRecord(entry.metadata);
  const model = asRecord(metadata.model);
  return Math.max(
    asNumber(entry.tokenCount) ??
      asNumber(model.total_tokens) ??
      asNumber(model.totalTokens) ??
      0,
    0,
  );
}

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
      const proxyLatencyMs = resolveProxyLatency(entry);
      const llmLatencyMs = resolveLlmLatency(entry);
      const tokenCount = resolveTokenCount(entry);

      return {
        workspace_id: workspaceId,
        prompt_version_id: entry.promptVersionId ?? null,
        proxy_latency_ms: proxyLatencyMs,
        llm_latency_ms: llmLatencyMs,
        token_count: tokenCount,
        prompt_name: promptName,
        version_tag: versionTag,
        metadata: buildTraceMetadataV1({
          metadata: entry.metadata ?? {},
          useType: "runtime",
          workspaceId,
          promptVersionId: entry.promptVersionId ?? null,
          promptName,
          versionTag,
          proxyLatencyMs,
          llmLatencyMs,
          tokenCount,
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
