import "server-only";

import type { SupportTicket, TicketStatus } from "@/lib/server/support";

/* ══════════════════════════════════════════════════════════════════════════════
   INBOUND SUPPORT MAIL — how a Spiceworks update reaches the customer.

   ── THE LOOP ─────────────────────────────────────────────────────────────────
   The free Spiceworks help desk has no API and no webhooks, but it does email the
   ticket's requester when a technician comments or closes the ticket. Reports are
   forwarded to Spiceworks FROM the support mailbox (SUPPORT_INBOUND_ADDRESS), so
   that mailbox is the requester, and every update lands there. The mailbox is set
   up to POST each message to /api/support/inbound/<token>, and this file decides
   what the message means:

     from the help desk  →  a technician comment and/or a status change; the
                            customer is told by email and sees it under My reports
     from the customer   →  their reply to an update email; added to the thread
                            and passed on to the help desk
     anything else       →  ignored, and logged

   The customer never needs a Spiceworks account.

   ── WHAT IS DELIBERATELY TOLERANT ────────────────────────────────────────────
   Spiceworks does not publish the format of its notification emails, so nothing
   here depends on one. A message is matched by the Vectorbea number in its subject
   or body (Spiceworks keeps the subject it was sent), or by the help desk's own
   ticket number once an earlier message has taught it. Status words are read from
   the subject and the first lines only, and only from help desk senders — a
   customer writing "this is still not resolved" must not close their own ticket.
══════════════════════════════════════════════════════════════════════════════ */

export interface InboundEmail {
  fromEmail: string;
  fromName: string | null;
  subject: string;
  /** Plain text, already stripped of the quoted history when the provider did it. */
  text: string;
  /** True when `text` is the provider's own stripped reply. */
  stripped: boolean;
  messageId: string | null;
  headers: Record<string, string>;
}

const TICKET_NUMBER = /\bVB-[A-HJ-NP-Z2-9]{6}\b/;
const HELPDESK_REF = /(?:ticket\s*#\s*|\[#)(\d{1,9})\b/i;
export const LOOP_HEADER = "X-Vectorbea-Support";

// ─── Parsing provider payloads ────────────────────────────────────────────────

/** "Ada Lovelace <ada@acme.com>" → parts. A bare address works too. */
export function parseAddress(raw: string | null | undefined): { email: string; name: string | null } | null {
  if (!raw) return null;
  const angled = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  const email = (angled ? angled[2] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = angled?.[1]?.trim() || null;
  return { email, name };
}

/** Raw header block ("Name: value\r\n…") → a lower-cased map. Folded lines are joined. */
export function parseHeaderBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  let last: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    if (/^\s/.test(line) && last) { out[last] += " " + line.trim(); continue; }
    const at = line.indexOf(":");
    if (at <= 0) continue;
    last = line.slice(0, at).trim().toLowerCase();
    out[last] = line.slice(at + 1).trim();
  }
  return out;
}

/** HTML → readable text, for providers that send no plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * Normalise what an inbound-mail provider posts.
 *
 * Supported: SendGrid Inbound Parse and Mailgun routes (form posts), Postmark
 * inbound (JSON), and a plain JSON shape `{from, subject, text, html, headers,
 * messageId}` for anything else — a Cloudflare Email Worker, or a small relay.
 * Returns null when there is no usable sender.
 */
export function normaliseInbound(input: { form?: FormData; json?: Json }): InboundEmail | null {
  if (input.form) {
    const f = input.form;
    const get = (k: string) => str(f.get(k));
    const headers = get("headers")
      ? parseHeaderBlock(get("headers")!)
      : mailgunHeaders(get("message-headers"));
    const from = parseAddress(get("from") ?? get("sender"));
    if (!from) return null;
    const strippedText = get("stripped-text");
    const text = strippedText ?? get("text") ?? get("body-plain") ?? htmlToText(get("html") ?? get("body-html") ?? "");
    return {
      fromEmail: from.email,
      fromName: from.name,
      subject: get("subject") ?? "",
      text,
      stripped: Boolean(strippedText),
      messageId: get("Message-Id") ?? headers["message-id"] ?? null,
      headers,
    };
  }

  const j = input.json ?? {};
  // Resend-style webhook envelope: { type, data: { … } }.
  const body: Json = typeof j.type === "string" && j.data && typeof j.data === "object" ? (j.data as Json) : j;

  // Postmark.
  if (str(body.From) || (body.FromFull && typeof body.FromFull === "object")) {
    const full = body.FromFull as Json | undefined;
    const from = parseAddress(str(full?.Email) ?? str(body.From));
    if (!from) return null;
    const headers: Record<string, string> = {};
    if (Array.isArray(body.Headers)) {
      for (const h of body.Headers as Json[]) {
        const name = str(h.Name); const value = str(h.Value);
        if (name && value) headers[name.toLowerCase()] = value;
      }
    }
    const strippedText = str(body.StrippedTextReply);
    return {
      fromEmail: from.email,
      fromName: str(full?.Name) ?? from.name,
      subject: str(body.Subject) ?? "",
      text: strippedText ?? str(body.TextBody) ?? htmlToText(str(body.HtmlBody) ?? ""),
      stripped: Boolean(strippedText),
      messageId: headers["message-id"] ?? str(body.MessageID),
      headers,
    };
  }

  // Plain JSON.
  const fromRaw = str(body.from) ?? (body.from && typeof body.from === "object" ? str((body.from as Json).email) : null);
  const from = parseAddress(fromRaw);
  if (!from) return null;
  const headers: Record<string, string> = {};
  if (body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)) {
    for (const [k, v] of Object.entries(body.headers as Json)) if (typeof v === "string") headers[k.toLowerCase()] = v;
  }
  return {
    fromEmail: from.email,
    fromName: from.name,
    subject: str(body.subject) ?? "",
    text: str(body.text) ?? htmlToText(str(body.html) ?? ""),
    stripped: false,
    messageId: str(body.messageId) ?? str(body.message_id) ?? headers["message-id"] ?? null,
    headers,
  };
}

function mailgunHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const pairs = JSON.parse(raw) as unknown;
    const out: Record<string, string> = {};
    if (Array.isArray(pairs)) for (const p of pairs) {
      if (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string") out[p[0].toLowerCase()] = p[1];
    }
    return out;
  } catch {
    return {};
  }
}

// ─── Reading a message ────────────────────────────────────────────────────────

/** The new part of a reply, without the quoted conversation under it. */
export function replyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? "";
    if (/^\s*#+\s*(please\s+)?(reply|type your reply)\s+above this line/i.test(line)) break;
    if (/^\s*-{2,}\s*original message\s*-{2,}/i.test(line)) break;
    if (/^\s*_{8,}\s*$/.test(line)) break;
    if (/^\s*On .{4,200}wrote:\s*$/i.test(line)) break;
    if (/^\s*On .{4,200}$/i.test(line) && /^\s*.{0,120}wrote:\s*$/i.test(next)) break;
    if (/^\s*From:\s.+/i.test(line) && /^\s*(Sent|Date):\s/i.test(next)) break;
    if (/^\s*>/.test(line)) continue;
    if (/^\s*Sent from my\s/i.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const STATUS_SENTENCE = (word: string) => new RegExp(
  `\\b(ticket|request)\\b[^.\\n]{0,40}\\b(has been|have been|was|is now|is|marked(?: as)?)\\s+(${word})\\b` +
  `|\\bstatus\\b\\s*(?:changed\\s*)?(?:to|:)\\s*(${word})\\b`,
  "i",
);

/** What is left of a subject once the customer's own words and the reference tags are removed. */
export function subjectRemainder(subject: string, customerSubject: string): string {
  let rest = subject;
  if (customerSubject) {
    const at = rest.toLowerCase().indexOf(customerSubject.toLowerCase());
    if (at >= 0) rest = rest.slice(0, at) + rest.slice(at + customerSubject.length);
  }
  return rest
    .replace(/\[?\bVB-[A-Z0-9]{6}\b\]?/gi, "")
    .replace(/\[?\s*ticket\s*#\s*\d+\s*\]?|\[#\d+\]/gi, "")
    .replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, "")
    .trim();
}

/**
 * A status change named by the help desk.
 *
 * `subject` must already have the customer's own subject removed (see
 * subjectRemainder) — Spiceworks keeps it, and a report titled "Connection closed"
 * would otherwise resolve itself on every update. In the body only a SENTENCE
 * about the ticket's state counts ("ticket has been closed", "status: resolved"),
 * and only in the first few lines, so a technician writing "I closed the old
 * connection" does not resolve anything.
 */
export function helpdeskStatus(subject: string, text: string): TicketStatus | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 4);
  const says = (word: string) =>
    new RegExp(`\\b(${word})\\b`, "i").test(subject) || lines.some((l) => STATUS_SENTENCE(word).test(l));
  if (says("re-?opened")) return "OPEN";
  if (says("closed|resolved")) return "RESOLVED";
  return null;
}

/**
 * The technician's words from a help desk notification: without the status
 * announcement, links, and the help desk's own footer. Empty when nothing is left,
 * or when all that is left is the customer's original report quoted back (the
 * "ticket created" confirmation does that).
 */
export function helpdeskBody(text: string, originalMessage: string): string {
  const kept = text.split(/\r?\n/).filter((raw) => {
    const line = raw.trim();
    if (!line) return true;
    if (STATUS_SENTENCE("closed|resolved|re-?opened|updated|created|opened|received|assigned").test(line)) return false;
    if (/^(https?:\/\/\S+|<https?:\/\/\S+>)$/i.test(line)) return false;
    if (/spiceworks/i.test(line)) return false;
    // The lead line of a customer comment we forwarded (buildHelpdeskCommentEmail), if echoed back.
    if (/^comment from .{1,200}:$/i.test(line)) return false;
    if (/^(view|open|see)\s+(this\s+|the\s+|your\s+)?(ticket|request)\b/i.test(line)) return false;
    if (/^(click here|to reply|reply to this email|you can reply)\b/i.test(line)) return false;
    return true;
  });
  const body = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (body && originalMessage && flat(originalMessage).includes(flat(body))) return "";
  return body;
}

export function ticketNumberIn(email: InboundEmail): string | null {
  return TICKET_NUMBER.exec(email.subject)?.[0] ?? TICKET_NUMBER.exec(email.text)?.[0] ?? null;
}

export function helpdeskRefIn(subject: string): string | null {
  return HELPDESK_REF.exec(subject)?.[1] ?? null;
}

// ─── Who sent it ──────────────────────────────────────────────────────────────

export interface SenderRules {
  /** SPICEWORKS_HELPDESK_EMAIL. Mail from its domain is the help desk. */
  helpdeskAddress: string | null;
  /** SUPPORT_HELPDESK_SENDERS: extra addresses or @domains that count as the help desk. */
  extraHelpdeskSenders: string[];
  /** The mailbox itself — mail "from" it is our own and is never processed. */
  inboundAddress: string | null;
  supportAdmins: string[];
}

export function isHelpdeskSender(email: string, rules: SenderRules): boolean {
  const domain = email.split("@")[1] ?? "";
  if (/(^|\.)spiceworks\.com$/.test(domain)) return true;
  if (rules.helpdeskAddress) {
    const hdDomain = rules.helpdeskAddress.split("@")[1]?.toLowerCase();
    if (email === rules.helpdeskAddress.toLowerCase() || (hdDomain && domain === hdDomain)) return true;
  }
  return rules.extraHelpdeskSenders.some((s) => {
    const rule = s.trim().toLowerCase();
    return rule.startsWith("@") ? domain === rule.slice(1) : email === rule;
  });
}

// ─── The decision ─────────────────────────────────────────────────────────────

export type InboundDecision =
  | { kind: "ignored"; reason: string }
  | { kind: "unmatched"; reason: string }
  | { kind: "customer"; ticket: SupportTicket; body: string }
  | { kind: "support"; ticket: SupportTicket; body: string; status: TicketStatus | null; helpdeskRef: string | null; authorName: string | null };

/**
 * What an inbound message means. Pure apart from the two lookups it is given, so
 * every rule above is testable without a database or a mail provider.
 */
export async function decideInbound(
  email: InboundEmail,
  rules: SenderRules,
  lookup: {
    byNumber: (ticketNumber: string) => Promise<SupportTicket | null>;
    byHelpdeskRef: (ref: string) => Promise<SupportTicket | null>;
  },
): Promise<InboundDecision> {
  if (Object.keys(email.headers).some((h) => h === LOOP_HEADER.toLowerCase())) {
    return { kind: "ignored", reason: "our own outgoing mail" };
  }
  if (rules.inboundAddress && email.fromEmail === rules.inboundAddress.toLowerCase()) {
    return { kind: "ignored", reason: "sent from the support mailbox itself" };
  }

  const fromHelpdesk = isHelpdeskSender(email.fromEmail, rules) || rules.supportAdmins.includes(email.fromEmail);
  const number = ticketNumberIn(email);
  const ref = helpdeskRefIn(email.subject);
  const ticket = (number ? await lookup.byNumber(number) : null)
    ?? (fromHelpdesk && ref ? await lookup.byHelpdeskRef(ref) : null);
  if (!ticket) return { kind: "unmatched", reason: number ? `no ticket ${number}` : "no ticket reference in the message" };

  const body = email.stripped ? email.text.trim() : replyText(email.text);

  if (fromHelpdesk) {
    return {
      kind: "support",
      ticket,
      body: helpdeskBody(body, ticket.message),
      status: helpdeskStatus(subjectRemainder(email.subject, ticket.subject), body),
      helpdeskRef: ref,
      authorName: email.fromName,
    };
  }

  if (email.fromEmail === ticket.user_email.toLowerCase()) {
    const auto = (email.headers["auto-submitted"] ?? "no").toLowerCase() !== "no"
      || /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office)/i.test(email.subject);
    if (auto) return { kind: "ignored", reason: "automatic reply from the customer's mailbox" };
    if (!body) return { kind: "ignored", reason: "empty reply" };
    return { kind: "customer", ticket, body };
  }

  return { kind: "ignored", reason: "sender is neither the customer nor the help desk" };
}
