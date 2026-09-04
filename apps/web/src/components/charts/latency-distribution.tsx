"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { linearScale, formatAxisDuration } from "./scale";
import type { LatencyDistribution } from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   <LatencyDistributionChart> — execution latency with p50/p95/p99 markers.

   Log-spaced buckets. With linear buckets, a workflow where most runs finish in
   2s and a few take 4 minutes puts 95% of the mass in bar one and renders the
   tail — the only interesting part — as invisible slivers.

   The percentile markers are the reason to look at this chart at all, so they
   are drawn on top of the bars with labels, not relegated to a legend.
══════════════════════════════════════════════════════════════════════════════ */

export interface LatencyDistributionChartProps {
  data: LatencyDistribution;
  height?: number;
  /** Called when a bucket is chosen, so the chart resolves to filtered runs. */
  onSelectBucket?: (lowerMs: number, upperMs: number) => void;
  className?: string;
}

const MARKERS = [
  { key: "p50" as const, label: "p50", colour: "var(--fg-muted)" },
  { key: "p95" as const, label: "p95", colour: "var(--status-waiting)" },
  { key: "p99" as const, label: "p99", colour: "var(--status-failed)" },
];

export function LatencyDistributionChart({
  data, height = 168, onSelectBucket, className,
}: LatencyDistributionChartProps) {
  const [hover, setHover] = React.useState<number | null>(null);

  if (data.sampleCount === 0) {
    return (
      <div
        className={cn("border-subtle grid place-items-center rounded-md border border-dashed", className)}
        style={{ height }}
      >
        <Text variant="body-sm" tone="muted">No completed runs in this range.</Text>
      </div>
    );
  }

  const padL = 34;
  const padR = 8;
  const padT = 18;
  const padB = 26;
  const width = 560;

  const maxCount = Math.max(...data.buckets.map((b) => b.count));
  const lowerMs = data.buckets.length ? data.buckets[0].upperMs : 1;
  const upperMs = data.buckets.length ? data.buckets[data.buckets.length - 1].upperMs : 1;

  // The x scale is log, matching the buckets.
  const x = linearScale([Math.log(lowerMs), Math.log(upperMs)], [padL, width - padR]);
  const positionForMs = (value: number) => data.buckets.length === 1
    ? (padL + width - padR) / 2
    : x(Math.log(value));
  const y = linearScale([0, maxCount], [height - padB, padT]);
  // Sparse distributions should still look like histograms, not solid panels.
  const barWidth = Math.min(48, Math.max(2, (width - padL - padR) / data.buckets.length - 2));
  const countTicks = maxCount <= 1 ? [maxCount] : [maxCount / 2, maxCount];
  const axisIndexes = Array.from(new Set([
    0,
    Math.floor(data.buckets.length / 2),
    data.buckets.length - 1,
  ])).filter((index) => index >= 0);

  return (
    <div className={cn("w-full min-w-0", className)}>
      <div
        className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1"
        aria-hidden="true"
      >
        {MARKERS.map((marker) => (
          <span key={marker.key} className="inline-flex items-center gap-1.5 whitespace-nowrap font-ui text-[11px]">
            <span
              className="h-2.5 border-l border-dashed"
              style={{ borderColor: marker.colour }}
            />
            <span style={{ color: marker.colour }}>
              {marker.label} {formatAxisDuration(data[marker.key])}
            </span>
          </span>
        ))}
      </div>
      <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full min-w-[26rem]"
        role="img"
        aria-label={`Execution latency distribution over ${data.sampleCount} runs. Median ${formatAxisDuration(data.p50)}, p95 ${formatAxisDuration(data.p95)}, p99 ${formatAxisDuration(data.p99)}.`}
      >
        {/* Count gridlines. Two is enough to read magnitude. */}
        {countTicks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" strokeWidth={1} />
            <text
              x={padL - 6} y={y(v) + 3} textAnchor="end"
              className="font-code tabular"
              fontSize={9} fill="var(--fg-disabled)"
            >
              {Math.round(v)}
            </text>
          </g>
        ))}

        {data.buckets.map((b, i) => {
          const cx = positionForMs(b.upperMs);
          const active = hover === i;
          const lower = i === 0 ? 0 : data.buckets[i - 1].upperMs;
          return (
            <rect
              key={i}
              x={cx - barWidth / 2}
              y={y(b.count)}
              width={barWidth}
              height={Math.max(b.count > 0 ? 1 : 0, height - padB - y(b.count))}
              fill={active ? "var(--accent)" : "var(--accent-border)"}
              opacity={active ? 1 : 0.55}
              className="cursor-pointer transition-opacity duration-instant"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectBucket?.(lower, b.upperMs)}
            >
              <title>{`${b.count} run${b.count === 1 ? "" : "s"} between ${formatAxisDuration(lower)} and ${formatAxisDuration(b.upperMs)}`}</title>
            </rect>
          );
        })}

        {/* Labels live in the legend above so coincident percentiles never overlap. */}
        {MARKERS.map((m) => {
          const value = data[m.key];
          const cx = positionForMs(Math.max(lowerMs, value));
          return (
            <g key={m.key}>
              <line x1={cx} x2={cx} y1={padT} y2={height - padB} stroke={m.colour} strokeWidth={1} strokeDasharray="3 2" />
            </g>
          );
        })}

        {/* Axis: first, middle and last bucket only. */}
        <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} stroke="var(--border-default)" strokeWidth={1} />
        {axisIndexes.map((i) => {
          const b = data.buckets[i];
          if (!b) return null;
          return (
            <text
              key={i}
              x={positionForMs(b.upperMs)}
              y={height - padB + 13}
              textAnchor={i === 0 ? "start" : i === data.buckets.length - 1 ? "end" : "middle"}
              className="font-code tabular"
              fontSize={9}
              fill="var(--fg-disabled)"
            >
              {formatAxisDuration(b.upperMs)}
            </text>
          );
        })}
      </svg>
      </div>
    </div>
  );
}
