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
  //   vbagent_   legacy agent-provisioned key (vbagent CLI / older SDK)
  if (!/^(?:vb(?:_(?:live|test))?_|vbagent_)[A-Za-z0-9\-_]+$/.test(rawToken)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key format" }, { status: 401 }),
    };
  }

  const keyHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, workspace_id, key_name, key_role, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle<ApiKeyRecord>();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to validate API key" }, { status: 500 }),
    };
  }

  if (!data || data.revoked_at) {
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
