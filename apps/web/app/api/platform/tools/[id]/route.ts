import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { cacheDel, CacheKeys } from "@/lib/server/cache";

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT * FROM platform_tools WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid LIMIT 1
  `);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rowToTool(rows[0]));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const updates: Prisma.Sql[] = [];
  if (typeof body.name === "string")        updates.push(Prisma.sql`name = ${body.name}`);
  if (typeof body.description === "string") updates.push(Prisma.sql`description = ${body.description}`);
  if (typeof body.type === "string")        updates.push(Prisma.sql`type = ${body.type}`);
  if (typeof body.riskLevel === "string")   updates.push(Prisma.sql`risk_level = ${body.riskLevel}`);
  if (typeof body.timeoutMs === "number")   updates.push(Prisma.sql`timeout_ms = ${body.timeoutMs}`);
  if (body.connectionId !== undefined)      updates.push(Prisma.sql`connection_id = ${body.connectionId}`);
  if (body.connectionName !== undefined)    updates.push(Prisma.sql`connection_name = ${body.connectionName}`);
  if (typeof body.status === "string")      updates.push(Prisma.sql`status = ${body.status}`);
  if (body.httpConfig)  updates.push(Prisma.sql`http_config = ${JSON.stringify(body.httpConfig)}::jsonb`);
  if (body.retryPolicy) updates.push(Prisma.sql`retry_policy = ${JSON.stringify(body.retryPolicy)}::jsonb`);
  updates.push(Prisma.sql`updated_at = now()`);

  let clause = updates[0]!;
  for (let i = 1; i < updates.length; i++) clause = Prisma.sql`${clause}, ${updates[i]}`;

  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    UPDATE platform_tools SET ${clause} WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid RETURNING *
  `);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await cacheDel(CacheKeys.toolList(workspaceId));
  return NextResponse.json(rowToTool(rows[0]));
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  await db.$executeRaw(Prisma.sql`DELETE FROM platform_tools WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`);
  await cacheDel(CacheKeys.toolList(workspaceId));
  return new NextResponse(null, { status: 204 });
}
