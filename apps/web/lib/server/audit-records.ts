import "server-only";

import { appQuery, appQueryOne } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   THE GOVERNANCE TRAIL

   THERE ARE THREE AUDIT TABLES IN THIS REPOSITORY AND ONLY ONE IS WRITTEN.

     vectorbea.audit_logs    Supabase. The LLM-proxy latency ledger. The Audit
                             log screen read this, which is why it reported "not
                             provisioned": no deployment has that project.
     vectorbea.audit_events  Supabase. Written by `lib/server/audit-events.ts`,
                             which already swallows "does not exist" — so it has
                             been a no-op for as long as it has existed.
     public.audit_log        Postgres. Written by the Kotlin API's `AuditLog`
                             on login, publish, approval decision, connection
                             change, member change, settings change, run cancel
                             and data export. Append-only, enforced by trigger.

   This module reads the third one — the one that has the records in it.

   THE FILTERS ARE DATABASE PREDICATES. On an audit surface the difference
   between "no rows matched" and "not in the page I fetched" is the entire
   point: a log that cannot prove absence is not a log. Every filter below is a
   WHERE clause, and `total` is a COUNT over the same predicates, so the count
   under the table is the answer to the question the filters asked.
══════════════════════════════════════════════════════════════════════════════ */

export type AuditActorType = "user" | "system" | "api_key";
export type AuditResult = "success" | "denied" | "error";

export interface AuditRecord {
  id: string;
  timestamp: string;
  workspaceId: string;
  environmentId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  /** The actor's email where the id resolves to a user, else null. */
  actorLabel: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result: AuditResult;
  before: unknown;
  after: unknown;
  userAgent: string | null;
  ipHash: string | null;
}

export interface AuditQuery {
  workspaceId: string;
  since?: string | null;
  until?: string | null;
  search?: string | null;
  action?: string | null;
  result?: AuditResult | null;
  actorType?: AuditActorType | null;
  page: number;
  pageSize: number;
}

export interface AuditRecordPage {
  items: AuditRecord[];
  page: number;
  pageSize: number;
  total: number;
  /** Every action present in this workspace's log, so the filter offers only what exists. */
  actions: string[];
}

interface AuditRow {
  id: string;
  created_at: Date | string;
  workspace_id: string;
  environment_id: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  before_json: unknown;
  after_json: unknown;
  user_agent: string | null;
  ip_hash: string | null;
}

/** Escape the LIKE metacharacters so a search for `100%` is not a wildcard. */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Build the shared WHERE clause once.
 *
 * The page query and the count query must apply exactly the same predicates or
 * the pager lies about how much there is. Generating both from one builder is
 * the only way to keep that true through later edits.
 */
function buildFilters(query: AuditQuery) {
  const clauses: string[] = ["a.workspace_id = $1::uuid"];
  const params: unknown[] = [query.workspaceId];

  const add = (clause: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(clause(`$${params.length}`));
  };

  if (query.since) add((p) => `a.created_at >= ${p}::timestamptz`, query.since);
  if (query.until) add((p) => `a.created_at < ${p}::timestamptz`, query.until);
  if (query.action) add((p) => `a.action = ${p}`, query.action);
  if (query.result) add((p) => `a.result = ${p}`, query.result);
  if (query.actorType) add((p) => `a.actor_type = ${p}`, query.actorType);
  if (query.search) {
    add(
      (p) =>
        `(a.action ILIKE ${p} OR a.target_type ILIKE ${p} OR a.actor_id ILIKE ${p} OR u.email ILIKE ${p})`,
      likePattern(query.search),
    );
  }

  return { where: clauses.join(" AND "), params };
}

/**
 * The actor join.
 *
 * `audit_log.actor_id` is TEXT and holds a user id for `actor_type = 'user'`, an
 * API key id otherwise. Comparing `u.id::text` rather than casting `actor_id` to
 * uuid means a non-uuid actor id (a system marker, a key handle) does not fail
 * the whole query — it simply does not join.
 */
const ACTOR_JOIN = `LEFT JOIN app_users u
  ON a.actor_type = 'user' AND u.id::text = a.actor_id`;

export async function listAuditRecords(query: AuditQuery): Promise<AuditRecordPage> {
  const { where, params } = buildFilters(query);
  const offset = (query.page - 1) * query.pageSize;

  const rows = await appQuery<AuditRow>(
    `SELECT a.id, a.created_at, a.workspace_id, a.environment_id,
            a.actor_type, a.actor_id, u.email AS actor_email,
            a.action, a.target_type, a.target_id, a.result,
            a.before_json, a.after_json, a.user_agent, a.ip_hash
       FROM audit_log a
       ${ACTOR_JOIN}
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, query.pageSize, offset],
  );

  const countRow = await appQueryOne<{ total: string }>(
    `SELECT count(*) AS total FROM audit_log a ${ACTOR_JOIN} WHERE ${where}`,
    params,
  );

  // Unfiltered by everything except the workspace: the filter must offer the
  // actions the log contains, not only the ones surviving the current filter,
  // or it becomes impossible to switch from one action to another.
  const actionRows = await appQuery<{ action: string }>(
    `SELECT DISTINCT action FROM audit_log WHERE workspace_id = $1::uuid ORDER BY action`,
    [query.workspaceId],
  );

  return {
    items: rows.map(toRecord),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(countRow?.total ?? rows.length),
    actions: actionRows.map((row) => row.action),
  };
}

function toRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    timestamp:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    workspaceId: row.workspace_id,
    environmentId: row.environment_id,
    actorType: normalizeActorType(row.actor_type),
    actorId: row.actor_id,
    actorLabel: row.actor_email,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: normalizeResult(row.result),
    before: row.before_json ?? null,
    after: row.after_json ?? null,
    userAgent: row.user_agent,
    ipHash: row.ip_hash,
  };
}

function normalizeActorType(value: string): AuditActorType {
  return value === "system" || value === "api_key" ? value : "user";
}

function normalizeResult(value: string): AuditResult {
  return value === "denied" || value === "error" ? value : "success";
}
