import "server-only";

import { sendEmail, emailConfigured } from "@/lib/server/email";
import { appBaseUrl, recordForward, supportLog, type SupportTicket } from "@/lib/server/support";
import { LOOP_HEADER } from "@/lib/server/support-inbound";
import { buildHelpdeskCommentEmail, supportInboundAddress } from "@/lib/server/support-mail";

/* ══════════════════════════════════════════════════════════════════════════════
   FORWARDING SUPPORT TICKETS TO SPICEWORKS

   ── WHY EMAIL, AND NOT AN API ─────────────────────────────────────────────────
   The free Spiceworks Cloud Help Desk takes tickets by email: every account has
   an inbound address (help@<account>.on.spiceworks.com) and each message becomes
   a ticket, subject as the summary and body as the description. There is no
   public ticket API on the free plan to call instead, so this sends a well-formed
   email to that address through the app's existing email provider.

   ── WHAT THAT MEANS FOR A TICKET ──────────────────────────────────────────────
   · The ticket is saved in Vectorbea FIRST. Forwarding happens after, and its
     outcome is recorded on the row (forward_status / forward_error), so a failed
     send is visible in /support and can be sent again — never a lost report.
   · Spiceworks records the SENDER as the requester, and the sender is our
     FROM_EMAIL, not the customer. The customer's name and email are therefore
     the first lines of the description, and Reply-To is the customer, so a reply
     from a mail client reaches them.
   · The Vectorbea ticket number leads the subject ("[VB-A83K2P] …"), so either
     system's ticket can be found from the other.
   · Updates come BACK by email too, when SUPPORT_INBOUND_ADDRESS is set: mail is
     then sent from that mailbox, Spiceworks emails its comments and status changes
     to it, and lib/server/support-inbound.ts applies them to the ticket. Without
     it there is nothing in Spiceworks to read status from.

   Configuration: SPICEWORKS_HELPDESK_EMAIL (forwarding), plus SUPPORT_INBOUND_ADDRESS
   and SUPPORT_INBOUND_TOKEN (two-way sync).
══════════════════════════════════════════════════════════════════════════════ */

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The help desk's inbound address, or null when forwarding is not configured. */
export function spiceworksAddress(): string | null {
  const raw = process.env.SPICEWORKS_HELPDESK_EMAIL?.trim();
  return raw && ADDRESS.test(raw) ? raw : null;
}

export interface SpiceworksStatus {
  enabled: boolean;
  address: string | null;
  /** False when no email provider is configured, so nothing can be sent. */
  emailReady: boolean;
  /** Why forwarding cannot work, in a sentence, or null when it can. */
  problem: string | null;
  /** Two-way sync: updates made in Spiceworks come back to the ticket. */
  sync: { enabled: boolean; mailbox: string | null; problem: string | null };
}

export function spiceworksStatus(): SpiceworksStatus {
  const address = spiceworksAddress();
  const emailReady = emailConfigured();
  const rawSet = Boolean(process.env.SPICEWORKS_HELPDESK_EMAIL?.trim());
  const problem = !rawSet
    ? "Set SPICEWORKS_HELPDESK_EMAIL to your Spiceworks help desk address."
    : !address
      ? "SPICEWORKS_HELPDESK_EMAIL is not a valid email address."
      : !emailReady
        ? "No email provider is configured, so tickets cannot be sent."
        : null;
  const mailbox = supportInboundAddress();
  const tokenSet = (process.env.SUPPORT_INBOUND_TOKEN?.trim().length ?? 0) >= 24;
  const syncProblem = !mailbox
    ? "Set SUPPORT_INBOUND_ADDRESS."
    : !tokenSet
      ? "Set SUPPORT_INBOUND_TOKEN (24+ characters)."
      : null;
  return {
    enabled: Boolean(address) && emailReady, address, emailReady, problem,
    sync: { enabled: !syncProblem && Boolean(address) && emailReady, mailbox, problem: syncProblem },
  };
}

const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High" };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The email Spiceworks turns into a ticket. Pure, so it is unit-testable. */
export function buildSpiceworksEmail(
  ticket: Pick<SupportTicket,
    "ticket_number" | "subject" | "message" | "priority" | "category" |
    "user_email" | "user_name" | "tenant_name" | "created_at">,
  baseUrl: string = appBaseUrl(),
): { subject: string; text: string; html: string; replyTo: string } {
  const requester = ticket.user_name ? `${ticket.user_name} <${ticket.user_email}>` : ticket.user_email;
  const link = `${baseUrl}/support?ticket=${encodeURIComponent(ticket.ticket_number)}`;
  const facts: Array<[string, string]> = [
    ["Requester", requester],
    ["Workspace", ticket.tenant_name ?? "Not recorded"],
    ["Priority", PRIORITY_LABEL[ticket.priority] ?? ticket.priority],
    ["Category", ticket.category ? ticket.category.replace(/_/g, " ") : "Not set"],
    ["Vectorbea ticket", ticket.ticket_number],
  ];

  const text =
    facts.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\n${ticket.message}\n\n` +
    `Reply to the requester at ${ticket.user_email}.\n` +
    `Vectorbea support portal: ${link}\n`;

  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.55">
  <table style="border-collapse:collapse">${facts
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;white-space:nowrap">${k}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`)
    .join("")}</table>
  <p style="white-space:pre-wrap;margin:16px 0">${escapeHtml(ticket.message)}</p>
  <p style="color:#6b7280;margin:0">Reply to the requester at <a href="mailto:${escapeHtml(ticket.user_email)}">${escapeHtml(ticket.user_email)}</a>.
  <a href="${escapeHtml(link)}">Open in the Vectorbea support portal</a>.</p>
</div>`;

  return {
    subject: `[${ticket.ticket_number}] ${ticket.subject}`,
    text,
    html,
    replyTo: ticket.user_email,
  };
}

export interface ForwardResult {
  status: "sent" | "failed" | "skipped";
  error: string | null;
  ticket: SupportTicket | null;
}

/**
 * Send one ticket to Spiceworks and record the outcome on the row.
 *
 * Never throws: a forward that fails is a recorded state, and the caller has
 * already told the customer their report was filed.
 */
export async function forwardToSpiceworks(ticket: SupportTicket): Promise<ForwardResult> {
  const status = spiceworksStatus();
  if (!status.enabled || !status.address) {
    return { status: "skipped", error: status.problem, ticket: null };
  }

  const mail = buildSpiceworksEmail(ticket);
  let error: string | null = null;
  try {
    const result = await sendEmail({ to: status.address, ...mail, ...senderFor(ticket.ticket_number) }, 1);
    if (!result.ok) error = friendlySendError(result.error);
  } catch (err) {
    error = friendlySendError(err instanceof Error ? err.message : String(err));
  }

  const outcome = error ? "failed" : "sent";
  supportLog(error ? "support.ticket.forward.failed" : "support.ticket.forwarded", {
    ticketNumber: ticket.ticket_number,
    error: error ?? undefined,
  });
  const updated = await recordForward(ticket.ticket_number, {
    to: status.address, status: outcome, error,
  }).catch((err: unknown) => {
    supportLog("support.ticket.forward.record.failed", { ticketNumber: ticket.ticket_number, error: err });
    return null;
  });
  return { status: outcome, error, ticket: updated };
}

/**
 * Sent FROM the support mailbox when two-way sync is set up: Spiceworks makes the
 * sender the requester and emails its updates there, which is how they come back.
 */
function senderFor(ticketNumber: string): { from?: string; headers: Record<string, string> } {
  const mailbox = supportInboundAddress();
  return {
    ...(mailbox ? { from: `Vectorbea Support <${mailbox}>` } : {}),
    headers: { [LOOP_HEADER]: ticketNumber },
  };
}

/** Add a customer's comment to the Spiceworks ticket. Never throws. */
export async function forwardCommentToSpiceworks(ticket: SupportTicket, body: string): Promise<boolean> {
  const status = spiceworksStatus();
  if (!status.enabled || !status.address) return false;
  const mail = buildHelpdeskCommentEmail(ticket, body);
  try {
    const result = await sendEmail({ to: status.address, ...mail, replyTo: ticket.user_email, ...senderFor(ticket.ticket_number) }, 1);
    if (!result.ok) supportLog("support.ticket.comment.forward.failed", { ticketNumber: ticket.ticket_number, error: result.error });
    return result.ok;
  } catch (err) {
    supportLog("support.ticket.comment.forward.failed", { ticketNumber: ticket.ticket_number, error: err });
    return false;
  }
}

/** A test ticket, so an admin can confirm tickets arrive before a customer files one. */
export async function sendSpiceworksTest(adminEmail: string): Promise<{ ok: boolean; error: string | null }> {
  const status = spiceworksStatus();
  if (!status.enabled || !status.address) return { ok: false, error: status.problem };
  const mail = buildSpiceworksEmail({
    ticket_number: "VB-TEST00",
    subject: "Test ticket from Vectorbea",
    message: "This is a test sent from the Vectorbea support portal. You can close it.",
    priority: "LOW",
    category: "other",
    user_email: adminEmail,
    user_name: "Vectorbea support portal",
    tenant_name: null,
    created_at: new Date().toISOString(),
  });
  const result = await sendEmail({ to: status.address, ...mail, ...senderFor("VB-TEST00") }, 0).catch((err: unknown) => ({
    ok: false, provider: "unknown", error: err instanceof Error ? err.message : String(err),
  }));
  return { ok: result.ok, error: result.ok ? null : friendlySendError(result.error) };
}

/** Provider errors, without keys or response bodies that are not useful to read. */
function friendlySendError(raw: string | undefined): string {
  const message = (raw ?? "").trim();
  if (/not set|not installed/i.test(message)) return "Email is not configured for this deployment.";
  if (/\b401\b|\b403\b|unauthori|forbidden/i.test(message)) return "The email provider rejected the credentials.";
  if (/\b422\b|domain|verify|sender/i.test(message)) return "The sender address is not verified with the email provider.";
  if (/\b429\b|rate/i.test(message)) return "The email provider is rate limiting. Try again shortly.";
  return "The email could not be sent. Try again shortly.";
}
