#!/usr/bin/env node
/**
 * Claim latency and wakeup source, straight from the worker's own histogram.
 *
 *   node scripts/load/claim-latency.mjs [port ...]
 *
 * Two numbers decide whether the Postgres claim is viable at all:
 *
 *   p95 claim duration — the SKIP LOCKED round trip. §3 sets the bar at 100ms.
 *                        Above it, the claim is the bottleneck rather than the
 *                        work, and every wakeup costs more than it collects.
 *   notify ÷ safety_poll — near-zero notifications while safety polls climb is
 *                        the pooler trap: LISTEN was silently dropped and the
 *                        system is running on the 2s fallback while still
 *                        looking event-driven from the outside.
 */

import { CONFIG } from './lib/env.mjs';
import { histogramQuantile, scrapeFleet, value } from './lib/metrics.mjs';

const ports = process.argv.slice(2).map(Number).filter(Number.isFinite);
const samples = await scrapeFleet(ports.length ? ports : [CONFIG.metricsPort]);

const ms = (v) => (v == null ? '—' : `${(v * 1000).toFixed(1)}ms`);

console.log('\n=== CLAIM LATENCY ===\n');
console.log('| Class | claims | p50 | p95 | p99 | budget |');
console.log('|---|---|---|---|---|---|');

let worstP95 = 0;
for (const cls of ['short', 'long', 'agent', 'system']) {
  const n = value(samples, 'claim_duration_seconds_count', { class: cls });
  if (!n) continue;
  // Renamed from `claim_duration_seconds` when the §5.4 metric set was aligned —
  // the doc calls this `job_claim_latency_seconds` and the dashboards and the
  // SystemSaturated alert both query that name. This script measured nothing between
  // the rename and this fix, which is exactly the failure `verify-metrics.mjs` exists
  // to catch and did not, because it checks the endpoint rather than the consumers.
  const p = (q) => histogramQuantile(samples, 'job_claim_latency_seconds', { class: cls }, q);
  const p95 = p(0.95);
  if (p95 != null) worstP95 = Math.max(worstP95, p95);
  console.log(`| ${cls} | ${n} | ${ms(p(0.5))} | ${ms(p95)} | ${ms(p(0.99))} | ${p95 != null && p95 < 0.1 ? 'PASS' : 'FAIL'} |`);
}

console.log(`\nworst p95 across classes: ${ms(worstP95)} — ${worstP95 < 0.1 ? 'under' : 'OVER'} the 100ms budget`);

const notify = value(samples, 'claim_wakeup_total', { source: 'notify' });
const poll = value(samples, 'claim_wakeup_total', { source: 'safety_poll' });
const claimed = value(samples, 'claimed_total');
const reserved = value(samples, 'claim_reserved_lane_total');
const reclaimed = value(samples, 'claim_reclaimed_total');

console.log(`\nwakeups   : notify=${notify} safety_poll=${poll}`);
console.log(`claims    : claimed=${claimed} from-reserved-lane=${reserved} reclaimed-stale=${reclaimed}`);
console.log(notify > 0
  ? '  LISTEN is delivering — the claim is event-driven.'
  : '  WARNING: zero notifications. LISTEN is dead; the claim is running on the safety poll alone.');
