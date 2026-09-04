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

   So: DEPTH IS THE COLUMN and sequence is the row — the delegation chain runs
   left to right, the way the Flow view already reads and the way an org chart of
   "who asked whom" is scanned. That is a Reingold–Tilford-ish layered tree, it is
   stable, it is O(n), and it puts the supervisor on the left because the
   supervisor IS the start of the chain.

   ── WHY NOT TOP-DOWN ────────────────────────────────────────────────────────
   It was, and the reason to move is agent NAMES. A node is a circle with a name
   under it; stacked vertically, three levels of delegation puts three names in a
   column 150px wide and they truncate. Laid out horizontally the column is as
   wide as the longest name and the rows are as tall as a circle, which is the
   cheaper direction to spend space in — and it matches the Flow view, so the two
   graph views in one tab do not disagree about which way time runs.

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
  /** This activation owns the span the root-cause attribution picked. */
  isRootCause?: boolean;
  /**
   * On the chain from the run's first activation to the root cause.
   *
   * Emphasised so the eye follows the delegation that broke instead of scanning
   * every node. Computed on the server, which has the parent links and the span
   * that failed; the client has neither together.
   */
  onRootCausePath?: boolean;
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

/**
 * The guard that is meant to catch a repeated handoff.
 *
 * Carries whether it is ENFORCED, because `HANDOFF_LOOP` is a defined stop
 * reason with no construction site in the runtime yet — joins, fan-out and the
 * loop guard land in a later phase. Saying "stopped by HANDOFF_LOOP" over a loop
 * nothing stopped is a claim the data cannot support.
 */
export interface LoopGuard {
  name: string;
  rule: string;
  enforced: boolean;
}

export interface Constellation {
  runId: string;
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  cycles: ConstellationCycle[];
  loopGuard?: LoopGuard;
  /**
   * Why there are no nodes, when there are none. Null when there are.
   *
   * `activations_disabled` — the run produced agent ITERATIONS but no activation
   * rows, which means `AGENT_ACTIVATIONS_ENABLED` was off when it executed. That
   * flag is off by default and set in no environment file, so this is the common
   * case, and the view previously reported it as "this run predates the agent
   * harness" — false, and it sends the reader to look for data that was never
   * written.
   *
   * `no_agent_steps` — the run had no agent step at all. An empty view is then
   * the correct answer rather than a symptom.
   */
  emptyCause?: "activations_disabled" | "no_agent_steps" | null;
  /**
   * The nodes were reconstructed from the ITERATION record, not read from
   * activation rows.
   *
   * NOT a quality warning — the numbers on a derived node are the run's real
   * numbers. It means one specific thing: handoff EDGES were never recorded, so
   * a reader looking at two derived nodes must not conclude the agents never
   * talked to each other.
   *
   * With one node there is nothing to say, and the view says nothing.
   */
  derived?: boolean;
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
  /** The arc's endpoints, so N repeats draw as ONE curve rather than N lines. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  loops: PlacedLoop[];
  width: number;
  height: number;
}

/** Geometry constants. Named so the reasons are readable at the call site. */
/** Vertical space per SIBLING. Two circles plus the name and token line. */
const LANE_HEIGHT = 96;
/** Horizontal space per DEPTH LEVEL. Wide enough for an edge label. */
const COL_WIDTH = 240;
const PAD_X = 90;
const PAD_Y = 60;
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

/**
 * True for a status that means "this produced nothing", so it draws dimmed and
 * dashed.
 *
 * ── WHY `handed_off` IS EXCLUDED ────────────────────────────────────────────
 * It carries a `blockedReason` — "transferred control to another agent" — because
 * the sentence is worth showing. But it is NOT an absence: a router that
 * correctly transferred did its job, and dimming it to 50% says the opposite,
 * that nothing happened here. It gets its own fill and full opacity; the
 * sentence still reaches the reader through the label and the tooltip.
 */
export function isBlocked(n: ConstellationNode): boolean {
  if (n.status === "handed_off") return false;
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

  /* Columns by depth. `Map` preserves insertion order, and nodes arrive ordered
     by `sequence`, so a column's top-to-bottom order is creation order — which
     matches the order a supervisor delegated in and is what somebody reading the
     diagram expects. */
  const columns = new Map<number, ConstellationNode[]>();
  for (const n of c.nodes) {
    const d = Math.max(0, n.depth);
    const col = columns.get(d);
    if (col) col.push(n);
    else columns.set(d, [n]);
  }

  const depths = [...columns.keys()].sort((a, b) => a - b);
  const tallest = Math.max(...depths.map((d) => columns.get(d)!.length));
  const width = PAD_X * 2 + Math.max(1, depths.length) * COL_WIDTH;
  const height = PAD_Y * 2 + Math.max(1, tallest) * LANE_HEIGHT;

  const maxTokens = Math.max(0, ...c.nodes.map((n) => n.tokens ?? 0));

  const placed = new Map<string, PlacedNode>();
  depths.forEach((d, colIndex) => {
    const col = columns.get(d)!;
    /* Columns are CENTRED vertically rather than top-aligned, so a single child
       reads as descending from its parent rather than as an unrelated first row. */
    const colHeight = col.length * LANE_HEIGHT;
    const startY = (height - colHeight) / 2 + LANE_HEIGHT / 2;
    col.forEach((n, i) => {
      placed.set(n.id, {
        ...n,
        x: PAD_X + colIndex * COL_WIDTH + COL_WIDTH / 2,
        y: startY + i * LANE_HEIGHT,
        r: radiusFor(n.tokens ?? 0, maxTokens),
        blocked: isBlocked(n),
      });
    });
  });

  /*
   * ── A CYCLE IS ONE ARC, NOT N EDGES ─────────────────────────────────────
   * Every repeat of a cycle has the same endpoints, so drawing them as ordinary
   * edges puts N identical lines and N identical labels exactly on top of each
   * other — an unreadable blob at precisely the place the reader is looking.
   * They are withheld from the edge list and drawn once, as a curve with the hit
   * count on it.
   *
   * Looked up by id so the set is exact rather than re-derived from geometry.
   */
  const cyclicEdgeIds = new Set(c.cycles.flatMap((cy) => cy.edgeIds));

  const edges: PlacedEdge[] = [];
  for (const e of c.edges) {
    if (cyclicEdgeIds.has(e.id)) continue;
    const to = placed.get(e.to);
    if (!to) continue;
    /* A null `from` is the team node opening the first activation — there is no
       delegating agent, so the edge starts just to the LEFT of its target rather
       than from nowhere. */
    const from = e.from ? placed.get(e.from) : undefined;
    edges.push({
      ...e,
      x1: from?.x ?? to.x - COL_WIDTH / 2,
      y1: from?.y ?? to.y,
      x2: to.x,
      y2: to.y,
      cyclic: false,
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
    const from = edge?.from ? placed.get(edge.from) : undefined;
    const to = edge ? placed.get(edge.to) : undefined;
    const anchor = from ?? to;
    return {
      ...cy,
      x: anchor?.x ?? width / 2,
      y: anchor?.y ?? height / 2,
      x1: from?.x ?? anchor?.x ?? width / 2,
      y1: from?.y ?? anchor?.y ?? height / 2,
      x2: to?.x ?? anchor?.x ?? width / 2,
      y2: to?.y ?? anchor?.y ?? height / 2,
    };
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
