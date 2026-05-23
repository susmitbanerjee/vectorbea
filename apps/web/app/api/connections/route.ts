import { NextRequest, NextResponse } from "next/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dbToConnection(row: Record<string, unknown>) {
  return {
    id:                  row.id,
    workspaceId:         row.workspace_id,
    name:                row.name,
    slug:                row.slug,
    type:                row.type,
    provider:            row.provider,
    environment:         row.environment,
    status:              row.status,
    authType:            row.auth_type,
    secretRef:           row.secret_ref   ?? null,
    secretMasked:        row.secret_masked ?? null,
    config:              row.config        ?? {},
    networkPolicy:       row.network_policy ?? {},
    lastTestedAt:        row.last_tested_at        ?? null,
    lastTestStatus:      row.last_test_status      ?? null,
    lastTestLatencyMs:   row.last_test_latency_ms  ?? null,
    lastTestError:       row.last_test_error        ?? null,
    usedByAgentIds:      row.used_by_agent_ids ?? [],
    usedByToolIds:       row.used_by_tool_ids  ?? [],
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
  };
}

// ─── GET /api/connections ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
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

    const type   = searchParams.get("type");
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    if (type)   query = query.eq("type", type);
    if (status) query = query.eq("status", status);
    if (search) query = query.or(
      `name.ilike.%${search}%,provider.ilike.%${search}%,type.ilike.%${search}%`
    );

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json((data ?? []).map(r => dbToConnection(r as Record<string, unknown>)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// ─── POST /api/connections ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  try {
    const body = await request.json() as Record<string, unknown>;
    const {
      name, type, provider, environment, authType,
      secretRef, secretMasked, config, networkPolicy,
    } = body;

    if (!name || !type || !provider) {
      return NextResponse.json({ error: "name, type, and provider are required" }, { status: 400 });
    }

    const slug = String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const supabase = createVectorBeaAdminClient();

    // Handle slug conflicts by appending a short suffix
    const ts = Date.now().toString(36);
    const finalSlug = `${slug}-${ts}`;

    const { data, error } = await supabase
      .from("connections")
      .insert({
        workspace_id:   workspaceId,
        name:           String(name),
        slug:           finalSlug,
        type:           String(type),
        provider:       String(provider),
        environment:    String(environment ?? "development"),
        status:         "not_tested",
        auth_type:      String(authType ?? "none"),
        secret_ref:     secretRef    ? String(secretRef)    : null,
        secret_masked:  secretMasked ? String(secretMasked) : null,
        config:         config        ?? {},
        network_policy: networkPolicy ?? { requireWhitelist: false, privateRunnerRequired: false, networkStatus: "unknown" },
        used_by_agent_ids: [],
        used_by_tool_ids:  [],
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
