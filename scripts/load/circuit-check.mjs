#!/usr/bin/env node
/**
 * Does the circuit breaker open, fail fast, and surface as unhealthy?
 *
 *   node scripts/load/circuit-check.mjs
 *
 * Points an LLM connection at a closed port so every call fails at connect, then
 * submits runs one at a time and watches `connections.circuit_state`.
 *
 * The measurement that matters is the LATENCY of the failures after the circuit
 * opens. A breaker that opens but still takes the full timeout to say so has
 * saved nothing — the whole point is converting a slow failure into a fast one.
 */
import { newPool, newRedis, sleep } from './lib/env.mjs';
import { LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream } from './seed.mjs';

process.env.LOAD_QUEUE_MODE = 'postgres';
const pool = newPool();
const redis = newRedis();

await resetLoadData(pool);
await resetStream(redis);

const t = await createTenant(pool, 1);
// Generous ceilings — only the connection should be able to stop these runs.
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, max_concurrent_runs, max_concurrent_agent_runs)
   VALUES ($1, 8, 8) ON CONFLICT (workspace_id) DO UPDATE
     SET max_concurrent_runs = 8, max_concurrent_agent_runs = 8`, [t.workspaceId]);

const wf = await provisionShape(pool, t, 'agent-iterative-8-turn');

// Repoint the LLM connection at a port nothing is listening on. Connect fails
// fast here (RST on loopback) rather than hanging, which is fine: the breaker is
// counting failures, not measuring them.
await pool.query(
  `UPDATE connections SET config_json = jsonb_set(config_json, '{baseUrl}', '"http://127.0.0.1:9"')
    WHERE workspace_id = $1 AND type = 'llm'`, [t.workspaceId]);
console.log('▶ LLM connection repointed at a dead port');

const timings = [];
for (let i = 0; i < 9; i++) {
  const t0 = Date.now();
  const { runId } = await enqueueRun(pool, redis, t, wf, { i });
  const deadline = Date.now() + 90_000;
  let r;
  while (Date.now() < deadline) {
    ({ rows: [r] } = await pool.query(
      `SELECT status, error_json FROM agent_runs WHERE id = $1`, [runId]));
    if (r && !['queued', 'claimed', 'running', 'yielded'].includes(r.status)) break;
    await sleep(200);
  }
  const ms = Date.now() - t0;
  const { rows: [c] } = await pool.query(
    `SELECT circuit_state, consecutive_failures, network_status
       FROM connections WHERE workspace_id = $1 AND type = 'llm'`, [t.workspaceId]);
  timings.push({ i, ms, state: c?.circuit_state, failures: c?.consecutive_failures,
                 network: c?.network_status,
                 fastFail: JSON.stringify(r?.error_json ?? '').includes('temporarily unavailable') });
  console.log(`  run ${i}: ${ms}ms · circuit=${c?.circuit_state} failures=${c?.consecutive_failures}` +
    (timings.at(-1).fastFail ? ' · rejected by breaker' : ''));
}

const opened = timings.find((x) => x.state === 'open');
const beforeOpen = timings.filter((x) => !x.fastFail);
const afterOpen = timings.filter((x) => x.fastFail);
const avg = (xs) => (xs.length ? xs.reduce((a, x) => a + x.ms, 0) / xs.length : null);

console.log('\n=== CIRCUIT BREAKER ===\n');
console.log(`  opened after        : ${opened ? `${opened.i + 1} runs` : 'never opened'}`);
console.log(`  network_status      : ${timings.at(-1).network}`);
console.log(`  avg latency, closed : ${avg(beforeOpen)?.toFixed(0) ?? '—'}ms (${beforeOpen.length} runs)`);
console.log(`  avg latency, open   : ${avg(afterOpen)?.toFixed(0) ?? '—'}ms (${afterOpen.length} runs)`);

const checks = [
  ['circuit opened', !!opened, opened ? `after ${opened.i + 1} runs` : 'no'],
  ['connection marked unhealthy', timings.at(-1).network === 'unhealthy', String(timings.at(-1).network)],
  ['calls rejected fast once open', afterOpen.length > 0, `${afterOpen.length} rejected by breaker`],
];
console.log('\n=== VERDICT ===\n');
let pass = true;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) pass = false;
}
await pool.end(); redis.disconnect();
process.exit(pass ? 0 : 1);
