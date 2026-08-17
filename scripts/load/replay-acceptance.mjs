#!/usr/bin/env node
/**
 * THE acceptance test for replay.
 *
 *   node scripts/load/replay-acceptance.mjs
 *
 * From docs/architecture/07-AGENT-RELIABILITY.md §2:
 *
 *   "A replayed run must produce byte-identical output to the original — that is
 *    the test."
 *
 * So this executes a run, replays it, and asserts four things. Any one of them
 * failing means the product does not have replay, whatever the button says:
 *
 *   1. BYTE-IDENTICAL OUTPUT at every node. Not "equivalent", not "same shape" —
 *      the same bytes. Compared per node so a failure names which node diverged
 *      rather than just saying the run differs.
 *   2. ZERO PROVIDER CALLS. Read from the mock upstream's own counter, not from
 *      our metrics: the question is whether a packet left the worker, and only
 *      the far end can answer that honestly.
 *   3. ZERO SIDE EFFECTS. No new rows in `side_effects` for the replay run.
 *   4. ZERO COST. `cost_cents` and `tokens_used` on the replay run are 0.
 *
 * Written before the replay engine existed, so its first run failed for the right
 * reason: the original "replay" re-executed everything. See REPLAY-AUDIT.md.
 */

import { CONFIG, newPool, newRedis, sleep, mockBaseUrl } from './lib/env.mjs';
import {
  LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream,
} from './seed.mjs';

const API = process.env.API_BASE ?? 'http://127.0.0.1:18090';
const MOCK = mockBaseUrl().replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.REPLAY_TIMEOUT_MS ?? 180_000);

const pool = newPool();
const redis = newRedis();

const mockStats = async () =>
  (await fetch(`${MOCK}/stats`).then((r) => r.json()).catch(() => ({ byRoute: {} }))).byRoute ?? {};
const providerCalls = (s) =>
  Object.entries(s)
    .filter(([route]) => route.startsWith('/v1/'))
    .reduce((a, [, n]) => a + n, 0);

async function waitTerminal(runId, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows: [r] } = await pool.query(
      `SELECT status, cost_cents, tokens_used FROM agent_runs WHERE id = $1`, [runId]);
    if (r && !['queued', 'claimed', 'running', 'yielded'].includes(r.status)) return r;
    await sleep(300);
  }
  throw new Error(`${label} run ${runId} never reached a terminal state`);
}

/** Every node's output, as stored, keyed by node id. The thing being compared. */
async function nodeOutputs(runId) {
  const { rows } = await pool.query(
    `SELECT node_id, raw_output_json_sanitized AS raw
       FROM step_outputs WHERE run_id = $1 ORDER BY node_id`, [runId]);
  return new Map(rows.map((r) => [r.node_id, JSON.stringify(r.raw)]));
}

async function sideEffectCount(runId) {
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int AS n FROM side_effects WHERE run_id = $1`, [runId]);
  return r.n;
}

// ── Original run ────────────────────────────────────────────────────────────
console.log('▶ resetting …');
await resetLoadData(pool);
await resetStream(redis);
await fetch(`${MOCK}/reset`, { method: 'POST' }).catch(() => {});

const tenant = await createTenant(pool, 1);
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, max_runs_per_day, max_concurrent_runs)
   VALUES ($1, 100000, 8)
   ON CONFLICT (workspace_id) DO UPDATE SET max_runs_per_day = 100000, max_concurrent_runs = 8`,
  [tenant.workspaceId]);
const wf = await provisionShape(pool, tenant, 'agent-iterative-8-turn');

process.env.LOAD_QUEUE_MODE = 'postgres';
const { runId: originalId } = await enqueueRun(pool, redis, tenant, wf, { acceptance: true });
console.log(`▶ original run ${originalId} …`);
const original = await waitTerminal(originalId, 'original');
const originalOutputs = await nodeOutputs(originalId);
const statsAfterOriginal = await mockStats();
const callsDuringOriginal = providerCalls(statsAfterOriginal);

console.log(`  status=${original.status} nodes=${originalOutputs.size} ` +
  `providerCalls=${callsDuringOriginal} cost=${original.cost_cents}c tokens=${original.tokens_used}`);

if (callsDuringOriginal === 0) {
  console.error('\nFAIL: the original run made zero provider calls, so this test would ' +
    'pass trivially. The workflow is not exercising a model — fix the fixture.');
  process.exit(1);
}

const { rows: [mc] } = await pool.query(
  `SELECT count(*)::int AS n FROM model_calls WHERE run_id = $1`, [originalId]);
console.log(`  model_calls recorded: ${mc.n}`);

// ── Replay ──────────────────────────────────────────────────────────────────
await fetch(`${MOCK}/reset`, { method: 'POST' }).catch(() => {});
const before = providerCalls(await mockStats());

const res = await fetch(`${API}/api/runs/${originalId}/replay`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-workspace-id': tenant.workspaceId,
    'x-environment-id': tenant.environmentId,
  },
  body: '{}',
});
const body = await res.json().catch(() => null);
if (res.status !== 202) {
  console.error(`\nFAIL: replay returned ${res.status}: ${JSON.stringify(body)}`);
  process.exit(1);
}
const replayId = body.runId;
console.log(`▶ replay run ${replayId} …`);

const replay = await waitTerminal(replayId, 'replay');
const replayOutputs = await nodeOutputs(replayId);
const callsDuringReplay = providerCalls(await mockStats()) - before;
const replaySideEffects = await sideEffectCount(replayId);

console.log(`  status=${replay.status} nodes=${replayOutputs.size} ` +
  `providerCalls=${callsDuringReplay} cost=${replay.cost_cents}c tokens=${replay.tokens_used}`);

// ── Assertions ──────────────────────────────────────────────────────────────
const diverged = [];
for (const [nodeId, out] of originalOutputs) {
  const got = replayOutputs.get(nodeId);
  if (got !== out) diverged.push({ nodeId, expected: out, got: got ?? '(node not executed)' });
}
const missing = [...originalOutputs.keys()].filter((n) => !replayOutputs.has(n));
const extra = [...replayOutputs.keys()].filter((n) => !originalOutputs.has(n));

console.log('\n=== REPLAY ACCEPTANCE ===\n');
console.log(`  nodes in original : ${originalOutputs.size}`);
console.log(`  nodes in replay   : ${replayOutputs.size}`);
console.log(`  diverged nodes    : ${diverged.length}`);
if (diverged.length) {
  for (const d of diverged.slice(0, 3)) {
    console.log(`    ${d.nodeId}:`);
    console.log(`      original: ${String(d.expected).slice(0, 160)}`);
    console.log(`      replay  : ${String(d.got).slice(0, 160)}`);
  }
}
if (missing.length) console.log(`  missing in replay : ${missing.join(', ')}`);
if (extra.length) console.log(`  extra in replay   : ${extra.join(', ')}`);

const checks = [
  ['byte-identical output at every node',
    diverged.length === 0 && missing.length === 0 && extra.length === 0,
    `${originalOutputs.size} nodes, ${diverged.length} diverged`],
  ['zero provider calls during replay', callsDuringReplay === 0, `${callsDuringReplay} calls`],
  ['zero side effects during replay', replaySideEffects === 0, `${replaySideEffects} side effects`],
  ['zero cost', (replay.cost_cents ?? 0) === 0 && (replay.tokens_used ?? 0) === 0,
    `${replay.cost_cents}c / ${replay.tokens_used} tokens`],
  ['replay reached the same terminal status', replay.status === original.status,
    `${replay.status} vs ${original.status}`],
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
