import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  try {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      UPDATE platform_runs
      SET status = 'cancelled', completed_at = now(), updated_at = now()
      WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
        AND status IN ('queued', 'running', 'waiting_approval')
      RETURNING id, status
    `);
    if (!rows[0]) {
      return NextResponse.json({ error: "Run not found or already completed" }, { status: 404 });
    }
    return NextResponse.json({ id: rows[0].id, status: "cancelled" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
