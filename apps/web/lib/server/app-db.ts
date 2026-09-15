import "server-only";

import { Pool, type QueryResultRow } from "pg";
import { appDatabaseConnectionOptions } from "./app-db-tls";

/* ══════════════════════════════════════════════════════════════════════════════
   THE APPLICATION DATABASE

   There are two data layers in this repository and only one of them is real.

   `lib/supabase-admin.ts` reaches a Supabase project and a `vectorbea` schema
   that no deployment provisions: the documented environment variables for
   staging and production (docs/deployment/dev-staging-prod.md §3.3) carry the
   Supabase URL and anon key for AUTH only — there is no service-role key, and
   `lib/auth/server.ts` already describes the Supabase organisation model as
   removed. Locally `NEXT_PUBLIC_SUPABASE_URL` is literally
   `https://placeholder.supabase.co`.

   The real store is Postgres — Neon in the deployed environments, the
   `docker compose up postgres` container locally — migrated by Flyway from
   `apps/api-kotlin/src/main/resources/db/migration`. It is where workspaces,
   members, usage counters and the audit trail actually live, and where the
   Kotlin API and worker read and enforce them.

   WHY `pg` AND NOT `@neondatabase/serverless`
   The rest of this app reaches Postgres through `neon()`, which is an HTTP
   driver that only speaks to Neon's endpoint. Against `localhost:5432` it
   cannot connect at all, so every screen built on it is dead in local and
   containerised development — which is most of the ways this product is run
   during a working day. `pg` speaks the wire protocol and therefore works
   against both, and `pg` is already a direct dependency. `sslmode` is parsed
   out of the connection string by pg itself, so Neon's `sslmode=require` is
   honoured and a local URL without it stays plaintext.
══════════════════════════════════════════════════════════════════════════════ */

/** The connection string, or null when this deployment has no database configured. */
export function appDatabaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim() || null;
}

let pool: Pool | null = null;

function getPool(): Pool {
  const connectionString = appDatabaseUrl();
  if (!connectionString) {
    // Named for the operator who has to fix it, not for the caller who hit it.
    throw new Error(
      "DATABASE_URL is not set for this deployment, so the application database cannot be reached.",
    );
  }
  if (!pool) {
    pool = new Pool({
      ...appDatabaseConnectionOptions(connectionString),
      // Small: a serverless instance handles one request at a time, and Neon's
      // pooled endpoint is the thing doing the real pooling.
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    // A pool that emits an unhandled 'error' takes the process down. Idle
    // clients are dropped by Neon routinely; that is not an application fault.
    pool.on("error", (error) => {
      console.error("[app-db] idle client error:", error.message);
    });
  }
  return pool;
}

/** Run one parameterised statement and return its rows. */
export async function appQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as never[]);
  return result.rows;
}

/** Run one statement expected to return at most one row. */
export async function appQueryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await appQuery<T>(text, params);
  return rows[0] ?? null;
}

/** A count query, defaulting to zero rather than to null. */
export async function appCount(text: string, params: unknown[] = []): Promise<number> {
  const row = await appQueryOne<{ count: string | number }>(text, params);
  const value = Number(row?.count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * A tagged template that parameterises every interpolation.
 *
 * A drop-in for `neon()`'s template so the auth modules keep their existing
 * call sites, minus the driver that could only talk to Neon. Interpolations
 * become `$1…$n` placeholders — never string concatenation — so this is not a
 * SQL-injection footgun dressed as convenience.
 *
 *   const rows = await appSql`SELECT id FROM app_users WHERE email = ${email}`;
 */
export async function appSql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const text = strings.reduce(
    (accumulated, part, index) => accumulated + part + (index < values.length ? `$${index + 1}` : ""),
    "",
  );
  return appQuery<T>(text, values);
}

/** One statement, run on a caller-held connection inside a transaction. */
export interface AppTransaction {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  /**
   * Run `work` inside a savepoint. Returns false and unwinds to the savepoint if
   * it throws, leaving the enclosing transaction usable — which a bare failed
   * statement would not, since Postgres aborts the whole transaction on error.
   */
  attempt(work: (tx: AppTransaction) => Promise<void>): Promise<boolean>;
}

/**
 * Run `work` in a transaction, committing on return and rolling back on throw.
 *
 * Multi-statement writes that must not half-apply — deleting a workspace,
 * changing a role and recording why — go through here. The connection is held
 * for the duration and always released.
 */
export async function withTransaction<T>(
  work: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let savepoint = 0;

  const wrap = (): AppTransaction => ({
    async query<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
      const result = await client.query<R>(text, params as never[]);
      return result.rows;
    },
    async attempt(inner) {
      const name = `sp_${(savepoint += 1)}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        await inner(wrap());
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return true;
      } catch {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return false;
      }
    },
  });

  try {
    await client.query("BEGIN");
    const result = await work(wrap());
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
