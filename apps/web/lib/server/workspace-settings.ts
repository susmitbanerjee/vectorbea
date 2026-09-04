import "server-only";

import { appQuery, appQueryOne, withTransaction } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKSPACE IDENTITY, AND ENDING IT

   Settings showed the workspace name as a read-only fact with the note
   "renaming and transfer are not exposed by any endpoint yet". That was true
   and it is no longer: `workspaces.name` and `workspaces.slug` are ordinary
   columns in the application database, and the only reason nothing wrote them
   was that nothing had been built to.

   DELETION IS NOT A CASCADE, AND PRETENDING IT IS WOULD LEAVE SECRETS BEHIND.
   Only some workspace-scoped tables carry a foreign key to `workspaces`;
   `workflows`, `connections`, `agents`, `tools`, `agent_runs`,
   `encrypted_secrets` and others carry a bare `workspace_id UUID NOT NULL` with
   no reference, so `DELETE FROM workspaces` removes the row and orphans the
   rest — including the encrypted credentials. A delete that leaves a tenant's
   API keys in the database is worse than no delete at all, because it was
   reported as done.

   So the purge below DISCOVERS every table carrying a `workspace_id`, empties
   them, and then VERIFIES that nothing is left before committing. Discovery
   rather than a hand-written list because the schema gains tables regularly and
   a list would silently fall behind; verification because "we tried" is not an
   answer to "is the customer's data gone".

   THE AUDIT TRAIL IS DELIBERATELY EXEMPT. `audit_log` refuses DELETE by trigger
   (V027) — that is the point of an append-only governance record, and an
   enterprise buyer asks about exactly this. The record of the deletion, and of
   everything before it, survives the workspace. The UI says so rather than
   leaving somebody to discover it.
══════════════════════════════════════════════════════════════════════════════ */

export interface WorkspaceIdentity {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
}

export async function getWorkspaceIdentity(workspaceId: string): Promise<WorkspaceIdentity | null> {
  const row = await appQueryOne<{
    id: string;
    name: string;
    slug: string;
    created_at: Date | string;
    owner_user_id: string | null;
    owner_email: string | null;
    owner_name: string | null;
  }>(
    `SELECT w.id, w.name, w.slug, w.created_at, w.owner_user_id,
            o.email AS owner_email, o.full_name AS owner_name
       FROM workspaces w
       LEFT JOIN app_users o ON o.id = w.owner_user_id
      WHERE w.id = $1::uuid`,
    [workspaceId],
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
  };
}

export const WORKSPACE_LIMITS = { NAME_MAX: 80, SLUG_MAX: 60 } as const;

/** Lower-case, hyphen-separated, no leading/trailing hyphen. */
export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_LIMITS.SLUG_MAX);
}

export interface WorkspaceRenameInput {
  name?: string;
  slug?: string;
}

export async function renameWorkspace(
  workspaceId: string,
  input: WorkspaceRenameInput,
): Promise<WorkspaceIdentity> {
  const name = input.name?.trim();
  if (input.name !== undefined) {
    if (!name) throw new Error("A workspace needs a name.");
    if (name.length > WORKSPACE_LIMITS.NAME_MAX) {
      throw new Error(`Keep the name to ${WORKSPACE_LIMITS.NAME_MAX} characters or fewer.`);
    }
  }

  let slug: string | undefined;
  if (input.slug !== undefined) {
    slug = normalizeSlug(input.slug);
    if (!slug) throw new Error("A slug needs at least one letter or number.");
  }

  try {
    const row = await appQueryOne<{ id: string }>(
      `UPDATE workspaces
          SET name = COALESCE($2, name),
              slug = COALESCE($3, slug),
              updated_at = now()
        WHERE id = $1::uuid
        RETURNING id`,
      [workspaceId, name ?? null, slug ?? null],
    );
    if (!row) throw new Error("That workspace no longer exists.");
  } catch (error) {
    // `workspaces.slug` is UNIQUE. Naming the conflict beats surfacing
    // "duplicate key value violates unique constraint workspaces_slug_key".
    const message = error instanceof Error ? error.message : String(error);
    if (/workspaces_slug_key|duplicate key/i.test(message)) {
      throw new Error(`The slug "${slug}" is already taken. Choose another.`);
    }
    throw error;
  }

  const identity = await getWorkspaceIdentity(workspaceId);
  if (!identity) throw new Error("That workspace no longer exists.");
  return identity;
}

/* ── Deletion ─────────────────────────────────────────────────────────────── */

/**
 * `audit_log` is append-only, enforced by trigger. It is excluded from the
 * purge on purpose, not overlooked.
 */
const RETAINED_TABLES = new Set(["audit_log"]);

export interface WorkspaceFootprint {
  /** Row counts by table, largest first, for tables that actually hold rows. */
  rows: { table: string; count: number }[];
  total: number;
  workflows: number;
  runs: number;
  connections: number;
  secrets: number;
  members: number;
}

/** Every public table carrying a `workspace_id`, minus the retained ones. */
async function purgeableTables(): Promise<string[]> {
  const rows = await appQuery<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'workspace_id'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  return rows.map((row) => row.table_name).filter((name) => !RETAINED_TABLES.has(name));
}

/**
 * What deleting this workspace would destroy.
 *
 * A confirmation dialog that says "this cannot be undone" without saying what
 * "this" is asks somebody to accept a consequence nobody has stated. The counts
 * come from the same discovery the purge uses, so the dialog and the delete can
 * never describe different things.
 */
export async function getWorkspaceFootprint(workspaceId: string): Promise<WorkspaceFootprint> {
  const tables = await purgeableTables();
  const counts: { table: string; count: number }[] = [];

  for (const table of tables) {
    try {
      const row = await appQueryOne<{ count: string }>(
        // Identifier comes from information_schema, not from user input, and is
        // quoted regardless.
        `SELECT count(*) AS count FROM "${table}" WHERE workspace_id = $1::uuid`,
        [workspaceId],
      );
      const count = Number(row?.count ?? 0);
      if (count > 0) counts.push({ table, count });
    } catch {
      // A table that cannot be counted (a view-like or permission-restricted
      // one) is reported by the purge, not silently folded into the total.
    }
  }

  counts.sort((a, b) => b.count - a.count);
  const find = (name: string) => counts.find((entry) => entry.table === name)?.count ?? 0;

  return {
    rows: counts,
    total: counts.reduce((sum, entry) => sum + entry.count, 0),
    workflows: find("workflows"),
    runs: find("agent_runs"),
    connections: find("connections"),
    secrets: find("encrypted_secrets"),
    members: find("workspace_members"),
  };
}

export interface WorkspaceDeletion {
  deletedRows: number;
  tablesCleared: number;
  /** Tables `audit_log` aside that still hold rows — always empty on success. */
  retained: string[];
}

export async function deleteWorkspace(workspaceId: string): Promise<WorkspaceDeletion> {
  const tables = await purgeableTables();

  return withTransaction(async (tx) => {
    let remaining = [...tables];
    let deletedRows = 0;
    let cleared = 0;

    // Repeated passes rather than a hand-ordered list. A table whose delete
    // fails on a foreign key from a table not yet emptied simply succeeds on a
    // later pass; the loop ends when a whole pass makes no progress, which
    // bounds it at one pass per table.
    for (let pass = 0; pass < tables.length + 1 && remaining.length > 0; pass += 1) {
      const failed: string[] = [];
      for (const table of remaining) {
        const ok = await tx.attempt(async (inner) => {
          const rows = await inner.query<{ deleted: string }>(
            `WITH removed AS (
               DELETE FROM "${table}" WHERE workspace_id = $1::uuid RETURNING 1
             ) SELECT count(*) AS deleted FROM removed`,
            [workspaceId],
          );
          deletedRows += Number(rows[0]?.deleted ?? 0);
        });
        if (ok) cleared += 1;
        else failed.push(table);
      }
      if (failed.length === remaining.length) break;
      remaining = failed;
    }

    await tx.query(`DELETE FROM workspaces WHERE id = $1::uuid`, [workspaceId]);

    // The guard. Anything still carrying this workspace_id means the purge was
    // incomplete, and an incomplete purge must not be committed and reported as
    // a deletion — the customer was told their data was gone.
    const leftovers: string[] = [];
    for (const table of tables) {
      const rows = await tx.query<{ count: string }>(
        `SELECT count(*) AS count FROM "${table}" WHERE workspace_id = $1::uuid`,
        [workspaceId],
      );
      if (Number(rows[0]?.count ?? 0) > 0) leftovers.push(table);
    }

    if (leftovers.length > 0) {
      throw new Error(
        `The workspace was not deleted: ${leftovers.length} table(s) still hold its data ` +
          `(${leftovers.slice(0, 5).join(", ")}). Nothing was removed. This needs a schema fix, ` +
          "not a retry.",
      );
    }

    return { deletedRows, tablesCleared: cleared, retained: [] };
  });
}
