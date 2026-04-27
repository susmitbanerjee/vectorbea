import { NextRequest, NextResponse } from "next/server";
import { acceptInvitation } from "@/lib/server/invitations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/accept-invite
 * Body: { token: string }
 *
 * Called from the /auth/accept-invite page after the user is authenticated.
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user from session cookie
    const supabase = createSupabaseAdminClient();
    const authHeader = request.headers.get("authorization");
    const jwt = authHeader?.replace("Bearer ", "") ?? "";

    if (!jwt) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    const body = await request.json() as { token?: string };
    if (!body.token) return NextResponse.json({ error: "token required" }, { status: 400 });

    const result = await acceptInvitation(body.token, user.id);
    return NextResponse.json(result);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to accept invitation");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
