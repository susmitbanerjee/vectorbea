"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { linearScale, linePath, areaPath, type Point } from "./scale";
import type { BudgetPoint } from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   <Burndown> — failure budget remaining, against the ideal burn.

   This chart exists to reframe one number. "41% success rate" is a shaming
   statistic: true, unactionable, and identical whether you are having a normal
   Tuesday or an outage. The same failures plotted against an allowance say
   something an operator can act on — you are ahead of budget, or you are 214%
   through it and the line went vertical at 09:00.

   The reference line is the ideal linear burn. Above it is fine. Crossing zero
   is the event.
══════════════════════════════════════════════════════════════════════════════ */

export interface BurndownProps {
  series: BudgetPoint[];
  /** Rendered inline; the caller owns the surrounding label. */
  height?: number;
  className?: string;
}

export function Burndown({ series, height = 40, className }: BurndownProps) {
  // Fixed viewBox, fluid render. A fixed pixel width collided with the metric
  // label once the health cell narrowed; letting the SVG scale means the chart
  // can never overlap its own caption at any breakpoint.
  const width = 132;
  const pad = 2;

  const { path, ideal, zeroY, breachX, area } = React.useMemo(() => {
    if (series.length === 0) {
      return { path: "", ideal: "", zeroY: height / 2, breachX: null as number | null, area: "" };
    }

    /**
     * The floor is one full budget overspent, and the line clamps to it.
     *
     * Without the clamp, a workspace 9.8× over budget gives a domain of
     * [-9.8, 1]: the ideal line and the first 90% of the actual line compress
     * into the top tenth of the chart, and the only legible feature is a
     * vertical drop. Clamping keeps the SHAPE of the burn readable — when it
     * started, how steep it was — and the exact magnitude is stated as a number
     * beside the chart, which is where a magnitude belongs anyway.
     */
    const FLOOR = -1;
    const x = linearScale([0, series.length - 1], [pad, width - pad]);
    const y = linearScale([FLOOR, 1], [height - pad, pad]);

    const pts: Point[] = series.map((p, i) => ({
      x: x(i),
      y: y(Math.max(FLOOR, p.remaining)),
    }));
    const idealPts: Point[] = series.map((p, i) => ({ x: x(i), y: y(p.ideal) }));

    // Where the budget ran out, if it did — the moment worth marking.
    const breachIndex = series.findIndex((p) => p.remaining <= 0);

    return {
      path: linePath(pts),
      ideal: linePath(idealPts),
      zeroY: y(0),
      breachX: breachIndex >= 0 ? x(breachIndex) : null,
      area: areaPath(pts, y(0)),
    };
  }, [series, height]);

  if (series.length === 0) {
    return <div className={cn("bg-surface-sunken w-full rounded-sm", className)} style={{ height }} />;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ height }}
      className={cn("block w-full", className)}
    >
      {/* Budget exhausted line. */}
      <line
        x1={0} x2={width} y1={zeroY} y2={zeroY}
        stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3"
      />

      {/* Ideal burn — deliberately faint. It is a reference, not a target. */}
      <path d={ideal} fill="none" stroke="var(--border-default)" strokeWidth={1} strokeDasharray="2 3" />

      {/* Actual. Filled below zero only, so overspend is the visible thing. */}
      <clipPath id="burndown-overspend">
        <rect x={0} y={zeroY} width={width} height={Math.max(0, height - zeroY)} />
      </clipPath>
      <path d={area} fill="var(--status-failed)" opacity={0.16} clipPath="url(#burndown-overspend)" />
      <path d={path} fill="none" stroke="var(--status-failed)" strokeWidth={1.5} strokeLinejoin="round" />

      {breachX !== null ? (
        <line
          x1={breachX} x2={breachX} y1={0} y2={height}
          stroke="var(--status-failed)" strokeWidth={1} opacity={0.5}
        />
      ) : null}
    </svg>
  );
}
