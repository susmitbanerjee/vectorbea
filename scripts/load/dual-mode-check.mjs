#!/usr/bin/env node
/**
 * Dual-mode safety: can a run be executed twice while both transports are live?
 *
 *   node scripts/load/dual-mode-check.mjs
 *
 * During the cutover every run exists in two places at once — a `queued` row the
 * Postgres claim can take, and a stream message a not-yet-upgraded worker can
 * read. That is the migration's whole risk, and it is worth stating precisely
 * why it is safe rather than assuming it:
 *
 *   the run lease is an atomic compare-and-set on a single row.
 *
 * Whichever transport arrives second finds the lease held and drops the job. The
 * claim adds a second, independent gate — `UPDATE … WHERE status IN
 * ('queued','yielded')` — but the lease alone was already sufficient, which is
 * why dual-mode does not need a new mechanism to be safe.
 *
 * This asserts it rather than arguing it. Every run must have exactly one
 * RUN_STARTED event; two would be a customer-visible double execution.
 *
 * Assumes workers are already running with WORKER_CLAIM_MODE=dual.
 */

import { newPool, newRedis, sleep } from './lib/env.mjs';
import {
  LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream,
} from './seed.mjs';

const RUNS_PER_TENANT = Number(process.env.DUAL_RUNS ?? 12);
const TENANTS = Number(process.env.DUAL_TENANTS ?? 4);
const TIMEOUT_MS = Number(process.env.DUAL_TIMEOUT_MS ?? 180_000);

// Unset, so seed.mjs writes BOTH the row and the XADD — which is exactly what
// an API in dual mode does.
delete process.env.LOAD_QUEUE_MODE;

const pool = newPool();
const redis = newRedis();

console.log('▶ resetting …');
await resetLoadData(pool);
await resetStream(redis);

const enqueued = [];
for (let i = 1; i <= TENANTS; i++) {
  const t = await createTenant(pool, i);
  const wf = await provisionShape(pool, t, 'linear-5-step');
  for (let r = 0; r < RUNS_PER_TENANT; r++) {
    enqueued.push((await enqueueRun(pool, redis, t, wf, { r })).runId);
  }
}
console.log(`▶ ${enqueued.length} runs enqueued to BOTH Postgres and the typed streams`);

const deadline = Date.now() + TIMEOUT_MS;
let terminal = 0;
while (Date.now() < deadline) {
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int n FROM agent_runs
      WHERE id = ANY($1::uuid[])
        AND status IN ('succeeded','failed','cancelled','timed_out')`, [enqueued]);
  terminal = r.n;
  if (terminal === enqueued.length) break;
  await sleep(500);
}
console.log(`  ${terminal}/${enqueued.length} reached a terminal state`);

// The assertion. RUN_STARTED is appended once, immediately after the
// queued|claimed → running CAS succeeds, so its count is the number of times the
// run actually began executing — not the number of times it was delivered.
const { rows: dupes } = await pool.query(
  `SELECT run_id, count(*)::int AS starts
     FROM run_events
    WHERE run_id = ANY($1::uuid[]) AND type = 'RUN_STARTED'
    GROUP BY run_id HAVING count(*) > 1`, [enqueued]);

const { rows: [totals] } = await pool.query(
  `SELECT count(*)::int AS started_events,
          count(DISTINCT run_id)::int AS distinct_runs
     FROM run_events
    WHERE run_id = ANY($1::uuid[]) AND type = 'RUN_STARTED'`, [enqueued]);

console.log('\n=== DUAL-MODE DUPLICATE CHECK ===\n');
console.log(`  runs enqueued        : ${enqueued.length}`);
console.log(`  runs reaching terminal: ${terminal}`);
console.log(`  RUN_STARTED events   : ${totals.started_events}`);
console.log(`  distinct runs started: ${totals.distinct_runs}`);
console.log(`  runs started twice   : ${dupes.length}`);

const pass = dupes.length === 0 && totals.started_events === totals.distinct_runs;
if (!pass) {
  for (const d of dupes.slice(0, 10)) console.log(`    DUPLICATE ${d.run_id} started ${d.starts}×`);
}
console.log(`\n${pass ? 'PASS' : 'FAIL'} — ${dupes.length} duplicate executions across the dual-mode window`);

await pool.end();
redis.disconnect();
process.exit(pass ? 0 : 1);
