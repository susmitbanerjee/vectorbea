import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";

function rowToRun(r: Record<string, unknown>) {
  const errorJson = r.error_json as Record<string, unknown> | null ?? null;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workflowId: r.workflow_id ?? null,
    workflowName: r.workflow_name,
    workflowVersion: r.workflow_version ?? "v1",
    creationMode: r.creation_mode ?? "native",
    status: r.status ?? "queued",
    triggerType: r.trigger_type ?? "manual",
    triggerSource: r.trigger_source ?? "manual",
    input: r.input_json ?? null,
    output: r.output_json ?? null,
    error: errorJson ? String(errorJson.message ?? JSON.stringify(errorJson)) : null,
    idempotencyKey: r.idempotency_key ?? null,
    startedAt: r.started_at ?? null,
    completedAt: r.completed_at ?? null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    totalTokens: r.total_tokens != null ? Number(r.total_tokens) : null,
    estimatedCostUsd: r.estimated_cost_usd != null ? Number(r.estimated_cost_usd) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    checkpoints: [],
    artifacts: [],
    approvalGates: [],
    replayAvailable: false,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT * FROM vectorbea.platform_runs WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid LIMIT 1
    `);
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rowToRun(rows[0]));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const ALLOWED_STATUSES = new Set(["queued", "running", "succeeded", "failed", "cancelled", "waiting_approval"]);

  const updates: Prisma.Sql[] = [];
  if (typeof body.status === "string" && ALLOWED_STATUSES.has(body.status)) {
    updates.push(Prisma.sql`status = ${body.status}`);
    if (["succeeded", "failed", "cancelled"].includes(body.status)) {
      updates.push(Prisma.sql`completed_at = now()`);
    }
  }
  if (body.outputJson !== undefined) updates.push(Prisma.sql`output_json = ${JSON.stringify(body.outputJson)}::jsonb`);
  if (body.errorJson !== undefined)  updates.push(Prisma.sql`error_json = ${JSON.stringify(body.errorJson)}::jsonb`);
  if (typeof body.durationMs === "number") updates.push(Prisma.sql`duration_ms = ${body.durationMs}`);
  if (typeof body.totalTokens === "number") updates.push(Prisma.sql`total_tokens = ${body.totalTokens}`);
  if (typeof body.estimatedCostUsd === "number") updates.push(Prisma.sql`estimated_cost_usd = ${body.estimatedCostUsd}`);
  updates.push(Prisma.sql`updated_at = now()`);

  try {
    let clause = updates[0]!;
    for (let i = 1; i < updates.length; i++) clause = Prisma.sql`${clause}, ${updates[i]}`;

    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      UPDATE vectorbea.platform_runs SET ${clause} WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid RETURNING *
    `);
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rowToRun(rows[0]));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
