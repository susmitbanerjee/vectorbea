import { createHash, randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import type { ApiKeyView, CreateApiKeyResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([] as ApiKeyView[]);
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, workspace_id, key_name, key_last_four, key_role, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const keys: ApiKeyView[] = (data ?? []).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.key_name ?? "",
      maskedKey: `vb_****${row.key_last_four ?? ""}`,
      createdAt: row.created_at,
    }));

    return NextResponse.json(keys);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load API keys" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const payload = (await request.json()) as { keyName?: string; keyRole?: string };
    const keyName = payload.keyName?.trim() || "default";
    const keyRole = payload.keyRole?.trim() || "admin";

    const rawKey = `vb_${randomBytes(32).toString("base64url")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyLastFour = rawKey.slice(-4);

    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("api_keys")
      .insert({
        workspace_id: workspaceId,
        key_name: keyName,
        key_hash: keyHash,
        key_last_four: keyLastFour,
        key_role: keyRole,
      })
      .select("id, workspace_id, key_name, created_at")
      .single();

    if (error) throw new Error(error.message);

    const response: CreateApiKeyResponse = {
      id: data.id,
      workspaceId: data.workspace_id,
      name: data.key_name,
      apiKey: rawKey,
      createdAt: data.created_at,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create API key" },
      { status: 500 },
    );
  }
}
