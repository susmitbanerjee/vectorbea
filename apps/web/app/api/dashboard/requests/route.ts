import { NextRequest, NextResponse } from "next/server";

import type { DailyRequestPoint } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([] as DailyRequestPoint[]);
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const supabase = createVectorBeaAdminClient();

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since);

    if (error) throw new Error(error.message);

    // Group by day
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const day = row.created_at.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    const points: DailyRequestPoint[] = Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, requests]) => ({ day, requests }));

    return NextResponse.json(points);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard requests" },
      { status: 500 },
    );
  }
}
