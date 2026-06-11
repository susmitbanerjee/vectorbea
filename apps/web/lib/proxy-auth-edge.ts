import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type ApiKeyRow = {
  id: string;
  workspace_id: string;
  key_name: string;
  key_role: "admin" | "editor" | "viewer";
  revoked_at: string | null;
};

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

async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function supabaseSelect<T>(path: string) {
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
    throw new Error("Failed API key lookup");
  }
  return (await response.json()) as T;
}

async function supabasePatch(path: string, body: Record<string, unknown>) {
  const { restUrl, serviceRoleKey } = getSupabaseConfig();
  await fetch(`${restUrl}${path}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Accept-Profile": "vectorbea",
      "Content-Profile": "vectorbea",
      Prefer: "return=minimal",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => undefined);
}

export type EdgeProxyAuth =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      keyId: string;
      workspaceId: string;
      keyName: string;
      keyRole: "admin" | "editor" | "viewer";
      rawToken: string;
    };

export async function authenticateProxyApiKey(request: NextRequest): Promise<EdgeProxyAuth> {
  const authHeader = request.headers.get("authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!rawToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authorization header with Bearer API key is required" },
        { status: 401 },
      ),
    };
  }

  if (!/^vb(?:_(?:live|test))?_[A-Za-z0-9\-_]+$/.test(rawToken)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key format" }, { status: 401 }),
    };
  }

  try {
    const keyHash = await sha256Hex(rawToken);
    const rows = await supabaseSelect<ApiKeyRow[]>(
      `/api_keys?select=id,workspace_id,key_name,key_role,revoked_at&key_hash=eq.${encodeURIComponent(keyHash)}&limit=1`,
    );
    const key = rows[0];
    if (!key || key.revoked_at) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }),
      };
    }
    // Best-effort.
    void supabasePatch(`/api_keys?id=eq.${encodeURIComponent(key.id)}`, {
      last_used_at: new Date().toISOString(),
    });
    return {
      ok: true,
      keyId: key.id,
      workspaceId: key.workspace_id,
      keyName: key.key_name ?? "",
      keyRole: key.key_role ?? "viewer",
      rawToken,
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to validate API key" }, { status: 500 }),
    };
  }
}

