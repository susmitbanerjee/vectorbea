/* ══════════════════════════════════════════════════════════════════════════════
   CHART PRIMITIVES — scales and paths.

   WHY NOT VISX. The execution plan named visx. These four charts are a
   burn-down line, a categorical grid, a histogram and a dual-series area — none
   needs a scale library, a shape generator or a legend system. visx would add
   ~180KB across @visx/scale, @visx/shape, @visx/axis and d3-* transitive deps to
   a page whose whole argument is that it loads fast during an incident, and it
   arrives with its own theming model that would have to be fought back onto our
   tokens. Everything below is ~120 lines and takes colour from CSS variables
   directly.

   Revisit if a surface later needs brushing, voronoi hit-testing or stacked
   layouts — that is where hand-rolling stops paying.
══════════════════════════════════════════════════════════════════════════════ */

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert(px: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  fn.domain = domain;
  fn.range = range;
  fn.invert = (px: number) => d0 + ((px - r0) / (r1 - r0 || 1)) * span;
  return fn;
}

/** A "nice" upper bound so the axis reads 12 rather than 11.8317. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export interface Point {
  x: number;
  y: number;
}

/** Straight-segment path. Splines lie about data between samples. */
export function linePath(points: Point[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

export function areaPath(points: Point[], baselineY: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${last.x.toFixed(2)} ${baselineY.toFixed(2)} L${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

/**
 * Ticks that land on round numbers inside the domain. Returns at most `count`,
 * because a crowded axis is worse than a sparse one.
 */
export function ticks(domain: [number, number], count = 4): number[] {
  const [d0, d1] = domain;
  const span = d1 - d0;
  if (span === 0) return [d0];
  const raw = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  const start = Math.ceil(d0 / step) * step;
  const out: number[] = [];
  for (let v = start; v <= d1 + step * 0.0001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Axis label for a timestamp, matched to the range's granularity. */
export function formatTick(ms: number, format: "time" | "day"): string {
  const d = new Date(ms);
  if (format === "day") {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  }
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

/** `940ms` · `2.4s` · `1m 12s` — the same vocabulary as format.ts, for axes. */
export function formatAxisDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m`;
}
