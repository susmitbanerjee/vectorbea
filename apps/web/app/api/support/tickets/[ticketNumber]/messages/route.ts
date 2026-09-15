import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { afterResponse } from "@/lib/server/after-response";
import { getTicketForUser, MESSAGE_MAX, supportLog } from "@/lib/server/support";
import { customerComment } from "@/lib/server/support-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/support/tickets/{ticketNumber}/messages — the customer adds a comment.
 *
 * Saved and returned at once; passing it on to the help desk or the support admins
 * happens after the response. Commenting on a resolved report reopens it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNumber: string }> },
) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const text = (body.body ?? "").trim();
  if (text.length < 2 || text.length > MESSAGE_MAX) {
    return NextResponse.json({ error: `Comments must be 2–${MESSAGE_MAX.toLocaleString("en-GB")} characters.` }, { status: 400 });
  }

  const { ticketNumber } = await params;
  try {
    const ticket = await getTicketForUser(ticketNumber, user.id);
    if (!ticket) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const saved = await customerComment(ticket, text, "app");
    if (!saved) return NextResponse.json({ error: "Your comment could not be saved. Try again." }, { status: 500 });
    afterResponse(saved.deliver);

    const { message } = saved;
    return NextResponse.json({
      ok: true,
      status: saved.ticket.status,
      message: {
        id: message.id, author_type: message.author_type, author_name: message.author_name,
        body: message.body, created_at: message.created_at,
      },
    }, { status: 201 });
  } catch (err) {
    supportLog("support.ticket.customer.comment.failed", { ticketNumber, userId: user.id, error: err });
    return NextResponse.json({ error: "Your comment could not be saved. Try again." }, { status: 500 });
  }
}
