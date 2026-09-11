/* ══════════════════════════════════════════════════════════════════════════════
   AN OFFSET OUTLINE OF THE CELL — the ring that sits around a node.

   ── THE BUG THIS REPLACES: NODES THAT LOOKED ROTATED ───────────────────────
   Every ring in the product was drawn by asking `cellPath` for a BIGGER cell
   and sliding it back by half the growth:

       <path d={cellPath(w + 8, h + 8)} transform="translate(-4 -4)" />

   That is a correct parallel offset for the straight edges and wrong for the
   two clipped corners, because `cellPath` recomputes `clip` from the size it is
   given and then CLAMPS it at 6px. The bigger cell therefore got the same 6px
   clip as the smaller one, so the chamfer did not move outward with the rest of
   the outline.

   Measured on a real 128×40 node with the executing ring around it: the ring
   sat 4.00px outside the flat edges and 5.66px outside the chamfers — 41% wider
   at exactly two corners, and those two corners are diagonally opposite. Two
   opposite corners splaying along one diagonal is precisely the cue the eye
   reads as ROTATION, which is why the run canvas looked very slightly tilted
   and why nothing in the CSS explained it: no element was rotated, the SVG
   transform was a pure translate, and every node sat at y = 0.

   ── THE GEOMETRY ──────────────────────────────────────────────────────────
   A true outward offset by `d` moves every edge along its own normal by `d`.

     · A straight edge moves by `d`.
     · A circular corner of radius `r` becomes radius `r + d`.
     · A 45° chamfer is the line `x + y = clip`. Offsetting it outward (towards
       the corner it cuts) gives `x + y = clip − d√2`. Expressed in the grown
       box's own coordinates, whose origin is at `(−d, −d)`, that is

           clipRing = clip + d(2 − √2)          ≈ clip + 0.586 d

   So the chamfer grows a little MORE than half the box does, which is exactly
   what the clamp was preventing.

   ── WHY A SEPARATE FUNCTION AND NOT A PARAMETER ON `cellPath` ─────────────
   `cellPath` answers "what shape is a cell this size". This answers "what
   outline sits `d` outside a cell that size" — a different question with a
   different input, and the reason the old code was wrong is that it used the
   first to answer the second. Keeping them apart means the next ring cannot be
   drawn the broken way by accident: there is now a function whose name is the
   thing the caller wants.

   Returns the path in the NODE's coordinate space, already starting at
   `(−d, −d)`, so callers do not add a `translate` — the translate was the other
   half of the old mistake and there is no longer anywhere to put a wrong one.
══════════════════════════════════════════════════════════════════════════════ */

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * The clip and corner radius `cellPath` would use for a `w`×`h` cell.
 *
 * Duplicated from `geometry.ts` rather than exported from it, deliberately: the
 * ring has to know what the BASE cell did, and a shared helper that both call
 * would invite someone to "simplify" by passing the ring's own size to it —
 * which is the bug. Asserted identical by `geometry-ring.test.ts`, so a change
 * to one that is not made to the other fails the build rather than the eye.
 */
function cellProportions(w: number, h: number): { clip: number; r: number } {
  const min = Math.min(w, h);
  return {
    clip: clamp(min * 0.34, 0.7, 6),
    r: clamp(min * 0.16, 0.3, 2.5),
  };
}

/** How much more the 45° chamfer moves than a straight edge, per unit of offset. */
const CHAMFER_FACTOR = 2 - Math.SQRT2;

/**
 * An outline sitting exactly [outset] px outside a [w]×[h] cell, on every edge.
 *
 * In the cell's own coordinates: the path starts at `(-outset, -outset)` and
 * ends at `(w + outset, h + outset)`. Draw it as a sibling of the cell with no
 * transform of its own.
 */
export function cellRingPath(w: number, h: number, outset: number): string {
  const base = cellProportions(w, h);
  /* Grown from the BASE cell's proportions, never recomputed from the ring's
     own size — that recomputation, and the clamp inside it, is what made the
     old rings splay at the chamfers. */
  const clip = base.clip + outset * CHAMFER_FACTOR;
  const r = base.r + outset;

  const x0 = -outset;
  const y0 = -outset;
  const x1 = w + outset;
  const y1 = h + outset;

  const f = (n: number) => n.toFixed(2);

  return [
    `M${f(x0 + clip)} ${f(y0)}`,
    `H${f(x1 - r)}`,
    `Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + r)}`,
    `V${f(y1 - clip)}`,
    `L${f(x1 - clip)} ${f(y1)}`,
    `H${f(x0 + r)}`,
    `Q${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - r)}`,
    `V${f(y0 + clip)}`,
    "Z",
  ].join(" ");
}
