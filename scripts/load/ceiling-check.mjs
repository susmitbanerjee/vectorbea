#!/usr/bin/env node
/**
 * Do the run-level ceilings actually stop a run, with the right terminal status?
 *
 *   node scripts/load/ceiling-check.mjs
 *
 * Drops one workspace's step ceiling to 3 and runs an 8-turn agent workflow at it.
 * The workflow is well-formed and would succeed; only the ceiling should stop it.
 *
 * Asserts the three things that make a ceiling useful rather than merely present:
 *   - the run reaches a terminal state (not stuck, not retrying forever)
 *   - the status NAMES the dimension, so the UI can offer the right next action
 *   - `ceiling_breached` and the error message say which limit and what to do
 *
 * Requires a worker with RUN_CEILING_USAGE_PROBE_MS default and no RUN_MAX_*
 * overrides, so the per-workspace policy is what binds.
 */
import { newPool, newRedis, sleep } from './lib/env.mjs';
import { LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream } from './seed.mjs';

process.env.LOAD_QUEUE_MODE = 'postgres';
const pool = newPool();
const redis = newRedis();

await resetLoadData(pool);
await resetStream(redis);

const t = await createTenant(pool, 1);
// Ceiling below the workflow's real step count. Everything else left generous so
// only the step dimension can be the one that fires.
await pool.query(
  `INSERT INTO workspace_usage_policies
     (workspace_id, max_steps_per_run, max_active_seconds, max_cost_cents_per_run,
      max_tokens_per_run, max_node_payload_bytes)
   VALUES ($1, 3, 3600, 100000, 100000000, 262144)
   ON CONFLICT (workspace_id) DO UPDATE SET max_steps_per_run = 3`,
  [t.workspaceId]);
console.log(`▶ ${t.slug}: max_steps_per_run = 3`);

const wf = await provisionShape(pool, t, 'agent-iterative-8-turn');
const { runId } = await enqueueRun(pool, redis, t, wf, {});
console.log(`▶ run ${runId} submitted`);

const deadline = Date.now() + 180_000;
let r;
while (Date.now() < deadline) {
  ({ rows: [r] } = await pool.query(
    `SELECT status, ceiling_breached, steps_executed, error_json
       FROM agent_runs WHERE id = $1`, [runId]));
  if (r.status && !['queued', 'claimed', 'running', 'yielded'].includes(r.status)) break;
  await sleep(500);
}

console.log('\n=== RUN CEILING ===\n');
console.log(`  terminal status  : ${r.status}`);
console.log(`  ceiling_breached : ${r.ceiling_breached ?? '(none)'}`);
console.log(`  steps executed   : ${r.steps_executed}`);
console.log(`  error            : ${JSON.stringify(r.error_json)?.slice(0, 260)}`);

const checks = [
  ['reached a terminal state', !['queued','claimed','running','yielded'].includes(r.status), r.status],
  ['status names the dimension', r.status === 'step_limit_exceeded', r.status],
  ['ceiling_breached recorded', r.ceiling_breached === 'steps', String(r.ceiling_breached)],
  ['error is actionable, not generic',
    !!r.error_json && JSON.stringify(r.error_json).includes('exit condition'),
    'message mentions the fix'],
];
console.log('\n=== VERDICT ===\n');
let pass = true;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) pass = false;
}
await pool.end(); redis.disconnect();
process.exit(pass ? 0 : 1);
