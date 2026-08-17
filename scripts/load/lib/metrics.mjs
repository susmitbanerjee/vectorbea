/**
 * Prometheus text-format scraping and the derived numbers the report needs.
 *
 * Kept deliberately small: the harness reads the worker's own :9090 endpoint
 * rather than reimplementing accounting, so what the report shows is exactly
 * what an operator would see on a dashboard during the same incident.
 */

import { CONFIG } from './env.mjs';

/** Parse Prometheus exposition text into a flat list of samples. */
export function parseExposition(text) {
  const samples = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(.+)$/);
    if (!m) continue;
    const [, name, labelBlob, valueRaw] = m;
    const value = Number(valueRaw.split(/\s+/)[0]);
    if (!Number.isFinite(value)) continue;
    const labels = {};
    if (labelBlob) {
      // Label values may contain escaped quotes; the worker escapes them.
      const inner = labelBlob.slice(1, -1);
      for (const part of inner.match(/[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\]|\\.)*"/g) ?? []) {
        const eq = part.indexOf('=');
        labels[part.slice(0, eq)] = part
          .slice(eq + 2, -1)
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\\\/g, '\\');
      }
    }
    samples.push({ name, labels, value });
  }
  return samples;
}

/**
 * Scrape every replica and concatenate the samples.
 *
 * Counters and histograms sum correctly across replicas because each exposes its
 * own share; gauges are summed by the callers that want fleet totals and read
 * per-replica where that is what matters. Merging here rather than in each
 * caller keeps "the fleet" the default unit of measurement.
 */
export async function scrapeFleet(ports = CONFIG.metricsPorts, timeoutMs = 3_000) {
  const all = await Promise.all(ports.map((p) =>
    scrape(p, timeoutMs).catch(() => [])));
  return all.flat();
}

export async function scrape(port = CONFIG.metricsPort, timeoutMs = 3_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
    return parseExposition(await res.text());
  } finally {
    clearTimeout(t);
  }
}

/**
 * Sum of every matching sample.
 *
 * A sum, not a `find`: with several replicas scraped into one list the same
 * series appears once per replica, and taking the first would report one
 * replica's number as the fleet's.
 */
export const value = (samples, name, labels = {}) =>
  samples
    .filter((s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v))
    .reduce((a, s) => a + s.value, 0);

export const seriesFor = (samples, name) => samples.filter((s) => s.name === name);

/**
 * Reconstruct percentiles from a Prometheus histogram's cumulative buckets.
 *
 * This is bucket interpolation, the same arithmetic `histogram_quantile` does,
 * so the numbers in the report and the numbers on a Grafana panel agree. It is
 * therefore bounded by bucket width: a p99 that lands in the [30, 60] bucket is
 * reported as a range-interpolated estimate, not a measured value. The report
 * labels these as estimates for that reason.
 */
export function histogramQuantile(samples, metric, labels = {}, q = 0.95) {
  const buckets = samples
    .filter(
      (s) =>
        s.name === `${metric}_bucket` &&
        Object.entries(labels).every(([k, v]) => s.labels[k] === v),
    )
    .map((s) => ({ le: s.labels.le === '+Inf' ? Infinity : Number(s.labels.le), count: s.value }))
    .sort((a, b) => a.le - b.le);

  if (buckets.length === 0) return null;
  const total = buckets[buckets.length - 1].count;
  if (!total) return null;

  const target = q * total;
  let prevLe = 0;
  let prevCount = 0;
  for (const b of buckets) {
    if (b.count >= target) {
      if (!Number.isFinite(b.le)) return prevLe; // in the overflow bucket
      if (b.count === prevCount) return b.le;
      const frac = (target - prevCount) / (b.count - prevCount);
      return prevLe + (b.le - prevLe) * frac;
    }
    prevLe = b.le;
    prevCount = b.count;
  }
  return prevLe;
}

/** Sum a histogram's `_count` across all label combinations. */
export function histogramCount(samples, metric) {
  return samples
    .filter((s) => s.name === `${metric}_count`)
    .reduce((a, s) => a + s.value, 0);
}

/** Sum a histogram's `_sum` across all label combinations. */
export function histogramSum(samples, metric) {
  return samples
    .filter((s) => s.name === `${metric}_sum`)
    .reduce((a, s) => a + s.value, 0);
}

/** Sum a counter across all label combinations (`_total` suffix is implied). */
export function counterTotal(samples, name) {
  return samples.filter((s) => s.name === name).reduce((a, s) => a + s.value, 0);
}
