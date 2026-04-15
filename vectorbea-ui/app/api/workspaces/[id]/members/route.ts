import { NextRequest, NextResponse } from "next/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createVectorBeaAdminClient();

    const { data, error } = await supabase
      .from("workspace_members")
      .select("user_id, role, granted_at")
      .eq("workspace_id", id);

    if (error) throw new Error(error.message);

    // Fetch profiles for these users
    const userIds = (data ?? []).map((m) => m.user_id);
    const { data: profiles } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, email, full_name, avatar_url")
          .in("id", userIds)
      : { data: [] };

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const members = (data ?? []).map((m) => {
      const profile = profileMap.get(m.user_id);
      return {
        id: m.user_id,
        email: profile?.email ?? m.user_id,
        displayName: profile?.full_name ?? profile?.email ?? m.user_id,
        avatarUrl: profile?.avatar_url ?? null,
        role: m.role as "admin" | "editor" | "viewer",
        joinedAt: m.granted_at,
      };
    });

    return NextResponse.json(members);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load members" },
      { status: 500 },
    );
  }
}
