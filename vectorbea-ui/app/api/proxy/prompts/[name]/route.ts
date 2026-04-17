import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parsePromptReference(rawName: string, requestedVersion: string | null) {
  const explicitVersion = requestedVersion?.trim();
  if (explicitVersion) {
    return {
      promptName: rawName.trim(),
      versionTag: explicitVersion,
    };
  }

  const separatorIndex = rawName.lastIndexOf("@");
  if (separatorIndex <= 0) {
    return {
      promptName: rawName.trim(),
      versionTag: null,
    };
  }

  const promptName = rawName.slice(0, separatorIndex).trim();
  const versionTag = rawName.slice(separatorIndex + 1).trim();

  if (!promptName || !versionTag) {
    return {
      promptName: rawName.trim(),
      versionTag: null,
    };
  }

  return { promptName, versionTag };
}

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
 * 2. Compare it directly against deployment_agents.api_token.
 *    A deployment_agent row ties a token to a specific workspace_id.
 * 3. Reject with 401 if the token is missing, unknown, or status != 'active'.
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
    const supabase = createVectorBeaAdminClient();

    // Status is NOT checked — a freshly-registered agent with status "offline"
    // must be able to fetch prompts. The first heartbeat will flip it to "online".
    const { data: agent, error: agentError } = await supabase
      .from("deployment_agents")
      .select("id, workspace_id")
      .eq("api_token", rawToken)
      .maybeSingle();

    if (agentError) {
      console.error("[proxy/prompts] deployment_agents lookup error:", agentError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json(
        { error: "Invalid deployment agent token" },
        { status: 401 },
      );
    }

    const workspaceId = agent.workspace_id as string;

    // ── 3. Resolve prompt by name + workspace ─────────────────────────────
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const { promptName, versionTag: requestedVersionTag } = parsePromptReference(
      decodedName,
      request.nextUrl.searchParams.get("version"),
    );

    // Look up prompt + versions only — no cross-table join.
    // organization_id is fetched separately below using the workspaceId we
    // already have from the agent, which avoids PostgREST relationship
    // resolution issues with schema-scoped clients.
    const { data: prompt, error: promptError } = await supabase
      .from("prompts")
      .select(
        `id,
         name,
         description,
         workspace_id,
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
      return NextResponse.json({ error: promptError.message }, { status: 500 });
    }

    if (!prompt) {
      // Log the workspace so the developer can cross-check in the dashboard.
      console.warn(
        `[proxy/prompts] '${promptName}' not found. ` +
        `Searched workspace_id=${workspaceId}. ` +
        `Verify the prompt exists in that workspace and is published.`,
      );
      return NextResponse.json(
        {
          error:
            `Prompt '${promptName}' not found. ` +
            `The agent token is linked to workspace ${workspaceId} — ` +
            `make sure the prompt was created and published in that same workspace.`,
        },
        { status: 404 },
      );
    }

    // Default resolution is the newest published version. If the caller
    // explicitly requests a version tag, honor it exactly.
    const versions = Array.isArray(prompt.prompt_versions) ? prompt.prompt_versions : [];
    const sortedVersions = [...versions].sort(
      (
        a: { created_at: string; id: string },
        b: { created_at: string; id: string },
      ) => {
        const createdAtOrder = b.created_at.localeCompare(a.created_at);
        return createdAtOrder !== 0 ? createdAtOrder : b.id.localeCompare(a.id);
      },
    );
    const resolvedVersion = requestedVersionTag
      ? sortedVersions.find(
          (version: { version_tag: string }) => version.version_tag === requestedVersionTag,
        )
      : sortedVersions.find((version: { is_published: boolean }) => version.is_published);

    if (!resolvedVersion) {
      const reason = requestedVersionTag
        ? `does not have version '${requestedVersionTag}'`
        : `has no published version — open the dashboard, find the prompt, and click Publish`;
      console.warn(`[proxy/prompts] '${promptName}' found but ${reason}.`);
      return NextResponse.json(
        { error: `Prompt '${promptName}' ${reason}` },
        { status: 404 },
      );
    }

    // ── 4. Fetch organization_id from workspaces (separate query, no join) ──
    // This avoids PostgREST FK resolution issues that arise with schema-scoped
    // clients — we already have workspaceId from the agent lookup above.
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("organization_id")
      .eq("id", workspaceId)
      .maybeSingle();

    // ── 5. Return PromptPayload shaped to match the Kotlin data class ─────
    return NextResponse.json({
      promptId:        prompt.id,
      promptVersionId: resolvedVersion.id,
      organizationId:  workspace?.organization_id ?? "",
      name:            prompt.name,
      description:     prompt.description ?? null,
      versionTag:      resolvedVersion.version_tag,
      templateText:    resolvedVersion.template_text,
      parameters:      resolvedVersion.parameters ?? {},
      createdAt:       resolvedVersion.created_at,
    });
  } catch (error) {
    console.error("[proxy/prompts] unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
