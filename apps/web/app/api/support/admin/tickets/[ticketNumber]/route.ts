import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import {
  isSupportAdmin, getTicketByNumber, resolveTicket, reopenTicket,
  supportLog, LIMITS,
} from "@/lib/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/support/admin/tickets/{ticketNumber} — full ticket detail (admin only). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> },
) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSupportAdmin(user.email)) {
    return NextResponse.json({ error: "Support admin access required" }, { status: 403 });
  }

  const { ticketNumber } = await params;
  try {
    const ticket = await getTicketByNumber(ticketNumber);
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    supportLog("support.ticket.viewed", { ticketNumber, adminEmail: user.email });
    return NextResponse.json({ ticket });
  } catch (err) {
    supportLog("support.ticket.view.failed", { ticketNumber, adminEmail: user.email, error: err });
    return NextResponse.json({ error: "Could not load the ticket." }, { status: 500 });
  }
}

/**
 * PATCH /api/support/admin/tickets/{ticketNumber} — resolve or reopen a ticket
 * (admin only). Body: { action: "resolve" | "reopen", adminNote?: string }.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> },
) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSupportAdmin(user.email)) {
    return NextResponse.json({ error: "Support admin access required" }, { status: 403 });
  }

  const { ticketNumber } = await params;
  let body: { action?: string; adminNote?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = (body.action ?? "").toLowerCase();
  const adminNote = body.adminNote?.slice(0, LIMITS.ADMIN_NOTE_MAX) ?? undefined;
  if (action !== "resolve" && action !== "reopen") {
    return NextResponse.json({ error: "action must be 'resolve' or 'reopen'." }, { status: 400 });
  }

  try {
    const ticket = action === "resolve"
      ? await resolveTicket(ticketNumber, { resolvedBy: user.email, adminNote })
      : await reopenTicket(ticketNumber, { adminNote });
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

    supportLog(action === "resolve" ? "support.ticket.resolved" : "support.ticket.reopened", {
      ticketNumber, adminEmail: user.email, tenantId: ticket.tenant_id,
    });
    return NextResponse.json({ ok: true, ticket });
  } catch (err) {
    supportLog("support.ticket.update.failed", { ticketNumber, adminEmail: user.email, error: err });
    return NextResponse.json({ error: "Could not update the ticket." }, { status: 500 });
  }
}
