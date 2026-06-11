import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface ConnectionStatus {
  connected: boolean;
  lastSeenAt: string | null;
  recentCallCount: number;
}

export async function GET(request: NextRequest) {
  try {
    const wsId = request.nextUrl.searchParams.get("workspaceId")
      ?? request.nextUrl.searchParams.get("organizationId");
    if (!wsId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, wsId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const supabase = createVectorBeaAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("created_at")
      .eq("workspace_id", wsId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const status: ConnectionStatus = {
      connected: rows.length > 0,
      lastSeenAt: rows[0]?.created_at ?? null,
      recentCallCount: rows.length,
    };

    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load connection status" },
      { status: 500 },
    );
  }
}
