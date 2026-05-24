import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { cacheDel, CacheKeys } from "@/lib/server/cache";

const ALLOWED_TYPES = new Set(["http","database_read","database_write","slack","email","crm","custom_function","mcp_tool","imported_tool"]);
const ALLOWED_RISK  = new Set(["read_only","low_risk_write","high_risk_write","irreversible"]);

function createSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rowToTool(r: Record<string, unknown>) {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name, slug: r.slug,
    description: r.description ?? "", type: r.type ?? "http",
    inputSchema: r.input_schema ?? {}, outputSchema: r.output_schema ?? {},
    riskLevel: r.risk_level ?? "read_only", timeoutMs: r.timeout_ms ?? 10000,
    retryPolicy: r.retry_policy ?? {}, idempotent: r.idempotent ?? true,
    connectionId: r.connection_id ?? null, connectionName: r.connection_name ?? null,
    authConnectionRef: r.auth_connection_ref ?? null, httpConfig: r.http_config ?? null,
    status: r.status ?? "active", totalCalls: r.total_calls ?? 0,
    lastUsedAt: r.last_used_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT * FROM platform_tools WHERE workspace_id = ${workspaceId}::uuid ORDER BY updated_at DESC
    `);
    return NextResponse.json(rows.map(rowToTool));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const type      = String(body.type ?? "http");
  const riskLevel = String(body.riskLevel ?? "read_only");
  if (!ALLOWED_TYPES.has(type))  return NextResponse.json({ error: "invalid type" }, { status: 400 });
  if (!ALLOWED_RISK.has(riskLevel)) return NextResponse.json({ error: "invalid riskLevel" }, { status: 400 });

  try {
    const slug = `${createSlug(String(body.name))}-${Date.now().toString(36)}`;
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      INSERT INTO platform_tools (
        workspace_id, name, slug, description, type, input_schema, output_schema,
        risk_level, timeout_ms, retry_policy, idempotent,
        connection_id, connection_name, auth_connection_ref, http_config
      ) VALUES (
        ${workspaceId}::uuid, ${String(body.name)}, ${slug},
        ${String(body.description ?? "")}, ${type},
        ${JSON.stringify(body.inputSchema ?? {})}::jsonb,
        ${JSON.stringify(body.outputSchema ?? {})}::jsonb,
        ${riskLevel}, ${Number(body.timeoutMs ?? 10000)},
        ${JSON.stringify(body.retryPolicy ?? { maxAttempts: 3, backoffType: "exponential", backoffMs: 1000 })}::jsonb,
        ${body.idempotent !== false},
        ${body.connectionId ?? null},
        ${body.connectionName ? String(body.connectionName) : null},
        ${body.authConnectionRef ? String(body.authConnectionRef) : null},
        ${body.httpConfig ? JSON.stringify(body.httpConfig) + "::jsonb" : null}
      ) RETURNING *
    `);
    await cacheDel(CacheKeys.toolList(workspaceId));
    return NextResponse.json(rowToTool(rows[0]!), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
