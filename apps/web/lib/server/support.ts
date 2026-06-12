import "server-only";
import { neon } from "@neondatabase/serverless";

/**
 * Support incidents — structured issue reports from the in-app widget.
 *
 * Admin model: a single support admin identified by the SUPPORT_EMAIL env var
 * (set in Vercel). Only a session whose email matches it can list all
 * incidents or change their status.
 */

export type IncidentStatus = "open" | "in_progress" | "resolved" | "closed";

export interface Incident {
  id: string;
  reporter_user_id: string;
  reporter_email: string;
  category: string;
  severity: string;
  subject: string;
  description: string;
  page_path: string | null;
  status: IncidentStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export const INCIDENT_CATEGORIES = ["bug", "workflow_failure", "connection_issue", "access_problem", "billing", "other"] as const;
export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const INCIDENT_STATUSES: IncidentStatus[] = ["open", "in_progress", "resolved", "closed"];

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

/** The single support admin (SUPPORT_EMAIL in Vercel). */
export function isSupportAdmin(email: string | null | undefined): boolean {
  const admin = process.env.SUPPORT_EMAIL?.trim().toLowerCase();
  return !!admin && !!email && email.trim().toLowerCase() === admin;
}

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS support_incidents (
      id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      reporter_user_id UUID        NOT NULL,
      reporter_email   TEXT        NOT NULL,
      category         TEXT        NOT NULL,
      severity         TEXT        NOT NULL,
      subject          TEXT        NOT NULL,
      description      TEXT        NOT NULL,
      page_path        TEXT,
      status           TEXT        NOT NULL DEFAULT 'open',
      admin_note       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_support_incidents_status ON support_incidents (status, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_support_incidents_reporter ON support_incidents (reporter_user_id, created_at DESC)`;
  tableReady = true;
}

export async function createIncident(args: {
  reporterUserId: string;
  reporterEmail: string;
  category: string;
  severity: string;
  subject: string;
  description: string;
  pagePath?: string | null;
}): Promise<Incident> {
  await ensureTable();
  const sql = db();
  const rows = await sql`
    INSERT INTO support_incidents
      (reporter_user_id, reporter_email, category, severity, subject, description, page_path)
    VALUES (${args.reporterUserId}, ${args.reporterEmail}, ${args.category}, ${args.severity},
            ${args.subject}, ${args.description}, ${args.pagePath ?? null})
    RETURNING *` as Incident[];
  return rows[0]!;
}

export async function listIncidentsForUser(userId: string): Promise<Incident[]> {
  await ensureTable();
  const sql = db();
  return await sql`
    SELECT * FROM support_incidents
    WHERE reporter_user_id = ${userId}
    ORDER BY created_at DESC LIMIT 50` as Incident[];
}

export async function listAllIncidents(): Promise<Incident[]> {
  await ensureTable();
  const sql = db();
  return await sql`
    SELECT * FROM support_incidents
    ORDER BY (status IN ('open','in_progress')) DESC, created_at DESC
    LIMIT 200` as Incident[];
}

export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
  adminNote?: string | null,
): Promise<Incident | null> {
  await ensureTable();
  const sql = db();
  const rows = await sql`
    UPDATE support_incidents
    SET status = ${status},
        admin_note = COALESCE(${adminNote ?? null}, admin_note),
        updated_at = now()
    WHERE id = ${id}
    RETURNING *` as Incident[];
  return rows[0] ?? null;
}
