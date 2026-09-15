import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { afterResponse } from "@/lib/server/after-response";
import {
  isSupportAdmin, getTicketByNumber, listMessages, resolveTicket, reopenTicket,
  supportLog, LIMITS,
} from "@/lib/server/support";
import { portalStatusChanged } from "@/lib/server/support-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/support/admin/tickets/{ticketNumber} — full ticket detail and conversation (admin only). */
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
    // The conversation is secondary: a failure to read it must not hide the ticket.
    const messages = await listMessages(ticket.id).catch((err: unknown) => {
      supportLog("support.ticket.messages.failed", { ticketNumber, error: err });
      return null;
    });
    supportLog("support.ticket.viewed", { ticketNumber, adminEmail: user.email });
    return NextResponse.json({ ticket, messages });
  } catch (err) {
    supportLog("support.ticket.view.failed", { ticketNumber, adminEmail: user.email, error: err });
    return NextResponse.json({ error: "Could not load the ticket." }, { status: 500 });
  }
}

/**
 * PATCH /api/support/admin/tickets/{ticketNumber} — resolve or reopen a ticket
 * (admin only). Body: { action: "resolve" | "reopen", adminNote?: string }.
 * The customer is emailed when the status actually changes.
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
    const before = await getTicketByNumber(ticketNumber);
    if (!before) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    const ticket = action === "resolve"
      ? await resolveTicket(ticketNumber, { resolvedBy: user.email, adminNote })
      : await reopenTicket(ticketNumber, { adminNote });
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

    if (before.status !== ticket.status) {
      const note = adminNote?.trim() || null;
      afterResponse(() => portalStatusChanged(ticket, ticket.status, note));
    }
    supportLog(action === "resolve" ? "support.ticket.resolved" : "support.ticket.reopened", {
      ticketNumber, adminEmail: user.email, tenantId: ticket.tenant_id,
    });
    return NextResponse.json({ ok: true, ticket });
  } catch (err) {
    supportLog("support.ticket.update.failed", { ticketNumber, adminEmail: user.email, error: err });
    return NextResponse.json({ error: "Could not update the ticket." }, { status: 500 });
  }
}
