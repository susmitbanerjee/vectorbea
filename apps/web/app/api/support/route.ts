import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { getUserById, getUserWorkspaces } from "@/lib/auth/neon-auth";
import { sendEmail } from "@/lib/server/email";
import {
  createTicket, listTicketsForUser, buildAdminNotificationEmail,
  getSupportAdminEmails, mapSeverityToPriority, supportLog,
  SUPPORT_CATEGORIES, LIMITS, appBaseUrl,
} from "@/lib/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/support — the signed-in user's own support tickets (widget "My reports").
 * User/tenant scoped: never returns other users' tickets.
 */
export async function GET() {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    const tickets = await listTicketsForUser(user.id);
    return NextResponse.json({ tickets });
  } catch (err) {
    supportLog("support.ticket.list.self.failed", { userId: user.id, error: err });
    return NextResponse.json({ error: "Could not load your reports." }, { status: 500 });
  }
}

/**
 * POST /api/support — file a support ticket. Persistence is authoritative;
 * the admin notification email is best-effort and never fails the request.
 *
 * Identity (user id / email / name / workspace) is taken from the authenticated
 * session — the customer is not asked to re-enter what we already know.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { subject?: string; message?: string; category?: string; severity?: string; pagePath?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const subject = (body.subject ?? "").trim();
  const rawMessage = (body.message ?? "").trim();
  const category = (body.category ?? "").trim() || null;

  if (subject.length < 4 || subject.length > LIMITS.SUBJECT_MAX)
    return NextResponse.json({ error: `Subject must be 4–${LIMITS.SUBJECT_MAX} characters.` }, { status: 400 });
  if (rawMessage.length < 10 || rawMessage.length > LIMITS.MESSAGE_MAX)
    return NextResponse.json({ error: `Message must be 10–${LIMITS.MESSAGE_MAX} characters.` }, { status: 400 });
  if (category && !(SUPPORT_CATEGORIES as readonly string[]).includes(category))
    return NextResponse.json({ error: "Pick a valid category." }, { status: 400 });

  // The originating page is useful context; fold it into the message so we keep
  // it without widening the schema.
  const pagePath = body.pagePath?.slice(0, 300);
  const message = pagePath ? `${rawMessage}\n\n— Reported from: ${pagePath}` : rawMessage;

  // Enrich identity from the session (name + primary workspace). Best-effort:
  // never block filing a ticket on a profile/workspace lookup hiccup.
  let userName: string | null = null;
  let tenantId: string | null = null;
  let tenantName: string | null = null;
  try {
    const profile = await getUserById(user.id);
    userName = profile?.full_name ?? null;
    const workspaces = await getUserWorkspaces(user.id);
    if (workspaces[0]) { tenantId = workspaces[0].id; tenantName = workspaces[0].name; }
  } catch (err) {
    supportLog("support.ticket.identity.enrich.failed", { userId: user.id, error: err });
  }

  let ticket;
  try {
    ticket = await createTicket({
      tenantId, tenantName,
      userId: user.id,
      userEmail: user.email,
      userName,
      subject,
      message,
      priority: mapSeverityToPriority(body.severity),
      category,
    });
  } catch (err) {
    supportLog("support.ticket.create.failed", { userId: user.id, tenantId, error: err });
    return NextResponse.json({ error: "Could not file your request right now. Try again shortly." }, { status: 500 });
  }

  supportLog("support.ticket.created", {
    ticketNumber: ticket.ticket_number, userId: user.id, tenantId,
  });

  // Notify support admins — persistence already succeeded, so email failures are
  // logged and swallowed. The ticket remains visible in /support regardless.
  const admins = getSupportAdminEmails();
  if (admins.length > 0) {
    const mail = buildAdminNotificationEmail(ticket, appBaseUrl());
    void Promise.allSettled(
      admins.map((to) => sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text })),
    ).then((results) => {
      const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
      if (failed.length > 0) {
        supportLog("support.ticket.notify.failed", { ticketNumber: ticket!.ticket_number, error: `${failed.length}/${admins.length} recipients failed` });
      }
    });
  } else {
    supportLog("support.ticket.notify.skipped", { ticketNumber: ticket.ticket_number, error: "no support admins configured" });
  }

  return NextResponse.json(
    { ok: true, ticket: { ticketNumber: ticket.ticket_number, status: ticket.status } },
    { status: 201 },
  );
}
