import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { cacheDel, CacheKeys } from "@/lib/server/cache";

function rowToAgent(r: Record<string, unknown>) {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name, slug: r.slug,
    description: r.description ?? "", role: r.role ?? "", instructions: r.instructions ?? "",
    type: r.type ?? "native_llm_agent", modelProvider: r.model_provider ?? "openai",
    modelName: r.model_name ?? "gpt-4.1-mini", temperature: Number(r.temperature ?? 0.1),
    maxIterations: r.max_iterations ?? 10, llmConnectionId: r.llm_connection_id ?? null,
    allowedToolIds: r.allowed_tool_ids ?? [], memoryPolicy: r.memory_policy ?? {},
    retryPolicy: r.retry_policy ?? {}, timeoutPolicy: r.timeout_policy ?? {},
    approvalPolicy: r.approval_policy ?? {}, status: r.status ?? "active",
    totalRuns: r.total_runs ?? 0, lastUsedAt: r.last_used_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT * FROM vectorbea.platform_agents WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid LIMIT 1
  `);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rowToAgent(rows[0]));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const updates: Prisma.Sql[] = [];
  if (typeof body.name === "string")         updates.push(Prisma.sql`name = ${body.name}`);
  if (typeof body.description === "string")  updates.push(Prisma.sql`description = ${body.description}`);
  if (typeof body.role === "string")         updates.push(Prisma.sql`role = ${body.role}`);
  if (typeof body.instructions === "string") updates.push(Prisma.sql`instructions = ${body.instructions}`);
  if (typeof body.modelProvider === "string") updates.push(Prisma.sql`model_provider = ${body.modelProvider}`);
  if (typeof body.modelName === "string")    updates.push(Prisma.sql`model_name = ${body.modelName}`);
  if (typeof body.temperature === "number")  updates.push(Prisma.sql`temperature = ${body.temperature}`);
  if (typeof body.maxIterations === "number") updates.push(Prisma.sql`max_iterations = ${body.maxIterations}`);
  if (body.llmConnectionId !== undefined)    updates.push(Prisma.sql`llm_connection_id = ${body.llmConnectionId}`);
  if (typeof body.status === "string")       updates.push(Prisma.sql`status = ${body.status}`);
  if (body.retryPolicy)    updates.push(Prisma.sql`retry_policy = ${JSON.stringify(body.retryPolicy)}::jsonb`);
  if (body.timeoutPolicy)  updates.push(Prisma.sql`timeout_policy = ${JSON.stringify(body.timeoutPolicy)}::jsonb`);
  if (body.approvalPolicy) updates.push(Prisma.sql`approval_policy = ${JSON.stringify(body.approvalPolicy)}::jsonb`);
  if (body.allowedToolIds) updates.push(Prisma.sql`allowed_tool_ids = ${JSON.stringify(body.allowedToolIds)}::jsonb`);
  updates.push(Prisma.sql`updated_at = now()`);

  let clause = updates[0]!;
  for (let i = 1; i < updates.length; i++) clause = Prisma.sql`${clause}, ${updates[i]}`;

  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    UPDATE vectorbea.platform_agents SET ${clause} WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid RETURNING *
  `);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await cacheDel(CacheKeys.agentList(workspaceId));
  return NextResponse.json(rowToAgent(rows[0]));
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  await db.$executeRaw(Prisma.sql`DELETE FROM vectorbea.platform_agents WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`);
  await cacheDel(CacheKeys.agentList(workspaceId));
  return new NextResponse(null, { status: 204 });
}
