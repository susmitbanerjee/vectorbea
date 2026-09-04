#!/usr/bin/env node
/**
 * Chaos at 70% of measured capacity.
 *
 *   node scripts/chaos/at-load.mjs --replicas 3
 *
 * WHY THIS IS SEPARATE FROM `scripts/chaos/run.mjs`
 * -------------------------------------------------
 * The existing suite injects each fault against a handful of runs. That proves the
 * recovery MECHANISM works. It does not prove the mechanism works while the system is
 * busy, and "busy" is the only state in which any of these faults will occur in
 * production — an idle system has nothing to lose.
 *
 * Two things only appear under load:
 *
 *   1. Recovery competes for the same slots as new work. A worker that dies holding
 *      six runs returns those six to a queue that already has two hundred in it.
 *   2. The no-stall property. With N>=2, killing one replica must not stop the
 *      platform. At N=1 it necessarily does, which is why that assertion is
 *      conditional rather than universal.
 *
 * 70% RATHER THAN 100%
 * --------------------
 * At 100% the queue grows without bound and every fault looks like it caused a
 * backlog that was already there. At 70% there is headroom, so a backlog that appears
 * after a fault is attributable to the fault and is expected to drain — which makes
 * "did it recover" a question with an observable answer.
 *
 * The 70% figure is derived from the measured ceiling in CAPACITY.md, not guessed:
 * 3.4 runs/s sustained at N=1 on this machine, so 2.4 runs/s here.
 */

import { newPool, newRedis, sleep, CONFIG } from '../load/lib/env.mjs';
import {
  LOAD_TAG, createTenant, provisionShape, enqueueRun, resetLoadData, resetStream,
} from '../load/seed.mjs';
import {
  assertNoDuplicateSideEffects, assertNoLostRuns, assertNoStuckLeases,
  assertMonotonicCheckpoints, renderResults,
} from './assertions.mjs';
import { workerPids, killWorker, pauseWorker, partitionPostgres } from './faults.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const exec = promisify(execFile);
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : []));

const REPLICAS = Number(args.replicas ?? 3);
const TARGET_RATE = Number(args.rate ?? 2.4);        // runs/s = 70% of measured 3.4
const DURATION_MS = Number(args.seconds ?? 300) * 1000;
const RECORDER = process.env.RECORDER_URL ?? 'http://127.0.0.1:18090';

const pool = newPool();
const redis = newRedis();
const log = (s) => console.log(s);
const rule = (s) => console.log('\n' + '─'.repeat(76) + '\n' + s + '\n' + '─'.repeat(76));

async function restartReplicas(count) {
  await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'scripts/load/start-replicas.ps1', '-Count', String(count)],
    { cwd: process.cwd(), timeout: 180_000 });
}

/**
 * Throughput measured over a moving window, used to answer "did the platform stall".
 *
 * Completions per interval rather than a cumulative count: a cumulative curve that
 * flattens and a curve that stops are indistinguishable at a glance, and only the
 * second is a stall.
 */
function startThroughputProbe(pgPool, intervalMs = 5_000) {
  const samples = [];   // [t, completedSoFar]
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const { rows } = await pgPool.query(
        `SELECT COUNT(*)::int AS n FROM agent_runs
          WHERE status IN ('succeeded','completed','failed')
            AND workspace_id IN (SELECT id FROM workspaces WHERE slug LIKE $1)`,
        [`${LOAD_TAG}-%`]);
      samples.push([Date.now(), rows[0].n]);
    } catch { /* transient during the partition fault, by design */ }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return {
    samples,
    stop() { stopped = true; clearInterval(timer); return samples; },
    /** Completions per second between two wall-clock marks. */
    rateBetween(t0, t1) {
      const inWindow = samples.filter(([t]) => t >= t0 && t <= t1);
      if (inWindow.length < 2) return null;
      const [ta, a] = inWindow[0];
      const [tb, b] = inWindow[inWindow.length - 1];
      return tb === ta ? null : ((b - a) / ((tb - ta) / 1000));
    },
  };
}

async function main() {
  rule(`CHAOS AT ${Math.round((TARGET_RATE / 3.4) * 100)}% LOAD — N=${REPLICAS} replicas`);
  log(`Target ${TARGET_RATE} runs/s for ${DURATION_MS / 1000}s, four fault types injected.`);

  await resetLoadData(pool);
  await resetStream(redis);
  await restartReplicas(REPLICAS);
  await sleep(3_000);

  // Tenants and a steady arrival process.
  const tenants = [];
  for (let i = 0; i < 10; i++) {
    const t = await createTenant(pool, i + 1);
    t.workflow = await provisionShape(pool, t, 'linear-5-step');
    tenants.push(t);
  }

  const ids = [];
  let arriving = true;
  const arrivalLoop = (async () => {
    const perTick = Math.max(1, Math.round(TARGET_RATE));
    while (arriving) {
      const batch = [];
      for (let i = 0; i < perTick; i++) {
        const t = tenants[(ids.length + i) % tenants.length];
        batch.push(enqueueRun(pool, redis, t, t.workflow, { i }));
      }
      // Enqueue failures during the Postgres partition are EXPECTED — the arrival
      // process is a client, and a client cannot enqueue while the database is
      // unreachable. Swallowing them here keeps the loop alive; the assertions below
      // only ever consider runs that were actually accepted.
      const settled = await Promise.allSettled(batch);
      for (const r of settled) if (r.status === 'fulfilled') ids.push(r.value.runId);
      await sleep(1_000);
    }
  })();

  const probe = startThroughputProbe(pool);
  const events = [];
  const mark = (name, extra = {}) => {
    events.push({ name, at: Date.now(), ...extra });
    log(`   [${new Date().toISOString().slice(11, 19)}] ${name}`);
  };

  // Let load establish before touching anything. A fault injected into a cold system
  // measures startup, not resilience.
  await sleep(30_000);
  mark('steady state reached');
  const steadyStart = Date.now() - 20_000;
  const steadyRate = probe.rateBetween(steadyStart, Date.now());
  log(`   steady-state throughput: ${steadyRate?.toFixed(2) ?? 'n/a'} runs/s`);

  // ── Fault 1: kill a replica ───────────────────────────────────────────────
  const pidsBefore = await workerPids();
  let killedPid = null;
  if (pidsBefore.length > 0) {
    killedPid = pidsBefore[Math.floor(Math.random() * pidsBefore.length)];
    await killWorker(killedPid);
    mark('replica killed', { pid: killedPid, of: pidsBefore.length });
  }
  const killAt = Date.now();
  await sleep(45_000);
  const rateAfterKill = probe.rateBetween(killAt + 5_000, Date.now());
  log(`   throughput after kill: ${rateAfterKill?.toFixed(2) ?? 'n/a'} runs/s`);

  // ── Fault 2: 2s LLM latency ───────────────────────────────────────────────
  // Applied by restarting the mock with a higher latency rather than by a per-request
  // header, so it affects every call including ones already in flight logic-wise.
  mark('LLM latency raised to 2s (restarting mock)');
  await exec('powershell.exe', ['-NoProfile', '-Command',
    "Get-Process -Name node -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.CommandLine -like '*mock-upstreams*' } | Stop-Process -Force"],
  ).catch(() => {});
  await sleep(1_000);
  execFile('node', ['scripts/load/mock-upstreams.mjs', '--llm-latency', '2000'],
    { cwd: process.cwd() }, () => {});
  await sleep(30_000);

  // ── Fault 3: sever Postgres for 30s ───────────────────────────────────────
  mark('severing Postgres for 30s');
  const partAt = Date.now();
  const partitioned = await partitionPostgres('vectorbea-load-postgres-1', 30_000)
    .then(() => true).catch((e) => { log(`   partition unavailable: ${e.message}`); return false; });
  mark(partitioned ? 'Postgres restored' : 'Postgres partition SKIPPED');
  await sleep(45_000);

  // ── Fault 4: SIGSTOP a worker to force lease expiry ───────────────────────
  const pidsNow = await workerPids();
  let pausedOk = false;
  if (pidsNow.length > 0) {
    // 75s: comfortably past the 60s lease TTL, so the lease genuinely expires and
    // another worker takes over while the frozen one still believes it owns the run.
    // That is the fencing case, and nothing shorter exercises it.
    pausedOk = await pauseWorker(pidsNow[0], 75_000).then(() => true).catch(() => false);
    mark(pausedOk ? 'worker frozen for 75s (lease TTL is 60s)' : 'SIGSTOP unavailable on this host');
  }
  await sleep(pausedOk ? 90_000 : 5_000);

  // ── Settle ────────────────────────────────────────────────────────────────
  arriving = false;
  await arrivalLoop;
  mark(`arrivals stopped — ${ids.length} runs accepted; draining`);

  // Everything must be back up for recovery to complete at all.
  await restartReplicas(REPLICAS);

  const TERMINAL = new Set(['succeeded', 'completed', 'failed', 'cancelled', 'timed_out']);
  const drainDeadline = Date.now() + 300_000;
  let settled = false;
  while (Date.now() < drainDeadline) {
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM agent_runs WHERE id = ANY($1::uuid[]) GROUP BY 1`,
      [ids]);
    const nonTerminal = rows.filter((r) => !TERMINAL.has(r.status)).reduce((a, r) => a + r.n, 0);
    if (nonTerminal === 0) { settled = true; break; }
    await sleep(5_000);
  }
  probe.stop();

  // ── Assertions ────────────────────────────────────────────────────────────
  rule('ASSERTIONS');

  const results = [];
  results.push(await assertNoLostRuns(pool, ids));
  results.push(await assertNoStuckLeases(pool, ids));
  results.push(await assertMonotonicCheckpoints(pool, ids));
  results.push(await assertNoDuplicateSideEffects(RECORDER).catch(() => ({
    name: 'zero duplicate side effects',
    passed: false,
    detail: 'recorder not reachable — assertion could not run, so this is UNPROVEN, not passed',
  })));

  results.push({
    name: 'all accepted runs reached a terminal state',
    passed: settled,
    detail: settled ? `${ids.length} runs settled` : 'some runs never settled within 5 minutes',
  });

  // The no-stall assertion. Conditional on N>=2 because at N=1 killing the only
  // replica MUST stop the platform — asserting otherwise would be asserting magic.
  if (REPLICAS >= 2 && steadyRate != null && rateAfterKill != null) {
    // 30% of steady state. Not "unchanged": losing a third of the fleet must cost
    // roughly a third of the throughput, and a test that demanded otherwise would be
    // measuring nothing. The claim is that work continues, not that loss is free.
    const floor = steadyRate * 0.3;
    results.push({
      name: `no total-platform stall when a replica dies (N=${REPLICAS})`,
      passed: rateAfterKill >= floor,
      detail: `steady ${steadyRate.toFixed(2)}/s → after kill ${rateAfterKill.toFixed(2)}/s ` +
              `(floor ${floor.toFixed(2)}/s)`,
    });
  } else if (REPLICAS < 2) {
    results.push({
      name: 'no total-platform stall when a replica dies',
      passed: null,
      detail: `NOT APPLICABLE at N=${REPLICAS} — killing the only replica stops the platform ` +
              'by definition. Run with --replicas 2 or more.',
    });
  }

  const out = {
    at: new Date().toISOString(),
    replicas: REPLICAS,
    targetRate: TARGET_RATE,
    accepted: ids.length,
    steadyRate, rateAfterKill,
    faults: events,
    partitioned, pausedOk, killedPid,
    results,
  };
  await fs.mkdir('docs/architecture/measurements', { recursive: true });
  await fs.writeFile(`docs/architecture/measurements/chaos-n${REPLICAS}.json`,
    JSON.stringify(out, null, 2));

  for (const r of results) {
    const badge = r.passed === null ? 'N/A ' : r.passed ? 'PASS' : 'FAIL';
    log(`  ${badge}  ${r.name}`);
    if (r.detail) log(`        ${r.detail}`);
  }

  const failed = results.filter((r) => r.passed === false).length;
  log(`\n  ${results.length - failed} of ${results.length} assertions passed` +
      (failed ? `, ${failed} FAILED` : ''));

  await pool.end();
  redis.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\nchaos harness error:', e.message);
  await pool.end().catch(() => {});
  redis.disconnect();
  process.exit(2);
});
