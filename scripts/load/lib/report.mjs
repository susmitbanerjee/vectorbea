/**
 * Turns a scenario's raw observations into the four numbers that decide whether
 * the scheduler is behaving:
 *
 *   throughput               runs completed per second
 *   wait-before-start        p50/p95/p99, measured XADD → RUN_STARTED
 *   per-tenant fairness      best-served ÷ worst-served, by completed count
 *   peak PEL depth           the high-water mark of messages this worker held
 *                            unacked — i.e. work no other worker could take
 *
 * Wait-before-start is computed twice: once from `run_events` (exact, per run)
 * and once from the worker's own histogram (bucketed). The exact figures are
 * what the report leads with; the histogram is retained as a cross-check that
 * the metric an operator would page on agrees with reality.
 */

/** Exact percentile from raw samples — nearest-rank, no interpolation. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarize(values) {
  const s = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return { n: 0 };
  return {
    n: s.length,
    min: s[0],
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

/**
 * best-served ÷ worst-served, over tenants that submitted work.
 *
 * 1.0 is perfect fairness. A tenant that completed nothing while another
 * completed n makes the ratio unbounded; that is reported as `Infinity` rather
 * than silently clamped, because "one tenant got zero" is the finding.
 */
export function fairnessRatio(completedByTenant) {
  const counts = Object.values(completedByTenant);
  if (counts.length === 0) return null;
  const best = Math.max(...counts);
  const worst = Math.min(...counts);
  if (worst === 0) return best === 0 ? 1 : Infinity;
  return best / worst;
}

export function formatSeconds(v) {
  if (v == null) return '—';
  if (!Number.isFinite(v)) return '∞';
  if (v < 1) return `${(v * 1000).toFixed(0)}ms`;
  return `${v.toFixed(2)}s`;
}

export function renderScenarioReport(r) {
  const lines = [];
  const w = r.wait ?? {};
  lines.push('');
  lines.push(`── ${r.name} ${'─'.repeat(Math.max(0, 60 - r.name.length))}`);
  lines.push(`  ${r.description}`);
  lines.push('');
  lines.push(`  tenants                 : ${r.tenantCount}`);
  lines.push(`  runs enqueued           : ${r.enqueued}`);
  lines.push(`  runs completed          : ${r.completed}  (succeeded=${r.succeeded} failed=${r.failed})`);
  lines.push(`  wall clock              : ${(r.wallClockMs / 1000).toFixed(1)}s`);
  lines.push(`  throughput              : ${r.throughputPerSec.toFixed(3)} runs/s`);
  lines.push(`  wait before start p50   : ${formatSeconds(w.p50)}`);
  lines.push(`  wait before start p95   : ${formatSeconds(w.p95)}`);
  lines.push(`  wait before start p99   : ${formatSeconds(w.p99)}`);
  lines.push(`  wait before start max   : ${formatSeconds(w.max)}`);
  lines.push(`  fairness (best÷worst)   : ${r.fairness == null ? '—' : (Number.isFinite(r.fairness) ? r.fairness.toFixed(2) : '∞ (a tenant completed nothing)')}`);
  lines.push(`  peak PEL depth          : ${r.peakPelDepth}`);
  lines.push(`  peak slots active       : ${Object.entries(r.peakSlotsActive).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  lines.push(`  tenant throttles        : ${r.throttled}`);
  lines.push(`  replicas                : ${r.replicas ?? 1}`);
  lines.push(`  peak tenant concurrency : total=${r.peakTenantConcurrency ?? '—'} per-class=${r.peakTenantClassConcurrency ?? '—'} (from run_leases)`);
  lines.push(`  admission overshoot     : ${r.admissionOvershoot ?? 0}`);
  lines.push(`  tenant-db peak active   : ${r.peakTenantDbActive ?? 0} (queue ${r.peakTenantDbQueue ?? 0}, rejected ${r.tenantDbRejected ?? 0})`);
  lines.push(`  jvm peak threads / heap : ${r.peakJvmThreads ?? '—'} threads, ${r.peakHeapMb ?? '—'} MB, ${r.cpuSeconds ?? '—'}s CPU`);
  if (r.notes?.length) {
    lines.push('');
    for (const n of r.notes) lines.push(`  · ${n}`);
  }
  return lines.join('\n');
}

/** Markdown row for the consolidated baseline table. */
export function markdownRow(r) {
  const w = r.wait ?? {};
  const fair = r.fairness == null ? '—'
    : Number.isFinite(r.fairness) ? r.fairness.toFixed(2) : '∞';
  return `| ${r.name} | ${r.tenantCount} | ${r.enqueued} | ${r.completed} | ` +
    `${r.throughputPerSec.toFixed(3)} | ${formatSeconds(w.p50)} | ${formatSeconds(w.p95)} | ` +
    `${formatSeconds(w.p99)} | ${fair} | ${r.peakPelDepth} |`;
}

export const MARKDOWN_HEADER = [
  '| Scenario | Tenants | Enqueued | Completed | Throughput (runs/s) | Wait p50 | Wait p95 | Wait p99 | Fairness | Peak PEL |',
  '|---|---|---|---|---|---|---|---|---|---|',
].join('\n');
