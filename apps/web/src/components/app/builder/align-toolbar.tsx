"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { align, distribute, type AlignAxis } from "./layout";
import type { BuilderAction, BuilderState } from "./store";

/* ══════════════════════════════════════════════════════════════════════════════
   CANVAS TOOLBAR — undo/redo, auto-layout, align, distribute, comment.

   The align and distribute controls are DISABLED until they would do something:
   align needs two nodes, distribute needs three. A control that is clickable and
   inert teaches people it is broken; one that is disabled with a reason in its
   title teaches them what it needs.
══════════════════════════════════════════════════════════════════════════════ */

export function AlignToolbar({
  state, dispatch, onAutoLayout, canUndo, canRedo, onUndo, onRedo, onComment,
}: {
  state: BuilderState;
  dispatch: React.Dispatch<BuilderAction>;
  onAutoLayout: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onComment: () => void;
}) {
  const count = state.selection.length;

  const applyAlign = (axis: AlignAxis) => {
    const nodes = align(state.nodes, state.selection, axis);
    dispatch({ type: "replaceGraph", graph: { nodes, edges: state.edges }, label: `Align ${axis}` });
  };

  const applyDistribute = (axis: "x" | "y") => {
    const nodes = distribute(state.nodes, state.selection, axis);
    dispatch({ type: "replaceGraph", graph: { nodes, edges: state.edges }, label: `Distribute ${axis}` });
  };

  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      className={cn(
        "border-subtle bg-surface-overlay/90 absolute left-3 top-3 flex items-center gap-0.5",
        "rounded-md border p-0.5 backdrop-blur-sm",
      )}
    >
      <Tool label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={onUndo}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.4 5.2H7a2.6 2.6 0 0 1 0 5.2H5.2M3.4 5.2 5.6 3M3.4 5.2l2.2 2.2" />
        </svg>
      </Tool>
      <Tool label="Redo" shortcut="⌘⇧Z" disabled={!canRedo} onClick={onRedo}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8.6 5.2H5a2.6 2.6 0 0 0 0 5.2h1.8M8.6 5.2 6.4 3M8.6 5.2 6.4 7.4" />
        </svg>
      </Tool>

      <Divider />

      <Tool label="Auto-layout the graph" onClick={onAutoLayout}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round">
          <rect x="1" y="4.6" width="2.8" height="2.8" rx="0.6" />
          <rect x="8.2" y="1.6" width="2.8" height="2.8" rx="0.6" />
          <rect x="8.2" y="7.6" width="2.8" height="2.8" rx="0.6" />
          <path d="M3.8 6h1.8m0 0V3h2.6m-2.6 3v3h2.6" />
        </svg>
      </Tool>

      <Divider />

      <Tool label="Align left" disabled={count < 2} reason="Select two or more nodes" onClick={() => applyAlign("left")}>
        <AlignGlyph axis="left" />
      </Tool>
      <Tool label="Align centre" disabled={count < 2} reason="Select two or more nodes" onClick={() => applyAlign("centre-x")}>
        <AlignGlyph axis="centre-x" />
      </Tool>
      <Tool label="Align top" disabled={count < 2} reason="Select two or more nodes" onClick={() => applyAlign("top")}>
        <AlignGlyph axis="top" />
      </Tool>
      <Tool label="Align middle" disabled={count < 2} reason="Select two or more nodes" onClick={() => applyAlign("centre-y")}>
        <AlignGlyph axis="centre-y" />
      </Tool>

      <Tool label="Distribute horizontally" disabled={count < 3} reason="Select three or more nodes" onClick={() => applyDistribute("x")}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.3}>
          <rect x="0.8" y="3.4" width="2" height="5.2" rx="0.5" />
          <rect x="5" y="3.4" width="2" height="5.2" rx="0.5" />
          <rect x="9.2" y="3.4" width="2" height="5.2" rx="0.5" />
        </svg>
      </Tool>
      <Tool label="Distribute vertically" disabled={count < 3} reason="Select three or more nodes" onClick={() => applyDistribute("y")}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.3}>
          <rect x="3.4" y="0.8" width="5.2" height="2" rx="0.5" />
          <rect x="3.4" y="5" width="5.2" height="2" rx="0.5" />
          <rect x="3.4" y="9.2" width="5.2" height="2" rx="0.5" />
        </svg>
      </Tool>

      <Divider />

      <Tool label="Add a comment pin" onClick={onComment}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round">
          <path d="M1.6 2.4h8.8v5.4H6.2L3.8 9.9V7.8H1.6z" />
        </svg>
      </Tool>
    </div>
  );
}

function Divider() {
  return <span className="bg-surface-active mx-0.5 h-4 w-px" aria-hidden="true" />;
}

function Tool({
  label, shortcut, reason, disabled, onClick, children,
}: {
  label: string;
  shortcut?: string;
  reason?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled && reason ? `${label} — ${reason}` : shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        "text-fg-muted grid size-6 place-items-center rounded-xs",
        "hover:text-fg-primary hover:bg-surface-hover transition-colors duration-fast",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
        "outline-none focus-visible:focus-ring",
      )}
    >
      {children}
    </button>
  );
}

function AlignGlyph({ axis }: { axis: AlignAxis }) {
  const vertical = axis === "left" || axis === "right" || axis === "centre-x";
  const line = axis === "left" ? 1.4 : axis === "right" ? 10.6 : 6;
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.3}>
      {vertical ? (
        <>
          <path d={`M${line} 1v10`} strokeDasharray="1.6 1.4" />
          <rect x={axis === "right" ? 3.6 : line + 0.6} y="2.4" width="6.4" height="2.6" rx="0.5" />
          <rect x={axis === "right" ? 5.6 : line + 0.6} y="6.6" width="4.4" height="2.6" rx="0.5" />
        </>
      ) : (
        <>
          <path d={`M1 ${axis === "top" ? 1.4 : 6}h10`} strokeDasharray="1.6 1.4" />
          <rect x="2.4" y={axis === "top" ? 2.2 : 1.2} width="2.6" height="6.4" rx="0.5" />
          <rect x="6.6" y={axis === "top" ? 2.2 : 3.2} width="2.6" height="4.4" rx="0.5" />
        </>
      )}
    </svg>
  );
}
