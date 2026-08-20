"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { linearScale, linePath, areaPath, niceMax, formatTick, type Point } from "./scale";
import { formatCost, formatTokens } from "~/lib/format";
import type { CostTrend } from "~/mocks/control";
import type { TimeRange } from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   <CostTrendChart> — spend per bucket with the budget line overlaid, and token
   volume behind it.

   The budget line is the reason this is not just a cost sparkline. Spend without
   an allowance is a number you glance at; spend crossing its allowance is a
   decision. Buckets over budget are drawn in the failed hue, which is the only
   place on this page where cost borrows a status colour — justified because an
   over-budget bucket IS a failure of a policy the workspace set.
══════════════════════════════════════════════════════════════════════════════ */

export interface CostTrendChartProps {
  data: CostTrend;
  range: TimeRange;
  height?: number;
  onSelectBucket?: (fromMs: number, toMs: number) => void;
  className?: string;
}

export function CostTrendChart({ data, range, height = 168, onSelectBucket, className }: CostTrendChartProps) {
  const [hover, setHover] = React.useState<number | null>(null);

  if (data.points.length === 0) {
    return (
      <div
        className={cn("border-subtle grid place-items-center rounded-md border border-dashed", className)}
        style={{ height }}
      >
        <Text variant="body-sm" tone="muted">No spend in this range.</Text>
      </div>
    );
  }

  const padL = 42;
  const padR = 10;
  const padT = 14;
  const padB = 26;
  const width = 560;

  const maxCost = niceMax(Math.max(data.budgetPerBucketUsd, ...data.points.map((p) => p.costUsd)));
  const maxTokens = Math.max(1, ...data.points.map((p) => p.tokens));
  const hasBudget = data.budgetPerBucketUsd > 0;

  const x = linearScale([0, data.points.length - 1], [padL, width - padR]);
  const y = linearScale([0, maxCost], [height - padB, padT]);
  const yTokens = linearScale([0, maxTokens], [height - padB, padT + 24]);

  const tokenPts: Point[] = data.points.map((p, i) => ({ x: x(i), y: yTokens(p.tokens) }));
  const budgetY = y(data.budgetPerBucketUsd);
  const barWidth = Math.max(2, (width - padL - padR) / data.points.length - 2);

  const hovered = hover !== null ? data.points[hover] : null;

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full min-w-[26rem]"
        role="img"
        aria-label={`Spend and token volume. ${formatCost(data.totalUsd)} and ${formatTokens(data.totalTokens)} tokens in this range${hasBudget ? `, against a budget of ${formatCost(data.budgetPerBucketUsd)} per bucket` : "; no spend budget is configured"}.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Token volume, behind everything — context, not the subject. */}
        <path d={areaPath(tokenPts, height - padB)} fill="var(--accent)" opacity={0.1} />
        <path d={linePath(tokenPts)} fill="none" stroke="var(--accent)" strokeWidth={1} opacity={0.35} />

        {/* Cost bars. */}
        {data.points.map((p, i) => {
          const over = hasBudget && p.costUsd > data.budgetPerBucketUsd;
          const active = hover === i;
          return (
            <rect
              key={i}
              x={x(i) - barWidth / 2}
              y={y(p.costUsd)}
              width={barWidth}
              height={Math.max(p.costUsd > 0 ? 1 : 0, height - padB - y(p.costUsd))}
              fill={over ? "var(--status-failed)" : "var(--accent)"}
              opacity={active ? 1 : over ? 0.85 : 0.6}
              className="cursor-pointer transition-opacity duration-instant"
              onMouseEnter={() => setHover(i)}
              onClick={() => onSelectBucket?.(p.t, p.t + range.bucketMs)}
            >
              <title>{`${formatTick(p.t, range.tickFormat)} · ${formatCost(p.costUsd)} · ${formatTokens(p.tokens)} tokens`}</title>
            </rect>
          );
        })}

        {/* Budget line, on top of the bars so an overspend reads as a breach. */}
        {hasBudget ? (
          <>
            <line
              x1={padL} x2={width - padR} y1={budgetY} y2={budgetY}
              stroke="var(--status-waiting)" strokeWidth={1.5} strokeDasharray="5 3"
            />
            <text
              x={width - padR} y={budgetY - 5} textAnchor="end"
              className="font-ui" fontSize={10} fill="var(--status-waiting)"
            >
              budget {formatCost(data.budgetPerBucketUsd)}
            </text>
          </>
        ) : null}

        {/* Y axis. */}
        {[maxCost / 2, maxCost].map((v) => (
          <text
            key={v} x={padL - 6} y={y(v) + 3} textAnchor="end"
            className="font-code tabular" fontSize={9} fill="var(--fg-disabled)"
          >
            {formatCost(v)}
          </text>
        ))}

        {/* X axis. */}
        <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} stroke="var(--border-default)" strokeWidth={1} />
        {[0, Math.floor(data.points.length / 2), data.points.length - 1].map((i) => {
          const p = data.points[i];
          if (!p) return null;
          return (
            <text
              key={i}
              x={x(i)} y={height - padB + 13}
              textAnchor={i === 0 ? "start" : i === data.points.length - 1 ? "end" : "middle"}
              className="font-code tabular" fontSize={9} fill="var(--fg-disabled)"
            >
              {formatTick(p.t, range.tickFormat)}
            </text>
          );
        })}

        {hovered ? (
          <line
            x1={x(hover!)} x2={x(hover!)} y1={padT} y2={height - padB}
            stroke="var(--border-strong)" strokeWidth={1} pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  );
}
