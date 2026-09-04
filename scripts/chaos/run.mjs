#!/usr/bin/env node
/**
 * Chaos suite.
 *
 * Runs workflows that perform recorded external side effects, breaks the workers
 * in four different ways while they do it, and then asserts that the exactly-once
 * guards held.
 *
 * The headline number is duplicate side effects, and it must be zero. It is
 * measured from actual HTTP requests received by the recorder, not from the
 * worker's own `side_effects` table — the duplicate that matters is by
 * definition the one the bookkeeping missed.
 *
 *   node scripts/chaos/run.mjs --scenario all
 *   node scripts/chaos/run.mjs --scenario kill-during-side-effect
 *
 * Prerequisites: the load harness stack, plus
 *   node scripts/chaos/side-effect-recorder.mjs --port 18090 &
 *   scripts/load/replicas.sh start 3
 */

import { CONFIG, newPool, newRedis, sleep } from '../load/lib/env.mjs';
import { createTenant, enqueueRun, resetLoadData, resetStream } from '../load/seed.mjs';
import {
  assertChaosActuallyHappened, assertMonotonicCheckpoints, assertNoDuplicateSideEffects,
  assertNoLostRuns, assertNoStuckLeases, renderResults,
} from './assertions.mjs';
import { killWorker, partitionPostgres, pauseWorker, randomBetween, workerPids } from './faults.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : []),
);

const RECORDER = `http://127.0.0.1:${process.env.RECORDER_PORT ?? 18090}`;
const PG_CONTAINER = process.env.CHAOS_PG_CONTAINER ?? 'vectorbea-load-postgres-1';
const REPLICA_CMD = 'scripts/load/replicas.sh';

/**
 * A workflow whose single node performs a recorded external side effect.
 *
 * `/effect/slow` holds the response open, which is what lets the driver kill a
 * worker in the window between "the call happened" and "we wrote that it did" —
 * the window every duplicate lives in.
 */
function sideEffectShape({ slow = false, steps = 1 }) {
  const path = slow ? '/effect/slow' : '/effect';
  const nodes = [{ id: 'n0', type: 'trigger', label: 'Trigger', config: {} }];
  const edges = [];
  for (let i = 1; i <= steps; i++) {
    nodes.push({
      id: `n${i}`,
      type: 'http',
      label: `Effect ${i}`,
      config: {
        url: `${RECORDER}${path}`,
        method: 'POST',
        timeoutMs: 20_000,
        body: { step: i },
      },
    });
    edges.push({ id: `e${i}`, source: `n${i - 1}`, target: `n${i}`, type: 'default' });
  }
  nodes.push({ id: 'nEnd', type: 'end', label: 'End', config: {} });
  edges.push({ id: 'eEnd', source: `n${steps}`, target: 'nEnd', type: 'default' });
  return { shape: 'chaos-side-effect', expectedClass: 'LONG', graph: { nodes, edges } };
}

async function createChaosWorkflow(pool, tenant, opts) {
  const crypto = await import('node:crypto');
  const workflowId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const d = sideEffectShape(opts);

  await pool.query(
    `INSERT INTO workflows (id, workspace_id, environment_id, name, slug, status)
     VALUES ($1,$2,$3,'chaos',$4,'active')`,
    [workflowId, tenant.workspaceId, tenant.environmentId, `chaos-${workflowId.slice(0, 8)}`]);
  await pool.query(
    `INSERT INTO workflow_versions (id, workflow_id, version, graph_json, execution_class)
     VALUES ($1,$2,1,$3,'long')`,
    [versionId, workflowId, JSON.stringify(d.graph)]);
  await pool.query(`UPDATE workflows SET current_version_id=$1 WHERE id=$2`, [versionId, workflowId]);
  return { workflowId, versionId, shape: d.shape, expectedClass: d.expectedClass };
}

async function resetAll(pool, redis) {
  await resetLoadData(pool);
  await resetStream(redis);
  await pool.query('DELETE FROM side_effects').catch(() => {});
  await pool.query('DELETE FROM dead_letters').catch(() => {});
  await fetch(`${RECORDER}/reset`, { method: 'POST' }).catch(() => {});
  await sleep(500);
}

/**
 * Top the fleet back up to [count] — start only the replicas that are missing.
 *
 * Not `start count`: that spawns a fresh set every time, so after four kills
 * there are a dozen workers, Postgres runs out of connections, and every
 * assertion after that point is measuring the harness rather than the system.
 * Learned by doing exactly that.
 */
async function ensureWorkers(count) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  for (let i = 1; i <= count; i++) {
    await exec('bash', [REPLICA_CMD, 'start-one', String(i)], { env: { ...process.env } })
      .catch((e) => console.warn(`[chaos] replica ${i} start warning: ${e.message}`));
  }
}

async function recorderCallCount() {
  const r = await fetch(`${RECORDER}/calls`).then((x) => x.json()).catch(() => ({ total: 0 }));
  return r.total ?? 0;
}

// ── Scenarios ───────────────────────────────────────────────────────────────

/**
 * Kill workers at random intervals throughout execution.
 *
 * The broad net: catches anything that breaks when a worker vanishes at an
 * arbitrary point, without targeting a particular window.
 */
async function scenarioRandomKills(pool, redis, ctx) {
  const tenants = [];
  const enqueued = [];
  for (let i = 1; i <= 4; i++) {
    const t = await createTenant(pool, i);
    t.workflow = await createChaosWorkflow(pool, t, { steps: 2 });
    tenants.push(t);
    for (let r = 0; r < 3; r++) enqueued.push(await enqueueRun(pool, redis, t, t.workflow, { r }));
  }

  let kills = 0;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await sleep(randomBetween(3_000, 7_000));
    const pids = await workerPids();
    if (pids.length === 0) { await ensureWorkers(ctx.replicas); continue; }
    const victim = pids[randomBetween(0, pids.length - 1)];
    await killWorker(victim);
    kills++;
    console.log(`[chaos] killed worker pid=${victim} (${kills} so far)`);
    // Bring the fleet back so the surviving work can finish.
    await ensureWorkers(ctx.replicas);
  }
  return { enqueued, kills };
}

/**
 * Kill specifically between the side effect and the state write.
 *
 * The dangerous window, and the only one that produces a duplicate if the guard
 * is wrong. `/effect/slow` holds the response, so a kill during that hold leaves
 * the call performed and the worker with no idea it happened.
 */
async function scenarioKillDuringSideEffect(pool, redis, ctx) {
  const tenants = [];
  const enqueued = [];
  for (let i = 1; i <= 3; i++) {
    const t = await createTenant(pool, i);
    t.workflow = await createChaosWorkflow(pool, t, { slow: true, steps: 1 });
    tenants.push(t);
    enqueued.push(await enqueueRun(pool, redis, t, t.workflow, {}));
  }

  let kills = 0;
  // Wait for calls to arrive at the recorder, then kill mid-hold.
  const deadline = Date.now() + 60_000;
  let lastSeen = 0;
  while (Date.now() < deadline && kills < 4) {
    await sleep(1_000);
    const seen = await recorderCallCount();
    if (seen > lastSeen) {
      lastSeen = seen;
      // A call is in flight right now and the response is being held.
      const pids = await workerPids();
      if (pids.length > 0) {
        const victim = pids[randomBetween(0, pids.length - 1)];
        await killWorker(victim);
        kills++;
        console.log(`[chaos] killed pid=${victim} DURING side effect #${seen}`);
        await ensureWorkers(ctx.replicas);
      }
    }
  }
  return { enqueued, kills };
}

/**
 * Freeze a worker until its lease expires, then let it resume.
 *
 * The split-brain case: the frozen worker wakes believing it still owns a run
 * another worker has since taken over. Only fencing stops its writes.
 */
async function scenarioLeaseExpiry(pool, redis, ctx) {
  const tenants = [];
  const enqueued = [];
  for (let i = 1; i <= 3; i++) {
    const t = await createTenant(pool, i);
    t.workflow = await createChaosWorkflow(pool, t, { slow: true, steps: 2 });
    tenants.push(t);
    enqueued.push(await enqueueRun(pool, redis, t, t.workflow, {}));
  }

  let kills = 0;
  await sleep(4_000);
  const pids = await workerPids();
  if (pids.length > 0) {
    const victim = pids[0];
    // Longer than the lease TTL, so the lease is genuinely reassigned.
    const pauseMs = Number(process.env.CHAOS_PAUSE_MS ?? 70_000);
    console.log(`[chaos] pausing pid=${victim} for ${pauseMs}ms to force lease expiry`);
    try {
      await pauseWorker(victim, pauseMs);
      kills++;
    } catch (e) {
      // Reported rather than swallowed — a scenario that silently skipped its
      // only fault would otherwise pass having tested nothing.
      console.warn(`[chaos] pause fault UNAVAILABLE: ${e.message}`);
      ctx.skipped.push(`lease-expiry: ${e.message}`);
    }
  }
  await ensureWorkers(ctx.replicas);
  return { enqueued, kills };
}

/** Cut the workers off from Postgres briefly, mid-execution. */
async function scenarioPostgresPartition(pool, redis, ctx) {
  const tenants = [];
  const enqueued = [];
  for (let i = 1; i <= 3; i++) {
    const t = await createTenant(pool, i);
    t.workflow = await createChaosWorkflow(pool, t, { steps: 2 });
    tenants.push(t);
    for (let r = 0; r < 2; r++) enqueued.push(await enqueueRun(pool, redis, t, t.workflow, { r }));
  }

  await sleep(3_000);
  console.log('[chaos] partitioning workers from Postgres for 8s');
  await partitionPostgres(PG_CONTAINER, 8_000);
  console.log('[chaos] Postgres restored');
  return { enqueued, kills: 1 };  // the partition is the fault
}

const SCENARIOS = {
  'random-kills': { fn: scenarioRandomKills, waitMs: 240_000 },
  'kill-during-side-effect': { fn: scenarioKillDuringSideEffect, waitMs: 240_000 },
  'lease-expiry': { fn: scenarioLeaseExpiry, waitMs: 180_000 },
  'postgres-partition': { fn: scenarioPostgresPartition, waitMs: 120_000 },
};

// ── Driver ──────────────────────────────────────────────────────────────────

async function waitForSettle(pool, runIds, timeoutMs) {
  const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'enqueue_failed']);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT status FROM agent_runs WHERE id = ANY($1::uuid[])`, [runIds]);
    if (rows.length && rows.every((r) => TERMINAL.has(r.status))) return true;
    await sleep(2_000);
  }
  return false;
}

async function main() {
  const pool = newPool();
  const redis = newRedis();
  const replicas = Number(args.replicas ?? 3);
  const chosen = args.scenario && args.scenario !== 'all'
    ? [args.scenario] : Object.keys(SCENARIOS);

  const allResults = [];
  try {
    await fetch(`${RECORDER}/healthz`).catch(() => {
      throw new Error(`side-effect recorder not reachable at ${RECORDER} — ` +
        `start it with: node scripts/chaos/side-effect-recorder.mjs`);
    });

    for (const name of chosen) {
      const spec = SCENARIOS[name];
      if (!spec) { console.error(`unknown scenario: ${name}`); continue; }

      console.log(`\n▶ chaos scenario: ${name}`);
      await resetAll(pool, redis);
      await ensureWorkers(replicas);
      await sleep(2_000);

      const ctx = { replicas, skipped: [] };
      const { enqueued, kills } = await spec.fn(pool, redis, ctx);
      const runIds = enqueued.map((e) => e.runId);

      console.log(`[chaos] ${runIds.length} run(s) enqueued, ${kills} fault(s) injected — settling…`);
      // Workers must be up for recovery to happen at all.
      await ensureWorkers(replicas);
      const settled = await waitForSettle(pool, runIds, spec.waitMs);
      if (!settled) console.warn('[chaos] not all runs settled within the window');

      const calls = await recorderCallCount();
      const results = [
        assertChaosActuallyHappened(kills, runIds.length, calls),
        await assertNoDuplicateSideEffects(RECORDER),
        await assertNoLostRuns(pool, runIds),
        await assertNoStuckLeases(pool, runIds),
        await assertMonotonicCheckpoints(pool, runIds),
      ];
      if (ctx.skipped.length) {
        results.push({
          name: 'all faults available on this host',
          passed: false,
          detail: `skipped: ${ctx.skipped.join('; ')}`,
        });
      }

      console.log(renderResults(name, results));
      allResults.push({ scenario: name, results, kills, runs: runIds.length, calls });
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n\n=== CHAOS SUMMARY ===\n');
    console.log('| Scenario | Faults | Runs | Side effects | Duplicates | Result |');
    console.log('|---|---|---|---|---|---|');
    let anyFailed = false;
    let totalDuplicates = 0;
    for (const r of allResults) {
      const dup = r.results.find((x) => x.name === 'zero duplicate side effects');
      const dupCount = dup?.metrics?.duplicateCalls ?? 0;
      totalDuplicates += dupCount;
      const failed = r.results.filter((x) => !x.passed).length;
      if (failed > 0) anyFailed = true;
      console.log(`| ${r.scenario} | ${r.kills} | ${r.runs} | ${r.calls} | ${dupCount} | ` +
        `${failed === 0 ? 'PASS' : `FAIL (${failed})`} |`);
    }
    console.log(`\nDUPLICATE SIDE EFFECTS ACROSS ALL SCENARIOS: ${totalDuplicates}`);
    console.log(totalDuplicates === 0
      ? 'This is the number that must be zero. It is zero.'
      : 'NON-ZERO — the exactly-once guards did not hold.');

    if (anyFailed || totalDuplicates > 0) process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    redis.disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
