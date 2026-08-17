/**
 * The four invariants the chaos suite exists to check.
 *
 * Each is written so that the *absence* of chaos cannot make it pass vacuously:
 * a scenario that never killed anything, or never ran anything, fails rather
 * than reporting a clean sweep. A green run that proves nothing is worse than a
 * red one, because it gets believed.
 */

/**
 * 1. Zero duplicate side effects.
 *
 * Measured from the recorder — actual HTTP requests received — not from the
 * `side_effects` table. The duplicate we care about is by definition the call
 * the worker's own bookkeeping failed to record.
 */
export async function assertNoDuplicateSideEffects(recorderUrl) {
  const res = await fetch(`${recorderUrl}/duplicates`);
  const d = await res.json();

  const failures = [];
  if (d.duplicateCalls > 0) {
    failures.push(
      `${d.duplicateCalls} duplicate side effect(s) across ${d.duplicateKeys} key(s): ` +
      d.details.map((x) => `${x.key} x${x.count}`).join(', '));
  }
  // An unkeyed call cannot be deduped by anything, so it is a defect in itself —
  // it means a side effect went out without passing through the guard.
  if (d.unkeyedCalls > 0) {
    failures.push(`${d.unkeyedCalls} call(s) carried no idempotency key — ` +
      `these bypassed the guard entirely and cannot be deduped`);
  }
  return {
    name: 'zero duplicate side effects',
    passed: failures.length === 0,
    detail: failures.join('; ') ||
      `${d.totalCalls} call(s), all uniquely keyed`,
    metrics: { totalCalls: d.totalCalls, duplicateCalls: d.duplicateCalls },
  };
}

/**
 * 2. Zero lost runs — every run reaches a terminal state.
 *
 * "Terminal" includes `failed`: a run that fails cleanly is not lost. A run
 * still sitting in `running` or `leased` long after the chaos stopped is.
 */
export async function assertNoLostRuns(pool, runIds, graceMs = 0) {
  if (graceMs > 0) await new Promise((r) => setTimeout(r, graceMs));

  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n
       FROM agent_runs WHERE id = ANY($1::uuid[]) GROUP BY status`,
    [runIds],
  );
  const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'enqueue_failed']);
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const stranded = rows.filter((r) => !TERMINAL.has(r.status));
  const strandedCount = stranded.reduce((a, r) => a + r.n, 0);

  return {
    name: 'zero lost runs',
    passed: strandedCount === 0,
    detail: strandedCount === 0
      ? `all ${runIds.length} run(s) terminal: ${JSON.stringify(byStatus)}`
      : `${strandedCount} run(s) never reached a terminal state: ` +
        stranded.map((r) => `${r.status}=${r.n}`).join(', '),
    metrics: { total: runIds.length, byStatus },
  };
}

/**
 * 3. Zero runs stuck leased after recovery.
 *
 * A lease held by a worker that no longer exists, on a run that is not running,
 * is the signature of a crash the recovery path did not clean up. It is the
 * difference between "recovered" and "looks recovered".
 */
export async function assertNoStuckLeases(pool, runIds) {
  const { rows } = await pool.query(
    `SELECT rl.run_id, rl.worker_id, ar.status,
            EXTRACT(EPOCH FROM (rl.expires_at - now()))::int AS expires_in_s
       FROM run_leases rl
       JOIN agent_runs ar ON ar.id = rl.run_id
      WHERE rl.run_id = ANY($1::uuid[])
        AND ar.status IN ('succeeded','failed','cancelled','timed_out')`,
    [runIds],
  );
  return {
    name: 'zero stuck leases',
    passed: rows.length === 0,
    detail: rows.length === 0
      ? 'no leases outlive their terminal runs'
      : `${rows.length} lease(s) held on already-terminal runs: ` +
        rows.map((r) => `${r.run_id.slice(0, 8)}@${r.worker_id}`).join(', '),
    metrics: { stuck: rows.length },
  };
}

/**
 * 4. Checkpoints are monotonic.
 *
 * A run's checkpoint sequence must never go backwards or repeat. Two workers
 * executing the same run concurrently produce exactly that — a duplicated or
 * regressed sequence — so this catches split-brain even when the side effects
 * happen to have been deduped.
 */
export async function assertMonotonicCheckpoints(pool, runIds) {
  const { rows } = await pool.query(
    `SELECT run_id, sequence
       FROM run_checkpoints
      WHERE run_id = ANY($1::uuid[])
      ORDER BY run_id, created_at ASC`,
    [runIds],
  );

  const seen = new Map();
  const violations = [];
  for (const r of rows) {
    const prev = seen.get(r.run_id);
    if (prev !== undefined && r.sequence <= prev) {
      violations.push(`run ${String(r.run_id).slice(0, 8)}: ${prev} → ${r.sequence}`);
    }
    seen.set(r.run_id, r.sequence);
  }

  return {
    name: 'monotonic checkpoints',
    passed: violations.length === 0,
    detail: violations.length === 0
      ? `${rows.length} checkpoint(s) across ${seen.size} run(s), all strictly increasing`
      : `non-monotonic sequences: ${violations.join('; ')}`,
    metrics: { checkpoints: rows.length, violations: violations.length },
  };
}

/**
 * Guard against a vacuous pass.
 *
 * If nothing was killed, or nothing ran, the four assertions above are all
 * trivially true and the suite would report success having tested nothing.
 */
export function assertChaosActuallyHappened(kills, runsStarted, sideEffectCalls) {
  const problems = [];
  if (kills === 0) problems.push('no workers were killed');
  if (runsStarted === 0) problems.push('no runs started');
  if (sideEffectCalls === 0) problems.push('no side effects were attempted');
  return {
    name: 'chaos was actually applied',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `${kills} kill(s), ${runsStarted} run(s), ${sideEffectCalls} side-effect call(s)`
      : `SUITE IS VACUOUS: ${problems.join(', ')}`,
    metrics: { kills, runsStarted, sideEffectCalls },
  };
}

export function renderResults(scenarioName, results) {
  const lines = [`\n── ${scenarioName} ${'─'.repeat(Math.max(0, 56 - scenarioName.length))}`];
  for (const r of results) {
    lines.push(`  ${r.passed ? '✓' : '✗'} ${r.name}`);
    lines.push(`      ${r.detail}`);
  }
  const failed = results.filter((r) => !r.passed).length;
  lines.push(`  ${failed === 0 ? 'PASS' : `FAIL — ${failed} assertion(s)`}`);
  return lines.join('\n');
}
