import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/proxy/prompts/:name
 *
 * Machine-to-machine (M2M) route consumed exclusively by the Kotlin sidecar
 * proxy. This is intentionally separate from the UI API routes, which use
 * browser-cookie auth that sidecar clients cannot provide.
 *
 * Auth flow
 * ─────────
 * 1. Extract the raw Bearer token from the Authorization header.
 * 2. SHA-256 hash it and look it up in vectorbea.deployment_agents.
 *    A deployment_agent row ties a hashed key to a specific workspace_id.
 * 3. Reject with 401 if the token is missing, unknown, or inactive.
 *
 * Response
 * ────────
 * Returns a PromptPayload JSON object shaped to match the Kotlin proxy's
 * serializable data class:
 *   { promptId, promptVersionId, organizationId, name, description,
 *     versionTag, templateText, parameters, createdAt }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
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
    const keyHash = createHash("sha256").update(rawToken).digest("hex");
    const supabase = createVectorBeaAdminClient();

    const { data: agent, error: agentError } = await supabase
      .from("deployment_agents")
      .select("id, workspace_id, is_active")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (agentError) {
      console.error("[proxy/prompts] deployment_agents lookup error:", agentError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!agent || !agent.is_active) {
      return NextResponse.json(
        { error: "Invalid or inactive deployment agent key" },
        { status: 401 },
      );
    }

    const workspaceId = agent.workspace_id as string;

    // ── 3. Resolve prompt by name + workspace ─────────────────────────────
    const { name } = await params;
    const promptName = decodeURIComponent(name);

    const { data: prompt, error: promptError } = await supabase
      .from("prompts")
      .select(
        `id,
         name,
         description,
         workspace_id,
         workspaces!inner ( organization_id ),
         prompt_versions (
           id,
           version_tag,
           template_text,
           parameters,
           is_published,
           created_at
         )`,
      )
      .eq("name", promptName)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (promptError) {
      console.error("[proxy/prompts] prompt lookup error:", promptError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!prompt) {
      return NextResponse.json(
        { error: `Prompt '${promptName}' not found in this workspace` },
        { status: 404 },
      );
    }

    // Find the published version (or fall back to the latest by date)
    const versions = Array.isArray(prompt.prompt_versions) ? prompt.prompt_versions : [];
    const published = versions.find((v: { is_published: boolean }) => v.is_published)
      ?? versions.sort(
        (a: { created_at: string }, b: { created_at: string }) =>
          b.created_at.localeCompare(a.created_at),
      )[0];

    if (!published) {
      return NextResponse.json(
        { error: `Prompt '${promptName}' has no published version` },
        { status: 404 },
      );
    }

    const workspace = Array.isArray(prompt.workspaces)
      ? prompt.workspaces[0]
      : prompt.workspaces;

    // ── 4. Return PromptPayload shaped to match the Kotlin data class ─────
    return NextResponse.json({
      promptId:        prompt.id,
      promptVersionId: published.id,
      organizationId:  workspace?.organization_id ?? "",
      name:            prompt.name,
      description:     prompt.description ?? null,
      versionTag:      published.version_tag,
      templateText:    published.template_text,
      parameters:      published.parameters ?? {},
      createdAt:       published.created_at,
    });
  } catch (error) {
    console.error("[proxy/prompts] unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
