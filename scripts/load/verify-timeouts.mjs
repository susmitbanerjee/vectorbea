#!/usr/bin/env node
/**
 * Focused regression check for the two failures TIMEOUT-AUDIT.md is about.
 *
 * These are the cases where the *old* code did not merely run slowly — it never
 * returned. Each asserts a bound, not just an eventual failure, because
 * "eventually failed" is what an unbounded call looks like when you stop
 * watching.
 *
 *   1. tool-stall     — the upstream sends 200 headers and then never sends the
 *                       body. `HttpRequest.timeout()` is already satisfied at
 *                       that point, so only a total-call ceiling can end it.
 *
 *   2. tenant-db-hang — the tenant database completes the TCP handshake and then
 *                       never answers. `Statement.setQueryTimeout` cannot end it
 *                       (pgjdbc's cancel needs a second connection to the same
 *                       dead host), so only driver-level socketTimeout can.
 *
 *   node scripts/load/verify-timeouts.mjs
 */

import { CONFIG, newPool, newRedis, sleep } from './lib/env.mjs';
import { createTenant, enqueueRun, fetchRunOutcomes, provisionShape, resetLoadData, resetStream } from './seed.mjs';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'completed', 'error']);

async function runOne(pool, redis, shape, opts, hardCapMs) {
  const tenant = await createTenant(pool, 1);
  const workflow = await provisionShape(pool, tenant, shape, opts);
  const enq = await enqueueRun(pool, redis, tenant, workflow, {});

  const startedAt = Date.now();
  let outcome = null;
  while (Date.now() - startedAt < hardCapMs) {
    const [row] = await fetchRunOutcomes(pool, [enq.runId]);
    if (row && TERMINAL.has(row.status)) { outcome = row; break; }
    await sleep(250);
  }
  return { outcome, elapsedMs: Date.now() - startedAt };
}

function report(label, { outcome, elapsedMs }, expectMinMs, expectMaxMs) {
  const secs = (elapsedMs / 1000).toFixed(1);
  if (!outcome) {
    console.log(`  ✗ ${label}: NEVER reached a terminal state within ${secs}s — the call is unbounded`);
    return false;
  }
  const reason = outcome.error_json
    ? String(typeof outcome.error_json === 'string' ? outcome.error_json : JSON.stringify(outcome.error_json)).slice(0, 200)
    : '(no error recorded)';
  const withinBound = elapsedMs <= expectMaxMs;
  const notInstant = elapsedMs >= expectMinMs;
  const ok = outcome.status === 'failed' && withinBound && notInstant;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${outcome.status} after ${secs}s ` +
    `(expected failure between ${expectMinMs / 1000}s and ${expectMaxMs / 1000}s)`);
  console.log(`      reason: ${reason}`);
  if (!withinBound) console.log('      ✗ exceeded its bound — the timeout did not fire');
  if (!notInstant) console.log('      ! returned faster than expected — check the mock is actually stalling');
  return ok;
}

async function main() {
  const pool = newPool();
  const redis = newRedis();
  let allOk = true;

  try {
    console.log('\nTimeout regression checks');
    console.log('=========================');

    console.log('\n1. HTTP tool whose upstream sends headers then stalls the body');
    await resetLoadData(pool);
    await resetStream(redis);
    await sleep(1_000);
    // Node timeout 15s; allow 45s of slack for dispatch before calling it unbounded.
    allOk = report('tool-stall',
      await runOne(pool, redis, 'tool-stall', { timeoutMs: 15_000 }, 90_000),
      10_000, 45_000) && allOk;

    console.log('\n2. Tenant database that accepts TCP and never responds');
    await resetLoadData(pool);
    await resetStream(redis);
    await sleep(1_000);
    // socketTimeout is 30s by default; allow 60s before calling it unbounded.
    allOk = report('tenant-db-hang',
      await runOne(pool, redis, 'tenant-db-hang', { hangDbPort: CONFIG.hangDbPort }, 120_000),
      3_000, 60_000) && allOk;

    console.log(`\n${allOk ? 'PASS — both calls are bounded.' : 'FAIL — see above.'}\n`);
    if (!allOk) process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
