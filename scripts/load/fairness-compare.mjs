#!/usr/bin/env node
/**
 * FIFO versus weighted fair queueing, measured on the same scenario.
 *
 *   node scripts/load/fairness-compare.mjs
 *
 * Runs S01 scenario 4 twice against an unchanged worker — one tenant floods 50
 * short runs while five others submit one each — and changes exactly one thing
 * between the two passes: how `fair_vtime` is stamped at enqueue.
 *
 *   fifo   every run gets `now`, so the claim's ORDER BY degrades to arrival
 *          order. This is what a Redis stream gives you.
 *   fair   FairOrdering.placeAndAdvance — each run is stamped a virtual finish
 *          time and the workspace clock advances by the run's cost, so a
 *          flooder's later runs sort behind a quiet tenant's first one.
 *
 * WHAT IS ACTUALLY BEING MEASURED
 * -------------------------------
 * Not throughput, and not the completed-runs ratio the baseline table reports —
 * that ratio is fixed by how many runs each tenant submitted, so it says nothing
 * about scheduling. The number that matters to a customer is how long *their*
 * one run waited while somebody else's fifty were in the queue.
 *
 * So: p50/p95 wait-before-start for the five quiet tenants, and the ratio of
 * quiet-tenant wait to flooder wait. Under FIFO a quiet tenant arriving last
 * waits behind the whole flood. Under weighted fairness it should be served
 * within roughly one service quantum.
 */

import { spawnSync } from 'node:child_process';
import { newPool } from './lib/env.mjs';
import { LOAD_TAG } from './seed.mjs';

const REPO_ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function runScenario(fairOrdering) {
  const res = spawnSync(process.execPath, ['scripts/load/run.mjs', '--scenario', '4', '--timeout', '200000'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LOAD_QUEUE_MODE: 'postgres',
      LOAD_FAIR_ORDERING: fairOrdering ? 'true' : 'false',
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) {
    process.stderr.write(res.stdout ?? '');
    process.stderr.write(res.stderr ?? '');
    throw new Error(`scenario 4 exited ${res.status}`);
  }
  return res.stdout;
}

const pct = (sorted, p) => {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
};

/**
 * Wait before start, per tenant, straight from the run rows.
 *
 * `started_at - created_at`, because `created_at` is stamped in the same
 * transaction that makes the run claimable. No stream message ID is involved,
 * which is the point — in claim mode there is no message.
 */
async function measure(pool) {
  const { rows } = await pool.query(
    `SELECT w.slug, ar.id,
            EXTRACT(EPOCH FROM (ar.started_at - ar.created_at)) AS wait_s
       FROM agent_runs ar JOIN workspaces w ON w.id = ar.workspace_id
      WHERE w.slug LIKE $1 AND ar.started_at IS NOT NULL
      ORDER BY w.slug`, [`${LOAD_TAG}-%`]);

  const byTenant = new Map();
  for (const r of rows) {
    if (!byTenant.has(r.slug)) byTenant.set(r.slug, []);
    byTenant.get(r.slug).push(Number(r.wait_s));
  }

  // The flooder is whichever tenant submitted the most runs.
  let flooder = null;
  for (const [slug, waits] of byTenant) {
    if (!flooder || waits.length > byTenant.get(flooder).length) flooder = slug;
  }

  const quiet = [...byTenant.entries()].filter(([s]) => s !== flooder).flatMap(([, w]) => w).sort((a, b) => a - b);
  const flood = (byTenant.get(flooder) ?? []).slice().sort((a, b) => a - b);

  return {
    flooder,
    quietRuns: quiet.length,
    quietP50: pct(quiet, 50),
    quietP95: pct(quiet, 95),
    quietMax: quiet.at(-1) ?? null,
    floodP50: pct(flood, 50),
    floodMax: flood.at(-1) ?? null,
    // >1 means quiet tenants wait longer than the flooder — the starvation FIFO
    // produces. Near or below 1 means the scheduler is interleaving them.
    quietVsFlood: quiet.length && flood.length ? pct(quiet, 50) / pct(flood, 50) : null,
  };
}

const fmt = (v) => (v == null ? '—' : `${v.toFixed(2)}s`);

const pool = newPool();
const results = {};
for (const mode of ['fifo', 'fair']) {
  process.stdout.write(`\n▶ ${mode === 'fair' ? 'weighted fair queueing' : 'FIFO (arrival order)'} …\n`);
  runScenario(mode === 'fair');
  results[mode] = await measure(pool);
  const r = results[mode];
  console.log(`  quiet-tenant wait  p50=${fmt(r.quietP50)} p95=${fmt(r.quietP95)} max=${fmt(r.quietMax)}  (n=${r.quietRuns})`);
  console.log(`  flooder wait       p50=${fmt(r.floodP50)} max=${fmt(r.floodMax)}`);
  console.log(`  quiet ÷ flooder    ${r.quietVsFlood == null ? '—' : r.quietVsFlood.toFixed(2)}`);
}
await pool.end();

const { fifo, fair } = results;
console.log('\n=== FAIRNESS: FIFO vs WEIGHTED ===\n');
console.log('| Metric | FIFO | Weighted fair | Change |');
console.log('|---|---|---|---|');
const row = (label, a, b, better = 'lower') => {
  const change = a == null || b == null || a === 0 ? '—'
    : better === 'lower' ? `${(a / b).toFixed(2)}× better` : `${(b / a).toFixed(2)}×`;
  console.log(`| ${label} | ${fmt(a)} | ${fmt(b)} | ${change} |`);
};
row('Quiet-tenant wait p50', fifo.quietP50, fair.quietP50);
row('Quiet-tenant wait p95', fifo.quietP95, fair.quietP95);
row('Quiet-tenant wait max', fifo.quietMax, fair.quietMax);
console.log(`| Quiet ÷ flooder wait | ${fifo.quietVsFlood?.toFixed(2) ?? '—'} | ${fair.quietVsFlood?.toFixed(2) ?? '—'} | — |`);
