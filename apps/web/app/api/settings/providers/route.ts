import { NextRequest, NextResponse } from "next/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";

/**
 * Required table schema for provider_configs:
 *
 * CREATE TABLE provider_configs (
 *   id uuid PRIMARY KEY,
 *   workspace_id uuid NOT NULL,
 *   provider_type text NOT NULL,
 *   display_name text NOT NULL,
 *   enabled boolean NOT NULL DEFAULT true,
 *   default_model text,
 *   base_url text,
 *   masked_key text NOT NULL,
 *   encrypted_key text NOT NULL,
 *   created_at timestamptz NOT NULL,
 *   updated_at timestamptz NOT NULL,
 *   last_used_at timestamptz
 * );
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;
  try {
    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("provider_configs")
      .select("id, workspace_id, provider_type, display_name, enabled, default_model, base_url, masked_key, created_at, updated_at, last_used_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // Map snake_case DB columns → camelCase ProviderConfig shape
    const mapped = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      providerType: row.provider_type,
      displayName: row.display_name,
      enabled: row.enabled,
      defaultModel: row.default_model ?? null,
      baseUrl: row.base_url ?? null,
      maskedKey: row.masked_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return NextResponse.json(mapped);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;
  // Require admin role — check membership role
  try {
    const supabase = createVectorBeaAdminClient();
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", authResult.user.id)
      .maybeSingle();
    if (!membership || membership.role !== "admin") {
      return NextResponse.json({ error: "Admin role required to manage provider configs." }, { status: 403 });
    }
    const body = await request.json();
    const { providerType, displayName, enabled, defaultModel, baseUrl, apiKey } = body as {
      providerType: string; displayName?: string; enabled?: boolean;
      defaultModel?: string; baseUrl?: string; apiKey?: string;
    };
    const ALLOWED_PROVIDERS = ["openai", "anthropic", "google", "enterprise_gateway"];
    if (!ALLOWED_PROVIDERS.includes(providerType)) {
      return NextResponse.json({ error: `Invalid provider type. Allowed: ${ALLOWED_PROVIDERS.join(", ")}` }, { status: 400 });
    }
    if (!apiKey?.trim()) return NextResponse.json({ error: "API key is required" }, { status: 400 });
    const key = apiKey.trim();
    const maskedKey = key.length > 8 ? `${key.slice(0, 3)}${"*".repeat(key.length - 7)}${key.slice(-4)}` : "****";
    const encKey = process.env.VECTORBEA_ENCRYPTION_KEY ?? "";
    let storedKey = Buffer.from(key).toString("base64");
    if (encKey) {
      const keyBytes = Buffer.from(encKey.slice(0, 32).padEnd(32, "0"));
      const dataBytes = Buffer.from(key);
      const xored = Buffer.alloc(dataBytes.length);
      for (let i = 0; i < dataBytes.length; i++) xored[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
      storedKey = xored.toString("base64");
    }
    const { data, error } = await supabase
      .from("provider_configs")
      .insert({
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        provider_type: providerType,
        display_name: displayName ?? providerType,
        enabled: enabled ?? true,
        default_model: defaultModel ?? null,
        base_url: baseUrl ?? null,
        masked_key: maskedKey,
        encrypted_key: storedKey,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id, workspace_id, provider_type, display_name, enabled, default_model, base_url, masked_key, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown>;
    return NextResponse.json({
      id: row.id,
      workspaceId: row.workspace_id,
      providerType: row.provider_type,
      displayName: row.display_name,
      enabled: row.enabled,
      defaultModel: row.default_model ?? null,
      baseUrl: row.base_url ?? null,
      maskedKey: row.masked_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
