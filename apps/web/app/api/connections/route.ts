import { NextRequest, NextResponse } from "next/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";

const ALLOWED_TYPES = new Set([
  "llm_provider",
  "database",
  "http_api",
  "saas",
  "mcp_server",
  "vector_store",
  "object_storage",
]);

const ALLOWED_ENVIRONMENTS = new Set(["development", "staging", "production"]);
const ALLOWED_AUTH_TYPES = new Set([
  "api_key",
  "bearer_token",
  "basic_auth",
  "oauth2",
  "aws_iam",
  "custom_header",
  "connection_string",
  "none",
]);
const ALLOWED_STATUSES = new Set([
  "connected",
  "not_tested",
  "failed",
  "needs_whitelist",
  "missing_secret",
  "disabled",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeConfig(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) return {};

  const blockedKeyPattern =
    /(secret|password|passwd|pwd|token|api[_-]?key|private[_-]?key|authorization|auth[_-]?header)/i;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isPlainObject(value)) return value;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (blockedKeyPattern.test(key)) continue;
      out[key] = walk(child);
    }
    return out;
  };

  return walk(input) as Record<string, unknown>;
}

function extractWorkspaceId(request: NextRequest, body?: Record<string, unknown>) {
  return (
    request.nextUrl.searchParams.get("workspaceId") ??
    (typeof body?.workspaceId === "string" ? body.workspaceId : null)
  );
}

function createSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function dbToConnection(row: Record<string, unknown>) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    provider: row.provider,
    environment: row.environment,
    status: row.status,
    authType: row.auth_type,
    secretRef: row.secret_ref ?? null,
    secretMasked: row.secret_masked ?? null,
    config: row.config ?? {},
    networkPolicy: row.network_policy ?? {},
    lastTestedAt: row.last_tested_at ?? null,
    lastTestStatus: row.last_test_status ?? null,
    lastTestLatencyMs: row.last_test_latency_ms ?? null,
    lastTestError: row.last_test_error ?? null,
    usedByAgentIds: row.used_by_agent_ids ?? [],
    usedByToolIds: row.used_by_tool_ids ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  try {
    const supabase = createVectorBeaAdminClient();
    let query = supabase
      .from("connections")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    const type = request.nextUrl.searchParams.get("type");
    const status = request.nextUrl.searchParams.get("status");
    const search = request.nextUrl.searchParams.get("search");

    if (type) query = query.eq("type", type);
    if (status) query = query.eq("status", status);
    if (search) {
      query = query.or(`name.ilike.%${search}%,provider.ilike.%${search}%,type.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json((data ?? []).map((r) => dbToConnection(r as Record<string, unknown>)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const workspaceId = extractWorkspaceId(request, body);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  try {
    const {
      name,
      type,
      provider,
      environment,
      authType,
      secretRef,
      secretMasked,
      config,
      networkPolicy,
    } = body;

    if (!name || !type || !provider) {
      return NextResponse.json({ error: "name, type, and provider are required" }, { status: 400 });
    }

    const normalizedType = String(type);
    const normalizedProvider = String(provider).trim();
    const normalizedEnvironment = String(environment ?? "development");
    const normalizedAuthType = String(authType ?? "none");

    if (!ALLOWED_TYPES.has(normalizedType)) {
      return NextResponse.json({ error: "invalid connection type" }, { status: 400 });
    }
    if (!ALLOWED_ENVIRONMENTS.has(normalizedEnvironment)) {
      return NextResponse.json({ error: "invalid environment" }, { status: 400 });
    }
    if (!ALLOWED_AUTH_TYPES.has(normalizedAuthType)) {
      return NextResponse.json({ error: "invalid authType" }, { status: 400 });
    }
    if (!normalizedProvider) {
      return NextResponse.json({ error: "provider must be non-empty" }, { status: 400 });
    }
    if (secretMasked && String(secretMasked).length > 120) {
      return NextResponse.json({ error: "secretMasked too long" }, { status: 400 });
    }

    const supabase = createVectorBeaAdminClient();
    const ts = Date.now().toString(36);
    const finalSlug = `${createSlug(String(name))}-${ts}`;
    const sanitizedConfig = sanitizeConfig(config);
    const safeNetworkPolicy = isPlainObject(networkPolicy)
      ? networkPolicy
      : { requireWhitelist: false, privateRunnerRequired: false, networkStatus: "unknown" };

    const { data, error } = await supabase
      .from("connections")
      .insert({
        workspace_id: workspaceId,
        name: String(name),
        slug: finalSlug,
        type: normalizedType,
        provider: normalizedProvider,
        environment: normalizedEnvironment,
        status: "not_tested",
        auth_type: normalizedAuthType,
        secret_ref: secretRef ? String(secretRef) : null,
        secret_masked: secretMasked ? String(secretMasked) : null,
        config: sanitizedConfig,
        network_policy: safeNetworkPolicy,
        used_by_agent_ids: [],
        used_by_tool_ids: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json(dbToConnection(data as Record<string, unknown>), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const workspaceId = extractWorkspaceId(request, body);
  const id = request.nextUrl.searchParams.get("id") ?? (typeof body.id === "string" ? body.id : null);
  if (!workspaceId || !id) {
    return NextResponse.json({ error: "workspaceId and id are required" }, { status: 400 });
  }

  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  const patch: Record<string, unknown> = {};
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (typeof body.lastTestStatus === "string") patch.last_test_status = body.lastTestStatus;
  if (typeof body.lastTestError === "string" || body.lastTestError === null) patch.last_test_error = body.lastTestError;
  if (typeof body.lastTestLatencyMs === "number" || body.lastTestLatencyMs === null) {
    patch.last_test_latency_ms = body.lastTestLatencyMs;
  }
  if (typeof body.lastTestedAt === "string" || body.lastTestedAt === null) patch.last_tested_at = body.lastTestedAt;
  patch.updated_at = new Date().toISOString();

  try {
    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("connections")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json(dbToConnection(data as Record<string, unknown>));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const id = request.nextUrl.searchParams.get("id");
  if (!workspaceId || !id) {
    return NextResponse.json({ error: "workspaceId and id are required" }, { status: 400 });
  }

  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  try {
    const supabase = createVectorBeaAdminClient();
    const { error } = await supabase
      .from("connections")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", id);

    if (error) throw new Error(error.message);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
