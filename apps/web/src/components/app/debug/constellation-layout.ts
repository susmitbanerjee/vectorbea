/* ══════════════════════════════════════════════════════════════════════════════
   CONSTELLATION LAYOUT — deterministic, no simulation.

   ── WHY NOT A FORCE-DIRECTED GRAPH ──────────────────────────────────────────
   Force layout is the obvious reach for "draw me a graph", and it is wrong here
   for three reasons that all matter more than prettiness:

     1. It is NON-DETERMINISTIC. The same run laid out twice looks different, so
        nobody can say "the writer node, top right" to a colleague, and a
        screenshot in an incident does not match what the next person opens.
     2. It SETTLES OVER TIME. A debugger opened during an incident should be
        readable in the first frame, not after two seconds of nodes drifting.
     3. It hides the one structural fact that matters. A delegation tree has a
        DEPTH, and depth is the thing you are reading: who called whom. A force
        layout throws that away and re-derives an arbitrary arrangement from
        edge tension.

   So: depth is the row, sequence is the column. That is a Reingold–Tilford-ish
   layered tree, it is stable, it is O(n), and it puts the supervisor at the top
   because the supervisor IS at the top.

   ── CYCLES ──────────────────────────────────────────────────────────────────
   A cycle cannot be a row-to-row edge, because both ends are in the same row or
   the edge points upward. Those are separated out as `loops` and drawn as an
   arc with a hit counter beside the guard that stopped them, which is both
   honest and much easier to read than an edge that crosses six rows.

   Pure: no React, no DOM, no measurement. Which is what lets the twelve-node
   acceptance case be a unit test rather than a screenshot.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ConstellationNode {
  id: string;
  parentId: string | null;
  depth: number;
  status: string;
  role: string | null;
  agentName: string;
  stopReason: string | null;
  tokens: number;
  costCents: number;
  iterations: number;
  blockedReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ConstellationEdge {
  id: string;
  from: string | null;
  to: string;
  kind: string;
  reason: string | null;
  contractHash: string;
  joinGroupId: string | null;
  createdAt: string | null;
  contract: string | null;
  output: string | null;
}

export interface ConstellationCycle {
  fromAgent: string | null;
  toAgent: string | null;
  contractHash: string;
  hits: number;
  edgeIds: string[];
  kind: string;
}

export interface Constellation {
  runId: string;
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  cycles: ConstellationCycle[];
}

export interface PlacedNode extends ConstellationNode {
  x: number;
  y: number;
  /** Radius in px. Scales with tokens — see `radiusFor`. */
  r: number;
  /** True when this activation produced nothing. Rendered greyed, with a reason. */
  blocked: boolean;
}

export interface PlacedEdge extends ConstellationEdge {
  x1: number; y1: number;
  x2: number; y2: number;
  /** True when this edge is part of a counted cycle. */
  cyclic: boolean;
}

export interface PlacedLoop extends ConstellationCycle {
  /** The node the loop is drawn beside. */
  x: number;
  y: number;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  loops: PlacedLoop[];
  width: number;
  height: number;
}

/** Geometry constants. Named so the reasons are readable at the call site. */
const ROW_HEIGHT = 120;
const MIN_COL_WIDTH = 150;
const PAD_X = 80;
const PAD_Y = 70;
const MIN_R = 14;
const MAX_R = 40;

/**
 * Node radius from token spend.
 *
 * ── SQUARE ROOT, NOT LINEAR ─────────────────────────────────────────────────
 * A circle's AREA is what the eye reads as magnitude, and area goes as r². A
 * linear radius therefore exaggerates: an agent that spent 10× as much looks
 * 100× bigger and swamps the diagram. The square root makes area proportional to
 * tokens, which is the comparison somebody is actually making.
 *
 * Clamped at both ends. The floor keeps a zero-token activation clickable — a
 * blocked node has spent nothing and is often the one you came to look at. The
 * ceiling stops one runaway member from covering its neighbours.
 */
export function radiusFor(tokens: number, maxTokens: number): number {
  if (maxTokens <= 0 || tokens <= 0) return MIN_R;
  const ratio = Math.sqrt(Math.min(tokens, maxTokens) / maxTokens);
  return MIN_R + ratio * (MAX_R - MIN_R);
}

/** True for a status that means "this produced nothing". */
export function isBlocked(n: ConstellationNode): boolean {
  return n.blockedReason !== null && n.blockedReason !== undefined;
}

/**
 * Lay the constellation out.
 *
 * Deterministic in the input order: nodes arrive ordered by `sequence`, which is
 * creation order, so two loads of one run produce identical coordinates.
 */
export function layout(c: Constellation): Layout {
  if (c.nodes.length === 0) {
    return { nodes: [], edges: [], loops: [], width: 0, height: 0 };
  }

  /* Rows by depth. `Map` preserves insertion order, and the nodes arrive in
     sequence order, so a row's left-to-right order is creation order — which
     matches the order a supervisor delegated in and is what somebody reading the
     diagram expects. */
  const rows = new Map<number, ConstellationNode[]>();
  for (const n of c.nodes) {
    const d = Math.max(0, n.depth);
    const row = rows.get(d);
    if (row) row.push(n);
    else rows.set(d, [n]);
  }

  const depths = [...rows.keys()].sort((a, b) => a - b);
  const widest = Math.max(...depths.map((d) => rows.get(d)!.length));
  const colWidth = Math.max(MIN_COL_WIDTH, MAX_R * 2 + 30);
  const width = PAD_X * 2 + Math.max(1, widest) * colWidth;
  const height = PAD_Y * 2 + Math.max(1, depths.length) * ROW_HEIGHT;

  const maxTokens = Math.max(0, ...c.nodes.map((n) => n.tokens ?? 0));

  const placed = new Map<string, PlacedNode>();
  depths.forEach((d, rowIndex) => {
    const row = rows.get(d)!;
    /* Rows are CENTRED rather than left-aligned, so a narrow row under a wide
       one reads as descending from it rather than as a separate column. */
    const rowWidth = row.length * colWidth;
    const startX = (width - rowWidth) / 2 + colWidth / 2;
    row.forEach((n, i) => {
      placed.set(n.id, {
        ...n,
        x: startX + i * colWidth,
        y: PAD_Y + rowIndex * ROW_HEIGHT,
        r: radiusFor(n.tokens ?? 0, maxTokens),
        blocked: isBlocked(n),
      });
    });
  });

  /* Which edges belong to a counted cycle. Looked up by id so the set is exact
     rather than re-derived from the geometry. */
  const cyclicEdgeIds = new Set(c.cycles.flatMap((cy) => cy.edgeIds));

  const edges: PlacedEdge[] = [];
  for (const e of c.edges) {
    const to = placed.get(e.to);
    if (!to) continue;
    /* A null `from` is the team node opening the first activation — there is no
       delegating agent, so the edge starts just above its target rather than
       from nowhere. */
    const from = e.from ? placed.get(e.from) : undefined;
    edges.push({
      ...e,
      x1: from?.x ?? to.x,
      y1: from?.y ?? to.y - ROW_HEIGHT / 2,
      x2: to.x,
      y2: to.y,
      cyclic: cyclicEdgeIds.has(e.id),
    });
  }

  /*
   * Loops are anchored on the node they leave FROM, so "this agent kept asking
   * the same question" reads off the diagram at the agent doing the asking.
   * Falling back to the target keeps a loop visible when the source activation
   * is missing — a truncated trace should not silently drop the evidence of a
   * cycle, which is usually the thing being looked for.
   */
  const loops: PlacedLoop[] = c.cycles.map((cy) => {
    const edge = c.edges.find((e) => e.id === cy.edgeIds[0]);
    const anchor =
      (edge?.from ? placed.get(edge.from) : undefined) ??
      (edge ? placed.get(edge.to) : undefined);
    return { ...cy, x: anchor?.x ?? width / 2, y: anchor?.y ?? height / 2 };
  });

  return { nodes: [...placed.values()], edges, loops, width, height };
}

/**
 * The fan-out groups, so one BROADCAST draws as one bracket.
 *
 * Without this, five children of one broadcast are five unrelated edges and the
 * most interesting fact about the run — that the supervisor asked five agents at
 * once — is invisible.
 */
export function joinGroups(edges: ConstellationEdge[]): Map<string, ConstellationEdge[]> {
  const groups = new Map<string, ConstellationEdge[]>();
  for (const e of edges) {
    if (!e.joinGroupId) continue;
    const g = groups.get(e.joinGroupId);
    if (g) g.push(e);
    else groups.set(e.joinGroupId, [e]);
  }
  /* A "group" of one is a plain delegation that happened to carry a group id.
     Bracketing it would claim a fan-out that did not happen. */
  for (const [k, v] of groups) if (v.length < 2) groups.delete(k);
  return groups;
}
