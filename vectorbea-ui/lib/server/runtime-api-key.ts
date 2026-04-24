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
  revoked_at: string | null;
};

type DeploymentAgentRecord = {
  id: string;
  workspace_id: string;
  name: string | null;
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

/**
 * Fallback for legacy `vbagent_` keys that were provisioned by the vbagent CLI
 * and stored as raw tokens in `deployment_agents.api_token` rather than as
 * SHA-256 hashes in `api_keys.key_hash`.
 *
 * This path is only tried when the primary `api_keys` lookup fails (table error)
 * or finds no row, and the token carries the `vbagent_` prefix.
 */
async function authenticateLegacyAgentToken(rawToken: string): Promise<RuntimeApiKeyAuth> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("deployment_agents")
    .select("id, workspace_id, name")
    .eq("api_token", rawToken)
    .maybeSingle<DeploymentAgentRecord>();

  if (error || !data) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
    };
  }

  return {
    ok: true,
    keyId: data.id,
    workspaceId: data.workspace_id,
    keyName: data.name ?? "agent",
    // Legacy agent tokens are treated as admin-scoped — they were issued for
    // sidecar use which requires full read/write access.
    keyRole: "admin",
  };
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
  //   vbagent_   legacy agent-provisioned key (vbagent CLI / older SDK)
  if (!/^(?:vb(?:_(?:live|test))?_|vbagent_)[A-Za-z0-9\-_]+$/.test(rawToken)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key format" }, { status: 401 }),
    };
  }

  // ── Primary path: api_keys table (SHA-256 hash lookup) ──────────────────
  const keyHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, workspace_id, key_name, key_role, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle<ApiKeyRecord>();

  if (error) {
    // api_keys query failed (table missing, permission error, etc.).
    // For vbagent_ tokens fall through to the legacy deployment_agents lookup
    // so existing sidecars keep working during schema migrations.
    if (rawToken.startsWith("vbagent_")) {
      return authenticateLegacyAgentToken(rawToken);
    }
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to validate API key" }, { status: 500 }),
    };
  }

  if (!data) {
    // No row found in api_keys. vbagent_ tokens may still be in deployment_agents.
    if (rawToken.startsWith("vbagent_")) {
      return authenticateLegacyAgentToken(rawToken);
    }
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
    };
  }

  if (data.revoked_at) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
    };
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
