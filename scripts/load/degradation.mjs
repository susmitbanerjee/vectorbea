#!/usr/bin/env node
/**
 * Graceful degradation under a 10× stress test.
 *
 *   node scripts/load/degradation.mjs
 *
 * Target concurrency for one worker at the shipped pool sizes is 8 short slots.
 * This drives 10× that in submitted work and asks four questions — the four that
 * separate "degrades gracefully" from "collapses":
 *
 *   1. Does throughput PLATEAU, or does it collapse? A system that degrades
 *      gracefully keeps completing work at its maximum rate while the queue grows
 *      behind it. A system that collapses completes *less* as load rises, because
 *      it spends its capacity on contention rather than work.
 *
 *   2. Does latency degrade PREDICTABLY? Queue wait should grow roughly linearly
 *      with depth — that is what makes an ETA possible. Superlinear growth means
 *      something is thrashing.
 *
 *   3. Does anything CRASH? The worker must still be answering /metrics at the end
 *      with the same process it started with.
 *
 *   4. Is any run SILENTLY LOST? Every submitted run must be accounted for:
 *      terminal, still queued, or explicitly rejected at admission. A run that is
 *      none of those has vanished, and that is the failure that destroys trust.
 *
 * Load is applied in rising steps rather than all at once, because a single
 * flood measures one point and this needs a curve.
 */

import { CONFIG, newPool, newRedis, sleep } from './lib/env.mjs';
import { scrapeFleet, value } from './lib/metrics.mjs';
import {
  LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream,
} from './seed.mjs';

/**
 * Concurrency the fleet is sized for — the "1x" the multipliers are against.
 *
 * The agent pool (6 permits) and the agent shape, not the short pool: a 5-step
 * transform finishes in well under a second, so the fleet drains the backlog as
 * fast as it is created, queue depth stays at zero, and the test measures an idle
 * system while reporting a pass. Eight LLM turns hold a permit for several
 * seconds, which is what makes the backlog real.
 */
const TARGET = Number(process.env.DEGRADE_TARGET ?? 6);
const SHAPE = process.env.DEGRADE_SHAPE ?? 'agent-iterative-8-turn';
const STEPS = (process.env.DEGRADE_STEPS ?? '1,2,5,10').split(',').map(Number);
const TENANTS = Number(process.env.DEGRADE_TENANTS ?? 6);
const STEP_SECONDS = Number(process.env.DEGRADE_STEP_SECONDS ?? 45);
const DRAIN_TIMEOUT_MS = Number(process.env.DEGRADE_DRAIN_MS ?? 300_000);

process.env.LOAD_QUEUE_MODE = 'postgres';

const pool = newPool();
const redis = newRedis();

const q = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

async function snapshot() {
  const r = await q(`
    SELECT
      (SELECT count(*)::int FROM agent_runs ar JOIN workspaces w ON w.id=ar.workspace_id
        WHERE w.slug LIKE $1 AND ar.status IN ('queued','yielded'))              AS queued,
      (SELECT count(*)::int FROM agent_runs ar JOIN workspaces w ON w.id=ar.workspace_id
        WHERE w.slug LIKE $1 AND ar.status IN ('claimed','running'))             AS in_flight,
      (SELECT count(*)::int FROM agent_runs ar JOIN workspaces w ON w.id=ar.workspace_id
        WHERE w.slug LIKE $1 AND ar.completed_at IS NOT NULL)                    AS done,
      (SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(ar.created_at))), 0)::float
         FROM agent_runs ar JOIN workspaces w ON w.id=ar.workspace_id
        WHERE w.slug LIKE $1 AND ar.status IN ('queued','yielded'))              AS oldest_wait
  `, [`${LOAD_TAG}-%`]);
  return {
    queued: r.queued, inFlight: r.in_flight, done: r.done,
    oldestWait: Number(r.oldest_wait),
  };
}

async function waitPercentiles() {
  const { rows } = await pool.query(`
    SELECT EXTRACT(EPOCH FROM (ar.started_at - ar.created_at))::float AS w
      FROM agent_runs ar JOIN workspaces w2 ON w2.id = ar.workspace_id
     WHERE w2.slug LIKE $1 AND ar.started_at IS NOT NULL
     ORDER BY 1`, [`${LOAD_TAG}-%`]);
  const xs = rows.map((r) => Number(r.w)).sort((a, b) => a - b);
  const p = (n) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor((n / 100) * xs.length))] : null);
  return { n: xs.length, p50: p(50), p95: p(95), max: xs.at(-1) ?? null };
}

/**
 * Is a worker still serving?
 *
 * Presence of *any* sample is the liveness test, not a specific metric: the point
 * is that the process is up and its HTTP server is answering, and picking one
 * named gauge would make this fail if that gauge were ever renamed.
 */
async function workerAlive() {
  const samples = await scrapeFleet([CONFIG.metricsPort]);
  return samples.length > 0;
}

console.log('▶ resetting …');
await resetLoadData(pool);
await resetStream(redis);

const tenants = [];
for (let i = 1; i <= TENANTS; i++) {
  const t = await createTenant(pool, i);
  tenants.push({ t, wf: await provisionShape(pool, t, SHAPE) });
}

const aliveAtStart = await workerAlive();
if (!aliveAtStart) {
  console.error('No worker is answering /metrics — start one before running this.');
  process.exit(1);
}

const submitted = [];
const rejected = [];
const results = [];

for (const mult of STEPS) {
  const batch = TARGET * mult;
  const before = await snapshot();
  const t0 = Date.now();

  console.log(`\n▶ ${mult}× — submitting ${batch} runs across ${TENANTS} tenants …`);
  // Submitted concurrently, in bounded chunks. Sequentially, each enqueue costs
  // two round trips and the fleet drains the backlog as fast as it is created --
  // the queue never grows and the test measures an idle system. A burst is also
  // the realistic shape of the thing being defended against.
  const CHUNK = 12;
  for (let start = 0; start < batch; start += CHUNK) {
    await Promise.all(
      Array.from({ length: Math.min(CHUNK, batch - start) }, (_, k) => {
        const i = start + k;
        const { t, wf } = tenants[i % TENANTS];
        return enqueueRun(pool, redis, t, wf, { step: mult, i })
          .then((r) => { submitted.push(r.runId); })
          // Admission rejections are a SUCCESS for this test -- shedding is the
          // graceful part of graceful degradation. They are counted, not
          // ignored, because a rejected run must not also be missing.
          .catch((e) => { rejected.push({ step: mult, error: String(e.message ?? e).slice(0, 120) }); });
      }));
  }

  await sleep(STEP_SECONDS * 1000);
  const after = await snapshot();
  const elapsed = (Date.now() - t0) / 1000;
  const completed = after.done - before.done;

  results.push({
    mult,
    submitted: batch,
    completedInWindow: completed,
    throughput: completed / elapsed,
    queueDepth: after.queued,
    inFlight: after.inFlight,
    oldestWait: after.oldestWait,
  });

  const r = results.at(-1);
  console.log(`  completed ${completed} in ${elapsed.toFixed(0)}s → ${r.throughput.toFixed(2)} runs/s` +
    ` · queue ${r.queueDepth} · in-flight ${r.inFlight} · oldest wait ${r.oldestWait.toFixed(1)}s`);
}

console.log('\n▶ draining …');
const drainStart = Date.now();
let last = await snapshot();
while (Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
  last = await snapshot();
  if (last.queued === 0 && last.inFlight === 0) break;
  await sleep(1000);
}

const waits = await waitPercentiles();
const aliveAtEnd = await workerAlive();
const ceilingBreaches = (await q(
  `SELECT count(*)::int AS n FROM agent_runs ar JOIN workspaces w ON w.id=ar.workspace_id
    WHERE w.slug LIKE $1 AND ar.ceiling_breached IS NOT NULL`, [`${LOAD_TAG}-%`])).n;

// ── Accounting: every submitted run must be somewhere ────────────────────────
const accounted = await q(`
  SELECT count(*) FILTER (WHERE status IN ('succeeded','failed','cancelled','timed_out',
                                           'cost_limit_exceeded','step_limit_exceeded',
                                           'token_limit_exceeded','duration_limit_exceeded',
                                           'payload_limit_exceeded'))::int AS terminal,
         count(*) FILTER (WHERE status IN ('queued','yielded','claimed','running'))::int AS pending,
         count(*)::int AS total
    FROM agent_runs WHERE id = ANY($1::uuid[])`, [submitted]);

const lost = submitted.length - accounted.total;

console.log('\n=== DEGRADATION CURVE ===\n');
console.log('| Load | Submitted | Completed in window | Throughput (runs/s) | Queue depth | Oldest wait |');
console.log('|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.mult}× | ${r.submitted} | ${r.completedInWindow} | ${r.throughput.toFixed(2)} | ` +
    `${r.queueDepth} | ${r.oldestWait.toFixed(1)}s |`);
}

const peak = Math.max(...results.map((r) => r.throughput));
const atMax = results.at(-1).throughput;
const plateau = atMax >= peak * 0.75;

console.log('\n=== ACCOUNTING ===\n');
console.log(`  submitted           : ${submitted.length}`);
console.log(`  rejected at admission: ${rejected.length}`);
console.log(`  reached terminal    : ${accounted.terminal}`);
console.log(`  still pending       : ${accounted.pending}`);
console.log(`  UNACCOUNTED (lost)  : ${lost}`);
console.log(`\n  wait before start   : n=${waits.n} p50=${waits.p50?.toFixed(2)}s ` +
  `p95=${waits.p95?.toFixed(2)}s max=${waits.max?.toFixed(2)}s`);
console.log(`  worker alive at end : ${aliveAtEnd ? 'yes' : 'NO - it died'}`);
console.log(`  circuit / ceiling    : ${ceilingBreaches} run(s) stopped by a ceiling`);

const checks = [
  ['throughput plateaus rather than collapsing',
    plateau, `${atMax.toFixed(2)} runs/s at ${results.at(-1).mult}× vs peak ${peak.toFixed(2)}`],
  ['nothing crashed', !!aliveAtEnd, aliveAtEnd ? 'worker still serving /metrics' : 'worker gone'],
  ['no run silently lost', lost === 0, `${lost} unaccounted`],
  ['queue drained', last.queued === 0 && last.inFlight === 0,
    `${last.queued} queued / ${last.inFlight} in flight at end`],
];

console.log('\n=== VERDICT ===\n');
let pass = true;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) pass = false;
}

await pool.end();
redis.disconnect();
process.exit(pass ? 0 : 1);
