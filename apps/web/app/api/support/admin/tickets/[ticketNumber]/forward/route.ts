import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { getTicketByNumber, isSupportAdmin, supportLog } from "@/lib/server/support";
import { forwardToSpiceworks, spiceworksStatus } from "@/lib/server/support-spiceworks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/support/admin/tickets/{ticketNumber}/forward — send a ticket to the
 * help desk again (admin only). Awaited, unlike the automatic forward, because an
 * admin pressing "Send again" is waiting to see whether it worked.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> },
) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSupportAdmin(user.email)) {
    return NextResponse.json({ error: "Support admin access required" }, { status: 403 });
  }

  const status = spiceworksStatus();
  if (!status.enabled) {
    return NextResponse.json({ error: status.problem ?? "Spiceworks is not connected." }, { status: 409 });
  }

  const { ticketNumber } = await params;
  try {
    const ticket = await getTicketByNumber(ticketNumber);
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

    const result = await forwardToSpiceworks(ticket);
    supportLog("support.ticket.forward.manual", { ticketNumber, adminEmail: user.email });
    if (result.status !== "sent") {
      return NextResponse.json({ error: result.error ?? "The ticket could not be sent.", ticket: result.ticket }, { status: 502 });
    }
    return NextResponse.json({ ok: true, ticket: result.ticket ?? ticket });
  } catch (err) {
    supportLog("support.ticket.forward.manual.failed", { ticketNumber, adminEmail: user.email, error: err });
    return NextResponse.json({ error: "The ticket could not be sent." }, { status: 500 });
  }
}
