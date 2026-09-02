"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Gauge, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatCostCents, formatDuration, formatTokens } from "~/lib/format";
import type {
  Burndown, BurndownBand, BurndownCeiling, BurndownMarker,
} from "~/lib/api/constellation";

/**
 * The burn-down: where the money went, by name.
 *
 * ── THE QUESTION THIS ANSWERS ───────────────────────────────────────────────
 * "Why did this run cost 31 cents" — with a name, not a number. A total tells
 * nobody anything actionable; a stack of bands says which member spent it, and
 * a ceiling line says whether that was a lot.
 *
 * ── AND THE ONE IT REFUSES TO FAKE ──────────────────────────────────────────
 * A run's cost is written twice, by two paths, in two units: `run_spans.cost_cents`
 * in CENTS by the agent brain, and `agent_runs.estimated_cost` in USD summed
 * from run events, which only the model-call executor writes. They are not
 * derived from each other and they do not always agree.
 *
 * Rescaling the bands to match the run row would produce a chart that adds up
 * perfectly and lies about where the money went. So the bands are what the spans
 * say, the gap is named, and the header states which figure is which.
 */

type Axis = "cost" | "tokens" | "iterations";

const AXIS: Record<Axis, {
  label: string;
  of: (p: { costCents: number; tokens: number; iterations: number }) => number;
  format: (n: number) => string;
}> = {
  cost: { label: "Cost", of: (p) => p.costCents, format: formatCostCents },
  tokens: { label: "Tokens", of: (p) => p.tokens, format: formatTokens },
  iterations: { label: "Iterations", of: (p) => p.iterations, format: (n) => String(Math.round(n)) },
};

/**
 * Band colours.
 *
 * Deliberately NOT the status ramp: a band is an agent, not an outcome, and
 * colouring the expensive one red would say it failed. These are the chart
 * sequence — distinguishable from each other and from every status hue, so a
 * reader never mistakes "this band is orange" for "this agent is waiting".
 */
const BAND_FILL = [
  "fill-chart-1", "fill-chart-2", "fill-chart-3",
  "fill-chart-4", "fill-chart-5", "fill-chart-6",
];
const BAND_SWATCH = [
  "bg-chart-1", "bg-chart-2", "bg-chart-3",
  "bg-chart-4", "bg-chart-5", "bg-chart-6",
];

const W = 720;
const H = 240;
const PAD_L = 56;
const PAD_B = 28;
const PAD_T = 16;

export function CostView({ burndown }: { burndown: Burndown }) {
  const [axis, setAxis] = React.useState<Axis>("cost");
  const [sort, setSort] = React.useState<{ key: keyof BurndownBand; desc: boolean }>(
    { key: "costCents", desc: true },
  );

  const { bands, ceilings, markers, reconciliation: rec, durationMs } = burndown;

  const axisCeilings = React.useMemo(
    () => ceilings.filter((c) => c.dimension === axis),
    [ceilings, axis],
  );

  /*
   * The stack's own total first, then the axis maximum — which includes every
   * ceiling, so a run well under its limit draws well under the line rather than
   * filling the plot. The bands are then stacked AGAINST that maximum.
   */
  const total = React.useMemo(
    () => stackBands(bands, axis, durationMs).total,
    [bands, axis, durationMs],
  );
  const peak = React.useMemo(
    () => Math.max(total, ...axisCeilings.map((c) => c.limit)),
    [total, axisCeilings],
  );
  const stack = React.useMemo(
    () => stackBands(bands, axis, durationMs, peak),
    [bands, axis, durationMs, peak],
  );

  const sorted = React.useMemo(() => {
    const rows = [...bands];
    rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const n = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sort.desc ? -n : n;
    });
    return rows;
  }, [bands, sort]);

  if (bands.length === 0 && rec.recordedTotalCents == null) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-subtle bg-surface-raised">
        <div className="max-w-md text-center">
          <Text variant="body" className="text-fg-secondary">
            Nothing metered for this run.
          </Text>
          <Text variant="caption" className="mt-1 text-fg-muted">
            Model and tool calls record what they cost; a run with neither has no
            burn-down.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Header
        axis={axis} onAxis={setAxis}
        reconciliation={rec}
        bandCount={bands.length}
      />

      <div className="rounded-md border border-subtle bg-surface-raised p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label={
            `${AXIS[axis].label} over the run, ${bands.length} band` +
            `${bands.length === 1 ? "" : "s"}: ` +
            bands.map((b) => `${b.agentName} ${AXIS[axis].format(AXIS[axis].of(b))}`).join(", ")
          }
        >
          <Grid peak={peak} axis={axis} durationMs={durationMs} />

          {/* The bands, deepest last so a supervisor sits under its children. */}
          {stack.areas.map((area, i) => (
            <path
              key={area.band.activationId ?? `orphan-${i}`}
              d={area.d}
              className={cn(
                BAND_FILL[i % BAND_FILL.length],
                /* Unattributable spend is hatched rather than coloured: it is
                   not an agent, and giving it a band colour puts it on the same
                   footing as one. */
                area.band.activationId == null && "opacity-40",
              )}
            />
          ))}

          <Ceilings ceilings={axisCeilings} peak={peak} durationMs={durationMs} axis={axis} />
          <Markers markers={markers} durationMs={durationMs} />
        </svg>

        <Legend bands={bands} axis={axis} />
      </div>

      {markers.length > 0 && <MarkerList markers={markers} bands={bands} />}

      <BandTable bands={sorted} axis={axis} sort={sort} onSort={setSort} />
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({
  axis, onAxis, reconciliation: rec, bandCount,
}: {
  axis: Axis;
  onAxis: (a: Axis) => void;
  reconciliation: Burndown["reconciliation"];
  bandCount: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <Text variant="body" className="font-medium text-fg-max">
            {formatCostCents(rec.attributedCents)}
          </Text>
          <Text variant="caption" className="text-fg-secondary">
            across {bandCount} band{bandCount === 1 ? "" : "s"}
          </Text>
        </div>

        {/* One axis, three measures. The toggle is instant because all three
            arrive together — they are the same rows with different columns. */}
        <div role="tablist" aria-label="Measure" className="flex gap-1">
          {(Object.keys(AXIS) as Axis[]).map((a) => (
            <button
              key={a}
              role="tab"
              aria-selected={axis === a}
              onClick={() => onAxis(a)}
              className={cn(
                "rounded-xs px-2 py-0.5 text-xs",
                "transition-opacity hover:opacity-80 motion-reduce:transition-none",
                "focus-visible:focus-ring",
                axis === a
                  ? "bg-surface-selected font-medium text-fg-max"
                  : "text-fg-secondary",
              )}
            >
              {AXIS[a].label}
            </button>
          ))}
        </div>
      </div>

      {/*
        THE RECONCILIATION.

        Shown only when the two records disagree — agreement is the common case
        and has nothing to say. When they differ, the reader is told which figure
        the chart is drawing and how much is missing from it, rather than being
        shown a rescaled chart that adds up.
      */}
      {!rec.agrees && (
        <div className="rounded-sm border border-status-waiting-border bg-status-waiting-subtle px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Icon icon={WarningCircle} size="xs" decorative className="text-status-waiting" />
            <Text variant="caption" className="text-status-waiting">
              {formatCostCents(Math.abs(rec.unattributedCents))} is not in the bands below
            </Text>
          </div>
          <Text variant="caption" className="mt-0.5 block text-fg-secondary">
            {rec.note} The chart shows {formatCostCents(rec.attributedCents)} from
            metered spans; the run row records{" "}
            {rec.recordedTotalCents == null ? "nothing" : formatCostCents(rec.recordedTotalCents)}.
          </Text>
        </div>
      )}
    </div>
  );
}

// ── Chart parts ─────────────────────────────────────────────────────────────

function Grid({ peak, axis, durationMs }: { peak: number; axis: Axis; durationMs: number }) {
  const lines = 4;
  return (
    <g aria-hidden="true">
      {Array.from({ length: lines + 1 }, (_, i) => {
        const v = (peak * i) / lines;
        const y = yFor(v, peak);
        return (
          <g key={i}>
            <line x1={PAD_L} y1={y} x2={W} y2={y} className="stroke-border-subtle" strokeWidth={1} />
            <text x={PAD_L - 6} y={y + 3} textAnchor="end"
                  className="fill-fg-muted font-ui text-[9px] tabular-nums">
              {AXIS[axis].format(v)}
            </text>
          </g>
        );
      })}
      {/* The time axis, so a crossing point can be read off it. */}
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={PAD_L + f * (W - PAD_L)} y={H - 8}
              textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
              className="fill-fg-muted font-ui text-[9px] tabular-nums">
          {formatDuration(durationMs * f)}
        </text>
      ))}
    </g>
  );
}

/**
 * The ceiling lines, each labelled with WHOSE limit it is.
 *
 * "This run cost 40 of its 100" is a different sentence depending on whether the
 * 100 was the workspace's or the team's, and a chart that draws only the loosest
 * one explains nothing about a run that stopped.
 */
function Ceilings({
  ceilings, peak, durationMs, axis,
}: {
  ceilings: BurndownCeiling[];
  peak: number;
  durationMs: number;
  axis: Axis;
}) {
  return (
    <g>
      {ceilings.map((c) => {
        const y = yFor(c.limit, peak);
        const crossed = c.crossedAtMs != null;
        return (
          <g key={`${c.dimension}-${c.source}`}>
            <line
              x1={PAD_L} y1={y} x2={W} y2={y}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className={crossed ? "stroke-status-failed" : "stroke-status-waiting"}
            />
            <text x={W - 4} y={y - 4} textAnchor="end"
                  className={cn("font-ui text-[9px]",
                    crossed ? "fill-status-failed" : "fill-status-waiting")}>
              {`${c.source} ceiling ${AXIS[axis].format(c.limit)}`}
            </text>
            {/* THE CROSSING POINT, marked where the stack passed the line. */}
            {crossed && (
              <>
                <line
                  x1={xFor(c.crossedAtMs!, durationMs)} y1={PAD_T}
                  x2={xFor(c.crossedAtMs!, durationMs)} y2={H - PAD_B}
                  className="stroke-status-failed" strokeWidth={1.5}
                />
                <text
                  x={xFor(c.crossedAtMs!, durationMs) + 4} y={PAD_T + 10}
                  className="fill-status-failed font-ui text-[9px]"
                >
                  {`crossed at ${formatDuration(c.crossedAtMs!)}`}
                </text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Clamps and ceiling events, as ticks on the axis. */
function Markers({ markers, durationMs }: { markers: BurndownMarker[]; durationMs: number }) {
  return (
    <g aria-hidden="true">
      {markers.map((m, i) => (
        <line
          key={`${m.kind}-${m.atMs}-${i}`}
          x1={xFor(m.atMs, durationMs)} y1={H - PAD_B}
          x2={xFor(m.atMs, durationMs)} y2={H - PAD_B - 8}
          strokeWidth={2}
          className={m.kind === "clamp" ? "stroke-status-waiting" : "stroke-status-failed"}
        />
      ))}
    </g>
  );
}

/**
 * The markers, in words.
 *
 * A tick on an axis is a hint; the sentence is the answer. A clamp is the reason
 * a worker underperformed — the child was granted less than it asked for and did
 * less work than it was told to — and every other screen shows an agent that
 * simply stopped early.
 */
function MarkerList({ markers, bands }: { markers: BurndownMarker[]; bands: BurndownBand[] }) {
  const nameOf = (id: string | null) =>
    bands.find((b) => b.activationId === id)?.agentName ?? null;

  return (
    <div className="rounded-md border border-subtle bg-surface-raised p-3">
      <Text variant="caption" className="mb-1.5 block font-medium uppercase tracking-wide text-fg-muted">
        Budget events
      </Text>
      <ul className="space-y-1">
        {markers.map((m, i) => (
          <li key={`${m.kind}-${m.atMs}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
            <Icon
              icon={m.kind === "clamp" ? Gauge : WarningCircle}
              size="xs" decorative
              className={m.kind === "clamp" ? "text-status-waiting" : "text-status-failed"}
            />
            <span className="font-mono text-[11px] tabular-nums text-fg-muted">
              {formatDuration(m.atMs)}
            </span>
            <Text variant="caption" className="font-medium text-fg-max">{m.label}</Text>
            {nameOf(m.activationId) && (
              <Text variant="caption" className="text-fg-secondary">{nameOf(m.activationId)}</Text>
            )}
            {m.detail && (
              <Text variant="caption" className="text-fg-secondary">{m.detail}</Text>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ bands, axis }: { bands: BurndownBand[]; axis: Axis }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {bands.map((b, i) => (
        <span key={b.activationId ?? `orphan-${i}`} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-xs",
                  BAND_SWATCH[i % BAND_SWATCH.length],
                  b.activationId == null && "opacity-40")} />
          <Text variant="caption" className="text-fg-secondary">{b.agentName}</Text>
          <span className="font-mono text-[11px] tabular-nums text-fg-max">
            {AXIS[axis].format(AXIS[axis].of(b))}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── The table ───────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: keyof BurndownBand; label: string; numeric: boolean }> = [
  { key: "agentName", label: "Agent", numeric: false },
  { key: "role", label: "Role", numeric: false },
  { key: "depth", label: "Depth", numeric: true },
  { key: "tokens", label: "Tokens", numeric: true },
  { key: "costCents", label: "Cost", numeric: true },
  { key: "shareOfCost", label: "Share", numeric: true },
];

function BandTable({
  bands, axis, sort, onSort,
}: {
  bands: BurndownBand[];
  axis: Axis;
  sort: { key: keyof BurndownBand; desc: boolean };
  onSort: (s: { key: keyof BurndownBand; desc: boolean }) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-subtle bg-surface-raised">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-subtle">
            {COLUMNS.map((c) => (
              <th key={String(c.key)} scope="col"
                  className={cn("px-3 py-2 font-medium", c.numeric && "text-right")}
                  aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                <button
                  type="button"
                  onClick={() => onSort({
                    key: c.key,
                    /* First click on a new column sorts descending for numbers
                       and ascending for names, which is what each is scanned
                       for. */
                    desc: sort.key === c.key ? !sort.desc : c.numeric,
                  })}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-xs text-fg-secondary",
                    "transition-opacity hover:opacity-80 motion-reduce:transition-none",
                    "focus-visible:focus-ring",
                    sort.key === c.key && "text-fg-max",
                  )}
                >
                  {c.label}
                  {sort.key === c.key && (
                    <Icon icon={sort.desc ? ArrowDown : ArrowUp} size="xs" decorative />
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => (
            <tr key={b.activationId ?? `orphan-${i}`} className="border-b border-subtle last:border-0">
              <td className="px-3 py-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true"
                        className={cn("size-2 shrink-0 rounded-xs",
                          BAND_SWATCH[i % BAND_SWATCH.length])} />
                  <span className={cn("text-fg-primary", b.activationId == null && "italic text-fg-secondary")}>
                    {b.agentName}
                  </span>
                </span>
              </td>
              <td className="px-3 py-1.5 text-fg-secondary">{b.role ?? "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-fg-secondary">{b.depth}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-primary">
                {formatTokens(b.tokens)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-primary">
                {formatCostCents(b.costCents)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-secondary">
                {`${Math.round(b.shareOfCost * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-subtle">
            <td className="px-3 py-1.5 font-medium text-fg-max" colSpan={3}>Total</td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-max">
              {formatTokens(bands.reduce((n, b) => n + b.tokens, 0))}
            </td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-max">
              {formatCostCents(bands.reduce((n, b) => n + b.costCents, 0))}
            </td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-secondary">100%</td>
          </tr>
        </tfoot>
      </table>
      <span className="sr-only">
        Sorted by {String(sort.key)}, {sort.desc ? "descending" : "ascending"}. Measure: {AXIS[axis].label}.
      </span>
    </div>
  );
}

// ── Geometry ────────────────────────────────────────────────────────────────

function xFor(atMs: number, durationMs: number): number {
  const f = durationMs > 0 ? atMs / durationMs : 0;
  return PAD_L + Math.max(0, Math.min(1, f)) * (W - PAD_L);
}

function yFor(value: number, peak: number): number {
  const f = peak > 0 ? value / peak : 0;
  return H - PAD_B - Math.max(0, Math.min(1, f)) * (H - PAD_B - PAD_T);
}

/**
 * Stack the bands into filled areas.
 *
 * ── WHY THE STACK IS BUILT ON A SHARED TIME GRID ────────────────────────────
 * Each band has its own sample times — an agent that made three calls has three
 * points, one that made thirty has thirty. Stacking those directly would put
 * band B's second point on top of band A's second point regardless of when
 * either happened, which draws a plausible chart of a run that never occurred.
 *
 * So every band is evaluated at every timestamp in the run, carrying its last
 * known value forward. That is what makes the stack's height at a moment the
 * real total at that moment.
 *
 * ── AND WHY THE SCALE IS AN ARGUMENT ────────────────────────────────────────
 * It computed its own peak from the bands and the caller drew the axis against
 * a different one — the highest ceiling. So a run that spent 36¢ of a $1.00
 * ceiling drew a stack filling the whole plot with the ceiling line floating
 * near the top: "40 of its 100" rendered as a full chart, which is the one thing
 * the ceiling exists to prevent. The scale belongs to the caller, because the
 * caller is what knows about the ceilings.
 */
export function stackBands(
  bands: BurndownBand[],
  axis: Axis,
  durationMs: number,
  /** The axis maximum. Defaults to the stack's own peak when there is no ceiling. */
  scale?: number,
): { areas: Array<{ band: BurndownBand; d: string }>; total: number } {
  const of = AXIS[axis].of;
  const times = [...new Set(bands.flatMap((b) => b.points.map((p) => p.atMs)))]
    .sort((a, b) => a - b);
  if (times.length === 0) return { areas: [], total: 0 };

  /* Last known value of each band at each time, carried forward. */
  const series = bands.map((b) => {
    let i = 0;
    let last = 0;
    return times.map((t) => {
      while (i < b.points.length && b.points[i]!.atMs <= t) { last = of(b.points[i]!); i += 1; }
      return last;
    });
  });

  const totals = times.map((_, ti) => series.reduce((n, s) => n + s[ti]!, 0));
  const total = Math.max(...totals, 0);
  /* The AXIS maximum, which is the stack's own peak only when nothing else sets
     a taller scale. Drawing against the wrong one is how a chart shows a run at
     its limit when it spent a third of it. */
  const peak = scale != null && scale > 0 ? scale : total;

  /* Cumulative lower edge per band, so each area sits on the one below it. */
  const areas = bands.map((band, bi) => {
    const lower = times.map((_, ti) =>
      series.slice(0, bi).reduce((n, s) => n + s[ti]!, 0));
    const upper = times.map((_, ti) => lower[ti]! + series[bi]![ti]!);

    const top = times.map((t, ti) => `${xFor(t, durationMs)},${yFor(upper[ti]!, peak)}`);
    const bottom = [...times].reverse().map((t, ri) => {
      const ti = times.length - 1 - ri;
      return `${xFor(t, durationMs)},${yFor(lower[ti]!, peak)}`;
    });
    return { band, d: `M ${top.join(" L ")} L ${bottom.join(" L ")} Z` };
  });

  return { areas, total };
}
