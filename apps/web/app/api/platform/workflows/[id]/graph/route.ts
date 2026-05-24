import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { cacheGet, cacheSet, cacheDel, CacheKeys, TTL } from "@/lib/server/cache";
import type { WorkflowGraph } from "@/types/workflow-graph";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const cacheKey = CacheKeys.workflowGraph(id);
  const cached = await cacheGet<WorkflowGraph>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const rows = await db.$queryRaw<{ graph_json: WorkflowGraph }[]>(Prisma.sql`
    SELECT graph_json FROM workflow_graphs WHERE workflow_id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid LIMIT 1
  `);

  if (!rows[0]) return NextResponse.json(null);
  await cacheSet(cacheKey, rows[0].graph_json, TTL.WORKFLOW_GRAPH);
  return NextResponse.json(rows[0].graph_json);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const graph = body.graph as WorkflowGraph ?? body;
  const graphJson = JSON.stringify(graph);

  await db.$executeRaw(Prisma.sql`
    INSERT INTO workflow_graphs (workflow_id, workspace_id, graph_json, version)
    VALUES (${id}::uuid, ${workspaceId}::uuid, ${graphJson}::jsonb, ${graph.version ?? "1"})
    ON CONFLICT (workflow_id) DO UPDATE SET
      graph_json = EXCLUDED.graph_json,
      version    = EXCLUDED.version,
      updated_at = now()
  `);

  await cacheDel(CacheKeys.workflowGraph(id));
  return NextResponse.json({ saved: true });
}
