import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { buildTraceMetadataV1, normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
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

    const modelRecord = asRecord(normalized.model);
    const modelName = asString(modelRecord.model) ?? asString(modelRecord.name) ?? "unknown-model";
    const provider = asString(modelRecord.provider) ?? "unknown";
    const outputRecord = asRecord(normalized.output);

    const proxyLatencyMs = Math.max(asNumber(row.proxy_latency_ms, 0), 0);
    const llmLatencyMs = Math.max(
      asNumber(modelRecord.latency_ms, asNumber(row.llm_latency_ms, 0)),
      0,
    );
    const tokenCount = Math.max(
      asNumber(modelRecord.total_tokens, asNumber(row.token_count, 0)),
      0,
    );

    const replayMetadata = buildTraceMetadataV1({
      metadata: {
        ...normalized,
        trace: {
          ...(normalized.trace ?? {}),
          status: "success",
          started_at: new Date().toISOString(),
          duration_ms: proxyLatencyMs + llmLatencyMs,
          request_id: `replay_${crypto.randomUUID()}`,
        },
        request: {
          ...(normalized.request ?? {}),
          input: {
            ...(asRecord(normalized.request?.input)),
            text: replayInputText,
            variables: replayVariables,
          },
        },
        prompt: {
          ...(normalized.prompt ?? {}),
          name: resolvedPromptName,
          version_tag: resolvedVersionTag,
          prompt_version_id: row.prompt_version_id ?? undefined,
          variables: replayVariables,
          resolved: {
            ...(asRecord(normalized.prompt?.resolved)),
            user: renderedPrompt || undefined,
          },
        },
        model: {
          ...(normalized.model ?? {}),
          provider,
          model: modelName,
          latency_ms: llmLatencyMs,
          total_tokens: tokenCount,
        },
        output: {
          ...(normalized.output ?? {}),
          raw_text: asString(outputRecord.raw_text) ?? undefined,
          final_text:
            asString(outputRecord.final_text) ??
            asString(outputRecord.raw_text) ??
            "Replay requested. Runtime output is not available for this trace source.",
        },
        logs: [
          ...(Array.isArray(normalized.logs) ? normalized.logs : []),
          {
            timestamp: new Date().toISOString(),
            level: "info",
            component: "trace-replay",
            message: "Replay created from trace detail",
          },
        ],
        tags: {
          ...(normalized.tags ?? {}),
          replay_of: row.id,
          replay_mode: "trace_detail",
        },
        custom: {
          ...(normalized.custom ?? {}),
          replay: {
            source_trace_id: row.id,
            triggered_by: auth.user.id,
            mode: "trace_detail",
          },
        },
      },
      useType: "runtime",
      workspaceId,
      promptVersionId: row.prompt_version_id,
      promptName: resolvedPromptName,
      versionTag: resolvedVersionTag,
      proxyLatencyMs,
      llmLatencyMs,
      tokenCount,
    });

    const { data: inserted, error: insertError } = await supabase
      .from("audit_logs")
      .insert({
        workspace_id: workspaceId,
        prompt_version_id: row.prompt_version_id,
        prompt_name: resolvedPromptName,
        version_tag: resolvedVersionTag,
        proxy_latency_ms: proxyLatencyMs,
        llm_latency_ms: llmLatencyMs,
        token_count: tokenCount,
        metadata: replayMetadata,
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to replay trace" },
      { status: 500 },
    );
  }
}
