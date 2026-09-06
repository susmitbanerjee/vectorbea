#!/usr/bin/env node
/**
 * Static validation of the monitoring stack.
 *
 *   node scripts/monitoring/validate.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The stack in `ops/monitoring/` was complete, careful, well-commented, and had
 * never worked. Three dashboards rendered nothing, three alerts fired to nobody, and
 * a scrape config pointed at hosts that do not exist in this deployment. Nothing
 * failed, because nothing checked. See docs/TELEMETRY-AUDIT.md §8.
 *
 * Config that is never executed rots exactly like code that is never run, and it rots
 * more quietly, because a broken dashboard renders as an empty graph — which is
 * visually identical to a healthy system with nothing happening.
 *
 * ── WHAT THIS CAN AND CANNOT CATCH ──────────────────────────────────────────
 * This is a STATIC check. It cannot tell you a metric is emitted — only
 * `scripts/load/verify-metrics.mjs` can, by scraping a live process, and it should
 * keep being the thing that does.
 *
 * What this catches is the other half, which nothing checked before: a dashboard or
 * an alert that references a metric NAME THAT DOES NOT EXIST IN THE SOURCE. That is
 * the failure that survives review indefinitely, because the panel looks right, the
 * PromQL is valid, and the result is empty.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OPS = join(ROOT, 'ops', 'monitoring');
const DASH_DIR = join(OPS, 'grafana', 'dashboards');

let failures = 0;
let checks = 0;

const fail = (where, msg) => { failures++; console.error(`  FAIL  ${where}: ${msg}`); };
const ok = (msg) => { checks++; console.log(`  ok    ${msg}`); };

// ─────────────────────────────────────────────────────────────────────────────
// The authoritative metric list, read from Kotlin source.
//
// Parsed rather than hard-coded on purpose: a hard-coded list is a second source of
// truth that drifts, and the drift is silent in the direction that matters — a
// renamed metric keeps passing because the list still contains the old name.
// ─────────────────────────────────────────────────────────────────────────────
function metricNames() {
  const sources = [
    ['apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/metrics/WorkerMetrics.kt',
     /=\s*(?:WCounter|WDoubleCounter|WGauge|WHistogram|WSecondsHistogram|WRatioHistogram)\(\s*(?:\/\/[^\n]*\n\s*)*"([a-z0-9_]+)"/g],
    ['apps/api-kotlin/src/main/kotlin/com/vectorbea/api/metrics/AppMetrics.kt',
     /=\s*(?:com\.vectorbea\.observability\.metrics\.)?(?:counter|gauge|secondsHistogram|doubleCounter|histogram)\(\s*(?:\/\/[^\n]*\n\s*)*"([a-z0-9_]+)"/g],
    ['packages/observability-kotlin/src/main/kotlin/com/vectorbea/observability/metrics/ScheduledJobHealth.kt',
     /=\s*(?:counter|gauge|secondsHistogram|doubleCounter)\(\s*\n?\s*"([a-z0-9_]+)"/g],
  ];
  const names = new Set();
  for (const [rel, rx] of sources) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(rx)) names.add(m[1]);
  }
  // Series Prometheus itself and the collector expose. Not ours, but legitimately
  // referenced by the pipeline-health alerts.
  for (const n of ['up', 'otelcol_exporter_send_failed_metric_points',
                   'otelcol_exporter_send_failed_spans']) names.add(n);
  return names;
}

/** Every form a family can appear as on the wire. */
function selectableNames(base) {
  const out = new Set();
  for (const n of base) {
    out.add(n);
    for (const s of ['_total', '_bucket', '_sum', '_count']) out.add(n + s);
  }
  return out;
}

/**
 * Pull metric identifiers out of a PromQL expression.
 *
 * Deliberately crude — it over-collects and then subtracts the known non-metric
 * vocabulary — because the alternative is a PromQL parser, and a crude check that
 * runs is worth more than a correct one that does not exist.
 */
const PROMQL_KEYWORDS = new Set([
  'sum', 'rate', 'increase', 'avg', 'min', 'max', 'count', 'by', 'without', 'le',
  'histogram_quantile', 'clamp_min', 'clamp_max', 'time', 'topk', 'bottomk', 'and',
  'or', 'unless', 'on', 'ignoring', 'group_left', 'group_right', 'label_replace',
  'label_join', 'absent', 'delta', 'idelta', 'irate', 'timestamp', 'vector', 'scalar',
  'round', 'abs', 'ceil', 'floor', 'sort', 'sort_desc', 'quantile', 'stddev', 'offset',
  'count_values', 'changes', 'resets', 'predict_linear', 'deriv', 'avg_over_time',
  'max_over_time', 'min_over_time', 'sum_over_time', 'last_over_time', 'e', 'inf', 'nan',
]);

function metricsInExpr(expr) {
  // Everything stripped below is a place where an identifier legally appears and is
  // NOT a metric name. Each of these was found by running the check and reading what
  // it wrongly rejected, which is the only reliable way to get this list right.
  const stripped = expr
    .replace(/"[^"]*"/g, '""')                       // string literals
    .replace(/'[^']*'/g, "''")
    .replace(/\{[^}]*\}/g, '{}')                     // label matchers
    .replace(/\[[^\]]*\]/g, '[]')                    // range durations — [5m] gave "m"
    .replace(/\boffset\s+[0-9]+[smhdwy]\b/g, '')     // offset modifiers
    .replace(/\b\d+(?:\.\d+)?e[+-]?\d+\b/gi, '0')    // 1e6 gave "e6"
    // Grouping and matching clauses: `by (provider, model)` gave "provider", "model".
    .replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, '')
    .replace(/\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?/g, '');  // Grafana variables

  const found = new Set();
  for (const m of stripped.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)) {
    const id = m[0];
    if (PROMQL_KEYWORDS.has(id)) continue;
    if (/^\d/.test(id)) continue;
    found.add(id);
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nMonitoring stack validation\n');

const base = metricNames();
const selectable = selectableNames(base);
console.log(`  ${base.size} metric families found in Kotlin source\n`);

// ── 1. Dashboards ───────────────────────────────────────────────────────────
console.log('Dashboards');
const dashFiles = readdirSync(DASH_DIR).filter((f) => f.endsWith('.json'));
if (dashFiles.length === 0) fail('dashboards', 'no dashboard files found');

const seenUids = new Map();
for (const file of dashFiles) {
  const where = `dashboards/${file}`;
  let d;
  try {
    d = JSON.parse(readFileSync(join(DASH_DIR, file), 'utf8'));
  } catch (e) {
    fail(where, `does not parse: ${e.message}`);
    continue;
  }

  if (!d.uid) fail(where, 'has no uid — provisioning needs a stable one');
  if (!d.title) fail(where, 'has no title');
  if (seenUids.has(d.uid)) {
    // Two dashboards with one uid means provisioning silently keeps whichever it
    // loaded last, and the other simply does not exist.
    fail(where, `duplicate uid "${d.uid}", also used by ${seenUids.get(d.uid)}`);
  }
  seenUids.set(d.uid, file);

  const vars = (d.templating?.list ?? []).map((v) => v.name);
  if (!vars.includes('env')) {
    fail(where, 'has no `env` template variable — it cannot separate environments');
  }

  const panels = d.panels ?? [];
  if (panels.length === 0) fail(where, 'has no panels');

  let promTargets = 0;
  for (const p of panels) {
    if (p.type === 'row') continue;
    if (!p.title) fail(where, `panel ${p.id} has no title`);
    if (!p.datasource) fail(where, `panel "${p.title}" has no datasource`);
    const targets = p.targets ?? [];
    if (targets.length === 0) fail(where, `panel "${p.title}" has no targets`);

    // Loki and Postgres panels also carry queries, but in other languages. Only
    // Prometheus panels get the metric-name check — running a PromQL parser over
    // LogQL produces confident nonsense.
    const dsType = (typeof p.datasource === 'object' ? p.datasource?.type : null)
      ?? (d.templating?.list ?? []).find((v) => v.name === 'env')?.datasource?.type;
    const isProm = dsType === 'prometheus';

    for (const t of targets) {
      if (t.expr === undefined) continue;   // SQL panel
      if (!t.expr.trim()) { fail(where, `panel "${p.title}" has an empty expr`); continue; }

      if (isProm) {
        promTargets++;
        // Every metric referenced must exist. This is the check that would have
        // caught a dashboard built against a renamed series.
        for (const id of metricsInExpr(t.expr)) {
          if (!selectable.has(id) && !id.startsWith('$')) {
            fail(where, `panel "${p.title}" references unknown metric \`${id}\``);
          }
        }
      }

      // And every one must be environment-scoped, or a "production" dashboard is
      // quietly summing staging into its numbers.
      if (!t.expr.includes('environment')) {
        fail(where, `panel "${p.title}" does not filter on environment: ${t.expr.slice(0, 70)}`);
      }
    }
  }
  ok(`${file} — ${panels.length} panels, ${promTargets} PromQL targets`);
}

// ── 2. Alerts ───────────────────────────────────────────────────────────────
console.log('\nAlerts');
const alertsRaw = readFileSync(join(OPS, 'prometheus', 'alerts.yml'), 'utf8');

// Deliberately not a YAML parse: this repo has no YAML dependency in scripts/, and
// adding one to read three fields is a poor trade. The shapes below are stable.
const alertNames = [...alertsRaw.matchAll(/^\s*- alert:\s*(\S+)/gm)].map((m) => m[1]);
if (alertNames.length === 0) fail('alerts.yml', 'no alerts defined');

const runbookPath = join(ROOT, 'docs', 'telemetry', 'RUNBOOKS.md');
if (!existsSync(runbookPath)) {
  fail('RUNBOOKS.md', 'missing — every alert needs a documented response');
} else {
  const runbooks = readFileSync(runbookPath, 'utf8');
  for (const name of alertNames) {
    // An alert with no runbook is noise: it wakes someone who then has to work out
    // what it means from the expression.
    if (!runbooks.includes(`## ${name}`)) {
      fail('RUNBOOKS.md', `no section for alert \`${name}\``);
    }
  }
  ok(`${alertNames.length} alerts, each with a runbook section`);
}

for (const blockMatch of alertsRaw.split(/^\s*- alert:\s*/m).slice(1)) {
  const name = blockMatch.split(/\s/)[0];
  if (!/severity:\s*(page|ticket)/.test(blockMatch)) {
    fail('alerts.yml', `\`${name}\` has no severity: page|ticket — it will not route`);
  }
  if (!/action:\s*/.test(blockMatch)) {
    fail('alerts.yml', `\`${name}\` has no action annotation`);
  }
}

// Alert expressions reference metrics too, and get them wrong the same way.
for (const m of alertsRaw.matchAll(/expr:\s*\|?\s*\n?([\s\S]*?)\n\s{8}(?:for|labels):/g)) {
  for (const id of metricsInExpr(m[1])) {
    if (!selectable.has(id) && !id.startsWith('$')) {
      fail('alerts.yml', `expression references unknown metric \`${id}\``);
    }
  }
}
ok('alert expressions reference only metrics that exist');

// ── 3. Config sanity ────────────────────────────────────────────────────────
console.log('\nConfiguration');

// Comments are stripped before every content check below. The configs explain WHY
// they no longer do a thing, by name, and a check that reads its own explanation as
// a violation is a check nobody can satisfy without deleting the explanation.
const stripComments = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const prom = stripComments(readFileSync(join(OPS, 'prometheus', 'prometheus.yml'), 'utf8'));
if (prom.includes('host.docker.internal')) {
  // The specific bug this whole exercise started from.
  fail('prometheus.yml', 'still scrapes host.docker.internal — that host does not exist on Railway');
} else ok('prometheus.yml has no single-box scrape targets');

const am = stripComments(readFileSync(join(OPS, 'alertmanager', 'alertmanager.yml'), 'utf8'));
if (/CONFIGURE ONE OF THESE/.test(am)) {
  fail('alertmanager.yml', 'still contains the unconfigured-receiver placeholder');
} else ok('alertmanager.yml has a configured receiver');
if (!/severity\s*=\s*"page"/.test(am)) {
  fail('alertmanager.yml', 'has no route matching severity=page');
} else ok('alertmanager.yml routes pages separately from tickets');

// ── Grafana access control ──────────────────────────────────────────────────
//
// The dashboards show per-workspace cost, run volume and the product event stream.
// Every one of these is a way that could stop being true without anyone noticing,
// because Grafana would keep working perfectly in each case.
const gfEntry = readFileSync(join(OPS, 'railway', 'grafana-entrypoint.sh'), 'utf8');
const gfDocker = readFileSync(join(OPS, 'railway', 'grafana.Dockerfile'), 'utf8');

if (!/GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT="true"/.test(gfEntry)) {
  // Without strict mode a non-matching user gets the DEFAULT role instead of being
  // refused — the allow-list silently becomes a no-op and everyone is admitted.
  fail('grafana-entrypoint.sh', 'role_attribute_strict is not "true" — the allow-list would not deny anyone');
} else ok('Grafana denies logins that do not match the allow-list (strict roles)');

if (!/contains\(\[\$EMAIL_LIST\], email\)/.test(gfEntry)) {
  fail('grafana-entrypoint.sh', 'the role expression does not match on an email allow-list');
} else ok('Grafana access is an explicit email allow-list');

if (!/email_verified &&/.test(gfEntry)) {
  // An unverified address is a claim, not an identity.
  fail('grafana-entrypoint.sh', 'the role expression does not require email_verified');
} else ok('Grafana requires a verified address');

if (!/GRAFANA_ALLOWED_EMAILS/.test(gfEntry) || !/exit 1/.test(gfEntry)) {
  fail('grafana-entrypoint.sh', 'does not refuse to start when GRAFANA_ALLOWED_EMAILS is unset');
} else ok('Grafana refuses to start with no allow-list configured');

if (!/GF_AUTH_ANONYMOUS_ENABLED=false/.test(gfDocker)) {
  fail('grafana.Dockerfile', 'anonymous access is not explicitly disabled');
} else ok('Grafana anonymous access is disabled');

const agent = stripComments(readFileSync(join(OPS, 'agent', 'config.yml'), 'utf8'));
for (const required of ['VECTORBEA_ENV', 'TELEMETRY_INGEST_TOKEN', 'dns_sd_configs']) {
  if (!agent.includes(required)) fail('agent/config.yml', `missing ${required}`);
}
ok('agent config stamps environment and discovers worker replicas by DNS');

// ── 4. Every registered scheduled job is on the jobs dashboard ──────────────
//
// Not a metric-name check — a COVERAGE check. The staleness alert is generic, so a
// new job is alerted automatically, but it is only *visible* if someone can see it,
// and the dashboard queries by label rather than by name, so this asserts the
// dashboard exists and is wired to the right series.
console.log('\nScheduled job coverage');
const jobNames = new Set();
for (const rel of [
  'apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker',
  'apps/api-kotlin/src/main/kotlin/com/vectorbea/api',
]) {
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.kt')) {
        const src = readFileSync(join(ROOT, p), 'utf8');
        for (const m of src.matchAll(/const val JOB_(?:NAME|SWEEP|EXPORT_DRAIN)\s*=\s*"([a-z0-9-]+)"/g)) {
          jobNames.add(m[1]);
        }
      }
    }
  };
  walk(rel);
}
if (jobNames.size === 0) {
  fail('scheduled jobs', 'no JOB_NAME constants found — is ScheduledJobHealth still wired?');
} else {
  ok(`${jobNames.size} scheduled jobs registered: ${[...jobNames].sort().join(', ')}`);
}

const jobsDash = join(DASH_DIR, 'scheduled-jobs.json');
if (!existsSync(jobsDash)) fail('dashboards', 'scheduled-jobs.json is missing');
else if (!readFileSync(jobsDash, 'utf8').includes('job_last_success_timestamp_seconds')) {
  fail('scheduled-jobs.json', 'does not query job_last_success_timestamp_seconds');
} else ok('scheduled-jobs dashboard is wired to the job-health series');

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${checks} checks passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
