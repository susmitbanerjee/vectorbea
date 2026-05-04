import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ systems: [] });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const status = request.nextUrl.searchParams.get("status")?.trim() || undefined;
    const sourceType = request.nextUrl.searchParams.get("sourceType")?.trim() || undefined;
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 100;

    const supabase = createVectorBeaAdminClient();
    let query = supabase
      .from("discovered_ai_systems")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("last_seen_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (sourceType) query = query.eq("source_type", sourceType);

    const { data, error } = await query;
    if (error) {
      if (error.message.toLowerCase().includes("does not exist"))
        return NextResponse.json({ systems: [] });
      throw new Error(error.message);
    }

    // Return raw snake_case rows so the client-side interface matches exactly.
    // Add event_count as an alias for seen_count for backward compatibility.
    const systems = (data ?? []).map((row) => ({
      ...row,
      event_count: row.seen_count ?? 0,
    }));

    return NextResponse.json({ systems });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load discovered systems");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
