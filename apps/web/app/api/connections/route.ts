import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { storeSecret, deleteSecret } from "@/lib/server/secret-service";

function maskSecret(s: string): string {
  if (s.length <= 8) return "••••••••";
  return s.slice(0, 4) + "••••••••" + s.slice(-4);
}

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

  try {
    const type = request.nextUrl.searchParams.get("type");
    const status = request.nextUrl.searchParams.get("status");
    const search = request.nextUrl.searchParams.get("search");

    const clauses: Prisma.Sql[] = [Prisma.sql`workspace_id = ${workspaceId}`];
    if (type) clauses.push(Prisma.sql`type = ${type}`);
    if (status) clauses.push(Prisma.sql`status = ${status}`);
    if (search) {
      const q = `%${search}%`;
      clauses.push(Prisma.sql`(name ILIKE ${q} OR provider ILIKE ${q} OR type ILIKE ${q})`);
    }

    let whereClause = clauses[0] ?? Prisma.sql`1=1`;
    for (let i = 1; i < clauses.length; i += 1) {
      whereClause = Prisma.sql`${whereClause} AND ${clauses[i]}`;
    }

    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT *
      FROM connections
      WHERE ${whereClause}
      ORDER BY created_at DESC
    `);

    return NextResponse.json((rows ?? []).map((r) => dbToConnection(r)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const workspaceId = extractWorkspaceId(request, body);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  try {
    const {
      name,
      type,
      provider,
      environment,
      authType,
      plaintextSecret, // accepted server-side only; never stored raw
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
    const ts = Date.now().toString(36);
    const finalSlug = `${createSlug(String(name))}-${ts}`;
    const sanitizedConfig = sanitizeConfig(config);
    const safeNetworkPolicy = isPlainObject(networkPolicy)
      ? networkPolicy
      : { requireWhitelist: false, privateRunnerRequired: false, networkStatus: "unknown" };

    // Insert the connection first to get its ID
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      INSERT INTO connections (
        workspace_id, name, slug, type, provider, environment, status, auth_type,
        secret_ref, secret_masked, config, network_policy,
        used_by_agent_ids, used_by_tool_ids, created_at, updated_at
      ) VALUES (
        ${workspaceId}, ${String(name)}, ${finalSlug}, ${normalizedType}, ${normalizedProvider},
        ${normalizedEnvironment}, 'not_tested', ${normalizedAuthType},
        null, null,
        ${JSON.stringify(sanitizedConfig)}::jsonb, ${JSON.stringify(safeNetworkPolicy)}::jsonb,
        ARRAY[]::text[], ARRAY[]::text[], now(), now()
      )
      RETURNING *
    `);

    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });

    // If a plaintext secret was provided, encrypt and store it server-side
    if (plaintextSecret && typeof plaintextSecret === "string" && plaintextSecret.trim()) {
      const connectionId = String(row.id);
      const secretRef = await storeSecret(workspaceId, connectionId, plaintextSecret.trim());
      const secretMasked = maskSecret(plaintextSecret.trim());
      const updated = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        UPDATE connections SET secret_ref = ${secretRef}, secret_masked = ${secretMasked}, updated_at = now()
        WHERE id = ${connectionId}::uuid AND workspace_id = ${workspaceId}
        RETURNING *
      `);
      return NextResponse.json(dbToConnection(updated[0] ?? row), { status: 201 });
    }

    return NextResponse.json(dbToConnection(row), { status: 201 });
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

  const updates: Prisma.Sql[] = [];

  if (typeof body.status === "string") {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    updates.push(Prisma.sql`status = ${body.status}`);
  }
  if (typeof body.lastTestStatus === "string") updates.push(Prisma.sql`last_test_status = ${body.lastTestStatus}`);
  if (typeof body.lastTestError === "string" || body.lastTestError === null) updates.push(Prisma.sql`last_test_error = ${body.lastTestError}`);
  if (typeof body.lastTestLatencyMs === "number" || body.lastTestLatencyMs === null) updates.push(Prisma.sql`last_test_latency_ms = ${body.lastTestLatencyMs}`);
  if (typeof body.lastTestedAt === "string" || body.lastTestedAt === null) updates.push(Prisma.sql`last_tested_at = ${body.lastTestedAt}`);

  updates.push(Prisma.sql`updated_at = now()`);

  try {
    let updateClause = updates[0] ?? Prisma.sql`updated_at = now()`;
    for (let i = 1; i < updates.length; i += 1) {
      updateClause = Prisma.sql`${updateClause}, ${updates[i]}`;
    }

    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      UPDATE connections
      SET ${updateClause}
      WHERE workspace_id = ${workspaceId} AND id = ${id}
      RETURNING *
    `);

    if (!rows[0]) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return NextResponse.json(dbToConnection(rows[0]));
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

  try {
    // Clean up secret before deleting connection
    await deleteSecret(id).catch(() => {/* no-op if no secret */});

    await db.$executeRaw(Prisma.sql`
      DELETE FROM connections
      WHERE workspace_id = ${workspaceId} AND id = ${id}
    `);

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
