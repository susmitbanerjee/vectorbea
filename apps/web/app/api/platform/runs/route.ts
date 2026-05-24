import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { validateWorkflowConnections } from "@/lib/server/connection-validator";

function rowToRun(r: Record<string, unknown>) {
  return {
    id: r.id, workspaceId: r.workspace_id, workflowId: r.workflow_id ?? null,
    workflowName: r.workflow_name, workflowVersion: r.workflow_version ?? "v1",
    creationMode: r.creation_mode ?? "native", status: r.status ?? "queued",
    triggerType: r.trigger_type ?? "manual", triggerSource: r.trigger_source ?? "manual",
    inputJson: r.input_json ?? null, outputJson: r.output_json ?? null,
    errorJson: r.error_json ?? null, idempotencyKey: r.idempotency_key ?? null,
    startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null,
    durationMs: r.duration_ms ?? null, totalTokens: r.total_tokens ?? null,
    estimatedCostUsd: r.estimated_cost_usd ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const status     = request.nextUrl.searchParams.get("status");
  const workflowId = request.nextUrl.searchParams.get("workflowId");
  const search     = request.nextUrl.searchParams.get("search");
  const page       = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1"));
  const pageSize   = Math.min(100, Math.max(1, parseInt(request.nextUrl.searchParams.get("pageSize") ?? "25")));
  const offset     = (page - 1) * pageSize;

  try {
    const clauses: Prisma.Sql[] = [Prisma.sql`workspace_id = ${workspaceId}::uuid`];
    if (status)     clauses.push(Prisma.sql`status = ${status}`);
    if (workflowId) clauses.push(Prisma.sql`workflow_id = ${workflowId}::uuid`);
    if (search)     clauses.push(Prisma.sql`workflow_name ILIKE ${`%${search}%`}`);

    let where = clauses[0]!;
    for (let i = 1; i < clauses.length; i++) where = Prisma.sql`${where} AND ${clauses[i]}`;

    const [rows, countRows] = await Promise.all([
      db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT * FROM platform_runs WHERE ${where} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.$queryRaw<{ count: string }[]>(Prisma.sql`SELECT COUNT(*) as count FROM platform_runs WHERE ${where}`),
    ]);

    const total = parseInt(countRows[0]?.count ?? "0");
    return NextResponse.json({
      items: rows.map(rowToRun),
      total, page, pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const workflowId   = typeof body.workflowId === "string" ? body.workflowId : null;
  const workflowName = typeof body.workflowName === "string" ? body.workflowName : "Unnamed Workflow";
  const idempotencyKey = `run-${workspaceId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // ── Connection validation ──────────────────────────────────────────────────
  // Validate all agent/tool connections required by this workflow before
  // creating a run record. Blocking issues prevent run creation entirely.
  // Warnings are stored as events on the created run.

  const agentDefs = Array.isArray(body.agentDefs)
    ? (body.agentDefs as Array<{ agentId: string; agentName: string; llmConnectionId: string | null }>)
    : [];
  const toolDefs = Array.isArray(body.toolDefs)
    ? (body.toolDefs as Array<{ toolId: string; toolName: string; connectionId: string | null; connectionType?: string }>)
    : [];

  // Only validate when we have explicit agent/tool defs (native workflow runs).
  // Legacy/external trigger paths that don't supply defs skip validation.
  if (agentDefs.length > 0 || toolDefs.length > 0) {
    const validation = await validateWorkflowConnections(workspaceId, agentDefs, toolDefs);

    if (!validation.ok) {
      // Create a FAILED run record so the failure is visible in the run history
      const failedRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        INSERT INTO platform_runs (
          workspace_id, workflow_id, workflow_name, workflow_version, creation_mode,
          status, trigger_type, trigger_source, input_json, idempotency_key,
          started_at, completed_at, error_json
        ) VALUES (
          ${workspaceId}::uuid,
          ${workflowId ? Prisma.sql`${workflowId}::uuid` : Prisma.sql`NULL`},
          ${workflowName},
          ${String(body.workflowVersion ?? "v1")},
          ${String(body.creationMode ?? "native")},
          'failed',
          ${String(body.triggerType ?? "manual")},
          ${String(body.triggerSource ?? "manual")},
          ${body.input ? JSON.stringify(body.input) + "::jsonb" : Prisma.sql`NULL`},
          ${idempotencyKey},
          now(), now(),
          ${JSON.stringify({ reason: "RUN_VALIDATION_FAILED", issues: validation.blockingIssues })}::jsonb
        ) RETURNING *
      `).catch(() => [] as Record<string, unknown>[]);

      const runRow = failedRows[0];

      // Emit one event per blocking issue so the timeline shows remediation details
      if (runRow?.id) {
        const runId = String(runRow.id);
        let seq = 1;
        for (const issue of validation.blockingIssues) {
          await db.$executeRaw(Prisma.sql`
            INSERT INTO platform_run_events (
              run_id, workspace_id, sequence, type, status, source,
              timestamp, title, summary, agent_name, tool_name,
              input_json_sanitized, output_json_sanitized,
              metadata_json_sanitized, error_json_sanitized
            ) VALUES (
              ${runId}::uuid, ${workspaceId}::uuid, ${seq},
              ${issue.code},
              'FAILED',
              'SYSTEM',
              now(),
              ${issue.message},
              ${issue.remediation},
              ${issue.entityType === "agent" ? issue.entityName : null},
              ${issue.entityType === "tool"  ? issue.entityName : null},
              NULL, NULL, NULL,
              ${JSON.stringify({ code: issue.code, message: issue.message, remediation: issue.remediation })}::jsonb
            )
          `).catch(() => { /* best-effort */ });
          seq++;
        }
      }

      return NextResponse.json(
        {
          error: "RUN_VALIDATION_FAILED",
          message: "This workflow cannot run because one or more required connections are missing, disabled, or unreachable.",
          blockingIssues: validation.blockingIssues,
          run: runRow ? rowToRun(runRow) : null,
        },
        { status: 422 },
      );
    }

    // Warnings — attach to run after creation (below)
  }
  // ── End connection validation ─────────────────────────────────────────────

  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      INSERT INTO platform_runs (
        workspace_id, workflow_id, workflow_name, workflow_version, creation_mode,
        status, trigger_type, trigger_source, input_json, idempotency_key, started_at
      ) VALUES (
        ${workspaceId}::uuid,
        ${workflowId ? Prisma.sql`${workflowId}::uuid` : Prisma.sql`NULL`},
        ${workflowName},
        ${String(body.workflowVersion ?? "v1")},
        ${String(body.creationMode ?? "native")},
        'running',
        ${String(body.triggerType ?? "manual")},
        ${String(body.triggerSource ?? "manual")},
        ${body.input ? JSON.stringify(body.input) + "::jsonb" : Prisma.sql`NULL`},
        ${idempotencyKey},
        now()
      ) RETURNING *
    `);

    const run = rows[0]!;

    // Attach warning events if any
    const { warnings } = agentDefs.length > 0 || toolDefs.length > 0
      ? await validateWorkflowConnections(workspaceId, agentDefs, toolDefs)
      : { warnings: [] };

    if (warnings.length > 0) {
      let seq = 1;
      for (const w of warnings) {
        await db.$executeRaw(Prisma.sql`
          INSERT INTO platform_run_events (
            run_id, workspace_id, sequence, type, status, source,
            timestamp, title, summary
          ) VALUES (
            ${String(run.id)}::uuid, ${workspaceId}::uuid, ${seq},
            ${w.code}, 'SUCCEEDED', 'SYSTEM', now(),
            ${w.message}, ${w.remediation}
          )
        `).catch(() => { /* best-effort */ });
        seq++;
      }
    }

    return NextResponse.json(rowToRun(run), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
