import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type ApiKeyRecord = {
  id: string;
  workspace_id: string;
  key_name: string;
  key_role: "admin" | "editor" | "viewer";
  // Optional: column may not exist on older schema versions.
  // Run: ALTER TABLE vectorbea.api_keys ADD COLUMN IF NOT EXISTS revoked_at timestamptz DEFAULT NULL;
  revoked_at?: string | null;
};

export type RuntimeApiKeyAuth =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      keyId: string;
      workspaceId: string;
      keyName: string;
      keyRole: ApiKeyRecord["key_role"];
    };

function readBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return token.length > 0 ? token : null;
}

export function readRuntimeToken(request: NextRequest): string | null {
  return readBearerToken(request);
}

export async function authenticateRuntimeApiKey(request: NextRequest): Promise<RuntimeApiKeyAuth> {
  const rawToken = readBearerToken(request);
  if (!rawToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authorization header with Bearer API key is required" },
        { status: 401 },
      ),
    };
  }

  // Accepted prefixes:
  //   vb_live_   dashboard production key
  //   vb_test_   dashboard non-production key
  //   vb_        legacy short prefix
  //   vbagent_   legacy agent-provisioned key (migrated into api_keys as SHA-256 hash)
  if (!/^(?:vb(?:_(?:live|test))?_|vbagent_)[A-Za-z0-9\-_]+$/.test(rawToken)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key format" }, { status: 401 }),
    };
  }

  const keyHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = createVectorBeaAdminClient();

  // Select only the columns guaranteed to exist in the base schema.
  // revoked_at is selected separately so a missing column never breaks auth.
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, workspace_id, key_name, key_role")
    .eq("key_hash", keyHash)
    .maybeSingle<ApiKeyRecord>();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to validate API key" }, { status: 500 }),
    };
  }

  if (!data) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
    };
  }

  // Check revocation — best-effort; if the column doesn't exist yet the
  // separate query errors are swallowed so auth still succeeds.
  try {
    const { data: revocationRow } = await supabase
      .from("api_keys")
      .select("revoked_at")
      .eq("id", data.id)
      .maybeSingle<{ revoked_at: string | null }>();
    if (revocationRow?.revoked_at) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
      };
    }
  } catch {
    // Column not yet migrated — skip revocation check.
  }

  // Best-effort telemetry field; do not fail request if column is missing.
  try {
    await supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
  } catch {
    // Swallow telemetry update failures; auth success should not fail.
  }

  return {
    ok: true,
    keyId: data.id,
    workspaceId: data.workspace_id,
    keyName: data.key_name ?? "",
    keyRole: data.key_role ?? "viewer",
  };
}
