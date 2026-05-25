/**
 * POST /api/platform/workflows/:id/run/:runId/execute
 *
 * Step 2: Browser fires this after navigating to the run page.
 * Loads the run + workflow graph and executes synchronously.
 * The browser does NOT await — it fires-and-forgets from the client side.
 * This runs as a regular server request so it survives serverless keepalive.
 */

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { executeWorkflow } from "@/lib/workflow-runtime/workflow-executor";
import type { WorkflowGraph } from "@/types/workflow-graph";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const { id: workflowId, runId } = await params;

  // -- Load run + workflow + graph -------------------------------------------
  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      r.id            AS run_id,
      r.status        AS run_status,
      r.trigger_type,
      r.input_json,
      w.name          AS workflow_name,
      w.current_version AS workflow_version,
      g.graph_json
    FROM vectorbea.platform_runs r
    JOIN vectorbea.platform_workflows w ON w.id = r.workflow_id
    LEFT JOIN vectorbea.workflow_graphs g ON g.workflow_id = w.id
    WHERE r.id = ${runId}::uuid
      AND r.workflow_id = ${workflowId}::uuid
      AND r.workspace_id = ${workspaceId}::uuid
    LIMIT 1
  `).catch((e: unknown) => {
    throw new Error(`Failed to load run: ${(e as Error).message}`);
  });

  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (row.run_status !== "queued") {
    // Already running or finished — idempotent no-op
    return NextResponse.json({ status: row.run_status }, { status: 200 });
  }

  const graphJson = row.graph_json as WorkflowGraph | null;
  if (!graphJson || !Array.isArray(graphJson.nodes) || graphJson.nodes.length === 0) {
    return NextResponse.json({ error: "Workflow has no graph" }, { status: 422 });
  }

  const workflowInput = (
    row.input_json && typeof row.input_json === "object" && !Array.isArray(row.input_json)
      ? row.input_json
      : {}
  ) as Record<string, unknown>;

  // -- Mark as running -------------------------------------------------------
  await db.$queryRaw(Prisma.sql`
    UPDATE vectorbea.platform_runs
    SET status = 'running', started_at = now()
    WHERE id = ${runId}::uuid AND status = 'queued'
  `).catch(() => { /* ignore — another process may have picked it up */ });

  // -- Execute ---------------------------------------------------------------
  try {
    const result = await executeWorkflow({
      runId,
      workspaceId,
      workflowId,
      workflowName: String(row.workflow_name ?? "Unnamed Workflow"),
      workflowVersion: String(row.workflow_version ?? "v1"),
      triggerType: String(row.trigger_type ?? "manual"),
      workflowInput,
      graph: graphJson,
    });

    // executeWorkflow writes its own final status to DB; just return 200
    return NextResponse.json({ status: result.status }, { status: 200 });
  } catch (e) {
    console.error("[execute] workflow execution error:", (e as Error).message);

    await db.$queryRaw(Prisma.sql`
      UPDATE vectorbea.platform_runs
      SET status = 'failed',
          error_message = ${(e as Error).message}::text,
          completed_at = now()
      WHERE id = ${runId}::uuid
    `).catch(() => { /* best-effort */ });

    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
