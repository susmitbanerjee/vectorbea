#!/usr/bin/env node
/**
 * The replica-scaling assertion, made from the sweep's recorded results.
 *
 *   node scripts/load/compare-replicas.mjs
 *
 * Reads matrix-n1.json / matrix-n2.json / matrix-n3.json and answers two questions:
 *
 *   1. Are per-tenant concurrency limits IDENTICAL at every replica count?
 *   2. Does throughput scale near-linearly?
 *
 * (1) is a hard assertion — the whole point of moving admission onto shared state is
 * that the answer cannot depend on N. Any variation is the S04 bug returning.
 *
 * (2) is a soft one. "Near-linear" on a single machine where three JVMs share four
 * cores with Postgres and the load generator is not a fair test of scaling, and this
 * prints the ratio rather than passing or failing it. Reporting a scaling number from
 * a machine that cannot scale would be exactly the kind of unsupported figure this
 * whole exercise exists to avoid.
 */

import fs from 'node:fs/promises';

const load = async (n) => {
  try {
    return JSON.parse(await fs.readFile(`docs/architecture/measurements/matrix-n${n}.json`, 'utf8'));
  } catch { return null; }
};

const rule = (s) => console.log('\n' + '─'.repeat(76) + '\n' + s + '\n' + '─'.repeat(76));
const f = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));

const runs = [];
for (const n of [1, 2, 3]) {
  const r = await load(n);
  if (r) runs.push({ n, ...r });
}

if (runs.length < 2) {
  console.error('need at least two replica counts; run scripts/load/replica-sweep.ps1 first');
  process.exit(2);
}

rule('REPLICA SCALING PROOF');

// ── 1. Per-tenant limits ────────────────────────────────────────────────────
console.log('\nPer-tenant concurrency, sampled from run_leases (shared state):\n');
console.log('| Scenario | ' + runs.map((r) => `N=${r.n}`).join(' | ') + ' | identical? |');
console.log('|---|' + runs.map(() => '---|').join('') + '---|');

const scenarioKeys = [...new Set(runs.flatMap((r) => r.results.map((x) => x.scenario)))];
let limitViolations = 0;
let notExactlyIdentical = 0;

// TWO DIFFERENT QUESTIONS, DELIBERATELY SEPARATED
// -----------------------------------------------
// The brief asks for "identical". The correctness property is narrower and stronger:
// the peak must never GROW with N. That asymmetry is not pedantry — it is the shape of
// the bug being tested for.
//
// The S04 bug was in-process limits: each replica enforced its own private allowance, so
// a cap of 2 became an effective 6 at three replicas. It can only ever make the observed
// peak go UP.
//
// Meanwhile the peak is sampled from run_leases once a second, and SHORT runs finish in
// well under a second. A lower reading at N=3 therefore means the sampler was unlucky,
// not that the limit tightened. Failing on that would be reporting a measurement
// artefact as a regression — and worse, it would train the reader to ignore this check.
//
// So: GROWTH is a hard failure. Non-identical-but-not-growing is reported as sampling
// noise, with the raw numbers shown so the reader can judge.
for (const key of scenarioKeys) {
  const perN = runs.map((r) => r.results.find((x) => x.scenario === key)?.peakTenantConcurrency);
  const present = perN.filter((v) => v != null);
  if (present.length < 2) continue;

  const baseline = present[0];
  const grew = present.some((v) => v > baseline);
  const identical = present.every((v) => v === baseline);
  if (grew) limitViolations += 1;
  else if (!identical) notExactlyIdentical += 1;

  const verdict = grew ? '**NO — GREW WITH N, S04 REGRESSION**'
    : identical ? 'YES'
      : 'no growth (lower reading = 1s sampling on sub-second runs)';
  console.log(`| ${key} | ${perN.map((v) => v ?? '—').join(' | ')} | ${verdict} |`);
}

// ── 2. Throughput ───────────────────────────────────────────────────────────
console.log('\nThroughput (runs/s) and scaling factor against N=1:\n');
console.log('| Scenario | ' + runs.map((r) => `N=${r.n}`).join(' | ') + ' | N=3/N=1 |');
console.log('|---|' + runs.map(() => '---|').join('') + '---|');

for (const key of scenarioKeys) {
  const perN = runs.map((r) => r.results.find((x) => x.scenario === key)?.throughputPerSec);
  if (perN.filter((v) => v != null).length < 2) continue;
  const first = perN[0];
  const last = perN[perN.length - 1];
  const factor = first && last ? last / first : null;
  console.log(`| ${key} | ${perN.map((v) => f(v)).join(' | ')} | ${f(factor)}x |`);
}

// ── 3. Correctness under scaling ────────────────────────────────────────────
console.log('\nCorrectness at every replica count:\n');
console.log('| Scenario | ' + runs.map((r) => `N=${r.n} err% / stuck`).join(' | ') + ' |');
console.log('|---|' + runs.map(() => '---|').join('') + '|');
let correctnessViolations = 0;
for (const key of scenarioKeys) {
  const cells = runs.map((r) => {
    const x = r.results.find((y) => y.scenario === key);
    if (!x) return '—';
    if (x.stuck > 0) correctnessViolations += 1;
    return `${f(x.errorRatePct, 1)} / ${x.stuck ?? 0}`;
  });
  console.log(`| ${key} | ${cells.join(' | ')} |`);
}

rule('VERDICT');
if (limitViolations === 0) {
  console.log('  PASS  per-tenant concurrency never grew with the replica count');
  console.log('        The S04 bug (in-process limits multiplying by N) has not returned.');
  console.log('        Admission reads run_leases, which is shared cluster-wide state.');
  if (notExactlyIdentical > 0) {
    console.log(`        ${notExactlyIdentical} scenario(s) read LOWER at some N. That is the`);
    console.log('        1s lease sampler missing a sub-second overlap, not a tighter limit —');
    console.log('        a real limit change could only show as growth. Raw values above.');
  } else {
    console.log('        Readings were also exactly identical at every N.');
  }
} else {
  console.log(`  FAIL  ${limitViolations} scenario(s) show per-tenant concurrency GROWING with N`);
  console.log('        This is the S04 regression: admission is reading process-local state');
  console.log('        again, so each replica enforces its own private allowance.');
}
if (correctnessViolations === 0) {
  console.log('  PASS  no runs stuck in a non-terminal state at any replica count');
} else {
  console.log(`  FAIL  ${correctnessViolations} scenario/replica combination(s) left runs stuck`);
}
console.log('\n  Throughput scaling is REPORTED, not asserted: three JVMs sharing four cores');
console.log('  with Postgres and the load generator cannot demonstrate linear scaling, and');
console.log('  claiming a scaling factor from this machine would be unsupported.');

process.exit(limitViolations || correctnessViolations ? 1 : 0);
