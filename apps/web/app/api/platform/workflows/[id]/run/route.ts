/**
 * POST /api/platform/workflows/:id/run
 *
 * Trigger a workflow run. Creates a run record, executes the workflow
 * synchronously, and returns the result. The browser waits for completion.
 *
 * Future: move execution to a background worker queue (BullMQ/pgmq) to
 * avoid blocking the HTTP request for long-running workflows.
 */

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { executeWorkflow } from "@/lib/workflow-runtime/workflow-executor";
import type { WorkflowGraph } from "@/types/workflow-graph";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const { id: workflowId } = await params;
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { /* empty body */ }

  const workflowInput = (typeof body.input === "object" && body.input !== null)
    ? body.input as Record<string, unknown> : {};
  const dryRun      = body.dryRun === true;
  const triggerType = typeof body.triggerType === "string" ? body.triggerType : "manual";

  // -- Load workflow + graph --------------------------------------------------
  const workflowRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT w.id, w.name, w.current_version, w.status, g.graph_json
    FROM vectorbea.platform_workflows w
    LEFT JOIN vectorbea.workflow_graphs g ON g.workflow_id = w.id
    WHERE w.id = ${workflowId}::uuid AND w.workspace_id = ${workspaceId}::uuid
    LIMIT 1
  `).catch((e: unknown) => { throw new Error(`Failed to load workflow: ${(e as Error).message}`); });

  const workflowRow = workflowRows[0];
  if (!workflowRow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (workflowRow.status === "archived") return NextResponse.json({ error: "Workflow is archived" }, { status: 422 });

  const workflowName    = String(workflowRow.name ?? "Unnamed Workflow");
  const workflowVersion = String(workflowRow.current_version ?? "v1");
  const graphJson       = workflowRow.graph_json as WorkflowGraph | null;

  if (!graphJson || !Array.isArray(graphJson.nodes) || graphJson.nodes.length === 0) {
    return NextResponse.json({ error: "Workflow has no graph. Build the workflow in the builder first." }, { status: 422 });
  }

  // -- Create run record -----------------------------------------------------
  const idempotencyKey = `run-${workspaceId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    INSERT INTO vectorbea.platform_runs (
      workspace_id, workflow_id, workflow_name, workflow_version,
      creation_mode, status, trigger_type, trigger_source,
      input_json, idempotency_key, started_at
    ) VALUES (
      ${workspaceId}::uuid, ${workflowId}::uuid,
      ${workflowName}, ${workflowVersion},
      'native', 'running', ${triggerType}, ${triggerType},
      ${JSON.stringify(workflowInput)}::jsonb, ${idempotencyKey}, now()
    ) RETURNING id
  `).catch((e: unknown) => { throw new Error(`Failed to create run record: ${(e as Error).message}`); });

  const runId = runRows[0] ? String(runRows[0].id) : null;
  if (!runId) return NextResponse.json({ error: "Failed to create run record" }, { status: 500 });

  // -- Execute workflow synchronously ----------------------------------------
  try {
    const result = await executeWorkflow({
      runId, workspaceId, workflowId,
      workflowName, workflowVersion, triggerType,
      workflowInput, graph: graphJson, dryRun,
      privateRunnerMode: false,
    });

    return NextResponse.json({
      runId,
      status: result.status,
      totalTokens: result.totalTokens,
      estimatedCostUsd: result.estimatedCostUsd,
      durationMs: result.durationMs,
      finalOutput: result.finalOutput ?? null,
      errorMessage: result.errorMessage ?? null,
      dryRun,
    }, { status: 201 });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Executor crashed";
    await db.$executeRaw(Prisma.sql`
      UPDATE vectorbea.platform_runs
      SET status = 'failed', completed_at = now(), updated_at = now(),
          error_json = ${JSON.stringify({ message: msg })}::jsonb
      WHERE id = ${runId}::uuid
    `).catch(() => {});
    return NextResponse.json({ runId, status: "failed", error: msg }, { status: 500 });
  }
}
