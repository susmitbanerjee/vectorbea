"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import type { Run, RunNode, CellState } from "~/lib/runs/model";

/* ══════════════════════════════════════════════════════════════════════════════
   REPLAY — the spine of this screen.

   §7.2 #7: "dragging the Ribbon drives canvas node states, log scroll position,
   and the metrics header in one synchronised transform. No lag, no easing — it
   tracks the pointer 1:1."

   That sentence is a state-management requirement, not an animation one. One
   source of truth, read by four panes, updated synchronously on pointer move:

     scrubIndex   — where the pointer is, or null when not scrubbing
     selectedIndex — the step the panes are pinned to when nobody is scrubbing
     focusIndex   — scrubIndex ?? selectedIndex; what the panes actually render

   The distinction matters. Scrubbing must not destroy the operator's selection:
   you drag across the ribbon to see what happened, let go, and the inspector is
   still on the step you were reading. Only a click commits a new selection.

   NO CONTEXT VALUE MEMO GAMES. This state changes on every pointer move during a
   drag, so a context that re-renders four panes per frame is the design. The
   panes keep their own work cheap instead — the log pane seeks by index rather
   than re-filtering, and the canvas paints from a derived state array that is
   computed once per focus change.
══════════════════════════════════════════════════════════════════════════════ */

export interface ReplayState {
  run: Run;
  /**
   * The run's real event log, and the detail response behind it.
   *
   * Carried on this context because the four panes take no props — they read
   * the run from here — and the log, the event history and the inspector all
   * need the same server-side record. Before this they each generated their own
   * content from a seeded RNG, so three panes describing one run could not even
   * agree with each other.
   */
  events: contracts.RunEvent[];
  detail: contracts.RunDetail | null;
  /** Pointer position during a scrub, else null. */
  scrubIndex: number | null;
  /** Committed selection. */
  selectedIndex: number;
  /** What the panes render: scrub wins while dragging. */
  focusIndex: number;
  /** True while the pointer is down on the ribbon. */
  scrubbing: boolean;
  setScrub: (index: number | null) => void;
  select: (index: number) => void;
}

const ReplayContext = React.createContext<ReplayState | null>(null);

export function useReplay(): ReplayState {
  const ctx = React.useContext(ReplayContext);
  if (!ctx) throw new Error("useReplay must be used inside <ReplayProvider>");
  return ctx;
}

export function ReplayProvider({
  run, children, initialIndex, events = [], detail = null,
}: {
  run: Run;
  children: React.ReactNode;
  initialIndex?: number;
  events?: contracts.RunEvent[];
  detail?: contracts.RunDetail | null;
}) {
  /* Default to the failed step when there is one. On a failed run that is the
     only step anyone opens the page to look at. */
  const defaultIndex = React.useMemo(() => {
    if (initialIndex !== undefined) return initialIndex;
    const failed = run.nodes.findIndex((n) => n.state === "failed");
    if (failed !== -1) return failed;
    const gated = run.nodes.findIndex((n) => n.state === "gated");
    if (gated !== -1) return gated;
    const executing = run.nodes.findIndex((n) => n.state === "executing");
    if (executing !== -1) return executing;
    return 0;
  }, [run, initialIndex]);

  const [selectedIndex, setSelectedIndex] = React.useState(defaultIndex);
  const [scrubIndex, setScrubIndex] = React.useState<number | null>(null);

  React.useEffect(() => { setSelectedIndex(defaultIndex); }, [defaultIndex]);

  const setScrub = React.useCallback((index: number | null) => {
    setScrubIndex(index);
  }, []);

  const select = React.useCallback((index: number) => {
    setSelectedIndex(index);
    setScrubIndex(null);
  }, []);

  const value: ReplayState = {
    run,
    events,
    detail,
    scrubIndex,
    selectedIndex,
    focusIndex: scrubIndex ?? selectedIndex,
    scrubbing: scrubIndex !== null,
    setScrub,
    select,
  };

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

/* ── Replayed state ───────────────────────────────────────────────────────── */

/**
 * The node states AS OF a given step.
 *
 * Scrubbing to step 4 must not show what the run looks like now — it must show
 * what it looked like when step 4 was executing. So everything past the focus
 * index is rewound to `pending`, and the focus node itself becomes `executing`
 * unless it is the node that actually died.
 *
 * This is the difference between a scrubber and a highlight. A highlight moves
 * a box around a finished picture; this reconstructs the picture.
 */
export function statesAt(nodes: RunNode[], focusIndex: number, scrubbing: boolean): CellState[] {
  if (!scrubbing) return nodes.map((n) => n.state);

  return nodes.map((node, i) => {
    if (i < focusIndex) {
      // Everything before the head had committed by then — except a node that
      // was skipped, which stays skipped.
      return node.state === "skipped" ? "skipped" : node.state === "pending" ? "pending" : node.state;
    }
    if (i === focusIndex) {
      // The head is in flight, unless it is the terminal failure or a gate.
      if (node.state === "failed" || node.state === "gated") return node.state;
      if (node.state === "pending" || node.state === "skipped") return node.state;
      return "executing";
    }
    return node.state === "skipped" ? "skipped" : "pending";
  });
}

/** Timestamp the panes seek to — the focus node's commit time, or the start. */
export function timeAt(run: Run, focusIndex: number): number {
  const node = run.nodes[focusIndex];
  if (node?.at) return Date.parse(node.at);
  const previous = run.nodes.slice(0, focusIndex).reverse().find((n) => n.at);
  return previous?.at ? Date.parse(previous.at) : Date.parse(run.startedAt);
}
