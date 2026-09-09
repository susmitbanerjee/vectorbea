"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { cellPath } from "~/components/app/ribbon/geometry";
import type { RunStatus } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   <Heatstrip> — one workflow's last N runs as a row of outcome cells.

   The Datadog-competitive element (§10, Control). A fleet of twenty workflows
   renders as twenty rows; an anomaly is a band of red in an otherwise green row,
   and you see it before you have read a single number. That is the whole point:
   pre-attentive processing beats a sorted table of failure percentages.

   GEOMETRY. Cells reuse `cellPath` from the Ribbon. The Ribbon means "a durable
   unit of work"; here the unit is a run rather than a node, but it is the same
   idea one level up, and giving it a different shape would imply a different
   kind of thing. §5's anti-requirement is about decoration — this encodes real
   state, so the shared geometry is the point rather than a violation.

   COLOUR. Status tokens only. Success green here is the same green as a
   committed cell in a Ribbon, because it means the same thing.
══════════════════════════════════════════════════════════════════════════════ */

const STATUS_FILL: Record<RunStatus, string | null> = {
  succeeded: "var(--status-success)",
  failed: "var(--status-failed)",
  running: "var(--status-live)",
  "awaiting-approval": "var(--status-waiting)",
  waiting: "var(--status-waiting)",
  queued: null,
  cancelled: null,
};

const STATUS_LABEL: Record<RunStatus, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
  "awaiting-approval": "Awaiting approval",
  waiting: "Waiting",
  queued: "Queued",
  cancelled: "Cancelled",
};

export interface HeatstripProps {
  /** Newest last, so the strip reads left-to-right as time. */
  statuses: RunStatus[];
  /** Run ids parallel to `statuses`. Null where the run is not linkable. */
  runIds?: (string | null)[];
  cellWidth?: number;
  cellHeight?: number;
  gap?: number;
  label: string;
  onSelect?: (index: number, runId: string | null) => void;
  onHover?: (index: number | null) => void;
  className?: string;
}

export function Heatstrip({
  statuses, runIds, cellWidth = 10, cellHeight = 20, gap = 3, label, onSelect, onHover, className,
}: HeatstripProps) {
  const [focused, setFocused] = React.useState<number | null>(null);
  const width = statuses.length * (cellWidth + gap) - gap;
  const path = React.useMemo(() => cellPath(cellWidth, cellHeight), [cellWidth, cellHeight]);

  const move = (delta: number) => {
    setFocused((current) => {
      const next = Math.min(statuses.length - 1, Math.max(0, (current ?? 0) + delta));
      onHover?.(next);
      return next;
    });
  };

  return (
    <div
      className={cn("relative", className)}
      onMouseLeave={() => onHover?.(null)}
    >
      <svg
        width={width}
        height={cellHeight}
        viewBox={`0 0 ${width} ${cellHeight}`}
        role="img"
        aria-label={`${label}: last ${statuses.length} runs. ${summarise(statuses)}`}
        // The strip is one tab stop; arrow keys move between cells. It must
        // declare its own ring — the unscoped legacy `:focus-visible` in
        // app/globals.css otherwise paints the pre-revamp green one, which is
        // success green indicating focus (CURRENT-STATE §9.9).
        className={cn(
          "block overflow-visible rounded-xs",
          "outline-none focus-visible:focus-ring",
        )}
        tabIndex={0}
        onFocus={() => setFocused((f) => f ?? statuses.length - 1)}
        onBlur={() => { setFocused(null); onHover?.(null); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (focused !== null) onSelect?.(focused, runIds?.[focused] ?? null);
          }
        }}
      >
        {statuses.map((status, i) => {
          const fill = STATUS_FILL[status];
          const x = i * (cellWidth + gap);
          const isFocused = focused === i;
          return (
            <g key={i} transform={`translate(${x} 0)`}>
              <path
                d={path}
                fill={fill ?? "transparent"}
                stroke={fill ? "none" : "var(--border-default)"}
                strokeWidth={fill ? 0 : 1}
                strokeDasharray={status === "cancelled" ? "2 2" : undefined}
                className="cursor-pointer"
                onMouseEnter={() => onHover?.(i)}
                onClick={() => onSelect?.(i, runIds?.[i] ?? null)}
              >
                <title>{`${STATUS_LABEL[status]} · ${statuses.length - i} run${statuses.length - i === 1 ? "" : "s"} ago`}</title>
              </path>
              {isFocused ? (
                <path
                  d={cellPath(cellWidth + 4, cellHeight + 4)}
                  transform="translate(-2 -2)"
                  fill="none"
                  stroke="var(--border-focus)"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function summarise(statuses: RunStatus[]): string {
  const counts = statuses.reduce<Partial<Record<RunStatus, number>>>((acc, s) => {
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([status, n]) => `${n} ${STATUS_LABEL[status as RunStatus].toLowerCase()}`)
    .join(", ");
}

export { STATUS_LABEL as HEATSTRIP_STATUS_LABEL };
