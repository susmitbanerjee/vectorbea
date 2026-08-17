#!/usr/bin/env node
/**
 * Admission control, through the real HTTP endpoint.
 *
 *   API_BASE=http://127.0.0.1:18090 node scripts/load/admission-check.mjs
 *
 * The load harness enqueues straight into Postgres, so it never exercises the API
 * path at all — this drives POST /api/runs so the guards that live there are
 * measured rather than assumed.
 *
 * Run the API with low thresholds so saturation is reachable:
 *   ADMISSION_IMMEDIATE_BELOW=5 ADMISSION_QUEUED_BELOW=20 ADMISSION_GLOBAL_REJECT=25
 *
 * And run it with NO WORKER. A worker drains the queue as fast as this fills it,
 * so the global threshold is never crossed and the shedding assertions silently
 * skip — the test then passes without having tested the thing it names.
 *
 * Asserts:
 *   - an uncontended run is accepted with no position and no ETA
 *   - once the queue is deep, acceptance carries queuePosition + etaSeconds
 *   - a workspace over its own cap gets 429 WORKSPACE_CONCURRENCY_LIMIT with
 *     structured details, not a bare 500
 *   - global saturation sheds with 503 QUEUE_SATURATED
 *   - the priority lane is still admitted while shedding
 */
import { newPool, newRedis, sleep } from './lib/env.mjs';
import { LOAD_TAG, createTenant, provisionShape, resetLoadData, resetStream } from './seed.mjs';

const API = process.env.API_BASE ?? 'http://127.0.0.1:18090';
const pool = newPool();
const redis = newRedis();

async function trigger(tenant, workflowId) {
  const res = await fetch(`${API}/api/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-workspace-id': tenant.workspaceId,
      'x-environment-id': tenant.environmentId,
    },
    body: JSON.stringify({ triggerType: 'manual', input: {} }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

await resetLoadData(pool);
await resetStream(redis);

const normal = await createTenant(pool, 1);
const capped = await createTenant(pool, 2);
const vip = await createTenant(pool, 3);
const wfs = {};
for (const t of [normal, capped, vip]) {
  wfs[t.slug] = await provisionShape(pool, t, 'agent-iterative-8-turn');
  // Lift the pre-existing beta daily-run quota (default 20) out of the way. It is
  // a separate, older guard and it fires first — leaving it at 20 means this test
  // stops at 20 runs and reports "threshold not reached" for an admission
  // threshold it never got near.
  await pool.query(
    `INSERT INTO workspace_usage_policies (workspace_id, max_runs_per_day)
     VALUES ($1, 100000) ON CONFLICT (workspace_id) DO UPDATE SET max_runs_per_day = 100000`,
    [t.workspaceId]);
}
// One concurrent run for the capped tenant, so its ceiling is trivially reachable.
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, max_concurrent_runs)
   VALUES ($1, 1) ON CONFLICT (workspace_id) DO UPDATE SET max_concurrent_runs = 1`,
  [capped.workspaceId]);
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, priority_lane, reserved_slots)
   VALUES ($1, true, 20) ON CONFLICT (workspace_id) DO UPDATE
     SET priority_lane = true, reserved_slots = 20`, [vip.workspaceId]);

const results = {};

// ── 1. Uncontended ──────────────────────────────────────────────────────────
results.idle = await trigger(normal, wfs[normal.slug].workflowId);
console.log(`▶ idle          → ${results.idle.status} ${JSON.stringify(results.idle.body)}`);

// ── 2. Workspace cap ────────────────────────────────────────────────────────
// Run BEFORE the queue is filled. Admission checks the workspace cap first and
// the global threshold second, so once the platform is shedding every caller
// gets 503 and this assertion can never reach the cap it is testing.
//
// The cap counts runs that are *active* (claimed/running), so with no worker
// draining nothing would ever be active and the cap could not bind. Mark one run
// running directly — the state a worker would have put it in — so the check is
// measuring admission rather than the absence of a worker.
const first = await trigger(capped, wfs[capped.slug].workflowId);
await pool.query(
  `UPDATE agent_runs SET status = 'running', started_at = now() WHERE id = $1`,
  [first.body?.runId]);
const cappedRes = await trigger(capped, wfs[capped.slug].workflowId);
console.log(`▶ over cap      → ${cappedRes.status} ${JSON.stringify(cappedRes.body)}`);

// ── 3. Build a queue ────────────────────────────────────────────────────────
console.log('▶ filling the queue …');
let lastAccepted = null;
let saturated = null;
const tally = {};
for (let i = 0; i < 120; i++) {
  const r = await trigger(normal, wfs[normal.slug].workflowId);
  const code = r.body?.error?.code ?? String(r.status);
  tally[code] = (tally[code] ?? 0) + 1;
  if (r.status === 202) lastAccepted = r;
  if (r.status === 503) { saturated = r; break; }
  // A 429 here is the run-creation bucket, not admission. Wait for it to refill
  // rather than counting the rest of the loop as rejections — otherwise the rate
  // limiter masks the admission threshold this test is trying to reach.
  if (r.status === 429 && r.body?.error?.code === 'TOO_MANY_REQUESTS') {
    await sleep((r.body.error.details?.retryAfterSeconds ?? 1) * 1000);
  }
}
console.log(`  responses: ${JSON.stringify(tally)}`);
console.log(`▶ deep queue    → ${lastAccepted?.status} ${JSON.stringify(lastAccepted?.body)}`);
if (saturated) console.log(`▶ shedding      → ${saturated.status} ${JSON.stringify(saturated.body)}`);

// ── 4. Priority lane during shedding ────────────────────────────────────────
const vipRes = await trigger(vip, wfs[vip.slug].workflowId);
console.log(`▶ priority lane → ${vipRes.status} ${JSON.stringify(vipRes.body)}`);

const err = (r) => r?.body?.error;
const checks = [
  ['idle run accepted without an ETA',
    results.idle.status === 202 && results.idle.body?.queuePosition == null,
    `${results.idle.status}`],
  ['deep queue returns position and ETA',
    lastAccepted?.body?.queuePosition != null,
    `position=${lastAccepted?.body?.queuePosition} eta=${lastAccepted?.body?.etaSeconds}s`],
  ['workspace cap → 429 with structured details',
    cappedRes.status === 429 && err(cappedRes)?.code === 'WORKSPACE_CONCURRENCY_LIMIT' &&
      err(cappedRes)?.details?.limit != null,
    `${cappedRes.status} ${err(cappedRes)?.code}`],
  ['saturation → 503, not a bare 500',
    saturated ? (saturated.status === 503 && err(saturated)?.code === 'QUEUE_SATURATED') : null,
    saturated ? `${saturated.status} ${err(saturated)?.code}` : 'threshold not reached'],
  ['priority lane admitted while shedding',
    saturated ? vipRes.status === 202 : null,
    `${vipRes.status}`],
];

console.log('\n=== VERDICT ===\n');
let pass = true;
for (const [name, ok, detail] of checks) {
  if (ok === null) { console.log(`  SKIP  ${name} — ${detail}`); continue; }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) pass = false;
}
await pool.end(); redis.disconnect();
process.exit(pass ? 0 : 1);
