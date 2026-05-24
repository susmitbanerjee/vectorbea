import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { cacheDel, CacheKeys } from "@/lib/server/cache";

function createSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rowToAgent(r: Record<string, unknown>) {
  return {
    id: r.id, workspaceId: r.workspace_id, name: r.name, slug: r.slug,
    description: r.description ?? "", role: r.role ?? "", instructions: r.instructions ?? "",
    type: r.type ?? "native_llm_agent", modelProvider: r.model_provider ?? "openai",
    modelName: r.model_name ?? "gpt-4.1-mini", temperature: Number(r.temperature ?? 0.1),
    maxIterations: r.max_iterations ?? 10, llmConnectionId: r.llm_connection_id ?? null,
    allowedToolIds: r.allowed_tool_ids ?? [],
    memoryPolicy: r.memory_policy ?? { type: "session" },
    retryPolicy: r.retry_policy ?? {},
    timeoutPolicy: r.timeout_policy ?? {},
    approvalPolicy: r.approval_policy ?? {},
    status: r.status ?? "active", totalRuns: r.total_runs ?? 0,
    lastUsedAt: r.last_used_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT * FROM platform_agents WHERE workspace_id = ${workspaceId}::uuid
      ORDER BY updated_at DESC
    `);
    return NextResponse.json(rows.map(rowToAgent));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const slug = `${createSlug(String(body.name))}-${Date.now().toString(36)}`;
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      INSERT INTO platform_agents (
        workspace_id, name, slug, description, role, instructions, type,
        model_provider, model_name, temperature, max_iterations,
        llm_connection_id, allowed_tool_ids, memory_policy,
        retry_policy, timeout_policy, approval_policy
      ) VALUES (
        ${workspaceId}::uuid, ${String(body.name)}, ${slug},
        ${String(body.description ?? "")}, ${String(body.role ?? "")},
        ${String(body.instructions ?? "")},
        ${String(body.type ?? "native_llm_agent")},
        ${String(body.modelProvider ?? "openai")},
        ${String(body.modelName ?? "gpt-4.1-mini")},
        ${Number(body.temperature ?? 0.1)},
        ${Number(body.maxIterations ?? 10)},
        ${body.llmConnectionId ? body.llmConnectionId : null},
        ${JSON.stringify(body.allowedToolIds ?? [])}::jsonb,
        ${JSON.stringify(body.memoryPolicy ?? { type: "session" })}::jsonb,
        ${JSON.stringify(body.retryPolicy ?? { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 })}::jsonb,
        ${JSON.stringify(body.timeoutPolicy ?? { stepTimeoutMs: 60000, runTimeoutMs: 600000 })}::jsonb,
        ${JSON.stringify(body.approvalPolicy ?? { requireApproval: false })}::jsonb
      ) RETURNING *
    `);
    await cacheDel(CacheKeys.agentList(workspaceId));
    return NextResponse.json(rowToAgent(rows[0]!), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
