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
  const y = linearScale([0, maxCount], [height - padB, padT]);
  const barWidth = Math.max(2, (width - padL - padR) / data.buckets.length - 2);

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full min-w-[26rem]"
        role="img"
        aria-label={`Execution latency distribution over ${data.sampleCount} runs. Median ${formatAxisDuration(data.p50)}, p95 ${formatAxisDuration(data.p95)}, p99 ${formatAxisDuration(data.p99)}.`}
      >
        {/* Count gridlines. Two is enough to read magnitude. */}
        {[maxCount / 2, maxCount].map((v) => (
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
          const cx = x(Math.log(b.upperMs));
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

        {/* Percentile markers, drawn over the bars. */}
        {MARKERS.map((m) => {
          const value = data[m.key];
          const cx = x(Math.log(Math.max(lowerMs, value)));
          return (
            <g key={m.key}>
              <line x1={cx} x2={cx} y1={padT - 8} y2={height - padB} stroke={m.colour} strokeWidth={1} strokeDasharray="3 2" />
              <text x={cx} y={padT - 11} textAnchor="middle" className="font-ui" fontSize={9} fill={m.colour}>
                {m.label} {formatAxisDuration(value)}
              </text>
            </g>
          );
        })}

        {/* Axis: first, middle and last bucket only. */}
        <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} stroke="var(--border-default)" strokeWidth={1} />
        {[0, Math.floor(data.buckets.length / 2), data.buckets.length - 1].map((i) => {
          const b = data.buckets[i];
          if (!b) return null;
          return (
            <text
              key={i}
              x={x(Math.log(b.upperMs))}
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
  );
}
