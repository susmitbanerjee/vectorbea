import "server-only";

import {
  addMessage, getSupportAdminEmails, getTicketByHelpdeskRef, getTicketByNumber, listMessages, setHelpdeskRef,
  setTicketStatus, supportLog, type SupportMessage, type SupportTicket, type TicketStatus,
} from "@/lib/server/support";
import { sendEmail } from "@/lib/server/email";
import { decideInbound, LOOP_HEADER, type InboundDecision, type InboundEmail } from "@/lib/server/support-inbound";
import { buildAdminCommentEmail, notifyCustomer, supportInboundAddress } from "@/lib/server/support-mail";
import { forwardCommentToSpiceworks, spiceworksAddress, spiceworksStatus } from "@/lib/server/support-spiceworks";

/* ══════════════════════════════════════════════════════════════════════════════
   APPLYING SUPPORT CONVERSATION CHANGES — one place, whichever door they came in.

   A comment or a status change can arrive from the app, from the /support portal,
   or by email (the customer replying, or Spiceworks reporting a technician's
   update). Each path ends here so the side effects are the same: the message is
   recorded once, the ticket status follows, and the OTHER party is told.
══════════════════════════════════════════════════════════════════════════════ */

export interface SyncResult {
  outcome: InboundDecision["kind"] | "duplicate";
  reason?: string;
  ticketNumber?: string;
}

/** An inbound email, end to end. Returns what happened, for the webhook's response and logs. */
export async function processInboundEmail(email: InboundEmail): Promise<SyncResult> {
  const decision = await decideInbound(email, {
    helpdeskAddress: spiceworksAddress(),
    extraHelpdeskSenders: (process.env.SUPPORT_HELPDESK_SENDERS ?? "").split(",").filter(Boolean),
    inboundAddress: supportInboundAddress(),
    supportAdmins: getSupportAdminEmails(),
  }, {
    byNumber: getTicketByNumber,
    byHelpdeskRef: getTicketByHelpdeskRef,
  });

  if (decision.kind === "ignored" || decision.kind === "unmatched") {
    supportLog(`support.inbound.${decision.kind}`, { error: decision.reason });
    return { outcome: decision.kind, reason: decision.reason };
  }

  const ticketNumber = decision.ticket.ticket_number;

  if (decision.kind === "customer") {
    const saved = await customerComment(decision.ticket, decision.body, "email", email.messageId);
    if (!saved) return { outcome: "duplicate", ticketNumber };
    await saved.deliver();
    return { outcome: "customer", ticketNumber };
  }

  // From the help desk.
  if (decision.helpdeskRef) await setHelpdeskRef(decision.ticket.id, decision.helpdeskRef);
  // A notification that only repeats a customer comment we forwarded is not support talking.
  if (decision.body && await isEcho(decision.ticket.id, decision.body)) decision.body = "";
  const body = decision.body || (decision.status ? statusLine(decision.status) : "");
  if (!body) return { outcome: "ignored", reason: "no comment and no status change", ticketNumber };

  const message = await addMessage({
    ticketId: decision.ticket.id,
    authorType: decision.body ? "support" : "system",
    authorName: decision.authorName ?? "Support",
    body,
    source: "helpdesk",
    externalMessageId: email.messageId,
  });
  if (!message) return { outcome: "duplicate", ticketNumber };

  const changed = decision.status
    ? await setTicketStatus(decision.ticket.id, decision.status, "Spiceworks")
    : null;
  const current = changed ?? decision.ticket;
  if (changed && decision.body) {
    await addMessage({
      ticketId: decision.ticket.id, authorType: "system", authorName: decision.authorName ?? "Support",
      body: statusLine(changed.status), source: "helpdesk",
    });
  }

  // One email per update: a comment that also closes the ticket says both.
  if (decision.body) {
    const note = changed ? `\n\n${statusSentence(changed.status)}` : "";
    await notifyCustomer(current, { kind: "comment", body: decision.body + note, authorName: decision.authorName });
  } else if (changed) {
    await notifyCustomer(current, { kind: "status", status: changed.status });
  }
  supportLog("support.inbound.helpdesk.applied", { ticketNumber });
  return { outcome: "support", ticketNumber };
}

/**
 * A customer's comment, from the app or by email. Reopens a resolved ticket —
 * a customer answering means it is not done. Null when the email was already
 * recorded.
 *
 * `deliver` passes the comment on (to the help desk, or to the support admins when
 * none is connected). It is returned rather than run so the app route can send it
 * after the response; the inbound webhook simply awaits it.
 */
export async function customerComment(
  ticket: SupportTicket,
  body: string,
  source: "app" | "email",
  externalMessageId: string | null = null,
): Promise<{ message: SupportMessage; ticket: SupportTicket; deliver: () => Promise<void> } | null> {
  const message = await addMessage({
    ticketId: ticket.id,
    authorType: "customer",
    authorName: ticket.user_name,
    authorEmail: ticket.user_email,
    body,
    source,
    externalMessageId,
  });
  if (!message) return null;
  const reopened = ticket.status === "RESOLVED" ? await setTicketStatus(ticket.id, "OPEN", null) : null;
  const current = reopened ?? ticket;
  supportLog("support.ticket.customer.comment", { ticketNumber: ticket.ticket_number });
  return { message, ticket: current, deliver: () => deliverCustomerComment(current, body) };
}

async function deliverCustomerComment(ticket: SupportTicket, body: string): Promise<void> {
  if (spiceworksStatus().enabled) {
    await forwardCommentToSpiceworks(ticket, body);
    return;
  }
  const admins = getSupportAdminEmails();
  if (admins.length === 0) return;
  const mail = buildAdminCommentEmail(ticket, body);
  const results = await Promise.allSettled(
    admins.map((to) => sendEmail({ to, ...mail, headers: { [LOOP_HEADER]: ticket.ticket_number } }, 1)),
  );
  const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
  if (failed.length > 0) {
    supportLog("support.ticket.comment.notify.failed", { ticketNumber: ticket.ticket_number, error: `${failed.length}/${admins.length} recipients failed` });
  }
}

/** A reply written in the /support portal. `deliver` emails the customer; run it after responding. */
export async function portalReply(
  ticket: SupportTicket,
  body: string,
  adminEmail: string,
): Promise<{ message: SupportMessage; deliver: () => Promise<void> } | null> {
  const message = await addMessage({
    ticketId: ticket.id,
    authorType: "support",
    authorName: "Vectorbea Support",
    authorEmail: adminEmail,
    body,
    source: "portal",
  });
  if (!message) return null;
  return { message, deliver: () => notifyCustomer(ticket, { kind: "comment", body, authorName: "Vectorbea Support" }) };
}

/**
 * A status change made in the /support portal, with the resolution note when one
 * was written. Recorded in the conversation and emailed to the customer once.
 */
export async function portalStatusChanged(
  ticket: SupportTicket,
  status: TicketStatus,
  note: string | null = null,
): Promise<void> {
  if (note) {
    await addMessage({
      ticketId: ticket.id, authorType: "support", authorName: "Vectorbea Support", body: note, source: "portal",
    }).catch(() => null);
  }
  await addMessage({
    ticketId: ticket.id, authorType: "system", authorName: "Vectorbea Support", body: statusLine(status), source: "portal",
  }).catch(() => null);
  await notifyCustomer(ticket, note
    ? { kind: "comment", body: `${note}\n\n${statusSentence(status)}`, authorName: "Vectorbea Support" }
    : { kind: "status", status });
}

async function isEcho(ticketId: string, body: string): Promise<boolean> {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const target = flat(body);
  const messages = await listMessages(ticketId).catch(() => [] as SupportMessage[]);
  return messages.some((m) => m.author_type === "customer" && flat(m.body) === target);
}

function statusLine(status: TicketStatus): string {
  return status === "RESOLVED" ? "Marked resolved." : "Reopened.";
}

function statusSentence(status: TicketStatus): string {
  return status === "RESOLVED" ? "This report is now marked resolved." : "This report has been reopened.";
}
