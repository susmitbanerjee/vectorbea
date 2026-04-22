import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/proxy/audit/batch
 *
 * Machine-to-machine audit ingestion route consumed exclusively by the
 * Kotlin sidecar proxy. Authenticates via deployment_agents.api_token
 * (Bearer). Status is NOT checked — a freshly-registered agent with
 * status "offline" must be able to flush audit events so its first
 * heartbeat can transition it to "online".
 *
 * If the proxy sends an AuditEvent without promptName / versionTag (old
 * proxy image), this route enriches them from prompt_versions → prompts
 * so the dashboard always shows meaningful names.
 */

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
    // ── 1. Extract Bearer token ───────────────────────────────────────────
    const authHeader = request.headers.get("authorization") ?? "";
    const rawToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!rawToken) {
      return NextResponse.json(
        { error: "Authorization header with Bearer token is required" },
        { status: 401 },
      );
    }

    // ── 2. Validate token — status is NOT checked so a newly-registered
    //       agent with status "offline" can still flush events and heartbeat
    //       itself to "online". ───────────────────────────────────────────
    const supabase = createVectorBeaAdminClient();

    const { data: agent, error: agentError } = await supabase
      .from("deployment_agents")
      .select("id, workspace_id")
      .eq("api_token", rawToken)
      .maybeSingle();

    if (agentError) {
      console.error("[proxy/audit/batch] deployment_agents lookup error:", agentError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json(
        { error: "Invalid deployment agent token" },
        { status: 401 },
      );
    }

    const workspaceId = agent.workspace_id as string;

    // ── 3. Parse entries ──────────────────────────────────────────────────
    const payload = (await request.json()) as AuditEntry[];
    const entries = Array.isArray(payload) ? payload : [payload];

    if (entries.length === 0) {
      return NextResponse.json({ inserted: 0 }, { status: 201 });
    }

    // ── 4. Enrich prompt_name / version_tag from DB for old proxy images
    //       that do not send them in the AuditEvent payload. ──────────────
    const missingNameIds = entries
      .filter((e) => e.promptVersionId && !e.promptName)
      .map((e) => e.promptVersionId as string);

    const versionMeta = new Map<string, { promptName: string; versionTag: string }>();

    if (missingNameIds.length > 0) {
      const { data: versions } = await supabase
        .from("prompt_versions")
        .select("id, version_tag, prompts!inner(name)")
        .in("id", missingNameIds);

      for (const v of versions ?? []) {
        const promptsRow = Array.isArray(v.prompts) ? v.prompts[0] : v.prompts;
        versionMeta.set(v.id, {
          promptName: (promptsRow as { name: string })?.name ?? "",
          versionTag: v.version_tag ?? "",
        });
      }
    }

    // ── 5. Build and insert rows ──────────────────────────────────────────
    const rows = entries.map((e) => {
      const meta = e.promptVersionId ? versionMeta.get(e.promptVersionId) : undefined;
      const metadata = {
        ...(e.metadata ?? {}),
        useType: "runtime",
      };
      return {
        workspace_id: workspaceId,
        prompt_version_id: e.promptVersionId ?? null,
        proxy_latency_ms: e.proxyLatencyMs ?? 0,
        llm_latency_ms: e.llmLatencyMs ?? 0,
        token_count: e.tokenCount ?? 0,
        prompt_name: e.promptName || meta?.promptName || "",
        version_tag: e.versionTag || meta?.versionTag || "",
        metadata,
      };
    });

    const { error: insertError } = await supabase.from("audit_logs").insert(rows);

    if (insertError) {
      console.error("[proxy/audit/batch] insert error:", insertError.message);
      throw new Error(insertError.message);
    }

    return NextResponse.json({ inserted: rows.length }, { status: 201 });
  } catch (error) {
    console.error("[proxy/audit/batch] unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
