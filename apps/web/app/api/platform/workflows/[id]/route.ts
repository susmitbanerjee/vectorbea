import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { cacheDel, CacheKeys } from "@/lib/server/cache";

function rowToWorkflow(r: Record<string, unknown>) {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name, slug: r.slug,
    description: r.description ?? "", status: r.status ?? "draft",
    creationMode: r.creation_mode ?? "native", triggerType: r.trigger_type ?? "manual",
    currentVersion: r.current_version ?? "v1",
    inputSchema: r.input_schema ?? {}, outputSchema: r.output_schema ?? {},
    steps: [], agentIds: [], toolIds: [],
    retryPolicy: r.retry_policy ?? {}, budgetPolicy: r.budget_policy ?? {},
    approvalPolicy: r.approval_policy ?? {},
    totalRuns: r.total_runs ?? 0, successRate: r.success_rate ?? 0,
    lastRunAt: r.last_run_at ?? null, lastRunStatus: r.last_run_status ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT * FROM platform_workflows WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid LIMIT 1
  `);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rowToWorkflow(rows[0]));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const updates: Prisma.Sql[] = [];
  if (typeof body.name === "string")        updates.push(Prisma.sql`name = ${body.name}`);
  if (typeof body.description === "string") updates.push(Prisma.sql`description = ${body.description}`);
  if (typeof body.status === "string")      updates.push(Prisma.sql`status = ${body.status}`);
  if (body.retryPolicy)   updates.push(Prisma.sql`retry_policy = ${JSON.stringify(body.retryPolicy)}::jsonb`);
  if (body.budgetPolicy)  updates.push(Prisma.sql`budget_policy = ${JSON.stringify(body.budgetPolicy)}::jsonb`);
  if (body.approvalPolicy) updates.push(Prisma.sql`approval_policy = ${JSON.stringify(body.approvalPolicy)}::jsonb`);
  updates.push(Prisma.sql`updated_at = now()`);

  let clause = updates[0]!;
  for (let i = 1; i < updates.length; i++) clause = Prisma.sql`${clause}, ${updates[i]}`;

  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    UPDATE platform_workflows SET ${clause}
    WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid RETURNING *
  `);
  if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await cacheDel(CacheKeys.workflowList(workspaceId));
  return NextResponse.json(rowToWorkflow(rows[0]));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  await db.$executeRaw(Prisma.sql`
    DELETE FROM platform_workflows WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
  `);
  await cacheDel(CacheKeys.workflowList(workspaceId));
  return new NextResponse(null, { status: 204 });
}
