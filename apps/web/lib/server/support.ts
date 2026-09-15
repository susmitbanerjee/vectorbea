import "server-only";
import { appSql } from "@/lib/server/app-db";

/**
 * Support tickets — the customer support widget writes here, and the admin
 * portal at /support reads/updates here. One small Postgres table in the
 * existing Neon database; no separate service, queue, or search engine.
 *
 * Admin model: a short list of support administrators identified by email
 * (SUPPORT_ADMIN_EMAILS). The portal is intentionally cross-tenant so admins
 * can support customers across every workspace — so admin access is gated by
 * email on every admin endpoint, never by tenant membership.
 */

// ─── Domain types ─────────────────────────────────────────────────────────────

export type TicketStatus = "OPEN" | "RESOLVED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH";

export interface SupportTicket {
  id: string;
  ticket_number: string;
  tenant_id: string | null;
  tenant_name: string | null;
  user_id: string | null;
  user_email: string;
  user_name: string | null;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  admin_note: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  /** The help desk address it was sent to. Absent on a database without V077. */
  forwarded_to?: string | null;
  forward_status?: "sent" | "failed" | null;
  forward_error?: string | null;
  forward_attempts?: number;
  forwarded_at?: string | null;
  /** The help desk's own ticket number, once its mail has named it (V078). */
  helpdesk_ref?: string | null;
  last_activity_at?: string | null;
}

export const TICKET_STATUSES: TicketStatus[] = ["OPEN", "RESOLVED"];
export const TICKET_PRIORITIES: TicketPriority[] = ["LOW", "NORMAL", "HIGH"];

/** Categories offered by the widget — kept as free-ish text but validated to this set. */
export const SUPPORT_CATEGORIES = [
  "bug", "workflow_failure", "connection_issue", "access_problem", "billing", "other",
] as const;

/** Input limits (also enforced at the API boundary). */
export const LIMITS = {
  SUBJECT_MAX: 200,
  MESSAGE_MAX: 10_000,
  ADMIN_NOTE_MAX: 10_000,
} as const;

// ─── Support-admin authorization ──────────────────────────────────────────────

/**
 * The initial support administrators. Used only as a fallback when neither
 * SUPPORT_ADMIN_EMAILS nor SUPPORT_EMAIL is configured, so the portal is never
 * accidentally locked out. Real deployments set SUPPORT_ADMIN_EMAILS.
 */
const DEFAULT_SUPPORT_ADMINS = ["susmit.b1@gmail.com", "susmit@vectorbea.com"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The configured support-admin allow-list, normalized + deduped.
 * SUPPORT_ADMIN_EMAILS (comma-separated) wins; SUPPORT_EMAIL is honored for
 * backward compatibility; otherwise the built-in defaults apply.
 */
export function getSupportAdminEmails(): string[] {
  const raw = process.env.SUPPORT_ADMIN_EMAILS?.trim()
    || process.env.SUPPORT_EMAIL?.trim()
    || DEFAULT_SUPPORT_ADMINS.join(",");
  const set = new Set(
    raw.split(",").map((e) => normalizeEmail(e)).filter(Boolean),
  );
  return [...set];
}

/** True when the authenticated email is a support admin (case-insensitive). */
export function isSupportAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return getSupportAdminEmails().includes(normalizeEmail(email));
}

// ─── Ticket number ────────────────────────────────────────────────────────────

// Crockford-ish alphabet: no 0/O/1/I to keep numbers easy to read aloud/type.
const TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TICKET_BODY_LEN = 6;

/** Human-readable ticket id, e.g. "VB-A83K2P". 32^6 ≈ 1.07B space. */
export function generateTicketNumber(): string {
  const bytes = new Uint32Array(TICKET_BODY_LEN);
  globalThis.crypto.getRandomValues(bytes);
  let body = "";
  for (let i = 0; i < TICKET_BODY_LEN; i++) {
    body += TICKET_ALPHABET[bytes[i]! % TICKET_ALPHABET.length];
  }
  return `VB-${body}`;
}

/** Map the widget's severity choice onto the ticket priority scale. */
export function mapSeverityToPriority(severity: string | null | undefined): TicketPriority {
  switch ((severity ?? "").toLowerCase()) {
    case "low": return "LOW";
    case "high":
    case "critical": return "HIGH";
    default: return "NORMAL";
  }
}

// ─── Structured logging (no message bodies) ───────────────────────────────────

type LogCtx = {
  ticketNumber?: string;
  userId?: string | null;
  tenantId?: string | null;
  adminEmail?: string;
  error?: unknown;
};

/** Emit a structured support event. Never logs the customer message body. */
export function supportLog(operation: string, ctx: LogCtx = {}): void {
  const line: Record<string, unknown> = { evt: operation };
  if (ctx.ticketNumber) line.ticketNumber = ctx.ticketNumber;
  if (ctx.userId) line.userId = ctx.userId;
  if (ctx.tenantId) line.tenantId = ctx.tenantId;
  if (ctx.adminEmail) line.adminEmail = ctx.adminEmail;
  if (ctx.error !== undefined) {
    line.error = ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
    console.error("[support]", JSON.stringify(line));
  } else {
    console.log("[support]", JSON.stringify(line));
  }
}

// ─── Data access (raw parameterized SQL, like the rest of this subsystem) ─────

/** The application database over the standard wire protocol. See lib/server/app-db.ts. */
function db() {
  return appSql;
}

// Safety net for environments where the migration has not been applied (dev),
// mirroring the previous support subsystem. The migration remains the source
// of truth; this only creates the table if it is entirely absent.
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  const sql = db();
  /* Look before creating. CREATE TABLE IF NOT EXISTS needs CREATE on the schema
     even when the table is already there, so on a least-privilege database role
     every portal request failed with "permission denied for schema public" for a
     table V077 had made. */
  const existing = await sql`SELECT to_regclass('support_tickets') IS NOT NULL AS present` as { present: boolean }[];
  if (existing[0]?.present) {
    tableReady = true;
    return;
  }
  await sql`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_number text        NOT NULL UNIQUE,
      tenant_id     text,
      tenant_name   text,
      user_id       text,
      user_email    text        NOT NULL,
      user_name     text,
      subject       text        NOT NULL,
      message       text        NOT NULL,
      status        text        NOT NULL DEFAULT 'OPEN'   CHECK (status   IN ('OPEN','RESOLVED')),
      priority      text        NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
      category      text,
      admin_note    text,
      resolved_by   text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      resolved_at   timestamptz,
      forwarded_to      text,
      forward_status    text,
      forward_error     text,
      forward_attempts  int NOT NULL DEFAULT 0,
      forwarded_at      timestamptz
    )`;
  await sql`CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx ON support_tickets (status, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS support_tickets_user_email_idx ON support_tickets (lower(user_email))`;
  await sql`CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx ON support_tickets (tenant_id)`;
  await sql`CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx ON support_tickets (user_id)`;
  tableReady = true;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "23505" || /duplicate key|unique/i.test(String((err as Error)?.message ?? ""));
}

export interface CreateTicketInput {
  tenantId?: string | null;
  tenantName?: string | null;
  userId?: string | null;
  userEmail: string;
  userName?: string | null;
  subject: string;
  message: string;
  priority?: TicketPriority;
  category?: string | null;
}

/** Persist a new ticket, generating a unique ticket number (retries on collision). */
export async function createTicket(input: CreateTicketInput): Promise<SupportTicket> {
  await ensureTable();
  const sql = db();
  const priority: TicketPriority = input.priority ?? "NORMAL";

  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ticketNumber = generateTicketNumber();
    try {
      const rows = await sql`
        INSERT INTO support_tickets
          (ticket_number, tenant_id, tenant_name, user_id, user_email, user_name,
           subject, message, priority, category)
        VALUES
          (${ticketNumber}, ${input.tenantId ?? null}, ${input.tenantName ?? null},
           ${input.userId ?? null}, ${input.userEmail}, ${input.userName ?? null},
           ${input.subject}, ${input.message}, ${priority}, ${input.category ?? null})
        RETURNING *` as SupportTicket[];
      return rows[0]!;
    } catch (err) {
      lastErr = err;
      if (!isUniqueViolation(err)) throw err; // real failure — surface it
      // else: astronomically unlikely number collision — try a fresh number
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not allocate a ticket number");
}

export type TicketFilter = "all" | "open" | "resolved";

export interface ListTicketsResult {
  tickets: SupportTicket[];
  total: number;    // total matching the current filter/search
  openCount: number; // total OPEN across all tickets (for the header badge)
}

/**
 * Admin ticket list: OPEN first, then newest first. Optional status filter and
 * a lightweight ILIKE search over ticket number / email / subject. Paginated.
 */
export async function listTickets(opts: {
  filter?: TicketFilter;
  search?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<ListTicketsResult> {
  await ensureTable();
  const sql = db();

  const filter = opts.filter ?? "all";
  const statusFilter = filter === "open" ? "OPEN" : filter === "resolved" ? "RESOLVED" : null;
  const search = opts.search?.trim() || null;
  const like = search ? `%${search}%` : null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const tickets = await sql`
    SELECT * FROM support_tickets
    WHERE (${statusFilter}::text IS NULL OR status = ${statusFilter})
      AND (${like}::text IS NULL
           OR ticket_number ILIKE ${like}
           OR user_email    ILIKE ${like}
           OR subject       ILIKE ${like})
    ORDER BY (status = 'OPEN') DESC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}` as SupportTicket[];

  const counts = await sql`
    SELECT
      count(*) FILTER (
        WHERE (${statusFilter}::text IS NULL OR status = ${statusFilter})
          AND (${like}::text IS NULL
               OR ticket_number ILIKE ${like}
               OR user_email    ILIKE ${like}
               OR subject       ILIKE ${like})
      )::int AS total,
      count(*) FILTER (WHERE status = 'OPEN')::int AS open_count
    FROM support_tickets` as { total: number; open_count: number }[];

  return {
    tickets,
    total: counts[0]?.total ?? tickets.length,
    openCount: counts[0]?.open_count ?? 0,
  };
}

/** A single ticket by its human-readable number. */
export async function getTicketByNumber(ticketNumber: string): Promise<SupportTicket | null> {
  await ensureTable();
  const sql = db();
  const rows = await sql`
    SELECT * FROM support_tickets WHERE ticket_number = ${ticketNumber} LIMIT 1` as SupportTicket[];
  return rows[0] ?? null;
}

/** A user's own tickets (for the widget's "My reports" view). Tenant/user scoped. */
export async function listTicketsForUser(userId: string): Promise<SupportTicket[]> {
  await ensureTable();
  const sql = db();
  return await sql`
    SELECT * FROM support_tickets
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 50` as SupportTicket[];
}

/** Resolve a ticket, recording who resolved it and when. Optional resolution note. */
export async function resolveTicket(
  ticketNumber: string,
  opts: { resolvedBy: string; adminNote?: string | null },
): Promise<SupportTicket | null> {
  await ensureTable();
  const sql = db();
  const rows = await sql`
    UPDATE support_tickets
    SET status = 'RESOLVED',
        resolved_at = now(),
        resolved_by = ${opts.resolvedBy},
        admin_note = COALESCE(${opts.adminNote ?? null}, admin_note),
        updated_at = now()
    WHERE ticket_number = ${ticketNumber}
    RETURNING *` as SupportTicket[];
  return rows[0] ?? null;
}

/**
 * Record whether a ticket reached the external help desk.
 *
 * Null when the database predates V077's forward_* columns: the forward still
 * happened, it just cannot be shown, and that must not fail anything.
 */
export async function recordForward(
  ticketNumber: string,
  outcome: { to: string; status: "sent" | "failed"; error: string | null },
): Promise<SupportTicket | null> {
  await ensureTable();
  const sql = db();
  try {
    const rows = await sql`
      UPDATE support_tickets
      SET forwarded_to = ${outcome.to},
          forward_status = ${outcome.status},
          forward_error = ${outcome.error},
          forward_attempts = forward_attempts + 1,
          forwarded_at = CASE WHEN ${outcome.status} = 'sent' THEN now() ELSE forwarded_at END,
          updated_at = now()
      WHERE ticket_number = ${ticketNumber}
      RETURNING *` as SupportTicket[];
    return rows[0] ?? null;
  } catch (err) {
    if ((err as { code?: string })?.code === "42703") return null;
    throw err;
  }
}

/** Reopen a resolved ticket, clearing the resolution fields. */
export async function reopenTicket(
  ticketNumber: string,
  opts: { adminNote?: string | null } = {},
): Promise<SupportTicket | null> {
  await ensureTable();
  const sql = db();
  const rows = await sql`
    UPDATE support_tickets
    SET status = 'OPEN',
        resolved_at = NULL,
        resolved_by = NULL,
        admin_note = COALESCE(${opts.adminNote ?? null}, admin_note),
        updated_at = now()
    WHERE ticket_number = ${ticketNumber}
    RETURNING *` as SupportTicket[];
  return rows[0] ?? null;
}

// ─── Conversation ─────────────────────────────────────────────────────────────

export type MessageAuthor = "customer" | "support" | "system";
export type MessageSource = "app" | "email" | "helpdesk" | "portal";

export interface SupportMessage {
  id: string;
  ticket_id: string;
  author_type: MessageAuthor;
  author_name: string | null;
  author_email: string | null;
  body: string;
  source: MessageSource;
  external_message_id: string | null;
  created_at: string;
}

export const MESSAGE_MAX = 10_000;

let messagesReady = false;
async function ensureMessagesTable() {
  if (messagesReady) return;
  await ensureTable();
  const sql = db();
  const existing = await sql`SELECT to_regclass('support_ticket_messages') IS NOT NULL AS present` as { present: boolean }[];
  if (!existing[0]?.present) {
    await sql`
      CREATE TABLE IF NOT EXISTS support_ticket_messages (
        id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id            uuid        NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
        author_type          text        NOT NULL CHECK (author_type IN ('customer','support','system')),
        author_name          text,
        author_email         text,
        body                 text        NOT NULL,
        source               text        NOT NULL CHECK (source IN ('app','email','helpdesk','portal')),
        external_message_id  text,
        created_at           timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS support_ticket_messages_external_id_uidx ON support_ticket_messages (external_message_id) WHERE external_message_id IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx ON support_ticket_messages (ticket_id, created_at)`;
  }
  messagesReady = true;
}

/** The conversation on a ticket, oldest first. */
export async function listMessages(ticketId: string): Promise<SupportMessage[]> {
  await ensureMessagesTable();
  const sql = db();
  return await sql`
    SELECT * FROM support_ticket_messages
    WHERE ticket_id = ${ticketId}
    ORDER BY created_at ASC
    LIMIT 500` as SupportMessage[];
}

/**
 * Add a message. Returns null when `externalMessageId` was already recorded —
 * an inbound provider retrying the same webhook, which must not add a duplicate.
 */
export async function addMessage(input: {
  ticketId: string;
  authorType: MessageAuthor;
  authorName?: string | null;
  authorEmail?: string | null;
  body: string;
  source: MessageSource;
  externalMessageId?: string | null;
}): Promise<SupportMessage | null> {
  await ensureMessagesTable();
  const sql = db();
  try {
    const rows = await sql`
      INSERT INTO support_ticket_messages
        (ticket_id, author_type, author_name, author_email, body, source, external_message_id)
      VALUES
        (${input.ticketId}, ${input.authorType}, ${input.authorName ?? null}, ${input.authorEmail ?? null},
         ${input.body.slice(0, MESSAGE_MAX)}, ${input.source}, ${input.externalMessageId ?? null})
      RETURNING *` as SupportMessage[];
    await touchTicket(input.ticketId);
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

async function touchTicket(ticketId: string): Promise<void> {
  const sql = db();
  try {
    await sql`UPDATE support_tickets SET last_activity_at = now(), updated_at = now() WHERE id = ${ticketId}`;
  } catch (err) {
    // A database without V078's column still records the message.
    if ((err as { code?: string })?.code !== "42703") throw err;
  }
}

/** A ticket, only when it belongs to this user. */
export async function getTicketForUser(ticketNumber: string, userId: string): Promise<SupportTicket | null> {
  await ensureTable();
  const sql = db();
  const rows = await sql`
    SELECT * FROM support_tickets
    WHERE ticket_number = ${ticketNumber} AND user_id = ${userId}
    LIMIT 1` as SupportTicket[];
  return rows[0] ?? null;
}

/** Match mail from the help desk that no longer carries the Vectorbea number. */
export async function getTicketByHelpdeskRef(ref: string): Promise<SupportTicket | null> {
  await ensureTable();
  const sql = db();
  try {
    const rows = await sql`
      SELECT * FROM support_tickets WHERE helpdesk_ref = ${ref}
      ORDER BY created_at DESC LIMIT 1` as SupportTicket[];
    return rows[0] ?? null;
  } catch (err) {
    if ((err as { code?: string })?.code === "42703") return null;
    throw err;
  }
}

/** Remember the help desk's ticket number the first time its mail names it. */
export async function setHelpdeskRef(ticketId: string, ref: string): Promise<void> {
  const sql = db();
  try {
    await sql`UPDATE support_tickets SET helpdesk_ref = ${ref} WHERE id = ${ticketId} AND helpdesk_ref IS NULL`;
  } catch (err) {
    if ((err as { code?: string })?.code !== "42703") throw err;
  }
}

/** Move a ticket to a status from outside the portal (the help desk, or a customer reply). */
export async function setTicketStatus(
  ticketId: string,
  status: TicketStatus,
  resolvedBy: string | null,
): Promise<SupportTicket | null> {
  await ensureTable();
  const sql = db();
  const rows = status === "RESOLVED"
    ? await sql`
        UPDATE support_tickets
        SET status = 'RESOLVED', resolved_at = now(), resolved_by = ${resolvedBy}, updated_at = now()
        WHERE id = ${ticketId} AND status <> 'RESOLVED'
        RETURNING *` as SupportTicket[]
    : await sql`
        UPDATE support_tickets
        SET status = 'OPEN', resolved_at = NULL, resolved_by = NULL, updated_at = now()
        WHERE id = ${ticketId} AND status <> 'OPEN'
        RETURNING *` as SupportTicket[];
  return rows[0] ?? null;
}

// ─── Notification email (pure builder, so it is unit-testable) ─────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Resolve the app base URL from existing env config (no hardcoded production URL). */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Build the admin notification email for a new ticket. Deep-links to the ticket
 * in the in-app portal: {APP_URL}/support?ticket={ticketNumber}.
 */
export function buildAdminNotificationEmail(
  ticket: Pick<SupportTicket, "ticket_number" | "user_email" | "user_name" | "tenant_name" | "priority" | "subject" | "message">,
  baseUrl: string = appBaseUrl(),
): { subject: string; html: string; text: string } {
  const link = `${baseUrl}/support?ticket=${encodeURIComponent(ticket.ticket_number)}`;
  const who = ticket.user_name ? `${ticket.user_name} <${ticket.user_email}>` : ticket.user_email;
  const workspace = ticket.tenant_name ?? "—";

  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#9CA3AF;font-size:12px;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:4px 0;color:#0B0D0F;font-size:13px">${v}</td></tr>`;

  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:560px">
    <p style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9CA3AF;margin:0 0 6px">New Vectorbea support request</p>
    <h2 style="margin:0 0 14px;font-size:18px;color:#0B0D0F">${escapeHtml(ticket.subject)}</h2>
    <table>${row("Ticket", escapeHtml(ticket.ticket_number))}${row("User", escapeHtml(who))}${row("Workspace", escapeHtml(workspace))}${row("Priority", ticket.priority)}</table>
    <p style="white-space:pre-wrap;border:1px solid #E0E3E6;border-radius:10px;padding:12px;font-size:13px;line-height:1.6;color:#374151;margin:14px 0">${escapeHtml(ticket.message)}</p>
    <a href="${link}" style="display:inline-block;background:#0B0D0F;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px">View ticket →</a>
  </div>`;

  const text =
    `New Vectorbea Support Request\n\n` +
    `Ticket: ${ticket.ticket_number}\n` +
    `User: ${who}\n` +
    `Workspace: ${workspace}\n` +
    `Priority: ${ticket.priority}\n` +
    `Subject: ${ticket.subject}\n\n` +
    `${ticket.message}\n\n` +
    `View ticket:\n${link}\n`;

  return {
    subject: `[Vectorbea support] ${ticket.priority} · ${ticket.subject}`,
    html,
    text,
  };
}
