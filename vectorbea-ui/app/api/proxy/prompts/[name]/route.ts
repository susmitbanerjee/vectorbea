import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

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
  organization_id: string;
};

function parsePromptReference(rawName: string, requestedVersion: string | null) {
  const explicitVersion = requestedVersion?.trim();
  if (explicitVersion) {
    return { promptName: rawName.trim(), versionTag: explicitVersion };
  }

  const separatorIndex = rawName.lastIndexOf("@");
  if (separatorIndex <= 0) {
    return { promptName: rawName.trim(), versionTag: null };
  }

  const promptName = rawName.slice(0, separatorIndex).trim();
  const versionTag = rawName.slice(separatorIndex + 1).trim();
  if (!promptName || !versionTag) {
    return { promptName: rawName.trim(), versionTag: null };
  }

  return { promptName, versionTag };
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for proxy route");
  }
  return {
    restUrl: `${supabaseUrl.replace(/\/$/, "")}/rest/v1`,
    serviceRoleKey,
  };
}

async function supabaseGet<T>(path: string) {
  const { restUrl, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${restUrl}${path}`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
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

    const agentRows = await supabaseGet<DeploymentAgent[]>(
      `/deployment_agents?select=id,workspace_id&api_token=eq.${encodeURIComponent(rawToken)}&limit=1`,
    );
    const agent = agentRows[0];
    if (!agent) {
      return NextResponse.json({ error: "Invalid deployment agent token" }, { status: 401 });
    }

    const workspaceId = agent.workspace_id;
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const { promptName, versionTag: requestedVersionTag } = parsePromptReference(
      decodedName,
      request.nextUrl.searchParams.get("version"),
    );

    const promptRows = await supabaseGet<PromptRow[]>(
      `/prompts?select=id,name,description,workspace_id,prompt_versions(id,version_tag,template_text,parameters,is_published,created_at)&name=eq.${encodeURIComponent(promptName)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
    );
    const prompt = promptRows[0];

    if (!prompt) {
      return NextResponse.json(
        {
          error:
            `Prompt '${promptName}' not found. ` +
            `The agent token is linked to workspace ${workspaceId} - ` +
            `make sure the prompt was created and published in that same workspace.`,
        },
        { status: 404 },
      );
    }

    const versions = Array.isArray(prompt.prompt_versions) ? prompt.prompt_versions : [];
    const sortedVersions = [...versions].sort((a, b) => {
      const createdAtOrder = b.created_at.localeCompare(a.created_at);
      return createdAtOrder !== 0 ? createdAtOrder : b.id.localeCompare(a.id);
    });

    const resolvedVersion = requestedVersionTag
      ? sortedVersions.find((version) => version.version_tag === requestedVersionTag)
      : sortedVersions.find((version) => version.is_published);

    if (!resolvedVersion) {
      const reason = requestedVersionTag
        ? `does not have version '${requestedVersionTag}'`
        : "has no published version - open the dashboard, find the prompt, and click Publish";
      return NextResponse.json({ error: `Prompt '${promptName}' ${reason}` }, { status: 404 });
    }

    const workspaceRows = await supabaseGet<WorkspaceRow[]>(
      `/workspaces?select=organization_id&id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
    );

    return NextResponse.json({
      promptId: prompt.id,
      promptVersionId: resolvedVersion.id,
      organizationId: workspaceRows[0]?.organization_id ?? "",
      name: prompt.name,
      description: prompt.description ?? null,
      versionTag: resolvedVersion.version_tag,
      templateText: resolvedVersion.template_text,
      parameters: resolvedVersion.parameters ?? {},
      createdAt: resolvedVersion.created_at,
    });
  } catch (error) {
    console.error("[proxy/prompts-edge] unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
