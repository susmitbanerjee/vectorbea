import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { storeSecret, deleteSecret } from "@/lib/server/secret-service";
import { cacheDel, CacheKeys } from "@/lib/server/cache";

function maskSecret(s: string): string {
  if (s.length <= 8) return "••••••••";
  return s.slice(0, 4) + "••••••••" + s.slice(-4);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizeConfig(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) return {};
  const blocked = /(secret|password|passwd|pwd|token|api[_-]?key|private[_-]?key|authorization|auth[_-]?header)/i;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isPlainObject(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v)) {
      if (blocked.test(k)) continue;
      out[k] = walk(child);
    }
    return out;
  };
  return walk(input) as Record<string, unknown>;
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
    // SECURITY: secretRef is opaque handle only; never return ciphertext or plaintext
    secretRef: row.secret_ref ?? null,
    secretMasked: row.secret_masked ?? null,
    secretConfigured: row.secret_ref != null,
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

// ─── GET /api/connections/[id] ────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT * FROM vectorbea.connections
      WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
      LIMIT 1
    `);
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(dbToConnection(rows[0]));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// ─── PATCH /api/connections/[id] ─────────────────────────────────────────────

const ALLOWED_STATUSES = new Set([
  "connected", "not_tested", "failed", "needs_whitelist", "missing_secret", "disabled",
]);
const ALLOWED_AUTH_TYPES = new Set([
  "api_key", "bearer_token", "basic_auth", "oauth2", "aws_iam", "custom_header", "connection_string", "none",
]);
const ALLOWED_ENVIRONMENTS = new Set(["development", "staging", "production"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const workspaceId =
    request.nextUrl.searchParams.get("workspaceId") ??
    (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  // Verify the connection belongs to this workspace before updating
  const existing = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT id FROM vectorbea.connections WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid LIMIT 1
  `);
  if (!existing[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates: Prisma.Sql[] = [];

  if (typeof body.name === "string" && body.name.trim()) {
    updates.push(Prisma.sql`name = ${body.name.trim()}`);
  }
  if (typeof body.description === "string") {
    updates.push(Prisma.sql`description = ${body.description}`);
  }
  if (typeof body.environment === "string" && ALLOWED_ENVIRONMENTS.has(body.environment)) {
    updates.push(Prisma.sql`environment = ${body.environment}`);
  }
  if (typeof body.authType === "string" && ALLOWED_AUTH_TYPES.has(body.authType)) {
    updates.push(Prisma.sql`auth_type = ${body.authType}`);
  }
  if (typeof body.status === "string" && ALLOWED_STATUSES.has(body.status)) {
    updates.push(Prisma.sql`status = ${body.status}`);
  }
  if (isPlainObject(body.config)) {
    updates.push(Prisma.sql`config = ${JSON.stringify(sanitizeConfig(body.config))}::jsonb`);
  }
  if (isPlainObject(body.networkPolicy)) {
    updates.push(Prisma.sql`network_policy = ${JSON.stringify(body.networkPolicy)}::jsonb`);
  }
  // Test result fields (set by test route, also patchable for external sync)
  if (typeof body.lastTestStatus === "string") {
    updates.push(Prisma.sql`last_test_status = ${body.lastTestStatus}`);
  }
  if (typeof body.lastTestError === "string" || body.lastTestError === null) {
    updates.push(Prisma.sql`last_test_error = ${body.lastTestError as string | null}`);
  }
  if (typeof body.lastTestLatencyMs === "number" || body.lastTestLatencyMs === null) {
    updates.push(Prisma.sql`last_test_latency_ms = ${body.lastTestLatencyMs as number | null}`);
  }
  if (typeof body.lastTestedAt === "string" || body.lastTestedAt === null) {
    updates.push(Prisma.sql`last_tested_at = ${body.lastTestedAt as string | null}`);
  }

  updates.push(Prisma.sql`updated_at = now()`);

  try {
    let clause = updates[0]!;
    for (let i = 1; i < updates.length; i++) clause = Prisma.sql`${clause}, ${updates[i]}`;

    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      UPDATE vectorbea.connections SET ${clause}
      WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
      RETURNING *
    `);

    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Secret rotation: if plaintextSecret provided, re-encrypt and store
    if (typeof body.plaintextSecret === "string" && body.plaintextSecret.trim()) {
      const plain = body.plaintextSecret.trim();
      const secretRef = await storeSecret(workspaceId, id, plain);
      const secretMasked = maskSecret(plain);
      const updated = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        UPDATE vectorbea.connections
        SET secret_ref = ${secretRef}, secret_masked = ${secretMasked}, updated_at = now()
        WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
        RETURNING *
      `);
      await cacheDel(CacheKeys.connections(workspaceId));
      return NextResponse.json(dbToConnection(updated[0] ?? rows[0]));
    }

    await cacheDel(CacheKeys.connections(workspaceId));
    return NextResponse.json(dbToConnection(rows[0]));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// ─── DELETE /api/connections/[id] ────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  try {
    // Check for active dependencies before hard delete
    const conn = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT used_by_agent_ids, used_by_tool_ids FROM vectorbea.connections
      WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
      LIMIT 1
    `);
    if (!conn[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const agentIds = (conn[0].used_by_agent_ids as string[]) ?? [];
    const toolIds  = (conn[0].used_by_tool_ids as string[]) ?? [];
    const force = request.nextUrl.searchParams.get("force") === "1";

    if (!force && (agentIds.length > 0 || toolIds.length > 0)) {
      return NextResponse.json({
        error: "Connection is in use by agents or tools. Pass ?force=1 to delete anyway.",
        usedByAgentIds: agentIds,
        usedByToolIds: toolIds,
      }, { status: 409 });
    }

    // Clean up encrypted secret
    await deleteSecret(id).catch(() => { /* no-op if no secret */ });

    await db.$executeRaw(Prisma.sql`
      DELETE FROM vectorbea.connections WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
    `);

    await cacheDel(CacheKeys.connections(workspaceId));
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
