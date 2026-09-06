import "server-only";

import { appQuery, appQueryOne } from "./app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   RETENTION, FOR THE SETTINGS SCREEN

   WHY THE DATES COME FROM THE SERVER AND NOT FROM THE BROWSER
   The sweeper's cutoff is `now() - days`, computed in Postgres. If the page
   subtracted its own days from its own clock, a customer reading a cached
   response in another timezone would be told a different day from the one the
   job will act on — and the one they would remember is the one on the screen.
   So every date here is produced by `retention_effective_days`, the same
   function the deleter calls.

   AND WHY IT READS FUNCTIONS RATHER THAN TABLES
   `workspace_retention_state` alone cannot answer "what window is in force" —
   that is `GREATEST(plan, previous)` while a grace period is running, and the
   rule lives in SQL so that the job, the API and this page cannot disagree
   about it. Reimplementing the comparison here is how a customer gets warned
   about a date the job does not honour.
══════════════════════════════════════════════════════════════════════════════ */

export type RetentionEntity = "runs" | "events" | "traces" | "payloads" | "archives";

export interface RetentionWindow {
  entity: RetentionEntity;
  label: string;
  /** The window in force, which during a grace period is the OLD one. */
  days: number;
  /** "plan" or "grace". Grace means a downgrade is being honoured. */
  source: string;
  /** Everything older than this goes on the next sweep. ISO 8601. */
  deletesBefore: string;

  /* Only while a downgrade is being graced. */
  inGrace: boolean;
  graceUntil: string | null;
  /** The shorter window that takes over when grace ends. */
  planDays: number | null;
  previousDays: number | null;
  changedAt: string | null;
  /** The first cutoff under the new, shorter window. */
  afterGraceDeletesBefore: string | null;
}

export interface RetentionStorage {
  entity: string;
  rows: number;
  bytes: number;
}

export interface RetentionPanel {
  windows: RetentionWindow[];
  storage: RetentionStorage[];
  /** True while ANY entity is inside a downgrade grace period. */
  downgrading: boolean;
  /** The soonest date on which graced data starts being deleted. */
  firstDeletionAt: string | null;
  lastExport: {
    id: string;
    status: string;
    createdAt: string;
    rowCount: number;
    expiresAt: string | null;
  } | null;
}

const LABELS: Record<RetentionEntity, string> = {
  runs: "Run history",
  events: "Run events",
  traces: "Traces and spans",
  payloads: "Prompts and payloads",
  archives: "Warm-tier archives",
};

const ENTITIES: RetentionEntity[] = ["runs", "events", "traces", "payloads", "archives"];

export async function getRetentionPanel(workspaceId: string): Promise<RetentionPanel | null> {
  // A deployment whose database predates V061 has none of this. Null degrades
  // the section to "not available" rather than 500-ing the whole settings page.
  const present = await appQueryOne<{ one: number }>(
    `SELECT 1 AS one FROM pg_proc WHERE proname = 'retention_effective_days' LIMIT 1`,
    [],
  );
  if (!present) return null;

  const windows: RetentionWindow[] = [];

  for (const entity of ENTITIES) {
    const effective = await appQueryOne<{ days: number; source: string }>(
      `SELECT days, source FROM retention_effective_days($1::uuid, $2)`,
      [workspaceId, entity],
    );
    if (!effective) continue;

    const state = await appQueryOne<{
      effective_days: number;
      previous_days: number | null;
      changed_at: string | null;
      grace_until: string | null;
    }>(
      `SELECT effective_days, previous_days, changed_at, grace_until
         FROM workspace_retention_state WHERE workspace_id = $1::uuid AND entity = $2`,
      [workspaceId, entity],
    );

    const graceUntil = state?.grace_until ?? null;
    const inGrace =
      effective.source === "grace" && graceUntil !== null && new Date(graceUntil) > new Date();

    /* The two dates the customer actually needs, both computed in Postgres so
       they match the job to the second: what goes on the next sweep, and — while
       a downgrade is graced — what goes once the grace ends. */
    const dates = await appQueryOne<{ deletes_before: string; after_grace: string | null }>(
      `SELECT (now() - make_interval(days => $1::int))::text AS deletes_before,
              CASE WHEN $2::timestamptz IS NULL THEN NULL
                   ELSE ($2::timestamptz - make_interval(days => $3::int))::text
              END AS after_grace`,
      [effective.days, inGrace ? graceUntil : null, state?.effective_days ?? effective.days],
    );

    windows.push({
      entity,
      label: LABELS[entity],
      days: effective.days,
      source: effective.source,
      deletesBefore: dates?.deletes_before ?? "",
      inGrace,
      graceUntil: inGrace ? graceUntil : null,
      planDays: inGrace ? (state?.effective_days ?? null) : null,
      previousDays: inGrace ? (state?.previous_days ?? null) : null,
      changedAt: inGrace ? (state?.changed_at ?? null) : null,
      afterGraceDeletesBefore: inGrace ? (dates?.after_grace ?? null) : null,
    });
  }

  const storage = await appQuery<{ entity: string; rows: string; bytes: string }>(
    `SELECT entity, rows::text, bytes::text FROM workspace_storage_bytes($1::uuid)`,
    [workspaceId],
  );

  const lastExport = await appQueryOne<{
    id: string;
    status: string;
    created_at: string;
    row_count: string;
    expires_at: string | null;
  }>(
    `SELECT id, status, created_at, row_count::text, expires_at
       FROM workspace_exports
      WHERE workspace_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 1`,
    [workspaceId],
  );

  const graced = windows.filter((w) => w.inGrace && w.graceUntil);
  const firstDeletionAt = graced.length
    ? graced
        .map((w) => w.graceUntil!)
        .sort()[0]
    : null;

  return {
    windows,
    storage: storage.map((s) => ({
      entity: s.entity,
      // BIGINT arrives from `pg` as a string. Converted deliberately — see the
      // same note in entitlements.ts; a string comparison here would sort "9"
      // above "100" in any table the page renders.
      rows: Number(s.rows),
      bytes: Number(s.bytes),
    })),
    downgrading: graced.length > 0,
    firstDeletionAt,
    lastExport: lastExport
      ? {
          id: lastExport.id,
          status: lastExport.status,
          createdAt: lastExport.created_at,
          rowCount: Number(lastExport.row_count),
          expiresAt: lastExport.expires_at,
        }
      : null,
  };
}
