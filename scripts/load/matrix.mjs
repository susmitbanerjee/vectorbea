#!/usr/bin/env node
/**
 * The B08 capacity matrix — eight scenarios, one metric set, one table.
 *
 *   node scripts/load/matrix.mjs                     # all eight
 *   node scripts/load/matrix.mjs --only a,d,g        # a subset
 *   node scripts/load/matrix.mjs --only e --minutes 5  # shorten the sustained run
 *   node scripts/load/matrix.mjs --tag n2            # label the output for a replica count
 *
 * WHY THIS IS NOT `run.mjs`
 * -------------------------
 * `run.mjs` measures the five Part-D scenarios and its report shape is pinned to them.
 * B08 asks a different question — a capacity model rather than a scheduler regression
 * check — and needs four columns run.mjs does not collect: error rate, DB connections,
 * heap growth over time, and fairness for every scenario rather than just the flood.
 *
 * The library underneath is shared (`seed`, `shapes`, `metrics`, `report`), so both
 * drive the same provisioning and read the same exposition. Forking the driver rather
 * than the substrate keeps the two sets of numbers comparable.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 * ----------------------------------------
 * It measures THIS machine: a developer laptop, a Dockerised Postgres and Redis on
 * loopback, and `mock-upstreams.mjs` standing in for the model providers. Every number
 * here is a measurement of that environment and nothing else.
 *
 * The mock's default LLM latency is 800ms, which is a fair approximation of a fast
 * model call and NOT an instant return — so the agent scenarios are genuinely
 * I/O-bound, as production would be. What the mock does not reproduce is variance: a
 * real provider's p99 is many multiples of its p50, and tail latency is what actually
 * fills a pool. Treat the agent numbers as a floor.
 *
 * Postgres and Redis are on loopback rather than across a network, which understates
 * per-query latency against Neon by roughly the round-trip time. That matters most for
 * `job_claim_latency_seconds` and `db_pool_wait_seconds`. Both effects are carried into
 * CAPACITY.md as named limitations rather than quietly averaged away.
 */

import {
  CONFIG, newPool, newRedis, sleep, mockBaseUrl,
} from './lib/env.mjs';
import {
  scrapeFleet, value, seriesFor, histogramQuantile, histogramCount, counterTotal,
} from './lib/metrics.mjs';
import { percentile, summarize, fairnessRatio } from './lib/report.mjs';
import {
  LOAD_TAG, createTenant, provisionShape, enqueueRun, resetLoadData, resetStream,
} from './seed.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : []));

const TAG = args.tag ?? 'n1';
const ONLY = args.only ? String(args.only).split(',').map((s) => s.trim()) : null;
const SUSTAINED_MINUTES = Number(args.minutes ?? 30);
const OUT = args.out ?? `docs/architecture/measurements/matrix-${TAG}.json`;

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'completed', 'error']);
const pool = newPool();
const redis = newRedis();

const log = (s) => console.log(s);
const rule = (s) => console.log('\n' + '─'.repeat(78) + '\n' + s + '\n' + '─'.repeat(78));

// ── The sampler ─────────────────────────────────────────────────────────────
//
// Samples the SAME endpoint an operator's Prometheus scrapes, so the harness cannot
// see anything the production monitoring could not. That constraint is deliberate: a
// capacity number derived from instrumentation nobody runs in production is a number
// you cannot reproduce during an incident.
//
// Series rather than only high-water marks, because (e) asks about heap GROWTH — a
// peak tells you nothing about whether it came back down.

function startSampler(pgPool, intervalMs = 1000) {
  const state = {
    heapSeries: [], threadSeries: [], dbConnSeries: [],
    slotsActive: {}, slotsTotal: {},
    peakByTenant: {}, peakByTenantClass: {},
    peakQueueDepth: 0, peakTenantDbActive: 0, peakTenantDbQueue: 0,
    samples: 0, scrapeFailures: 0, last: null, stopped: false,
  };

  const tick = async () => {
    if (state.stopped) return;
    const t = Date.now();
    try {
      const s = await scrapeFleet();
      state.last = s;
      state.samples += 1;
      state.heapSeries.push([t, value(s, 'jvm_heap_used_bytes')]);
      state.threadSeries.push([t, value(s, 'jvm_threads_live')]);
      for (const sample of seriesFor(s, 'worker_pool_slots_active')) {
        const p = sample.labels.pool ?? 'unknown';
        state.slotsActive[p] = Math.max(state.slotsActive[p] ?? 0, sample.value);
      }
      for (const sample of seriesFor(s, 'worker_pool_slots_total')) {
        state.slotsTotal[sample.labels.pool ?? 'unknown'] = sample.value;
      }
      state.peakTenantDbActive = Math.max(state.peakTenantDbActive, value(s, 'tenant_db_slots_active'));
      state.peakTenantDbQueue = Math.max(state.peakTenantDbQueue, value(s, 'tenant_db_queue_depth'));
    } catch { state.scrapeFailures += 1; }

    // Per-tenant concurrency from run_leases — SHARED state, not any worker's own
    // bookkeeping. This is the whole point of the replica-scaling proof: a number read
    // from one worker's memory would be correct at N=1 by construction and prove
    // nothing about N=3.
    try {
      const { rows } = await pgPool.query(
        `SELECT l.workspace_id::text AS ws, COALESCE(r.execution_class,'?') AS cls, COUNT(*) AS n
           FROM run_leases l JOIN agent_runs r ON r.id = l.run_id
          WHERE l.expires_at > now() GROUP BY 1,2`);
      const byTenant = {};
      for (const r of rows) {
        const n = Number(r.n);
        byTenant[r.ws] = (byTenant[r.ws] ?? 0) + n;
        const k = `${r.ws}/${r.cls}`;
        state.peakByTenantClass[k] = Math.max(state.peakByTenantClass[k] ?? 0, n);
      }
      for (const [ws, n] of Object.entries(byTenant)) {
        state.peakByTenant[ws] = Math.max(state.peakByTenant[ws] ?? 0, n);
      }
    } catch { /* transient */ }

    // Postgres connection count. §2.7 gives a connection budget and every scenario
    // should say what it actually used — an exhausted pool looks like a slow database
    // from every other vantage point.
    try {
      const { rows } = await pgPool.query(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`);
      state.dbConnSeries.push([t, rows[0].n]);
    } catch { /* transient */ }

    // Queue depth, from the same predicate the worker's job_queue_depth gauge uses.
    try {
      const { rows } = await pgPool.query(
        `SELECT COUNT(*)::int AS n FROM agent_runs WHERE status = 'queued'`);
      state.peakQueueDepth = Math.max(state.peakQueueDepth, rows[0].n);
    } catch { /* transient */ }
  };

  const timer = setInterval(tick, intervalMs);
  tick();
  return {
    state,
    async stop() { state.stopped = true; clearInterval(timer); await tick(); return state; },
  };
}

const seriesMax = (s) => (s.length ? Math.max(...s.map(([, v]) => v)) : 0);
const seriesLast = (s) => (s.length ? s[s.length - 1][1] : 0);
const seriesFirst = (s) => (s.length ? s[0][1] : 0);

/**
 * Least-squares slope over a time series, in units per hour.
 *
 * Used for the heap-growth question in (e). A peak cannot distinguish "allocated and
 * collected" from "leaked"; a positive slope sustained over 30 minutes can. Not proof
 * of a leak — GC timing dominates over short windows — which is why the write-up
 * reports the slope AND the post-GC floor rather than either alone.
 */
function slopePerHour(series) {
  if (series.length < 3) return null;
  // A slope extrapolated from a 3-second window is arithmetic, not evidence: the
  // baseline scenario produced "22,970 MB/h" from JVM warm-up. Reporting that in a
  // capacity table would be worse than reporting nothing, because a reader has no way
  // to tell it apart from a real leak. Below five minutes of observation, decline.
  const windowMs = series[series.length - 1][0] - series[0][0];
  if (windowMs < 5 * 60_000) return null;
  const t0 = series[0][0];
  const xs = series.map(([t]) => (t - t0) / 3_600_000);
  const ys = series.map(([, v]) => v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? null : num / den;
}

// ── Completion ──────────────────────────────────────────────────────────────

async function waitForCompletion(runIds, timeoutMs, onProgress) {
  const deadline = Date.now() + timeoutMs;
  let outcomes = [];
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT id::text, status, workspace_id::text AS workspace_id, error_json,
              started_at, completed_at, created_at
         FROM agent_runs WHERE id = ANY($1::uuid[])`, [runIds]);
    outcomes = rows;
    const done = rows.filter((r) => TERMINAL.has(r.status)).length;
    onProgress?.(done, rows.length);
    if (done === runIds.length) return { outcomes, timedOut: false };
    await sleep(500);
  }
  return { outcomes, timedOut: true };
}

/**
 * Wait-before-start, measured from the run row rather than from the harness clock.
 *
 * `created_at → started_at` is what the user experiences: the gap between pressing Run
 * and the run beginning. Measuring from when the harness issued the insert would
 * include the harness's own latency and would flatter the result.
 */
async function waitBeforeStart(runIds) {
  const { rows } = await pool.query(
    `SELECT id::text, workspace_id::text AS ws, execution_class AS cls,
            EXTRACT(EPOCH FROM (started_at - created_at)) AS wait_s
       FROM agent_runs
      WHERE id = ANY($1::uuid[]) AND started_at IS NOT NULL`, [runIds]);
  return rows.map((r) => ({ ...r, wait_s: Number(r.wait_s) }));
}

// ── Scenario bodies ─────────────────────────────────────────────────────────

/** Provision N tenants, each with `runs` runs of `shape`. Returns {tenants, ids}. */
async function fanTenants({ count, runs, shape, startIndex = 1, opts = {} }) {
  const tenants = [];
  const ids = [];
  for (let i = 0; i < count; i++) {
    const t = await createTenant(pool, startIndex + i);
    t.workflow = await provisionShape(pool, t, shape, opts);
    tenants.push(t);
    for (let r = 0; r < runs; r++) {
      ids.push((await enqueueRun(pool, redis, t, t.workflow, { r })).runId);
    }
  }
  return { tenants, ids };
}

const SCENARIOS = {
  a: {
    name: 'Baseline — 1 tenant, 1 linear workflow',
    why: 'The floor. Wait is pure dispatch latency; throughput is the ceiling every other row is measured against.',
    timeoutMs: 120_000,
    async run() {
      const { tenants, ids } = await fanTenants({ count: 1, runs: 1, shape: 'linear-5-step' });
      return { tenants, ids };
    },
  },

  b: {
    name: 'Agent saturation — 20 tenants × 1 agent workflow',
    why: 'Twenty agent runs against a 6-slot agent pool. Measures how far behind the last-served tenant falls, which is what a twentieth customer experiences.',
    timeoutMs: 600_000,
    async run() {
      return fanTenants({ count: 20, runs: 1, shape: 'agent-iterative-8-turn' });
    },
  },

  c: {
    name: 'Fan-out — 1 workflow, 16 parallel branches',
    why: 'One run that wants sixteen things at once. Tests whether parallelism inside a run competes with parallelism across runs.',
    timeoutMs: 300_000,
    async run() {
      // parallel-fanout-8 is the built shape; 16 branches means two runs of it in
      // parallel from one tenant, which is the same demand on the scheduler and does
      // not require inventing a shape whose classifier behaviour is unproven.
      const { tenants, ids } = await fanTenants({
        count: 1, runs: 2, shape: 'parallel-fanout-8',
        opts: { baseUrl: mockBaseUrl() },
      });
      return { tenants, ids, note: '2 runs × 8 branches = 16 concurrent branches from one tenant' };
    },
  },

  d: {
    name: 'Abusive tenant — 1 floods 500 runs + 10 tenants × 2 runs',
    why: 'THE HEADLINE. One workspace submits 500 runs while ten others submit two each. The normal tenants must be materially unaffected — that is the claim fairness exists to support.',
    timeoutMs: 900_000,
    async run() {
      // The flooder goes first so its runs are ahead in time — the worst case for
      // everyone else, and the one a naive FIFO queue fails.
      const noisy = await createTenant(pool, 1);
      noisy.workflow = await provisionShape(pool, noisy, 'linear-5-step');
      const noisyIds = [];
      for (let i = 0; i < 500; i++) {
        noisyIds.push((await enqueueRun(pool, redis, noisy, noisy.workflow, { i })).runId);
      }
      const quiet = await fanTenants({ count: 10, runs: 2, shape: 'linear-5-step', startIndex: 2 });
      return {
        tenants: [noisy, ...quiet.tenants],
        ids: [...noisyIds, ...quiet.ids],
        // The comparison that IS the result: the quiet tenants' wait against the
        // flooder's. A single aggregate p95 would average the victim into the abuser.
        split: { abusive: new Set(noisyIds), normal: new Set(quiet.ids) },
      };
    },
  },

  e: {
    name: `Sustained — 200 concurrent for ${SUSTAINED_MINUTES} minutes`,
    why: 'Heap growth, connection leaks, run_events bloat. Nothing here shows up in a 60-second test; everything here shows up in production at 3am.',
    timeoutMs: (SUSTAINED_MINUTES + 5) * 60_000,
    sustained: true,
    async run() {
      // 20 tenants seeded with 200 runs, then TOPPED UP for the full duration.
      //
      // The first version of this returned after the initial 200 and called itself a
      // sustained test. It drained in 56 seconds. A 56-second window cannot answer any
      // of the three questions this scenario exists for — heap growth, connection
      // leaks, run_events bloat — and reporting it as "sustained: passed" would have
      // been the single most misleading number in the matrix.
      //
      // The top-up runs inside `run()` and only returns once the wall-clock duration
      // has elapsed, so the driver's completion wait sees the full population.
      const tenants = [];
      for (let i = 0; i < 20; i++) {
        const t = await createTenant(pool, i + 1);
        t.workflow = await provisionShape(pool, t, 'linear-5-step');
        tenants.push(t);
      }
      const ids = [];
      const enqueue = async (n) => {
        const batch = [];
        for (let i = 0; i < n; i++) {
          const t = tenants[(ids.length + i) % tenants.length];
          batch.push(enqueueRun(pool, redis, t, t.workflow, { i }));
        }
        for (const r of await Promise.all(batch)) ids.push(r.runId);
      };

      await enqueue(200);
      const until = Date.now() + SUSTAINED_MINUTES * 60_000;
      let topUps = 0;
      while (Date.now() < until) {
        await sleep(5_000);
        // Hold ~200 in flight: replace whatever drained since the last check.
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS n FROM agent_runs WHERE status IN ('queued','running','yielded')`);
        const deficit = 200 - rows[0].n;
        if (deficit > 0) { await enqueue(deficit); topUps += deficit; }
      }
      return {
        tenants, ids,
        note: `held ~200 in flight for ${SUSTAINED_MINUTES}min; ` +
              `${ids.length} runs total (${topUps} topped up)`,
      };
    },
  },

  f: {
    name: 'Spike — 0 → 300 concurrent in 10 seconds',
    why: 'Admission control under a step function. The question is not whether it copes but whether it refuses honestly rather than collapsing.',
    timeoutMs: 600_000,
    async run() {
      const tenants = [];
      for (let i = 0; i < 10; i++) {
        const t = await createTenant(pool, i + 1);
        t.workflow = await provisionShape(pool, t, 'linear-5-step');
        tenants.push(t);
      }
      // 300 runs across 10 seconds, in 10 bursts of 30. Genuinely a spike rather than
      // a fast ramp — the burst is what finds an admission path that assumes arrival
      // is smooth.
      const ids = [];
      const started = Date.now();
      for (let burst = 0; burst < 10; burst++) {
        const batch = [];
        for (let i = 0; i < 30; i++) {
          const t = tenants[i % tenants.length];
          batch.push(enqueueRun(pool, redis, t, t.workflow, { burst, i }));
        }
        for (const r of await Promise.all(batch)) ids.push(r.runId);
        const elapsed = Date.now() - started;
        const target = (burst + 1) * 1000;
        if (elapsed < target) await sleep(target - elapsed);
      }
      return { tenants, ids, note: `300 runs enqueued in ${((Date.now() - started) / 1000).toFixed(1)}s` };
    },
  },

  g: {
    name: 'Hanging tenant DB — 1 black-hole database + 10 normal tenants',
    why: 'THE CONTAINMENT TEST. One tenant queries a database that completes the handshake and never responds. It must consume only its own dispatcher.',
    timeoutMs: 300_000,
    async run() {
      const hanger = await createTenant(pool, 1);
      hanger.workflow = await provisionShape(pool, hanger, 'tenant-db-hang', {
        hangDbPort: CONFIG.hangDbPort,
      });
      const hangIds = [];
      for (let i = 0; i < 8; i++) {
        hangIds.push((await enqueueRun(pool, redis, hanger, hanger.workflow, { i })).runId);
      }
      // Agent-shaped normals on purpose: "unrelated" has to mean a genuinely different
      // execution pool. Using a shape the classifier bins into the same pool as the
      // hang would measure two workloads contending for one pool and call it
      // interference.
      const normal = await fanTenants({
        count: 10, runs: 1, shape: 'agent-iterative-8-turn', startIndex: 2 });
      return {
        tenants: [hanger, ...normal.tenants],
        ids: [...hangIds, ...normal.ids],
        split: { hanging: new Set(hangIds), normal: new Set(normal.ids) },
      };
    },
  },

  h: {
    name: 'Saturation — push until degradation',
    why: 'The real ceiling and the shape of the failure. A ceiling nobody has measured is a guess, and a failure mode nobody has watched is a hope.',
    timeoutMs: 900_000,
    async run() {
      // Ramp in steps rather than one push, so the LAST HEALTHY step is identifiable.
      // A single overwhelming load tells you it broke, not where.
      const tenants = [];
      for (let i = 0; i < 20; i++) {
        const t = await createTenant(pool, i + 1);
        t.workflow = await provisionShape(pool, t, 'linear-5-step');
        tenants.push(t);
      }
      const ids = [];
      const steps = [];
      for (const size of [50, 100, 200, 400, 800]) {
        const t0 = Date.now();
        const batch = [];
        for (let i = 0; i < size; i++) {
          const t = tenants[i % tenants.length];
          batch.push(enqueueRun(pool, redis, t, t.workflow, { step: size, i }));
        }
        const stepIds = (await Promise.all(batch)).map((r) => r.runId);
        ids.push(...stepIds);
        steps.push({ size, ids: stepIds, enqueueMs: Date.now() - t0 });
        await sleep(5_000);
      }
      return { tenants, ids, steps };
    },
  },
};

// ── Driver ──────────────────────────────────────────────────────────────────

async function runScenario(key) {
  const s = SCENARIOS[key];
  rule(`${key.toUpperCase()}. ${s.name}`);
  log(`   ${s.why}\n`);

  await resetLoadData(pool);
  await resetStream(redis);
  await sleep(1_500);

  const before = await scrapeFleet().catch(() => null);
  if (!before) throw new Error(`worker metrics unreachable on :${CONFIG.metricsPort} — is the worker running?`);
  const base = {
    throttled: counterTotal(before, 'tenant_throttled_total'),
    deadLetters: counterTotal(before, 'dead_letter_total'),
    leaseExpiry: counterTotal(before, 'lease_expiry_total'),
    suspended: counterTotal(before, 'run_suspended_total'),
  };

  const sampler = startSampler(pool);
  const t0 = Date.now();
  const setup = await s.run();
  const enqueuedAt = Date.now();

  let lastLogged = 0;
  const { outcomes, timedOut } = await waitForCompletion(
    setup.ids, s.timeoutMs,
    (done, total) => {
      const now = Date.now();
      if (now - lastLogged > 15_000) {
        lastLogged = now;
        log(`   … ${done}/${total} complete (${((now - t0) / 1000).toFixed(0)}s)`);
      }
    });

  const wallMs = Date.now() - t0;
  const sampled = await sampler.stop();
  const after = sampled.last ?? before;

  // ── Derive ────────────────────────────────────────────────────────────────
  const terminal = outcomes.filter((o) => TERMINAL.has(o.status));
  const ok = terminal.filter((o) => o.status === 'succeeded' || o.status === 'completed');
  const bad = terminal.filter((o) => !(o.status === 'succeeded' || o.status === 'completed'));
  const stuck = outcomes.length - terminal.length;

  const waits = await waitBeforeStart(setup.ids);
  const allWaits = waits.map((w) => w.wait_s).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);

  const completedByTenant = {};
  const slugByWs = new Map((setup.tenants ?? []).map((t) => [t.workspaceId, t.slug]));
  for (const t of setup.tenants ?? []) completedByTenant[t.slug] = 0;
  for (const o of terminal) {
    const slug = slugByWs.get(o.workspace_id) ?? o.workspace_id;
    completedByTenant[slug] = (completedByTenant[slug] ?? 0) + 1;
  }

  // The split comparison, where the scenario has one. This is the number that
  // answers d and g; an aggregate would hide exactly what they ask.
  let splitReport = null;
  if (setup.split) {
    splitReport = {};
    for (const [label, idSet] of Object.entries(setup.split)) {
      const group = waits.filter((w) => idSet.has(w.id)).map((w) => w.wait_s).sort((a, b) => a - b);
      const groupOutcomes = terminal.filter((o) => idSet.has(o.id));
      splitReport[label] = {
        n: idSet.size,
        completed: groupOutcomes.length,
        succeeded: groupOutcomes.filter((o) => o.status === 'succeeded' || o.status === 'completed').length,
        waitP50: percentile(group, 50), waitP95: percentile(group, 95), waitP99: percentile(group, 99),
        waitMax: group.length ? group[group.length - 1] : null,
      };
    }
  }

  const heapSlope = slopePerHour(sampled.heapSeries);
  const connSlope = slopePerHour(sampled.dbConnSeries);

  const result = {
    scenario: key,
    name: s.name,
    tag: TAG,
    at: new Date().toISOString(),
    enqueued: setup.ids.length,
    completed: terminal.length,
    succeeded: ok.length,
    failed: bad.length,
    stuck,
    timedOut,
    errorRatePct: terminal.length ? (bad.length / terminal.length) * 100 : null,
    wallClockSeconds: wallMs / 1000,
    enqueueSeconds: (enqueuedAt - t0) / 1000,
    throughputPerSec: terminal.length / (wallMs / 1000),
    wait: {
      n: allWaits.length,
      p50: percentile(allWaits, 50),
      p95: percentile(allWaits, 95),
      p99: percentile(allWaits, 99),
      max: allWaits.length ? allWaits[allWaits.length - 1] : null,
    },
    split: splitReport,
    fairness: fairnessRatio(completedByTenant),
    completedByTenant,
    peakQueueDepth: sampled.peakQueueDepth,
    peakSlotsActive: sampled.slotsActive,
    slotsTotal: sampled.slotsTotal,
    peakTenantConcurrency: Math.max(0, ...Object.values(sampled.peakByTenant)),
    peakTenantClassConcurrency: Math.max(0, ...Object.values(sampled.peakByTenantClass)),
    tenantDb: { peakActive: sampled.peakTenantDbActive, peakQueue: sampled.peakTenantDbQueue },
    heap: {
      startMB: seriesFirst(sampled.heapSeries) / 1e6,
      peakMB: seriesMax(sampled.heapSeries) / 1e6,
      endMB: seriesLast(sampled.heapSeries) / 1e6,
      slopeMBPerHour: heapSlope == null ? null : heapSlope / 1e6,
    },
    threads: {
      start: seriesFirst(sampled.threadSeries),
      peak: seriesMax(sampled.threadSeries),
      end: seriesLast(sampled.threadSeries),
    },
    dbConnections: {
      start: seriesFirst(sampled.dbConnSeries),
      peak: seriesMax(sampled.dbConnSeries),
      end: seriesLast(sampled.dbConnSeries),
      slopePerHour: connSlope,
    },
    guards: {
      throttled: counterTotal(after, 'tenant_throttled_total') - base.throttled,
      deadLetters: counterTotal(after, 'dead_letter_total') - base.deadLetters,
      leaseExpiry: counterTotal(after, 'lease_expiry_total') - base.leaseExpiry,
      suspended: counterTotal(after, 'run_suspended_total') - base.suspended,
    },
    claimLatencyP95: histogramQuantile(after, 'job_claim_latency_seconds', {}, 0.95),
    samples: sampled.samples,
    scrapeFailures: sampled.scrapeFailures,
    note: setup.note ?? null,
    steps: setup.steps ? setup.steps.map((st) => ({ size: st.size, enqueueMs: st.enqueueMs })) : null,
  };

  printResult(result);
  return result;
}

function printResult(r) {
  const f = (v, d = 2) => (v == null ? 'n/a' : Number(v).toFixed(d));
  log('');
  log(`   enqueued ${r.enqueued} · completed ${r.completed} · succeeded ${r.succeeded} · failed ${r.failed}` +
      (r.stuck ? ` · STUCK ${r.stuck}` : ''));
  log(`   throughput      ${f(r.throughputPerSec, 3)} runs/s over ${f(r.wallClockSeconds, 1)}s`);
  log(`   wait p50/p95/p99 ${f(r.wait.p50)}s / ${f(r.wait.p95)}s / ${f(r.wait.p99)}s (max ${f(r.wait.max)}s)`);
  log(`   error rate      ${f(r.errorRatePct, 1)}%`);
  log(`   fairness        ${f(r.fairness, 2)}`);
  log(`   heap            ${f(r.heap.startMB, 0)} → ${f(r.heap.peakMB, 0)} peak → ${f(r.heap.endMB, 0)} MB` +
      (r.heap.slopeMBPerHour == null ? '' : ` (slope ${f(r.heap.slopeMBPerHour, 1)} MB/h)`));
  log(`   threads         ${r.threads.start} → ${r.threads.peak} peak → ${r.threads.end}`);
  log(`   db connections  ${r.dbConnections.start} → ${r.dbConnections.peak} peak → ${r.dbConnections.end}`);
  log(`   peak queue      ${r.peakQueueDepth}`);
  log(`   peak per-tenant ${r.peakTenantConcurrency} (per class ${r.peakTenantClassConcurrency})`);
  log(`   claim p95       ${f(r.claimLatencyP95, 3)}s`);
  if (r.guards.throttled || r.guards.deadLetters || r.guards.leaseExpiry || r.guards.suspended) {
    log(`   guards          throttled=${r.guards.throttled} suspended=${r.guards.suspended} ` +
        `leaseExpiry=${r.guards.leaseExpiry} deadLetters=${r.guards.deadLetters}`);
  }
  if (r.tenantDb.peakActive || r.tenantDb.peakQueue) {
    log(`   tenant-db       peak active ${r.tenantDb.peakActive}, peak queue ${r.tenantDb.peakQueue}`);
  }
  if (r.split) {
    log('');
    for (const [label, s] of Object.entries(r.split)) {
      log(`   [${label}] n=${s.n} completed=${s.completed} ` +
          `wait p50=${f(s.waitP50)}s p95=${f(s.waitP95)}s max=${f(s.waitMax)}s`);
    }
  }
  if (r.note) log(`   note            ${r.note}`);
  if (r.timedOut) log(`   *** TIMED OUT — ${r.stuck} run(s) never reached a terminal state`);
}

// ── Main ────────────────────────────────────────────────────────────────────

const keys = (ONLY ?? Object.keys(SCENARIOS)).filter((k) => SCENARIOS[k]);
if (!keys.length) { console.error('no scenarios selected'); process.exit(2); }

rule(`B08 CAPACITY MATRIX — tag=${TAG}`);
log(`Scenarios: ${keys.join(', ')}`);
log('Every number below measures THIS machine with mock upstreams. See CAPACITY.md §2.');

const results = [];
for (const k of keys) {
  try {
    results.push(await runScenario(k));
  } catch (e) {
    console.error(`\n   scenario ${k} FAILED to run: ${e.message}`);
    results.push({ scenario: k, name: SCENARIOS[k].name, tag: TAG, harnessError: String(e.message) });
  }
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify({ tag: TAG, at: new Date().toISOString(), results }, null, 2));

rule('SUMMARY');
log('| # | Scenario | Runs | Thr/s | p50 | p95 | p99 | Err% | Fair | Heap peak | Thr | DB |');
log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  if (r.harnessError) { log(`| ${r.scenario} | ${r.name} | — harness error: ${r.harnessError} |`); continue; }
  const f = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
  log(`| ${r.scenario} | ${r.name.split('—')[0].trim()} | ${r.completed}/${r.enqueued} | ` +
      `${f(r.throughputPerSec, 2)} | ${f(r.wait.p50)}s | ${f(r.wait.p95)}s | ${f(r.wait.p99)}s | ` +
      `${f(r.errorRatePct, 1)} | ${f(r.fairness, 2)} | ${f(r.heap.peakMB, 0)}MB | ` +
      `${r.threads.peak} | ${r.dbConnections.peak} |`);
}
log(`\nWritten to ${OUT}`);

await pool.end();
redis.disconnect();
process.exit(results.some((r) => r.harnessError || r.timedOut) ? 1 : 0);
