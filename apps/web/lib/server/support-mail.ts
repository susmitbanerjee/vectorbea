import "server-only";

import { sendEmail } from "@/lib/server/email";
import { LOOP_HEADER } from "@/lib/server/support-inbound";
import { appBaseUrl, supportLog, type SupportTicket, type TicketStatus } from "@/lib/server/support";

/* ══════════════════════════════════════════════════════════════════════════════
   SUPPORT MAIL SENT BY VECTORBEA

   Two kinds, both marked with LOOP_HEADER so that if one ever comes back into the
   support mailbox it is recognised and dropped instead of processed:

   · to the CUSTOMER when support comments or the ticket changes status. Reply-To
     is the support mailbox, so answering the email adds to the same ticket.
   · to the HELP DESK when the customer comments, as a reply on the ticket.

   Both carry "[VB-XXXXXX]" in the subject: that is what matches a reply back.
══════════════════════════════════════════════════════════════════════════════ */

/** The mailbox replies come back to. Unset means two-way sync is off. */
export function supportInboundAddress(): string | null {
  const raw = process.env.SUPPORT_INBOUND_ADDRESS?.trim();
  return raw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.toLowerCase() : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function threadSubject(ticket: Pick<SupportTicket, "ticket_number" | "subject">): string {
  return `Re: [${ticket.ticket_number}] ${ticket.subject}`;
}

export type CustomerUpdate =
  | { kind: "comment"; body: string; authorName: string | null }
  | { kind: "status"; status: TicketStatus };

/** The update email a customer receives. Pure, so it is unit-testable. */
export function buildCustomerUpdateEmail(
  ticket: Pick<SupportTicket, "ticket_number" | "subject" | "user_name">,
  update: CustomerUpdate,
  baseUrl: string = appBaseUrl(),
  replyable = true,
): { subject: string; text: string; html: string } {
  const link = `${baseUrl}/control?support=${encodeURIComponent(ticket.ticket_number)}`;
  const greeting = ticket.user_name ? `Hi ${ticket.user_name.split(" ")[0]},` : "Hi,";
  const lead = update.kind === "comment"
    ? `${update.authorName ?? "Our support team"} replied to your report ${ticket.ticket_number}:`
    : update.status === "RESOLVED"
      ? `Your report ${ticket.ticket_number} has been resolved. If it is not fixed, comment on it and it reopens.`
      : `Your report ${ticket.ticket_number} has been reopened.`;
  const quote = update.kind === "comment" ? update.body : null;
  const answer = replyable ? "Reply to this email to answer, or open the report in Vectorbea" : "Open the report in Vectorbea to answer";

  const text = [
    greeting, "", lead, ...(quote ? ["", quote] : []), "",
    `${answer}:`, link,
  ].join("\n");

  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55;color:#111827">
  <p style="margin:0 0 12px">${escapeHtml(greeting)}</p>
  <p style="margin:0 0 12px">${escapeHtml(lead)}</p>
  ${quote ? `<p style="white-space:pre-wrap;margin:0 0 16px;padding:12px;border-left:3px solid #d1d5db;background:#f9fafb">${escapeHtml(quote)}</p>` : ""}
  <p style="margin:0;color:#6b7280">${replyable ? "Reply to this email to answer, or " : ""}<a href="${escapeHtml(link)}">${replyable ? "open the report in Vectorbea" : "Open the report in Vectorbea"}</a>${replyable ? "" : " to answer"}.</p>
</div>`;

  return { subject: threadSubject(ticket), text, html };
}

/** Tell the customer about a comment or a status change. Never throws. */
export async function notifyCustomer(ticket: SupportTicket, update: CustomerUpdate): Promise<void> {
  const inbound = supportInboundAddress();
  const mail = buildCustomerUpdateEmail(ticket, update, appBaseUrl(), inbound !== null);
  try {
    const result = await sendEmail({
      to: ticket.user_email,
      ...mail,
      ...(inbound ? { from: `Vectorbea Support <${inbound}>`, replyTo: inbound } : {}),
      headers: { [LOOP_HEADER]: ticket.ticket_number },
    }, 1);
    if (!result.ok) supportLog("support.customer.notify.failed", { ticketNumber: ticket.ticket_number, error: result.error });
  } catch (err) {
    supportLog("support.customer.notify.failed", { ticketNumber: ticket.ticket_number, error: err });
  }
}

/** The email that adds a customer's comment to the help desk ticket. Pure. */
export function buildHelpdeskCommentEmail(
  ticket: Pick<SupportTicket, "ticket_number" | "subject" | "user_email" | "user_name" | "helpdesk_ref">,
  body: string,
): { subject: string; text: string; html: string } {
  const who = ticket.user_name ? `${ticket.user_name} <${ticket.user_email}>` : ticket.user_email;
  const ref = ticket.helpdesk_ref ? ` [Ticket #${ticket.helpdesk_ref}]` : "";
  const text = `Comment from ${who}:\n\n${body}\n`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55">
  <p style="margin:0 0 8px;color:#6b7280">Comment from ${escapeHtml(who)}:</p>
  <p style="white-space:pre-wrap;margin:0">${escapeHtml(body)}</p>
</div>`;
  return { subject: `${threadSubject(ticket)}${ref}`, text, html };
}

/** Tells the support admins about a customer comment when no help desk is connected. Pure. */
export function buildAdminCommentEmail(
  ticket: Pick<SupportTicket, "ticket_number" | "subject" | "user_email" | "user_name">,
  body: string,
  baseUrl: string = appBaseUrl(),
): { subject: string; text: string; html: string } {
  const who = ticket.user_name ? `${ticket.user_name} <${ticket.user_email}>` : ticket.user_email;
  const link = `${baseUrl}/support?ticket=${encodeURIComponent(ticket.ticket_number)}`;
  const text = `Comment from ${who}:\n\n${body}\n\nOpen the ticket: ${link}\n`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55">
  <p style="margin:0 0 8px;color:#6b7280">Comment from ${escapeHtml(who)}:</p>
  <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(body)}</p>
  <p style="margin:0"><a href="${escapeHtml(link)}">Open the ticket</a></p>
</div>`;
  return { subject: threadSubject(ticket), text, html };
}
