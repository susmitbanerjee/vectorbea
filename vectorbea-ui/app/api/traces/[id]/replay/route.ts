import { NextRequest, NextResponse } from "next/server";

import { executeResolvedPrompt } from "@/lib/server/execution";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { assertQuotaAvailable } from "@/lib/server/usage-quotas";
import { isRuntimeTraceMetadata } from "@/lib/server/traces";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

export const dynamic = "force-dynamic";

type AuditLogRow = {
  id: string;
  workspace_id: string;
  prompt_version_id: string | null;
  prompt_name: string | null;
  version_tag: string | null;
  proxy_latency_ms: number | null;
  llm_latency_ms: number | null;
  token_count: number | null;
  metadata: Record<string, unknown> | null;
};

type PromptVersionRow = {
  id: string;
  version_tag: string;
  template_text: string;
  parameters: Record<string, unknown> | null;
  prompts: { name?: string } | Array<{ name?: string }> | null;
};

type ReplayRequestBody = {
  providerOverride?: string | null;
  modelOverride?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function renderTemplate(template: string, variables: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const rate = consumeRateLimit(`traces:replay:${workspaceId}:${auth.user.id}`, 60, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for replay requests." }, { status: 429 });
    }
    await assertQuotaAvailable(workspaceId, "replay_runs", 1);
    const body = (await request.json().catch(() => ({}))) as ReplayRequestBody;
    const providerOverride = asString(body.providerOverride);
    const modelOverride = asString(body.modelOverride);

    if (providerOverride && providerOverride !== "same") {
      if (providerOverride === "enterprise_gateway") {
        if (!process.env.VECTORBEA_ENTERPRISE_GATEWAY_URL) {
          return NextResponse.json({ error: "Provider not configured: enterprise gateway URL is missing." }, { status: 422 });
        }
      } else {
        return NextResponse.json(
          { error: `Provider not configured: live replay for ${providerOverride} is not available in this deployment.` },
          { status: 422 },
        );
      }
    }

    const supabase = createVectorBeaAdminClient();

    const { data: original, error: originalError } = await supabase
      .from("audit_logs")
      .select(
        "id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();

    if (originalError) throw new Error(originalError.message);
    if (!original) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }

    const row = original as AuditLogRow;
    const normalized = normalizeTraceMetadataV1((row.metadata ?? {}) as Record<string, unknown>);
    if (!isRuntimeTraceMetadata(normalized)) {
      return NextResponse.json(
        { error: "Replay is only available for runtime execution traces." },
        { status: 422 },
      );
    }

    let promptVersion = null as PromptVersionRow | null;
    if (row.prompt_version_id) {
      const { data: version, error: versionError } = await supabase
        .from("prompt_versions")
        .select("id, version_tag, template_text, parameters, prompts(name)")
        .eq("id", row.prompt_version_id)
        .maybeSingle();

      if (versionError) throw new Error(versionError.message);
      promptVersion = (version ?? null) as PromptVersionRow | null;
    }

    const requestInput = asRecord(normalized.request?.input);
    const promptVariables = asRecord(normalized.prompt?.variables);
    const legacyVariables = asRecord(asRecord(normalized.custom).variables);
    const replayVariables = {
      ...promptVariables,
      ...legacyVariables,
      ...asRecord(requestInput.variables),
    };
    const replayInputText =
      asString(requestInput.text) ??
      asString(asRecord(normalized.custom).userInput) ??
      "";

    if (!replayInputText && Object.keys(replayVariables).length === 0) {
      return NextResponse.json(
        { error: "Replay unavailable for this trace because request input metadata is missing." },
        { status: 422 },
      );
    }

    const promptNameFromVersion = Array.isArray(promptVersion?.prompts)
      ? promptVersion?.prompts?.[0]?.name ?? null
      : promptVersion?.prompts?.name ?? null;

    const resolvedPromptName =
      promptNameFromVersion ??
      asString(normalized.prompt?.name) ??
      row.prompt_name ??
      "unknown-prompt";
    const resolvedVersionTag =
      promptVersion?.version_tag ??
      asString(normalized.prompt?.version_tag) ??
      row.version_tag ??
      "latest";

    const templateText = promptVersion?.template_text ?? "";
    const renderedPrompt = renderTemplate(templateText, replayVariables);

    const execution = await executeResolvedPrompt({
      workspaceId,
      promptVersionId: row.prompt_version_id,
      promptName: resolvedPromptName,
      versionTag: resolvedVersionTag,
      templateText,
      variables: replayVariables,
      inputText: replayInputText,
      renderedPrompt,
      sourceMetadata: normalized,
      replayOf: row.id,
      triggeredBy: auth.user.id,
      executorOverride: providerOverride && providerOverride !== "same"
        ? { type: providerOverride === "enterprise_gateway" ? "enterprise_gateway" : "direct_provider", provider: providerOverride, model: modelOverride }
        : modelOverride
          ? { model: modelOverride }
          : undefined,
    });

    const { data: inserted, error: insertError } = await supabase
      .from("audit_logs")
      .insert({
        workspace_id: workspaceId,
        prompt_version_id: row.prompt_version_id,
        prompt_name: resolvedPromptName,
        version_tag: resolvedVersionTag,
        proxy_latency_ms: execution.proxyLatencyMs,
        llm_latency_ms: execution.llmLatencyMs,
        token_count: execution.tokenCount,
        metadata: execution.metadata,
      })
      .select("id, created_at")
      .single();

    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({
      traceId: inserted.id,
      replayedFrom: row.id,
      createdAt: inserted.created_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to replay trace";
    const quotaExceeded = message.toLowerCase().includes("quota exceeded");
    return NextResponse.json(
      { error: quotaExceeded ? message : "Failed to replay trace" },
      { status: quotaExceeded ? 402 : 500 },
    );
  }
}
