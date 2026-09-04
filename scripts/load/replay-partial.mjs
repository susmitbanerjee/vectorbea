#!/usr/bin/env node
/**
 * Partial replay, and the hard-fail rule.
 *
 *   node scripts/load/replay-partial.mjs
 *
 * Two behaviours that only matter together:
 *
 *   PARTIAL REPLAY — replay up to a chosen node, then continue live. This is how
 *   a user asks "what if this node had returned something different": everything
 *   before the boundary is the recorded run exactly, everything after is fresh.
 *   Asserted by provider-call count: strictly between zero (full replay) and the
 *   original's count, because only the nodes after the boundary call out.
 *
 *   HARD FAIL — a run with no recording is refused with an explanation, not
 *   quietly executed live. A replay that falls through to the provider costs
 *   money the user was told it would not cost and returns a different answer
 *   while claiming to be faithful. Refusing is the whole design.
 */
import { newPool, newRedis, sleep, mockBaseUrl } from './lib/env.mjs';
import { LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream } from './seed.mjs';

const API = process.env.API_BASE ?? 'http://127.0.0.1:18090';
const MOCK = mockBaseUrl().replace(/\/$/, '');
const pool = newPool();
const redis = newRedis();
process.env.LOAD_QUEUE_MODE = 'postgres';

const calls = async () => {
  const s = (await fetch(`${MOCK}/stats`).then(r => r.json()).catch(() => ({}))).byRoute ?? {};
  return Object.entries(s).filter(([r]) => r.startsWith('/v1/')).reduce((a, [, n]) => a + n, 0);
};
const post = (runId, path, body, t) => fetch(`${API}/api/runs/${runId}/${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json',
             'x-workspace-id': t.workspaceId, 'x-environment-id': t.environmentId },
  body: JSON.stringify(body ?? {}),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

async function waitTerminal(runId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { rows: [r] } = await pool.query(`SELECT status FROM agent_runs WHERE id = $1`, [runId]);
    if (r && !['queued','claimed','running','yielded'].includes(r.status)) return r.status;
    await sleep(300);
  }
  return 'timeout';
}

await resetLoadData(pool);
await resetStream(redis);
await fetch(`${MOCK}/reset`, { method: 'POST' }).catch(() => {});

const t = await createTenant(pool, 1);
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, max_runs_per_day, max_concurrent_runs)
   VALUES ($1, 100000, 8) ON CONFLICT (workspace_id) DO UPDATE
     SET max_runs_per_day = 100000, max_concurrent_runs = 8`, [t.workspaceId]);
const wf = await provisionShape(pool, t, 'agent-iterative-8-turn');

const { runId: originalId } = await enqueueRun(pool, redis, t, wf, {});
await waitTerminal(originalId);
const originalCalls = await calls();
console.log(`▶ original ${originalId}: ${originalCalls} provider calls`);

// Which nodes made model calls, in order — the boundary must be one of them.
const { rows: nodes } = await pool.query(
  `SELECT DISTINCT node_id FROM model_calls WHERE run_id = $1 ORDER BY node_id`, [originalId]);
console.log(`  nodes with recorded calls: ${nodes.map(n => n.node_id).join(', ')}`);
const boundary = nodes[0]?.node_id;

// ── Partial replay ──────────────────────────────────────────────────────────
await fetch(`${MOCK}/reset`, { method: 'POST' }).catch(() => {});
const beforePartial = await calls();
const partial = await post(originalId, 'replay', { untilNode: boundary }, t);
console.log(`▶ partial replay until '${boundary}' → ${partial.status}`);
const partialStatus = await waitTerminal(partial.body?.runId);
const partialCalls = (await calls()) - beforePartial;
console.log(`  status=${partialStatus} providerCalls=${partialCalls}`);

// ── Hard fail on an unrecorded run ──────────────────────────────────────────
// A run row with no model_calls: exactly the shape of a run executed before
// recording existed.
const { rows: [bare] } = await pool.query(
  `INSERT INTO agent_runs (workspace_id, environment_id, workflow_id, workflow_version_id,
                           status, trigger_type, input_json, execution_class)
   VALUES ($1,$2,$3,$4,'succeeded','manual','{}','agent') RETURNING id`,
  [t.workspaceId, t.environmentId, wf.workflowId, wf.versionId]);
const refused = await post(bare.id, 'replay', {}, t);
console.log(`▶ replay of an unrecorded run → ${refused.status} ${refused.body?.error?.code ?? ''}`);

// ── Re-run is the honest name for the old behaviour ─────────────────────────
await fetch(`${MOCK}/reset`, { method: 'POST' }).catch(() => {});
const beforeRerun = await calls();
const rerun = await post(originalId, 'rerun', {}, t);
const rerunStatus = await waitTerminal(rerun.body?.runId);
const rerunCalls = (await calls()) - beforeRerun;
console.log(`▶ rerun → ${rerun.status} status=${rerunStatus} providerCalls=${rerunCalls}`);

const checks = [
  ['partial replay accepted', partial.status === 202, String(partial.status)],
  ['partial replay makes SOME calls but fewer than the original',
    partialCalls > 0 && partialCalls < originalCalls,
    `${partialCalls} vs ${originalCalls} original`],
  ['partial replay completes', partialStatus === 'succeeded', partialStatus],
  ['unrecorded run refused, not executed live',
    refused.status === 422 && refused.body?.error?.code === 'UNPROCESSABLE_ENTITY',
    `${refused.status} ${refused.body?.error?.code}`],
  ['rerun calls providers for real', rerunCalls >= originalCalls,
    `${rerunCalls} vs ${originalCalls} original`],
];
console.log('\n=== VERDICT ===\n');
let pass = true;
for (const [n, ok, d] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n} — ${d}`); if (!ok) pass = false; }
await pool.end(); redis.disconnect();
process.exit(pass ? 0 : 1);
