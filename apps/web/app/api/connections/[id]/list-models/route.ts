/**
 * POST /api/connections/:id/list-models
 *
 * List available models for an LLM provider connection.
 * Resolves the API key server-side and queries the provider's models endpoint.
 *
 * SECURITY: API key never returned to client.
 */

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { getSecretForRuntime } from "@/lib/server/secret-service";

// ─── Known model lists (fallback when provider doesn't have a /models endpoint) ─

const KNOWN_MODELS: Record<string, string[]> = {
  openai: [
    "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
    "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo",
    "o1", "o1-mini", "o3", "o3-mini", "o4-mini",
  ],
  anthropic: [
    "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5",
    "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022", "claude-3-opus-20240229",
  ],
  google: [
    "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash",
    "gemini-1.5-pro", "gemini-1.5-flash",
  ],
  qwen: [
    "qwen-max", "qwen-plus", "qwen-turbo", "qwen2.5-72b-instruct",
    "qwen2.5-7b-instruct",
  ],
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const { id: connectionId } = await params;

  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT id, type, config_json, secret_ref, base_url, status
    FROM vectorbea.connections
    WHERE id = ${connectionId}::uuid
      AND workspace_id = ${workspaceId}::uuid
    LIMIT 1
  `).catch(() => [] as Record<string, unknown>[]);

  const conn = rows[0];
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  if (conn.status !== "active") return NextResponse.json({ error: "Connection is not active" }, { status: 422 });

  const connType = String(conn.type ?? "");
  if (!connType.includes("llm") && !connType.includes("ai") && !connType.includes("openai") && !connType.includes("anthropic")) {
    return NextResponse.json({ error: "Model listing is only available for LLM provider connections" }, { status: 422 });
  }

  const configJson = (conn.config_json ?? {}) as Record<string, unknown>;
  const providerType = String(configJson.providerType ?? connType).toLowerCase();
  const baseUrl = typeof conn.base_url === "string" ? conn.base_url : null;

  // Check if we have known models (avoid API call)
  const known = KNOWN_MODELS[providerType];
  if (known) {
    return NextResponse.json({
      connectionId,
      provider: providerType,
      models: known.map((id) => ({ id, name: id })),
      source: "builtin",
    });
  }

  // Try to list models from the provider API
  const secretRef = typeof conn.secret_ref === "string" ? conn.secret_ref : null;
  if (!secretRef) {
    return NextResponse.json({
      connectionId,
      provider: providerType,
      models: [],
      source: "no_secret",
      warning: "No API key configured",
    });
  }

  const apiKey = await getSecretForRuntime(secretRef);
  if (!apiKey) {
    return NextResponse.json({
      connectionId,
      provider: providerType,
      models: [],
      source: "secret_error",
      warning: "Could not resolve API key",
    });
  }

  // Try OpenAI-compatible /models endpoint
  const modelsUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/v1/models`
    : "https://api.openai.com/v1/models";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);

      if (!resp.ok) throw new Error(`Provider returned ${resp.status}`);

      const data = await resp.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((m) => ({ id: m.id, name: m.id }));

      return NextResponse.json({
        connectionId,
        provider: providerType,
        models,
        source: "live",
      });
    } catch {
      clearTimeout(timer);
      throw new Error("Could not reach models endpoint");
    }
  } catch (err) {
    const safe = ((err as Error).message ?? "").replace(apiKey, "[REDACTED]");
    return NextResponse.json({
      connectionId,
      provider: providerType,
      models: [],
      source: "error",
      warning: `Could not fetch model list: ${safe}`,
    });
  }
}
