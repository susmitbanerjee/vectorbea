import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  getWorkspaceNotificationPrefs,
  upsertWorkspaceNotificationPrefs,
} from "@/lib/server/notification-preferences";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;
    const prefs = await getWorkspaceNotificationPrefs(id);
    return NextResponse.json(prefs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to get notification preferences");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;
    const body = await request.json();
    const prefs = await upsertWorkspaceNotificationPrefs(id, body);
    return NextResponse.json(prefs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update notification preferences");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
