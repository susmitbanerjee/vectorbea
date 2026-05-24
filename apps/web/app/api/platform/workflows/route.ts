import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { cacheGetOrSet, cacheDel, CacheKeys, TTL } from "@/lib/server/cache";

function createSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rowToWorkflow(r: Record<string, unknown>) {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    slug: r.slug,
    description: r.description ?? "",
    status: r.status ?? "draft",
    creationMode: r.creation_mode ?? "native",
    triggerType: r.trigger_type ?? "manual",
    currentVersion: r.current_version ?? "v1",
    inputSchema: r.input_schema ?? {},
    outputSchema: r.output_schema ?? {},
    steps: [],
    agentIds: [],
    toolIds: [],
    retryPolicy: r.retry_policy ?? { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 },
    budgetPolicy: r.budget_policy ?? {},
    approvalPolicy: r.approval_policy ?? { requireApproval: false },
    totalRuns: r.total_runs ?? 0,
    successRate: r.success_rate ?? 0,
    lastRunAt: r.last_run_at ?? null,
    lastRunStatus: r.last_run_status ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");
  const page   = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(request.nextUrl.searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;

  // Only cache unfiltered first-page requests; filtered/paginated queries run DB directly
  const useCache = !search && !status && page === 1 && pageSize === 20;
  const cacheKey = CacheKeys.workflowList(workspaceId);

  const runQuery = async () => {
    const clauses: Prisma.Sql[] = [Prisma.sql`workspace_id = ${workspaceId}::uuid`];
    if (status) clauses.push(Prisma.sql`status = ${status}`);
    if (search) {
      const q = `%${search}%`;
      clauses.push(Prisma.sql`(name ILIKE ${q} OR description ILIKE ${q})`);
    }

    let where = clauses[0] ?? Prisma.sql`1=1`;
    for (let i = 1; i < clauses.length; i++) where = Prisma.sql`${where} AND ${clauses[i]}`;

    const [rows, countRows] = await Promise.all([
      db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT * FROM vectorbea.platform_workflows WHERE ${where}
        ORDER BY updated_at DESC LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.$queryRaw<{ count: string }[]>(Prisma.sql`
        SELECT COUNT(*) as count FROM vectorbea.platform_workflows WHERE ${where}
      `),
    ]);

    const total = parseInt(countRows[0]?.count ?? "0");
    return {
      items: (rows ?? []).map(rowToWorkflow),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  };

  try {
    const result = useCache
      ? await cacheGetOrSet(cacheKey, TTL.LIST, runQuery)
      : await runQuery();

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? (typeof body.workspaceId === "string" ? body.workspaceId : null);
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const { name, description, status, creationMode, triggerType, retryPolicy, budgetPolicy, approvalPolicy } = body;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const slug = `${createSlug(String(name))}-${Date.now().toString(36)}`;
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      INSERT INTO vectorbea.platform_workflows (
        workspace_id, name, slug, description, status, creation_mode, trigger_type,
        retry_policy, budget_policy, approval_policy
      ) VALUES (
        ${workspaceId}::uuid, ${String(name)}, ${slug},
        ${String(description ?? "")},
        ${String(status ?? "draft")},
        ${String(creationMode ?? "native")},
        ${String(triggerType ?? "manual")},
        ${JSON.stringify(retryPolicy ?? { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 })}::jsonb,
        ${JSON.stringify(budgetPolicy ?? {})}::jsonb,
        ${JSON.stringify(approvalPolicy ?? { requireApproval: false })}::jsonb
      ) RETURNING *
    `);
    await cacheDel(CacheKeys.workflowList(workspaceId));
    return NextResponse.json(rowToWorkflow(rows[0]!), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
