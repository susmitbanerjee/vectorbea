#!/usr/bin/env node
/**
 * Load harness driver.
 *
 *   node scripts/load/run.mjs --scenario 5
 *   node scripts/load/run.mjs --all --out docs/architecture/baseline.md
 *
 * Prerequisites (see scripts/load/README.md):
 *   docker compose -f scripts/load/docker-compose.load.yml up -d
 *   node scripts/load/mock-upstreams.mjs &
 *   node scripts/load/hang-db.mjs &
 *   ... and a worker pointed at the harness Postgres/Redis.
 *
 * The harness never mutates anything outside workspaces slugged `loadtest-*`.
 */

import fs from 'node:fs/promises';
import { CONFIG, newPool, newRedis, sleep } from './lib/env.mjs';
import {
  counterTotal, histogramCount, histogramQuantile, histogramSum, scrapeFleet, seriesFor, value,
} from './lib/metrics.mjs';
import {
  MARKDOWN_HEADER, fairnessRatio, markdownRow, renderScenarioReport, summarize,
} from './lib/report.mjs';
import { SCENARIOS, byId } from './scenarios.mjs';
import { createTenant, enqueueRun, fetchRunOutcomes, provisionShape, resetLoadData, resetStream } from './seed.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : []),
);

const TIMEOUT_MS = Number(args.timeout ?? 300_000);
const POLL_MS = 500;

/** Terminal statuses — anything else means the run is still in flight. */
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'completed', 'error']);

/**
 * Poll the worker's metrics while a scenario runs, keeping high-water marks.
 * Sampling rather than instrumenting the worker further keeps the harness
 * honest: it can only see what an operator's Prometheus can see.
 */
function startSampler() {
  const state = {
    peakPelDepth: 0,
    peakPelByStream: {},
    peakSlotsActive: {},
    slotsTotal: {},
    // Containment evidence: how much of the isolated tenant-DB dispatcher a
    // hanging database actually consumed, and whether it ever hit the wall.
    peakTenantDbActive: 0,
    peakTenantDbQueue: 0,
    peakJvmThreads: 0,
    peakHeapBytes: 0,
    samples: 0,
    failures: 0,
    last: null,
    stopped: false,
  };
  const tick = async () => {
    if (state.stopped) return;
    try {
      const s = await scrapeFleet();
      state.last = s;
      state.samples += 1;
      // PEL depth is now reported per stream. The number that matters is the
      // depth of any ONE stream versus that pool's free slots — the typed-queue
      // guarantee is per class, not in aggregate.
      let pelSum = 0;
      for (const sample of seriesFor(s, 'worker_pel_depth')) {
        pelSum += sample.value;
        const stream = sample.labels.stream ?? 'unknown';
        state.peakPelByStream[stream] = Math.max(state.peakPelByStream[stream] ?? 0, sample.value);
      }
      state.peakPelDepth = Math.max(state.peakPelDepth, pelSum);
      for (const sample of seriesFor(s, 'worker_pool_slots_active')) {
        const pool = sample.labels.pool ?? 'unknown';
        state.peakSlotsActive[pool] = Math.max(state.peakSlotsActive[pool] ?? 0, sample.value);
      }
      for (const sample of seriesFor(s, 'worker_pool_slots_total')) {
        state.slotsTotal[sample.labels.pool ?? 'unknown'] = sample.value;
      }
      state.peakTenantDbActive = Math.max(state.peakTenantDbActive, value(s, 'tenant_db_slots_active'));
      state.peakTenantDbQueue = Math.max(state.peakTenantDbQueue, value(s, 'tenant_db_queue_depth'));
      state.peakJvmThreads = Math.max(state.peakJvmThreads, value(s, 'jvm_threads_live'));
      state.peakHeapBytes = Math.max(state.peakHeapBytes, value(s, 'jvm_heap_used_bytes'));
    } catch {
      state.failures += 1;
    }
  };
  const timer = setInterval(tick, 250);
  tick();
  return {
    state,
    async stop() {
      state.stopped = true;
      clearInterval(timer);
      await tick.call(null);
      return state;
    },
  };
}

/**
 * Poll `run_leases` for peak concurrent runs per workspace.
 *
 * This is THE measurement for replica scaling, and it deliberately does not go
 * through the worker's metrics. `run_leases` is the same shared state admission
 * now consults: one row per actively executing run, cluster-wide, regardless of
 * which replica owns it. Reading it directly means the number is independent of
 * how many workers exist, how their in-process counters happen to be set, and
 * whether any of them are lying.
 *
 * If per-tenant limits truly hold as replicas are added, the peak here is
 * identical at N=1, N=2 and N=3.
 */
function startLeaseSampler(pool, intervalMs = 200) {
  const state = { peakByTenant: {}, peakByTenantClass: {}, samples: 0, stopped: false };
  const tick = async () => {
    if (state.stopped) return;
    try {
      // Count runs that are actually EXECUTING, not merely leased.
      //
      // A run refused by the claim-time gate holds its lease for the few
      // milliseconds between acquiring it and releasing it, and never runs — its
      // status stays 'queued'. Counting bare leases therefore catches those
      // transients and reports concurrency the platform never actually granted.
      // `status = 'running'` is set only after the claim gate admits, so this is
      // the honest measure of what the limit is about: simultaneous execution.
      const { rows } = await pool.query(
        `SELECT rl.workspace_id, ar.execution_class, count(*)::int AS active
           FROM run_leases rl
           JOIN agent_runs ar ON ar.id = rl.run_id
          WHERE rl.expires_at > now()
            AND ar.status = 'running'
          GROUP BY rl.workspace_id, ar.execution_class`,
      );
      state.samples += 1;
      const perTenant = {};
      for (const r of rows) {
        perTenant[r.workspace_id] = (perTenant[r.workspace_id] ?? 0) + r.active;
        const k = `${r.workspace_id}:${r.execution_class}`;
        state.peakByTenantClass[k] = Math.max(state.peakByTenantClass[k] ?? 0, r.active);
      }
      for (const [ws, n] of Object.entries(perTenant)) {
        state.peakByTenant[ws] = Math.max(state.peakByTenant[ws] ?? 0, n);
      }
    } catch { /* transient — the next tick retries */ }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return {
    state,
    async stop() { state.stopped = true; clearInterval(timer); return state; },
  };
}

/** Exact XADD → RUN_STARTED per run, read from run_events. */
async function waitBeforeStartSeconds(pool, enqueuedRuns) {
  const ids = enqueuedRuns.map((r) => r.runId);
  if (ids.length === 0) return { perRun: [], values: [] };
  const { rows } = await pool.query(
    `SELECT run_id, MIN(created_at) AS started_at
       FROM run_events
      WHERE run_id = ANY($1::uuid[]) AND type = 'RUN_STARTED'
      GROUP BY run_id`,
    [ids],
  );
  const startedAt = new Map(rows.map((r) => [r.run_id, new Date(r.started_at).getTime()]));
  const perRun = enqueuedRuns.map((r) => ({
    ...r,
    startedAtMs: startedAt.get(r.runId) ?? null,
    waitSeconds: startedAt.has(r.runId)
      ? (startedAt.get(r.runId) - r.enqueuedAtMs) / 1000
      : null,
  }));
  return { perRun, values: perRun.map((r) => r.waitSeconds).filter((v) => v != null) };
}

async function waitForCompletion(pool, runIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let outcomes = [];
  while (Date.now() < deadline) {
    outcomes = await fetchRunOutcomes(pool, runIds);
    const done = outcomes.filter((r) => TERMINAL.has(r.status)).length;
    if (done >= runIds.length) return { outcomes, timedOut: false };
    await sleep(POLL_MS);
  }
  outcomes = await fetchRunOutcomes(pool, runIds);
  return { outcomes, timedOut: true };
}

async function provisionTenants(pool, count, shape, opts = {}) {
  const tenants = [];
  for (let i = 1; i <= count; i++) {
    const t = await createTenant(pool, i);
    t.workflow = await provisionShape(pool, t, shape, opts);
    tenants.push(t);
  }
  return tenants;
}

/** Execute one scenario end to end and produce a report object. */
async function runScenario(scenario, pool, redis) {
  console.log(`\n▶ scenario ${scenario.id}: ${scenario.name}`);
  await resetLoadData(pool);
  await resetStream(redis);
  // Let the worker notice the rebuilt group before measurement starts.
  await sleep(1_500);

  const notes = [];
  const enqueued = [];
  let tenants = [];

  const before = await scrapeFleet().catch(() => null);
  if (!before) {
    throw new Error(
      `cannot scrape worker metrics on :${CONFIG.metricsPort} — is the worker running?`);
  }
  const baseThrottled = counterTotal(before, 'tenant_throttled_total');
  const baseClassifyCount = histogramCount(before, 'job_classify_duration_seconds');
  const baseClassifySum = histogramSum(before, 'job_classify_duration_seconds');
  const baseBlocked = Object.fromEntries(
    seriesFor(before, 'thread_blocked_seconds').map((s) => [s.labels.pool, s.value]));
  const baseDbCount = histogramCount(before, 'tenant_db_call_duration_seconds');
  const baseDbSum = histogramSum(before, 'tenant_db_call_duration_seconds');
  const baseTenantDbRejected = counterTotal(before, 'tenant_db_rejected_total');
  const baseCpuSeconds = value(before, 'jvm_process_cpu_seconds');
  const baseDerived = Object.fromEntries(
    seriesFor(before, 'job_classify_duration_seconds_count').map((s) => [s.labels.result, s.value]));

  const sampler = startSampler();
  const leaseSampler = startLeaseSampler(pool);
  const startedAt = Date.now();

  if (scenario.custom === 'flood') {
    // One noisy tenant, then the quiet ones.
    const noisy = await createTenant(pool, 1);
    noisy.workflow = await provisionShape(pool, noisy, scenario.shape);
    tenants.push(noisy);
    for (let i = 0; i < scenario.floodRuns; i++) {
      enqueued.push(await enqueueRun(pool, redis, noisy, noisy.workflow, { i }));
    }
    for (let i = 2; i <= scenario.quietTenants + 1; i++) {
      const t = await createTenant(pool, i);
      t.workflow = await provisionShape(pool, t, scenario.shape);
      tenants.push(t);
      enqueued.push(await enqueueRun(pool, redis, t, t.workflow, { quiet: true }));
    }
    notes.push(`tenant 1 flooded ${scenario.floodRuns} runs; tenants 2..${scenario.quietTenants + 1} submitted 1 each`);
  } else if (scenario.custom === 'db-hang') {
    // The hanging tenant first, so its runs are at the head of the stream and
    // get first claim on slots — the worst case for everyone else.
    const hanger = await createTenant(pool, 1);
    hanger.workflow = await provisionShape(pool, hanger, 'tenant-db-hang', {
      hangDbPort: CONFIG.hangDbPort,
    });
    tenants.push(hanger);
    for (let i = 0; i < scenario.hangRuns; i++) {
      enqueued.push(await enqueueRun(pool, redis, hanger, hanger.workflow, { i }));
    }
    for (let i = 2; i <= scenario.normalTenants + 1; i++) {
      const t = await createTenant(pool, i);
      t.workflow = await provisionShape(pool, t, scenario.normalShape);
      tenants.push(t);
      enqueued.push(await enqueueRun(pool, redis, t, t.workflow, { normal: true }));
    }
    notes.push(`tenant 1 ran ${scenario.hangRuns} queries against a black-hole database on 127.0.0.1:${CONFIG.hangDbPort}`);
  } else if (scenario.custom === 'mixed') {
    // Agent tenants first so their messages are ahead in time. Under one
    // untyped stream that ordering is exactly what pushed short runs behind
    // agent work the worker could not start.
    for (let i = 1; i <= scenario.agentTenants; i++) {
      const t = await createTenant(pool, i);
      t.workflow = await provisionShape(pool, t, 'agent-iterative-8-turn');
      t.kind = 'agent';
      tenants.push(t);
      for (let r = 0; r < scenario.agentRunsEach; r++) {
        enqueued.push(await enqueueRun(pool, redis, t, t.workflow, { r }));
      }
    }
    for (let i = scenario.agentTenants + 1; i <= scenario.agentTenants + scenario.shortTenants; i++) {
      const t = await createTenant(pool, i);
      t.workflow = await provisionShape(pool, t, 'linear-5-step');
      t.kind = 'short';
      tenants.push(t);
      for (let r = 0; r < scenario.shortRunsEach; r++) {
        enqueued.push(await enqueueRun(pool, redis, t, t.workflow, { r }));
      }
    }
    notes.push(
      `${scenario.agentTenants} agent tenants x ${scenario.agentRunsEach} runs enqueued first, ` +
      `then ${scenario.shortTenants} short tenants x ${scenario.shortRunsEach} runs`);
  } else {
    tenants = await provisionTenants(pool, scenario.tenants, scenario.shape);
    for (const t of tenants) {
      for (let i = 0; i < (scenario.runsPerTenant ?? 1); i++) {
        enqueued.push(await enqueueRun(pool, redis, t, t.workflow, { i }));
      }
    }
  }

  const runIds = enqueued.map((r) => r.runId);
  const { outcomes, timedOut } = await waitForCompletion(pool, runIds, TIMEOUT_MS);
  const wallClockMs = Date.now() - startedAt;
  const sampled = await sampler.stop();
  const leases = await leaseSampler.stop();
  const after = sampled.last ?? (await scrapeFleet().catch(() => before));

  if (timedOut) {
    notes.push(`TIMED OUT after ${(TIMEOUT_MS / 1000).toFixed(0)}s — ${outcomes.filter((o) => !TERMINAL.has(o.status)).length} run(s) never reached a terminal state`);
  }

  const { perRun, values: waitValues } = await waitBeforeStartSeconds(pool, enqueued);

  // Wait split by execution class. For the decoupling test this IS the result:
  // short runs should be unaffected by whatever the agent pool is doing.
  const waitByClass = {};
  for (const r of perRun) {
    if (r.waitSeconds == null) continue;
    (waitByClass[r.executionClass] ??= []).push(r.waitSeconds);
  }
  const waitSummaryByClass = Object.fromEntries(
    Object.entries(waitByClass).map(([cls, vals]) => [cls, summarize(vals)]));
  for (const [cls, sum] of Object.entries(waitSummaryByClass)) {
    notes.push(`wait[${cls}]: n=${sum.n} p50=${(sum.p50 ?? 0).toFixed(2)}s ` +
      `p95=${(sum.p95 ?? 0).toFixed(2)}s max=${(sum.max ?? 0).toFixed(2)}s`);
  }
  // The replica-scaling assertion, measured from shared state rather than from
  // any worker's own bookkeeping.
  const peakTenantConcurrency = Math.max(0, ...Object.values(leases.peakByTenant));
  const peakTenantClassConcurrency = Math.max(0, ...Object.values(leases.peakByTenantClass));
  notes.push(
    `peak per-tenant concurrency (run_leases): total=${peakTenantConcurrency} ` +
    `per-class=${peakTenantClassConcurrency} over ${leases.samples} samples`);

  if (Object.keys(sampled.peakPelByStream).length) {
    notes.push('peak PEL by stream: ' +
      Object.entries(sampled.peakPelByStream).map(([k, v]) => `${k}=${v}`).join(' '));
  }

  const byWorkspace = new Map(tenants.map((t) => [t.workspaceId, t.slug]));
  const completedByTenant = {};
  for (const t of tenants) completedByTenant[t.slug] = 0;
  let succeeded = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (!TERMINAL.has(o.status)) continue;
    const slug = byWorkspace.get(o.workspace_id) ?? o.workspace_id;
    completedByTenant[slug] = (completedByTenant[slug] ?? 0) + 1;
    if (o.status === 'succeeded' || o.status === 'completed') succeeded += 1;
    else failed += 1;
  }
  const completed = succeeded + failed;

  // Failure-reason breakdown makes scenario 5 legible: a socket timeout and an
  // "unreachable" are very different findings.
  const reasons = {};
  for (const o of outcomes) {
    if (!o.error_json) continue;
    const raw = typeof o.error_json === 'string' ? o.error_json : JSON.stringify(o.error_json);
    const key = raw.toLowerCase().includes('socket') || raw.toLowerCase().includes('timed out')
      ? 'socket/timeout'
      : raw.toLowerCase().includes('connect') ? 'connect'
        : 'other';
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  if (Object.keys(reasons).length) {
    notes.push(`failure reasons: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }

  const classifyCount = histogramCount(after, 'job_classify_duration_seconds') - baseClassifyCount;
  const classifySum = histogramSum(after, 'job_classify_duration_seconds') - baseClassifySum;
  if (classifyCount > 0) {
    notes.push(`classifier: ${classifyCount} probes, mean ${(classifySum / classifyCount * 1000).toFixed(1)}ms`);
  }

  // Which execution class the classifier actually derived, versus what the shape
  // expected. A mismatch means the workload ran on a different pool than the
  // scenario intended, which changes what the numbers mean — so it is reported
  // rather than assumed away.
  const derived = {};
  for (const s of seriesFor(after, 'job_classify_duration_seconds_count')) {
    const d = s.value - (baseDerived[s.labels.result] ?? 0);
    if (d > 0) derived[s.labels.result] = d;
  }
  if (Object.keys(derived).length) {
    notes.push(`derived classes: ${Object.entries(derived).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    const expected = new Set(
      tenants.map((t) => (t.workflow?.expectedClass ?? '').toLowerCase()).filter(Boolean));
    const actual = new Set(Object.keys(derived));
    const unexpected = [...actual].filter((c) => !expected.has(c));
    if (expected.size && unexpected.length) {
      notes.push(
        `CLASSIFIER MISMATCH: expected ${[...expected].join('/')}, ` +
        `classifier also produced ${unexpected.join('/')} — the workload ran on a different pool`);
    }
  }

  const blockedDelta = {};
  for (const s of seriesFor(after, 'thread_blocked_seconds')) {
    const d = s.value - (baseBlocked[s.labels.pool] ?? 0);
    if (d > 0.001) blockedDelta[s.labels.pool] = d;
  }
  if (Object.keys(blockedDelta).length) {
    notes.push(`thread-seconds blocked on outbound I/O: ${Object.entries(blockedDelta).map(([k, v]) => `${k}=${v.toFixed(1)}s`).join(' ')}`);
  }

  const dbCount = histogramCount(after, 'tenant_db_call_duration_seconds') - baseDbCount;
  const dbSum = histogramSum(after, 'tenant_db_call_duration_seconds') - baseDbSum;
  if (dbCount > 0) {
    notes.push(`tenant DB calls: ${dbCount}, mean ${(dbSum / dbCount).toFixed(1)}s (this is how long each hung call held a slot)`);
  }

  // Cross-check the exact percentiles against the metric an operator sees.
  const metricP95 = histogramQuantile(after, 'job_wait_before_start_seconds', {}, 0.95);
  if (metricP95 != null) {
    notes.push(`job_wait_before_start_seconds p95 from the worker's own histogram: ~${metricP95.toFixed(2)}s (bucketed estimate)`);
  }

  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    expect: scenario.expect,
    tenantCount: tenants.length,
    enqueued: enqueued.length,
    completed,
    succeeded,
    failed,
    timedOut,
    wallClockMs,
    throughputPerSec: completed / (wallClockMs / 1000),
    wait: summarize(waitValues),
    waitByClass: waitSummaryByClass,
    waitPerRun: perRun.map((r) => ({ tenant: r.tenantSlug, waitSeconds: r.waitSeconds })),
    completedByTenant,
    fairness: fairnessRatio(completedByTenant),
    peakPelDepth: sampled.peakPelDepth,
    peakPelByStream: sampled.peakPelByStream,
    peakSlotsActive: sampled.peakSlotsActive,
    slotsTotal: sampled.slotsTotal,
    peakTenantConcurrency,
    peakTenantClassConcurrency,
    peakByTenant: leases.peakByTenant,
    replicas: CONFIG.metricsPorts.length,
    admissionOvershoot: counterTotal(after, 'tenant_admission_overshoot_total')
      - counterTotal(before, 'tenant_admission_overshoot_total'),
    peakTenantDbActive: sampled.peakTenantDbActive,
    peakTenantDbQueue: sampled.peakTenantDbQueue,
    tenantDbRejected: counterTotal(after, 'tenant_db_rejected_total') - baseTenantDbRejected,
    peakJvmThreads: sampled.peakJvmThreads,
    peakHeapMb: Math.round(sampled.peakHeapBytes / 1048576),
    cpuSeconds: Math.round((value(after, 'jvm_process_cpu_seconds') - baseCpuSeconds) * 10) / 10,
    throttled: counterTotal(after, 'tenant_throttled_total') - baseThrottled,
    notes,
  };
}

async function main() {
  const pool = newPool();
  const redis = newRedis();
  const results = [];

  try {
    await pool.query('SELECT 1');
    await redis.ping();

    const chosen = args.all
      ? SCENARIOS
      : args.scenario ? [byId(args.scenario)].filter(Boolean) : SCENARIOS;

    if (chosen.length === 0) {
      console.error(`no scenario matched --scenario ${args.scenario}`);
      process.exitCode = 1;
      return;
    }

    for (const s of chosen) {
      const r = await runScenario(s, pool, redis);
      results.push(r);
      console.log(renderScenarioReport(r));
      // Let the worker settle between scenarios so high-water marks do not bleed.
      await sleep(3_000);
    }

    console.log('\n\n=== BASELINE TABLE ===\n');
    console.log(MARKDOWN_HEADER);
    for (const r of results) console.log(markdownRow(r));

    if (typeof args.out === 'string') {
      const md = [
        '# Load harness baseline',
        '',
        `Generated ${new Date().toISOString()}`,
        '',
        MARKDOWN_HEADER,
        ...results.map(markdownRow),
        '',
        ...results.flatMap((r) => [
          `## ${r.name}`,
          '',
          r.description,
          '',
          '```',
          renderScenarioReport(r),
          '```',
          '',
        ]),
      ].join('\n');
      await fs.writeFile(args.out, md, 'utf8');
      console.log(`\nwrote ${args.out}`);
    }

    if (typeof args.json === 'string') {
      await fs.writeFile(args.json, JSON.stringify(results, null, 2), 'utf8');
      console.log(`wrote ${args.json}`);
    }
  } finally {
    await pool.end().catch(() => {});
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
