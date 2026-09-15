import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { afterResponse } from "@/lib/server/after-response";
import { getTicketByNumber, isSupportAdmin, MESSAGE_MAX, supportLog } from "@/lib/server/support";
import { portalReply } from "@/lib/server/support-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/support/admin/tickets/{ticketNumber}/messages — reply to the customer (admin only). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> },
) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSupportAdmin(user.email)) {
    return NextResponse.json({ error: "Support admin access required" }, { status: 403 });
  }

  let body: { body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const text = (body.body ?? "").trim();
  if (text.length < 2 || text.length > MESSAGE_MAX) {
    return NextResponse.json({ error: `Replies must be 2–${MESSAGE_MAX.toLocaleString("en-GB")} characters.` }, { status: 400 });
  }

  const { ticketNumber } = await params;
  try {
    const ticket = await getTicketByNumber(ticketNumber);
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    const saved = await portalReply(ticket, text, user.email);
    if (!saved) return NextResponse.json({ error: "The reply could not be sent." }, { status: 500 });
    afterResponse(saved.deliver);
    supportLog("support.ticket.portal.reply", { ticketNumber, adminEmail: user.email });
    const { message } = saved;
    return NextResponse.json({
      ok: true,
      message: {
        id: message.id, author_type: message.author_type, author_name: message.author_name,
        body: message.body, created_at: message.created_at,
      },
    }, { status: 201 });
  } catch (err) {
    supportLog("support.ticket.portal.reply.failed", { ticketNumber, adminEmail: user.email, error: err });
    return NextResponse.json({ error: "The reply could not be sent." }, { status: 500 });
  }
}
