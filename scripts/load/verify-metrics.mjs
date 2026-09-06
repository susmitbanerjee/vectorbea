#!/usr/bin/env node
/**
 * Prove every metric §5.4 names is actually emitted — by scraping, not by reading code.
 *
 *   node scripts/load/verify-metrics.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The worker's `scrape()` builds its output from a hand-written list of metric objects.
 * A metric can be declared, incremented at a real call site, and still never appear on
 * the endpoint because nobody added it to that list. Reading the code shows the
 * declaration and the call site and gives you every reason to believe it works.
 *
 * That is the exact failure this checks for, so it checks the bytes on the wire.
 *
 * ON EMPTY SERIES
 * ---------------
 * A counter that has never been incremented still exposes its HELP/TYPE header and a
 * zero sample, which is what makes presence checkable on a fresh process. `dead_letter_total`
 * SHOULD be zero — the check is that the series exists, so that a dashboard panel reads
 * "0" rather than "No data", which look identical at a glance and mean opposite things.
 */

const API_METRICS = process.env.API_METRICS ?? 'http://127.0.0.1:18090/metrics';
const WORKER_METRICS = process.env.WORKER_METRICS ?? 'http://127.0.0.1:9090/metrics';

/** Everything §5.4 lists, with where it must come from and the labels it must carry. */
const REQUIRED = [
  { name: 'job_queue_depth',               source: 'worker', labels: ['workspace', 'priority'] },
  { name: 'job_claim_latency_seconds',     source: 'worker', histogram: true },
  { name: 'job_execution_duration_seconds', source: 'worker', histogram: true, labels: ['node_kind'] },
  { name: 'worker_in_flight',              source: 'worker', labels: ['worker_id'] },
  { name: 'worker_slots_available',        source: 'worker' },
  { name: 'lease_expiry_total',            source: 'worker' },
  { name: 'dead_letter_total',             source: 'worker' },
  { name: 'side_effect_dedupe_total',      source: 'worker' },
  { name: 'db_pool_wait_seconds',          source: 'either', histogram: true },
  { name: 'provider_429_total',            source: 'worker', labels: ['provider'] },
  { name: 'run_suspended_total',           source: 'worker' },

  // ── Scheduled-job health ───────────────────────────────────────────────────
  //
  // These are checked on BOTH services because the loops are split across them —
  // five in the worker, two in the API — and a registry that renders on one but not
  // the other is exactly the bug this harness exists for. The worker in particular
  // did not render the shared `observability.metrics` registry at all until the job
  // work landed: a metric could be registered, incremented on every pass, and never
  // appear on the wire.
  //
  // `job_last_success_timestamp_seconds` is the series the ScheduledJobStale alert
  // evaluates. If it is absent the alert cannot fire, and a job that stops is silent
  // again — which is the failure the whole exercise was meant to close.
  { name: 'job_last_success_timestamp_seconds', source: 'either', labels: ['job_name'] },
  { name: 'job_expected_interval_seconds',      source: 'either', labels: ['job_name'] },
  { name: 'job_runs_total',                     source: 'either', labels: ['job_name', 'outcome'] },
  { name: 'job_duration_seconds',               source: 'either', histogram: true, labels: ['job_name'] },

  // ── Provider capacity ──────────────────────────────────────────────────────
  //
  // The Provider capacity dashboard is built entirely on these. They were emitted
  // long before anything rendered them, so their presence has never actually been
  // confirmed against a live scrape.
  { name: 'provider_429_received_total',        source: 'worker', labels: ['provider'] },
  { name: 'provider_429_after_admit_total',     source: 'worker', labels: ['provider'] },
  { name: 'provider_capacity_exhausted_total',  source: 'worker', labels: ['provider'] },
  { name: 'provider_capacity_utilisation',      source: 'worker', histogram: true },
  { name: 'provider_estimate_error_ratio',      source: 'worker', histogram: true },

  // ── Trace pipeline ─────────────────────────────────────────────────────────
  { name: 'worker_run_events_dropped_total',    source: 'worker' },
  { name: 'worker_trace_spans_dropped_total',   source: 'worker' },
  { name: 'worker_trace_exports_dropped_total', source: 'worker' },
];

async function scrape(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, body: '' };
    return { ok: true, body: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e), body: '' };
  }
}

/**
 * Presence is checked against the TYPE header, not against a sample line.
 *
 * A sample line for a labelled metric only exists once some code path has produced that
 * label set, so checking samples would make this fail on a freshly started process for
 * metrics that are working perfectly. The TYPE header is emitted by the registry the
 * moment the metric is registered and rendered, which is precisely the property under
 * test: does this metric reach the endpoint at all.
 */
function findMetric(body, name) {
  const typeLine = new RegExp(`^# TYPE ${name} (\\w+)$`, 'm').exec(body);
  if (!typeLine) return null;
  const kind = typeLine[1];
  // A histogram's samples are `<name>_bucket{...}`, a counter's are `<name>` or
  // `<name>_total`, so match the prefix rather than the exact name.
  const samples = body.split('\n').filter(
    (l) => l.startsWith(name) && !l.startsWith('#'));
  return { kind, samples };
}

/**
 * Real labels only.
 *
 * `le` is the histogram's own bucket boundary, not a dimension anyone chose. Counting it
 * made an empty histogram look like a labelled one with the wrong labels — reported as
 * a hard failure when the truth was "no node has executed yet on a freshly started
 * worker", which is not a defect.
 */
const STRUCTURAL_LABELS = new Set(['le', 'quantile']);

function labelsOn(samples) {
  const found = new Set();
  for (const line of samples) {
    const m = /\{([^}]*)\}/.exec(line);
    if (!m) continue;
    for (const pair of m[1].split(',')) {
      const k = pair.split('=')[0]?.trim();
      if (k && !STRUCTURAL_LABELS.has(k)) found.add(k);
    }
  }
  return found;
}

const rule = (s) => console.log('\n' + '─'.repeat(74) + '\n' + s + '\n' + '─'.repeat(74));

rule('SECTION 5.4 METRIC VERIFICATION');

const api = await scrape(API_METRICS);
const worker = await scrape(WORKER_METRICS);

console.log(`  api    ${API_METRICS}  ${api.ok ? `ok, ${api.body.length} bytes` : `UNREACHABLE (${api.error})`}`);
console.log(`  worker ${WORKER_METRICS}  ${worker.ok ? `ok, ${worker.body.length} bytes` : `UNREACHABLE (${worker.error})`}`);

if (!api.ok && !worker.ok) {
  console.error('\nNeither endpoint responded. Start the services and re-run.');
  process.exit(2);
}

console.log('');
let failures = 0;
let unverifiable = 0;

for (const spec of REQUIRED) {
  const bodies = spec.source === 'worker' ? [['worker', worker]]
               : spec.source === 'api'    ? [['api', api]]
               : [['worker', worker], ['api', api]];

  const reachable = bodies.filter(([, r]) => r.ok);
  if (reachable.length === 0) {
    console.log(`  SKIP  ${spec.name.padEnd(32)} — ${spec.source} endpoint unreachable`);
    unverifiable++;
    continue;
  }

  let hit = null, hitIn = null;
  for (const [where, r] of reachable) {
    const m = findMetric(r.body, spec.name);
    if (m) { hit = m; hitIn = where; break; }
  }

  if (!hit) {
    console.log(`  FAIL  ${spec.name.padEnd(32)} — not present on the endpoint`);
    failures++;
    continue;
  }

  const problems = [];
  if (spec.histogram && hit.kind !== 'histogram') {
    problems.push(`declared ${hit.kind}, must be a histogram for quantiles`);
  }
  if (spec.labels) {
    // Only checkable once a sample exists; an unlabelled zero-sample metric is
    // reported as "no data yet" rather than counted as a failure, because the label
    // genuinely cannot be confirmed until the code path runs.
    const present = labelsOn(hit.samples);
    if (present.size === 0) {
      problems.push(`labels ${spec.labels.join(', ')} unconfirmed — no samples yet`);
    } else {
      const missing = spec.labels.filter((l) => !present.has(l));
      if (missing.length) problems.push(`missing label(s): ${missing.join(', ')}`);
    }
  }

  if (problems.some((p) => !p.includes('unconfirmed'))) {
    console.log(`  FAIL  ${spec.name.padEnd(32)} — ${problems.join('; ')}`);
    failures++;
  } else if (problems.length) {
    console.log(`  WARN  ${spec.name.padEnd(32)} — ${hitIn}, ${problems.join('; ')}`);
  } else {
    console.log(`  PASS  ${spec.name.padEnd(32)} — ${hitIn}, ${hit.kind}, ${hit.samples.length} sample(s)`);
  }
}

rule('RESULT');
console.log(`  ${REQUIRED.length - failures - unverifiable} of ${REQUIRED.length} verified` +
            (unverifiable ? `, ${unverifiable} unverifiable (endpoint down)` : '') +
            (failures ? `, ${failures} MISSING` : ''));

if (failures) {
  console.log('\n  A missing metric is usually a declaration that never made it into the\n' +
              '  scrape() list. Check WorkerMetrics.scrape().');
}
process.exit(failures ? 1 : 0);
