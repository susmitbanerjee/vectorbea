/**
 * POST /api/platform/workflows/:id/run
 *
 * Trigger a workflow run with a given input payload.
 * Resolves the workflow graph, creates a run record, and executes
 * the workflow server-side with full secret resolution.
 *
 * Body: { input?: Record<string, unknown>, dryRun?: boolean }
 *
 * Returns the created AgentRun record plus execution result metadata.
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
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    // empty body is fine
  }

  const workflowInput = (typeof body.input === "object" && body.input !== null)
    ? body.input as Record<string, unknown>
    : {};
  const dryRun = body.dryRun === true;
  const triggerType = typeof body.triggerType === "string" ? body.triggerType : "manual";

  // ── Load workflow ─────────────────────────────────────────────────────────
  const workflowRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT id, name, current_version, status, graph_json
    FROM vectorbea.platform_workflows
    WHERE id = ${workflowId}::uuid
      AND workspace_id = ${workspaceId}::uuid
    LIMIT 1
  `).catch(() => [] as Record<string, unknown>[]);

  const workflowRow = workflowRows[0];
  if (!workflowRow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  if (workflowRow.status === "archived") {
    return NextResponse.json({ error: "Workflow is archived" }, { status: 422 });
  }

  const workflowName = String(workflowRow.name ?? "Unnamed Workflow");
  const workflowVersion = String(workflowRow.current_version ?? "v1");

  // ── Load graph ────────────────────────────────────────────────────────────
  const graphRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT graph_json FROM vectorbea.workflow_graphs
    WHERE workflow_id = ${workflowId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
  `).catch(() => [] as Record<string, unknown>[]);

  const graphJson = graphRows[0]?.graph_json as WorkflowGraph | null;
  if (!graphJson || !Array.isArray(graphJson.nodes) || graphJson.nodes.length === 0) {
    return NextResponse.json({ error: "Workflow has no graph. Build the workflow in the builder first." }, { status: 422 });
  }

  // ── Create run record ─────────────────────────────────────────────────────
  const idempotencyKey = `run-${workspaceId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    INSERT INTO vectorbea.platform_runs (
      workspace_id, workflow_id, workflow_name, workflow_version,
      creation_mode, status, trigger_type, trigger_source,
      input_json, idempotency_key, started_at
    ) VALUES (
      ${workspaceId}::uuid,
      ${workflowId}::uuid,
      ${workflowName},
      ${workflowVersion},
      'native',
      'running',
      ${triggerType},
      ${triggerType},
      ${JSON.stringify(workflowInput)}::jsonb,
      ${idempotencyKey},
      now()
    ) RETURNING *
  `).catch((e: unknown) => {
    throw new Error(`Failed to create run record: ${(e as Error).message}`);
  });

  const runRow = runRows[0];
  if (!runRow) {
    return NextResponse.json({ error: "Failed to create run record" }, { status: 500 });
  }

  const runId = String(runRow.id);

  // ── Execute workflow (async or inline depending on graph size) ────────────
  // For now, execute inline (synchronous). Future: queue via a worker process.
  let executionResult;
  try {
    executionResult = await executeWorkflow({
      runId,
      workspaceId,
      workflowId,
      workflowName,
      workflowVersion,
      triggerType,
      workflowInput,
      graph: graphJson,
      dryRun,
      privateRunnerMode: false,
    });
  } catch (err) {
    // Unexpected executor crash — mark run as failed
    const msg = (err instanceof Error) ? err.message : "Executor crashed";
    await db.$executeRaw(Prisma.sql`
      UPDATE vectorbea.platform_runs
      SET status = 'failed', completed_at = now(), updated_at = now(),
          error_json = ${JSON.stringify({ message: msg })}::jsonb
      WHERE id = ${runId}::uuid
    `).catch(() => {});

    return NextResponse.json({
      runId,
      status: "failed",
      error: msg,
    }, { status: 500 });
  }

  // ── Return run + result summary ───────────────────────────────────────────
  return NextResponse.json({
    runId,
    status: executionResult.status,
    totalTokens: executionResult.totalTokens,
    estimatedCostUsd: executionResult.estimatedCostUsd,
    durationMs: executionResult.durationMs,
    finalOutput: executionResult.finalOutput ?? null,
    errorMessage: executionResult.errorMessage ?? null,
    dryRun,
  }, { status: 201 });
}
