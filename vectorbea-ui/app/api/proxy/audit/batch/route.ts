import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/proxy/audit/batch
 *
 * Machine-to-machine audit ingestion route consumed exclusively by the
 * Kotlin sidecar proxy. Mirrors /api/audit/batch but authenticates via
 * deployment_agents.api_token (Bearer) instead of requiring a browser
 * session cookie, so the proxy can flush audit events without user auth.
 *
 * Auth flow
 * ─────────
 * Same as /api/proxy/prompts/:name — Bearer token matched against
 * deployment_agents.api_token. The workspace_id is derived from the agent
 * row, so no workspaceId query param is needed.
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

    // ── 2. Validate against deployment_agents ─────────────────────────────
    const supabase = createVectorBeaAdminClient();

    const { data: agent, error: agentError } = await supabase
      .from("deployment_agents")
      .select("id, workspace_id, status")
      .eq("api_token", rawToken)
      .maybeSingle();

    if (agentError) {
      console.error("[proxy/audit/batch] deployment_agents lookup error:", agentError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!agent || !["active", "online"].includes(agent.status)) {
      return NextResponse.json(
        { error: "Invalid or inactive deployment agent token" },
        { status: 401 },
      );
    }

    const workspaceId = agent.workspace_id as string;

    // ── 3. Parse and insert audit events ──────────────────────────────────
    const payload = (await request.json()) as AuditEntry[];
    const entries = Array.isArray(payload) ? payload : [payload];

    if (entries.length === 0) {
      return NextResponse.json({ inserted: 0 }, { status: 201 });
    }

    const rows = entries.map((e) => ({
      workspace_id: workspaceId,
      prompt_version_id: e.promptVersionId ?? null,
      proxy_latency_ms: e.proxyLatencyMs ?? 0,
      llm_latency_ms: e.llmLatencyMs ?? 0,
      token_count: e.tokenCount ?? 0,
      prompt_name: e.promptName ?? "",
      version_tag: e.versionTag ?? "",
      metadata: e.metadata ?? {},
    }));

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
