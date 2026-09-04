"use client";

import * as React from "react";
import { useStore } from "@xyflow/react";

/* ══════════════════════════════════════════════════════════════════════════════
   THE CANVAS LATTICE — §2, rendered.

   "Hexagonal derivation for the canvas lattice." Not a hexagon-tiled background,
   which §2 explicitly forbids as literal hive imagery. What is drawn is the
   VERTEX SET of a hex lattice: the points where three cells would meet, at very
   low contrast, with nothing joining them.

   The result reads as a precision surface — a measuring grid — rather than as
   decoration, and it is structurally the hive without being a picture of one.
   A plain dot grid is what every node editor ships; the offset rows are the
   difference, and they are visible without ever being noticeable.

   THE MARKS SCALE WITH ZOOM BUT THE DENSITY DOES NOT. Below 55% the lattice
   fades out entirely: at that zoom the dots are closer together than they are
   wide, and a surface of touching dots is noise that fights the graph.
══════════════════════════════════════════════════════════════════════════════ */

/** Lattice pitch in canvas units. A multiple of the 4px base from §8. */
const PITCH = 32;

export function LatticeBackground() {
  // Subscribed individually so a pan re-renders this and nothing else.
  const transform = useStore((s) => s.transform);
  const [tx, ty, zoom] = transform;

  // The vertex set of a hex lattice: every other row offset by half a pitch,
  // rows spaced by the hex height ratio (√3 / 2).
  const rowHeight = PITCH * 0.866;
  // Per-instance, because a hard-coded id collides the moment two canvases share
  // a document — and an SVG pattern collision is silent: the second definition
  // wins and one canvas quietly renders the other's lattice.
  const patternId = React.useId().replace(/:/g, "");

  /* Fade out only once the marks genuinely crowd.
     The pitch on screen is PITCH × zoom, so at 35% the dots still sit 11px
     apart — legible as a lattice, nowhere near texture. An earlier cut at 55%
     meant a graph wide enough to open below that zoom never showed its own
     background at all. Squared falloff so it is gone before it becomes noise,
     not after. */
  const opacity = zoom < 0.3 ? 0 : Math.min(1, ((zoom - 0.3) / 0.25) ** 2);
  // Held near a constant ~0.8px on screen: a dot that scales with zoom becomes
  // a blob at 200% and disappears at 40%.
  const radius = Math.max(0.45, Math.min(1.6, 0.8 / Math.max(zoom, 0.3)));

  if (opacity === 0) {
    return <div className="bg-surface-canvas pointer-events-none absolute inset-0" aria-hidden="true" />;
  }

  return (
    <div className="bg-surface-canvas pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg className="size-full" style={{ opacity }}>
        <defs>
          <pattern
            id={patternId}
            width={PITCH}
            height={rowHeight * 2}
            patternUnits="userSpaceOnUse"
            // The pattern rides the canvas transform, so the lattice is fixed to
            // the graph rather than to the viewport — a node dropped on a vertex
            // stays on it through a pan.
            patternTransform={`translate(${tx % (PITCH * zoom)} ${ty % (rowHeight * 2 * zoom)}) scale(${zoom})`}
          >
            <circle cx={0} cy={0} r={radius} fill="var(--border-subtle)" />
            <circle cx={PITCH} cy={0} r={radius} fill="var(--border-subtle)" />
            <circle cx={PITCH / 2} cy={rowHeight} r={radius} fill="var(--border-subtle)" />
            <circle cx={0} cy={rowHeight * 2} r={radius} fill="var(--border-subtle)" />
            <circle cx={PITCH} cy={rowHeight * 2} r={radius} fill="var(--border-subtle)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}

/* ── Alignment guides ─────────────────────────────────────────────────────── */

export interface GuideLine {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/**
 * Guides drawn in canvas space, transformed with the viewport.
 *
 * Iris, not a status hue — an alignment guide is a brand affordance, and §3's
 * rule that status colour is reserved for run state applies to the canvas as
 * much as to a table.
 */
export function AlignmentGuides({ guides }: { guides: GuideLine[] }) {
  const transform = useStore((s) => s.transform);
  const [tx, ty, zoom] = transform;

  if (guides.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
      <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
        {guides.map((guide, i) => (
          <line
            key={i}
            x1={guide.axis === "x" ? guide.at : guide.from}
            x2={guide.axis === "x" ? guide.at : guide.to}
            y1={guide.axis === "x" ? guide.from : guide.at}
            y2={guide.axis === "x" ? guide.to : guide.at}
            stroke="var(--accent)"
            strokeWidth={1 / zoom}
            strokeDasharray={`${3 / zoom} ${3 / zoom}`}
            opacity={0.8}
          />
        ))}
      </g>
    </svg>
  );
}
