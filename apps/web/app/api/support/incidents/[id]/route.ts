import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isSupportAdmin, updateIncidentStatus, INCIDENT_STATUSES, type IncidentStatus } from "@/lib/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH — status/note updates; SUPPORT_EMAIL admin only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSupportAdmin(user.email)) {
    return NextResponse.json({ error: "Support admin access required" }, { status: 403 });
  }

  const { id } = await params;
  let body: { status?: string; adminNote?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const status = (body.status ?? "").trim() as IncidentStatus;
  if (!INCIDENT_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const updated = await updateIncidentStatus(id, status, body.adminNote?.slice(0, 2000));
    if (!updated) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    return NextResponse.json({ ok: true, incident: updated });
  } catch (err) {
    console.error("[support] update failed:", err);
    return NextResponse.json({ error: "Could not update the incident." }, { status: 500 });
  }
}
