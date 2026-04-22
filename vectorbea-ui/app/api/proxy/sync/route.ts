// Edge runtime — zero cold start, no Node-only modules.
// Called by the sidecar's HubClient on boot (eager sync) and every 5 min (poll).
// Also used as the token-validation probe: a 401 means the token is invalid.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// ─── Types ─────────────────────────────────────────────────────────────────────

type DeploymentAgent = {
  id: string;
  workspace_id: string;
};

type PromptVersion = {
  id: string;
  version_tag: string;
  template_text: string;
  parameters: Record<string, unknown> | null;
  is_published: boolean;
  created_at: string;
};

type PromptRow = {
  id: string;
  name: string;
  description: string | null;
  workspace_id: string;
  prompt_versions: PromptVersion[] | null;
};

type WorkspaceRow = {
  id: string;
  organization_id: string;
};

// ─── Supabase REST helper ──────────────────────────────────────────────────────

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables");
  }
  return {
    restUrl: `${supabaseUrl.replace(/\/$/, "")}/rest/v1`,
    serviceRoleKey,
  };
}

async function supabaseGet<T>(path: string): Promise<T> {
  const { restUrl, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${restUrl}${path}`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      // Route all table access through the vectorbea schema, not public.
      "Accept-Profile": "vectorbea",
      "Content-Profile": "vectorbea",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase REST ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // 1. Extract bearer token (the sidecar's VECTORBEA_KEY)
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

    // 2. Validate token → get workspace
    const agentRows = await supabaseGet<DeploymentAgent[]>(
      `/deployment_agents?select=id,workspace_id&api_token=eq.${encodeURIComponent(rawToken)}&limit=1`,
    );
    const agent = agentRows[0];
    if (!agent) {
      return NextResponse.json(
        { error: "Invalid deployment agent token" },
        { status: 401 },
      );
    }

    const workspaceId = agent.workspace_id;

    // 3. Look up organization for this workspace
    const workspaceRows = await supabaseGet<WorkspaceRow[]>(
      `/workspaces?select=id,organization_id&id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
    );
    const organizationId = workspaceRows[0]?.organization_id ?? "";

    // 4. Fetch all prompts (with all versions) for this workspace
    const promptRows = await supabaseGet<PromptRow[]>(
      `/prompts?select=id,name,description,workspace_id,prompt_versions(id,version_tag,template_text,parameters,is_published,created_at)&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    );

    // 5. Build PromptPayload[] — one entry per prompt, latest published version only
    const payloads = promptRows.flatMap((prompt) => {
      const versions = Array.isArray(prompt.prompt_versions)
        ? prompt.prompt_versions
        : [];

      // Pick the published version (newest first as tiebreak)
      const sorted = [...versions].sort((a, b) => {
        const dateOrder = b.created_at.localeCompare(a.created_at);
        return dateOrder !== 0 ? dateOrder : b.id.localeCompare(a.id);
      });
      const published = sorted.find((v) => v.is_published);
      if (!published) return []; // draft-only prompts are not served

      return [
        {
          promptId: prompt.id,
          promptVersionId: published.id,
          organizationId,
          name: prompt.name,
          description: prompt.description ?? null,
          versionTag: published.version_tag,
          templateText: published.template_text,
          parameters: published.parameters ?? {},
          createdAt: published.created_at,
        },
      ];
    });

    return NextResponse.json(payloads);
  } catch (error) {
    console.error("[proxy/sync] unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
