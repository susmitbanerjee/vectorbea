import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import type { RunTimelineEventUi, TimelineEventType, TimelineEventStatus, TimelineEventSource } from "@/types/agent-run-ui";

function rowToEvent(r: Record<string, unknown>, idx: number): RunTimelineEventUi {
  return {
    id: String(r.id),
    sequence: Number(r.sequence ?? idx + 1),
    type: String(r.type) as TimelineEventType,
    status: String(r.status ?? "SUCCEEDED") as TimelineEventStatus,
    source: String(r.source ?? "SYSTEM").toUpperCase() as TimelineEventSource,
    timestamp: String(r.timestamp ?? r.created_at),
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : undefined,
    title: String(r.title ?? r.type),
    summary: r.summary ? String(r.summary) : undefined,
    agentName: r.agent_name ? String(r.agent_name) : undefined,
    toolName: r.tool_name ? String(r.tool_name) : undefined,
    modelName: r.model_name ? String(r.model_name) : undefined,
    inputJson: r.input_json_sanitized ?? null,
    outputJson: r.output_json_sanitized ?? null,
    metadataJson: r.metadata_json_sanitized ?? null,
    errorMessage: r.error_json_sanitized
      ? (r.error_json_sanitized as Record<string, unknown>).message as string | undefined
      : undefined,
    tokensUsed: r.tokens_used != null ? Number(r.tokens_used) : undefined,
    estimatedCostUsd: r.estimated_cost_usd != null ? Number(r.estimated_cost_usd) : undefined,
    handoffTo: r.handoff_to ? String(r.handoff_to) : undefined,
    artifactName: r.artifact_name ? String(r.artifact_name) : undefined,
    actorName: r.actor_name ? String(r.actor_name) : undefined,
    approval: r.approval_json ? (r.approval_json as RunTimelineEventUi["approval"]) : undefined,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const limit  = Math.min(500, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "200")));
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0"));

  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT * FROM vectorbea.platform_run_events
      WHERE run_id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
      ORDER BY sequence ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return NextResponse.json(rows.map(rowToEvent));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? String(body.workspaceId ?? "");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  // Redact inputs/outputs before persisting
  const { redactObject } = await import("@/lib/server/redact");

  const event = body.event as Record<string, unknown>;
  if (!event) return NextResponse.json({ error: "event is required" }, { status: 400 });

  // Get next sequence number
  const seqRows = await db.$queryRaw<{ seq: string }[]>(Prisma.sql`
    SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM vectorbea.platform_run_events WHERE run_id = ${id}::uuid
  `);
  const sequence = parseInt(seqRows[0]?.seq ?? "1");

  const sanitizedInput    = event.inputJson    ? redactObject(event.inputJson)    : null;
  const sanitizedOutput   = event.outputJson   ? redactObject(event.outputJson)   : null;
  const sanitizedMetadata = event.metadataJson ? redactObject(event.metadataJson) : null;
  const sanitizedError    = event.errorMessage ? { message: String(event.errorMessage).slice(0, 2000) } : null;

  await db.$executeRaw(Prisma.sql`
    INSERT INTO vectorbea.platform_run_events (
      run_id, workspace_id, sequence, type, status, source,
      timestamp, duration_ms, agent_name, tool_name, model_name,
      title, summary, input_json_sanitized, output_json_sanitized,
      metadata_json_sanitized, error_json_sanitized,
      tokens_used, estimated_cost_usd, handoff_to, artifact_name, actor_name
    ) VALUES (
      ${id}::uuid, ${workspaceId}::uuid, ${sequence},
      ${String(event.type ?? "SYSTEM")},
      ${String(event.status ?? "SUCCEEDED")},
      ${String(event.source ?? "system")},
      ${event.timestamp ? String(event.timestamp) : "now()"},
      ${event.durationMs != null ? Number(event.durationMs) : null},
      ${event.agentName ? String(event.agentName) : null},
      ${event.toolName  ? String(event.toolName)  : null},
      ${event.modelName ? String(event.modelName) : null},
      ${String(event.title ?? event.type ?? "")},
      ${event.summary ? String(event.summary) : null},
      ${sanitizedInput    != null ? Prisma.sql`${JSON.stringify(sanitizedInput)}::jsonb`    : Prisma.sql`NULL`},
      ${sanitizedOutput   != null ? Prisma.sql`${JSON.stringify(sanitizedOutput)}::jsonb`   : Prisma.sql`NULL`},
      ${sanitizedMetadata != null ? Prisma.sql`${JSON.stringify(sanitizedMetadata)}::jsonb` : Prisma.sql`NULL`},
      ${sanitizedError    != null ? Prisma.sql`${JSON.stringify(sanitizedError)}::jsonb`    : Prisma.sql`NULL`},
      ${event.tokensUsed       != null ? Number(event.tokensUsed) : null},
      ${event.estimatedCostUsd != null ? Number(event.estimatedCostUsd) : null},
      ${event.handoffTo    ? String(event.handoffTo)    : null},
      ${event.artifactName ? String(event.artifactName) : null},
      ${event.actorName    ? String(event.actorName)    : null}
    )
  `);

  return NextResponse.json({ sequence }, { status: 201 });
}
