import { describe, expect, it } from "vitest";

import { cellPath } from "~/components/app/ribbon/geometry";
import { cellRingPath } from "~/components/app/ribbon/geometry-ring";

/* ══════════════════════════════════════════════════════════════════════════════
   A RING MUST BE THE SAME DISTANCE FROM THE CELL ON EVERY EDGE.

   The defect this guards against does not look like a geometry bug when you
   meet it: the run canvas reads as very slightly ROTATED, nothing in the CSS is
   rotated, the SVG transform is a pure translate, and every node sits at y = 0.
   The cause is that the ring splayed wider at the two clipped corners than at
   the flat edges — and those two corners are diagonally opposite, which is the
   cue the eye reads as rotation.

   So the assertion is the distance itself, at both kinds of edge, rather than a
   snapshot of the path string.
══════════════════════════════════════════════════════════════════════════════ */

/** The `y` of the top edge: the first vertical coordinate in the path. */
function topEdgeY(d: string): number {
  const m = /^M[-\d.]+ ([-\d.]+)/.exec(d);
  if (!m) throw new Error(`no start point in ${d}`);
  return Number(m[1]);
}

/**
 * The chamfer, as the constant `c` in `x + y = c`.
 *
 * Both chamfers are 45° lines, so one number describes each. The top-left one
 * runs from the path's start point to the end of the final `V`.
 */
function chamferConstant(d: string): number {
  const m = /^M([-\d.]+) ([-\d.]+)/.exec(d);
  if (!m) throw new Error(`no start point in ${d}`);
  return Number(m[1]) + Number(m[2]);
}

/**
 * How closely the measured gap must match, in decimal places.
 *
 * Two, because the paths round their coordinates to two decimals — asserting
 * tighter than the path's own resolution would be asserting about `toFixed`,
 * not about the geometry. A hundredth of a pixel is four hundred times smaller
 * than the 1.66px splay this test exists to catch.
 */
const PRECISION = 2;

/** Perpendicular distance between two parallel 45° lines `x+y=a` and `x+y=b`. */
const diagonalGap = (a: number, b: number) => Math.abs(a - b) / Math.SQRT2;

describe("cellRingPath", () => {
  it("sits the same distance from the cell at a flat edge and at a chamfer", () => {
    const w = 128;
    const h = 40;
    const outset = 4;

    const cell = cellPath(w, h);
    const ring = cellRingPath(w, h, outset);

    const flatGap = topEdgeY(cell) - topEdgeY(ring);
    const chamferedGap = diagonalGap(chamferConstant(cell), chamferConstant(ring));

    expect(flatGap).toBeCloseTo(outset, PRECISION);
    expect(chamferedGap).toBeCloseTo(outset, PRECISION);
  });

  it("is what the old `cellPath(w+2d, h+2d)` trick was not", () => {
    /*
     * The regression, stated as the number it actually produced. A 128×40 node
     * with a 4px executing ring measured 4.00px out at the flat edges and
     * 5.66px out at the chamfers — 41% wider at two opposite corners.
     */
    const cell = cellPath(128, 40);
    const oldRing = cellPath(128 + 8, 40 + 8); // drawn with transform="translate(-4 -4)"
    const oldChamferGap = diagonalGap(
      chamferConstant(cell),
      chamferConstant(oldRing) - 4 - 4, // undo the translate
    );

    expect(oldChamferGap).toBeGreaterThan(5.6);
    expect(diagonalGap(chamferConstant(cell), chamferConstant(cellRingPath(128, 40, 4))))
      .toBeCloseTo(4, PRECISION);
  });

  it("holds at every outset a caller actually uses", () => {
    // 2 (ribbon bloom), 3 (canvas focus), 4 (canvas executing/gated), 5 (builder).
    for (const outset of [2, 3, 4, 5]) {
      const ring = cellRingPath(128, 40, outset);
      expect(topEdgeY(cellPath(128, 40)) - topEdgeY(ring)).toBeCloseTo(outset, PRECISION);
      expect(diagonalGap(chamferConstant(cellPath(128, 40)), chamferConstant(ring)))
        .toBeCloseTo(outset, PRECISION);
    }
  });

  it("holds for a small ribbon cell as well as a wide canvas node", () => {
    /* The ribbon's cells are a few px tall, where `clip` is well under its
       clamp — the case the clamp was never the problem for, and which must not
       regress while fixing the case it was. */
    for (const [w, h] of [[6, 6], [10, 24], [128, 40], [220, 64]] as const) {
      const ring = cellRingPath(w, h, 2);
      expect(topEdgeY(cellPath(w, h)) - topEdgeY(ring)).toBeCloseTo(2, PRECISION);
      expect(diagonalGap(chamferConstant(cellPath(w, h)), chamferConstant(ring)))
        .toBeCloseTo(2, PRECISION);
    }
  });

  it("keeps the ring's corner radius one offset larger than the cell's", () => {
    /* A circular arc offset outward by d has radius r + d. Read it back off the
       `Q` control point: the top-right corner starts at `H(x1 - r)`. */
    const ring = cellRingPath(128, 40, 4);
    const m = /H([-\d.]+) Q/.exec(ring);
    expect(m).not.toBeNull();
    const x1 = 128 + 4;
    const ringR = x1 - Number(m![1]);
    // cellPath's r for 128×40 is clamp(40*0.16, 0.3, 2.5) = 2.5
    expect(ringR).toBeCloseTo(2.5 + 4, PRECISION);
  });
});
