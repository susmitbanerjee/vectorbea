import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { getTicketForUser, listMessages, supportLog } from "@/lib/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/support/tickets/{ticketNumber} — the signed-in user's own report and its
 * conversation. Another user's ticket answers 404, exactly like a missing one.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> },
) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { ticketNumber } = await params;
  try {
    const ticket = await getTicketForUser(ticketNumber, user.id);
    if (!ticket) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const messages = await listMessages(ticket.id);
    return NextResponse.json({
      ticket: {
        ticket_number: ticket.ticket_number, subject: ticket.subject, message: ticket.message,
        status: ticket.status, admin_note: ticket.admin_note, created_at: ticket.created_at,
        resolved_at: ticket.resolved_at,
      },
      messages: messages.map((m) => ({
        id: m.id, author_type: m.author_type, author_name: m.author_name, body: m.body, created_at: m.created_at,
      })),
    });
  } catch (err) {
    supportLog("support.ticket.view.self.failed", { ticketNumber, userId: user.id, error: err });
    return NextResponse.json({ error: "Your report could not be loaded." }, { status: 500 });
  }
}
