#!/usr/bin/env node
/**
 * Does the priority lane actually preempt under saturation?
 *
 *   node scripts/load/priority-lane.mjs
 *
 * The demo lane is only worth building if it works at the exact moment it is
 * needed: the pool already full of somebody else's work, thirty seconds before
 * an investor demo. So the test saturates first and asks for a slot second.
 *
 *   1. One ordinary tenant floods enough short runs to fill the pool and queue
 *      a backlog behind it.
 *   2. Once the pool is measurably saturated, two runs are enqueued at the same
 *      instant: one from a `priority_lane` workspace, one from another ordinary
 *      workspace.
 *   3. Both waits are measured.
 *
 * PASS is not "the priority run was a bit quicker". It is that the priority run
 * starts while ordinary runs are still queued behind the flood — that is what
 * preemption means, and it is the only version of this that survives a demo.
 */

import { CONFIG, newPool, newRedis, sleep } from './lib/env.mjs';
import {
  LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream,
} from './seed.mjs';

const FLOOD = Number(process.env.PRIORITY_FLOOD ?? 40);
/**
 * The shape all three tenants run.
 *
 * Defaults to the agent shape, not the short one. A 5-step transform finishes in
 * well under a second, so a sequential enqueue loop drains as fast as it fills
 * and the pool is never actually saturated when the probes arrive — the test
 * then passes against an idle system, which proves nothing. Eight LLM turns hold
 * a permit for several seconds, which is what makes the backlog real.
 */
const SHAPE = process.env.PRIORITY_SHAPE ?? 'agent-iterative-8-turn';
const SATURATION_TIMEOUT_MS = 60_000;
const RESULT_TIMEOUT_MS = 120_000;

const pool = newPool();
const redis = newRedis();
process.env.LOAD_QUEUE_MODE = 'postgres';

async function inFlight(workspaceId = null) {
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int n FROM agent_runs ar
      JOIN workspaces w ON w.id = ar.workspace_id
     WHERE w.slug LIKE $1 AND ar.status IN ('claimed','running')
       AND ($2::uuid IS NULL OR ar.workspace_id = $2)`,
    [`${LOAD_TAG}-%`, workspaceId]);
  return r.n;
}

async function waitFor(runId) {
  const deadline = Date.now() + RESULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows: [r] } = await pool.query(
      `SELECT status, EXTRACT(EPOCH FROM (started_at - created_at)) AS wait_s
         FROM agent_runs WHERE id = $1`, [runId]);
    if (r?.wait_s != null) return Number(r.wait_s);
    await sleep(100);
  }
  return null;
}

console.log('▶ resetting …');
await resetLoadData(pool);
await resetStream(redis);

const flooder = await createTenant(pool, 1);
const priority = await createTenant(pool, 2);
const ordinary = await createTenant(pool, 3);

// The lane is a per-workspace policy flag, flipped at runtime. No deploy, no
// restart — which is the point: it has to be usable half an hour before a demo.
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, priority_lane)
   VALUES ($1, true)
   ON CONFLICT (workspace_id) DO UPDATE SET priority_lane = true`,
  [priority.workspaceId]);
console.log(`  priority_lane enabled for ${priority.slug}`);

const shapes = {};
for (const t of [flooder, priority, ordinary]) {
  shapes[t.slug] = await provisionShape(pool, t, SHAPE);
}

console.log(`▶ flooding ${FLOOD} ordinary ${SHAPE} runs from ${flooder.slug} …`);
for (let i = 0; i < FLOOD; i++) {
  await enqueueRun(pool, redis, flooder, shapes[flooder.slug], { i });
}

// Wait for real saturation, not a fixed sleep. Enqueueing the probes before the
// pool is full would measure an idle system and pass for the wrong reason.
const satDeadline = Date.now() + SATURATION_TIMEOUT_MS;
let peak = 0;
while (Date.now() < satDeadline) {
  peak = Math.max(peak, await inFlight());
  const { rows: [q] } = await pool.query(
    `SELECT count(*)::int n FROM agent_runs ar JOIN workspaces w ON w.id = ar.workspace_id
      WHERE w.slug LIKE $1 AND ar.status = 'queued'`, [`${LOAD_TAG}-%`]);
  if (peak >= 4 && q.n >= 5) break;
  await sleep(200);
}
const queuedAtProbe = (await pool.query(
  `SELECT count(*)::int n FROM agent_runs ar JOIN workspaces w ON w.id = ar.workspace_id
    WHERE w.slug LIKE $1 AND ar.status = 'queued'`, [`${LOAD_TAG}-%`])).rows[0].n;
console.log(`  saturated: peak in-flight ${peak}, ${queuedAtProbe} still queued`);

console.log('▶ enqueueing one priority run and one ordinary run, together …');
const [p, o] = await Promise.all([
  enqueueRun(pool, redis, priority, shapes[priority.slug], { probe: 'priority' }),
  enqueueRun(pool, redis, ordinary, shapes[ordinary.slug], { probe: 'ordinary' }),
]);
console.log(`  priority run priority=${p.priority} vtime=${p.fairVtime?.toFixed(2)}`);
console.log(`  ordinary run priority=${o.priority} vtime=${o.fairVtime?.toFixed(2)}`);

const [pWait, oWait] = await Promise.all([waitFor(p.runId), waitFor(o.runId)]);

console.log('\n=== PRIORITY LANE ===\n');
console.log('| Run | Lane | Wait before start |');
console.log('|---|---|---|');
console.log(`| probe | priority (priority=${p.priority}) | ${pWait == null ? 'never started' : `${pWait.toFixed(2)}s`} |`);
console.log(`| probe | ordinary (priority=${o.priority}) | ${oWait == null ? 'never started' : `${oWait.toFixed(2)}s`} |`);

const pass = pWait != null && (oWait == null || pWait < oWait);
console.log(`\n${pass ? 'PASS' : 'FAIL'} — priority run ${
  pWait == null ? 'never started'
    : oWait == null ? `started in ${pWait.toFixed(2)}s while the ordinary run never did`
    : `started ${(oWait / pWait).toFixed(1)}× sooner than the ordinary run`}`);

await pool.end();
redis.disconnect();
process.exit(pass ? 0 : 1);
