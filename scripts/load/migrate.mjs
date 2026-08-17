#!/usr/bin/env node
/**
 * Applies the API's Flyway migrations to the harness Postgres.
 *
 * The migrations are plain SQL with no Flyway placeholders, so they can be
 * applied directly — which means the harness runs against the *real* schema,
 * not a hand-written approximation that could drift. Applied in filename order
 * and recorded in `load_schema_history` so re-running is cheap.
 *
 *   node scripts/load/migrate.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG, REPO_ROOT, newPool } from './lib/env.mjs';

const MIGRATIONS_DIR = path.join(
  REPO_ROOT, 'apps', 'api-kotlin', 'src', 'main', 'resources', 'db', 'migration');

async function main() {
  const pool = newPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS load_schema_history (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await pool.query('SELECT filename FROM load_schema_history');
    const applied = new Set(rows.map((r) => r.filename));

    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`  applying ${file} … `);
      const client = await pool.connect();
      try {
        // Each migration is one transaction: a partial apply would leave the
        // harness schema in a state no environment ever has.
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO load_schema_history (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('ok');
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        throw new Error(`${file}: ${err.message}`);
      } finally {
        client.release();
      }
    }

    console.log(count === 0
      ? `schema already current (${files.length} migrations)`
      : `applied ${count} migration(s) to ${CONFIG.pgHost}:${CONFIG.pgPort}/${CONFIG.pgDatabase}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exitCode = 1;
});
