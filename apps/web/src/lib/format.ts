/**
 * Display formatters.
 *
 * Design direction §4.2 — the numeric law:
 *   - never render a raw float
 *   - durations and costs are mono
 *   - IDs are mono, middle-truncated and click-to-copy
 *
 * These return strings only. Applying `tabular` / `identifier` (see
 * src/styles/tokens/typography.css) is the component's job.
 */

/** An em dash — the single permitted representation of "no value". */
export const EMPTY = "—";

/**
 * Middle-truncate an identifier: `a35d65ca-…-3453b5` → `a35d65ca…3453b5`.
 * Always pair with click-to-copy so the full value stays reachable.
 */
export function truncateId(id: string, head = 8, tail = 6): string {
  if (!id) return EMPTY;
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/**
 * Duration from milliseconds, at the coarsest useful precision:
 * `840ms` · `1.4s` · `2m 06s` · `1h 12m`.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * Cost in USD, keeping sub-cent precision that would otherwise round to $0.00.
 * `$0.0031` stays `$0.0031`; a true zero renders as the em dash.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return EMPTY;
  if (usd === 0) return EMPTY;
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Token counts: `842` · `12.4k` · `1.8M`. Zero renders as the em dash. */
export function formatTokens(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count) || count === 0) return EMPTY;
  if (Math.abs(count) < 1000) return String(Math.round(count));
  if (Math.abs(count) < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Percentage with no trailing noise: `41%` · `99.9%`. */
export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return `${value.toFixed(fractionDigits)}%`;
}
