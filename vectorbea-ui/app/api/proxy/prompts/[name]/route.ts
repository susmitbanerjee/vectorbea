import { NextRequest, NextResponse } from "next/server";
import { authenticateRuntimeApiKey } from "@/lib/server/runtime-api-key";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type PromptVersion = {
  id: string;
  version_tag: string;
  template_text: string;
  parameters: Record<string, unknown> | null;
  is_published: boolean;
  rollout_status?: string | null;
  rollout_percentage?: number | null;
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeEnvironment(value: string | null): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "prod";
}

function hashBucket(input: string): number {
  // FNV-1a 32-bit hash, deterministic in Edge runtime.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

function extractSeed(request: NextRequest, token: string, promptId: string) {
  const seed =
    request.headers.get("x-vectorbea-user-id")?.trim() ||
    request.headers.get("x-user-id")?.trim() ||
    request.headers.get("x-request-id")?.trim() ||
    request.nextUrl.searchParams.get("requestId")?.trim() ||
    request.nextUrl.searchParams.get("userId")?.trim() ||
    token;
  return `${seed}:${promptId}`;
}

function versionEnabledForEnvironment(version: PromptVersion, environment: string): boolean {
  const params = asRecord(version.parameters);
  const rollout = asRecord(params.vectorbea_rollout);
  const environments = rollout.environments;
  if (!Array.isArray(environments) || environments.length === 0) {
    return true;
  }
  const normalized = environments
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value) => value.length > 0);
  if (normalized.length === 0) return true;
  return normalized.includes(environment) || normalized.includes("all");
}

function selectByRollout(versions: PromptVersion[], seedKey: string, environment: string) {
  const sorted = [...versions].sort((a, b) => a.version_tag.localeCompare(b.version_tag));
  const candidates = sorted.filter(
    (version) =>
      (version.rollout_status ?? "draft") === "candidate" &&
      (version.rollout_percentage ?? 0) > 0 &&
      versionEnabledForEnvironment(version, environment),
  );
  const active = sorted.find(
    (version) =>
      (version.rollout_status ?? "draft") === "active" &&
      versionEnabledForEnvironment(version, environment),
  );

  if (candidates.length === 0) {
    return {
      version: active ?? sorted.find((version) => version.is_published) ?? null,
      bucket: null,
      candidateTotal: 0,
      selectedBy: active ? "active" : "published",
    };
  }

  const bucket = hashBucket(seedKey);
  let cursor = 0;
  let selected: PromptVersion | null = null;

  for (const candidate of candidates) {
    const share = Math.max(0, Math.min(100, candidate.rollout_percentage ?? 0));
    const end = Math.min(100, cursor + share);
    if (bucket >= cursor && bucket < end) {
      selected = candidate;
      break;
    }
    cursor = end;
    if (cursor >= 100) break;
  }

  return {
    version: selected ?? active ?? sorted.find((version) => version.is_published) ?? null,
    bucket,
    candidateTotal: Math.min(
      100,
      candidates.reduce((sum, version) => sum + Math.max(0, Math.min(100, version.rollout_percentage ?? 0)), 0),
    ),
    selectedBy: selected ? "candidate_split" : active ? "active_fallback" : "published_fallback",
  };
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const auth = await authenticateRuntimeApiKey(request);
    if (!auth.ok) return auth.response;
    const workspaceId = auth.workspaceId;

    // Read raw token for rollout seed (used to bucket this caller deterministically).
    const rawToken =
      (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() ||
      auth.keyId;

    const rate = consumeRateLimit(`proxy:prompts:${workspaceId}`, 600, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded for prompt fetch. Try again shortly." },
        { status: 429 },
      );
    }
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
            `Prompt '${promptName}' not found for this sidecar token. ` +
            "Make sure the prompt exists and is published in the same workspace as the token.",
        },
        { status: 404 },
      );
    }

    const versions = Array.isArray(prompt.prompt_versions) ? prompt.prompt_versions : [];
    const sortedVersions = [...versions].sort((a, b) => {
      const createdAtOrder = b.created_at.localeCompare(a.created_at);
      return createdAtOrder !== 0 ? createdAtOrder : b.id.localeCompare(a.id);
    });

    const runtimeEnvironment = normalizeEnvironment(
      request.nextUrl.searchParams.get("environment") ??
      request.headers.get("x-vectorbea-environment") ??
      request.headers.get("x-environment"),
    );
    const seedKey = extractSeed(request, rawToken, prompt.id);
    const rolloutSelection = selectByRollout(sortedVersions, seedKey, runtimeEnvironment);

    const resolvedVersion = requestedVersionTag
      ? sortedVersions.find((version) => version.version_tag === requestedVersionTag)
      : rolloutSelection.version;

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
      rollout: {
        status: resolvedVersion.rollout_status ?? "draft",
        percentage: resolvedVersion.rollout_percentage ?? 0,
        environment: runtimeEnvironment,
        selectedBy: requestedVersionTag ? "explicit_version" : rolloutSelection.selectedBy,
        candidateTotalPercentage: rolloutSelection.candidateTotal,
        bucket: rolloutSelection.bucket,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to resolve prompt" },
      { status: 500 },
    );
  }
}
