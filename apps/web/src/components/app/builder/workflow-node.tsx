"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "~/lib/cn";
import { cellPath } from "~/components/app/ribbon/geometry";
import { NODE_MARKS } from "~/components/icons/nodes";
import { ProviderLogo } from "~/components/ui/provider-logo";
import { NODE_SIZE } from "./store";
import type { BoundResource, NodeChrome } from "~/mocks/builder";
import type { VersionNode } from "~/mocks/workflow-nodes";
import type { NodeKind } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   THE NODE — one component, twelve type variants, eleven states.

   Nothing from @xyflow/react's default styling survives: no .react-flow__node
   background, no default handles, no library border radius. The library owns
   position, selection plumbing and the connection gesture. Everything drawn is
   ours.

   STRUCTURE, top to bottom (§6.2):
     type mark on a tinted chip · step label · bound resource with provider logo
     · status row · handles.

   THE CHIP TINT IS THE TYPE. The border and fill are the STATE. Keeping those
   two encodings on different parts of the node is what lets you read "this is an
   approval, and it is failing" in one look — collapsing them into one colour
   forces a legend.

   COMPACT MODE below 60% zoom drops to mark and label. At 40 nodes and 50% zoom
   the resource line and status row render as illegible grey smears, and smears
   cost the same paint time as text you can read.
══════════════════════════════════════════════════════════════════════════════ */

export type NodeRunState =
  | "ready" | "configured" | "has-warning" | "has-error" | "disabled"
  | "executing" | "committed" | "failed" | "gated" | "skipped";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: VersionNode;
  state: NodeRunState;
  resource: BoundResource | null;
  chrome: NodeChrome;
  /** Validation issues on this node. The badge shows the count. */
  issueCount: number;
  /** Rendered small — set by the canvas from the live zoom. */
  compact: boolean;
  /** Dimmed because a hover is highlighting a different path. */
  dimmed: boolean;
  /** On the highlighted path. */
  emphasised: boolean;
  onOpenIssues?: (nodeId: string) => void;
}

/* ── Type chips ───────────────────────────────────────────────────────────── */

/**
 * Chip tint per node type.
 *
 * Brand iris for the types that DO work, graphite for the structural ones that
 * only route it, ember for the one that stops for a person. Three tints, not
 * twelve: a palette with a colour per type is a palette nobody learns, and §11
 * spends the colour budget on run state instead.
 */
const CHIP: Record<NodeKind, string> = {
  trigger: "bg-accent-subtle text-accent border-accent-border",
  agent: "bg-accent-subtle text-accent border-accent-border",
  llm: "bg-accent-subtle text-accent border-accent-border",
  tool: "bg-accent-subtle text-accent border-accent-border",
  checkpoint: "bg-accent-subtle text-accent border-accent-border",
  branch: "bg-surface-hover text-fg-secondary border-subtle",
  parallel: "bg-surface-hover text-fg-secondary border-subtle",
  merge: "bg-surface-hover text-fg-secondary border-subtle",
  wait: "bg-surface-hover text-fg-secondary border-subtle",
  output: "bg-surface-hover text-fg-secondary border-subtle",
  end: "bg-surface-hover text-fg-secondary border-subtle",
  approval: "bg-status-waiting-subtle text-status-waiting border-status-waiting-border",
};

/* ── State chrome ─────────────────────────────────────────────────────────── */

interface StateStyle {
  border: string;
  fill: string;
  /** Extra ring drawn outside the cell. */
  halo?: string;
  label: string;
}

const STATE: Record<NodeRunState, StateStyle> = {
  ready: { border: "var(--border-subtle)", fill: "var(--bg-raised)", label: "not configured" },
  configured: { border: "var(--border-default)", fill: "var(--bg-raised)", label: "configured" },
  "has-warning": { border: "var(--status-waiting-border)", fill: "var(--bg-raised)", label: "has a warning" },
  "has-error": { border: "var(--status-failed)", fill: "var(--bg-raised)", label: "has an error" },
  disabled: { border: "var(--border-subtle)", fill: "transparent", label: "disabled" },
  executing: { border: "var(--status-live)", fill: "var(--status-live-subtle)", halo: "var(--status-live)", label: "executing" },
  committed: { border: "var(--status-success-border)", fill: "var(--status-success-subtle)", label: "committed" },
  failed: { border: "var(--status-failed)", fill: "var(--status-failed-subtle)", label: "failed" },
  gated: { border: "var(--status-waiting-border)", fill: "var(--status-waiting-subtle)", halo: "var(--status-waiting)", label: "waiting on a person" },
  skipped: { border: "var(--border-subtle)", fill: "transparent", label: "skipped" },
};

/* ── Handles ──────────────────────────────────────────────────────────────── */

/**
 * A port, drawn as a small hive cell rather than the library's circle.
 *
 * Larger hit area than visual size: the visible cell is 10px, the grab target is
 * 20px. A 10px drag target is a miss most of the time, and the miss lands on the
 * canvas and starts a marquee instead — which reads as the app ignoring you.
 */
function Port({
  type, position, id, kind,
}: {
  type: "source" | "target";
  position: Position;
  id?: string;
  kind: NodeKind;
}) {
  const isError = id === "error";
  return (
    <Handle
      type={type}
      position={position}
      id={id}
      // The library's own class is left off entirely; these are our styles.
      className={cn(
        "!size-5 !border-0 !bg-transparent",
        "!rounded-none",
        type === "source" ? "!-right-2.5" : "!-left-2.5",
      )}
      style={position === Position.Bottom ? { bottom: -10, top: "auto", left: "50%" } : undefined}
      aria-label={`${type === "source" ? "Output" : "Input"} of ${kind} node`}
    >
      <svg viewBox="0 0 10 10" className="pointer-events-none absolute inset-0 m-auto size-2.5" aria-hidden="true">
        <path
          d={cellPath(10, 10)}
          fill={isError ? "var(--status-failed-subtle)" : "var(--bg-base)"}
          stroke={isError ? "var(--status-failed)" : "var(--border-default)"}
          strokeWidth={1.4}
        />
      </svg>
    </Handle>
  );
}

/* ── The node ─────────────────────────────────────────────────────────────── */

function WorkflowNodeImpl({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const { node, state, resource, chrome, issueCount, compact, dimmed, emphasised } = d;
  const style = STATE[state];
  const mark = NODE_MARKS.find((m) => m.type === node.kind);
  const Mark = mark?.Icon;

  const w = NODE_SIZE.width;
  const h = compact ? 40 : NODE_SIZE.height;

  return (
    <div
      className={cn(
        "relative",
        // Transform and opacity only — §7. A node that animates its width
        // reflows every edge attached to it on every frame.
        "transition-[opacity,transform] duration-fast ease-standard",
        dimmed && "opacity-35",
        emphasised && "z-10",
        state === "disabled" && "opacity-55",
      )}
      style={{ width: w, height: h }}
    >
      {/* The cell itself, drawn as SVG so the hive geometry stays exact at every
          zoom — a CSS clip-path rounds differently at 40% and 200%. */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        className="absolute inset-0"
        aria-hidden="true"
      >
        {style.halo ? (
          <path
            d={cellPath(w + 10, h + 10)}
            transform="translate(-5 -5)"
            fill="none"
            stroke={style.halo}
            strokeWidth={2}
            opacity={0.16}
            data-motion="decorative"
            className={cn(
              state === "gated"
                // §7.2 #5 — barely perceptible, 2.6s sine.
                ? "motion-safe:animate-[ink-gate-breathe_2.6s_ease-in-out_infinite]"
                : "motion-safe:animate-[ink-cell-breathe_1.6s_ease-in-out_infinite]",
            )}
          />
        ) : null}

        <path
          d={cellPath(w, h)}
          fill={style.fill}
          stroke={selected ? "var(--border-focus)" : style.border}
          strokeWidth={selected ? 2 : 1.2}
          strokeDasharray={state === "skipped" || state === "disabled" ? "5 3" : undefined}
        />
      </svg>

      <div className={cn("relative flex h-full min-w-0 items-center gap-2", compact ? "px-2" : "px-2.5")}>
        {/* Type mark on its tinted chip. */}
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-xs border",
            compact ? "size-6" : "size-7",
            CHIP[node.kind],
          )}
        >
          {Mark ? <Mark size={compact ? 13 : 15} aria-hidden="true" /> : null}
        </span>

        <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
          <span className="font-ui text-body-sm text-fg-primary truncate">{node.name}</span>

          {!compact ? (
            <>
              {resource ? (
                <span className="flex min-w-0 items-center gap-1">
                  {resource.provider ? (
                    <ProviderLogo
                      provider={resource.provider}
                      connected={resource.connected}
                      size={9}
                      decorative
                      className="!size-4 shrink-0 !rounded-xs"
                    />
                  ) : null}
                  <span className="font-code text-mono-sm text-fg-muted truncate">{resource.label}</span>
                </span>
              ) : (
                <span className="font-ui text-caption text-fg-disabled truncate">
                  {node.kind === "branch" && !node.config.condition ? "No condition set"
                    : node.kind === "approval" && !node.config.approverGroup ? "No approver group"
                      : mark?.meaning.split(" — ")[0] ?? node.kind}
                </span>
              )}

              {/* Status row: the non-default policies, the gate warning, the
                  commit glyph. Silent when everything is ordinary. */}
              <span className="flex min-w-0 items-center gap-1.5">
                {chrome.retry ? <Chip title={`Retry policy: ${chrome.retry} attempts`}>{chrome.retry}</Chip> : null}
                {chrome.timeout ? <Chip title={`Timeout: ${chrome.timeout}`}>{chrome.timeout}</Chip> : null}
                {chrome.commits ? (
                  <span className="text-status-success" title="Commits a checkpoint">
                    <CommitGlyph />
                  </span>
                ) : null}
                {chrome.precedesGate ? (
                  <span className="text-status-waiting" title="Feeds an approval gate — work stops here for a person">
                    <GateGlyph />
                  </span>
                ) : null}
                <span className="font-ui text-[10px] text-fg-disabled ml-auto truncate">{style.label}</span>
              </span>
            </>
          ) : null}
        </div>

        {issueCount > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); d.onOpenIssues?.(node.id); }}
            aria-label={`${issueCount} ${issueCount === 1 ? "issue" : "issues"} on ${node.name}. Jump to the first.`}
            className={cn(
              "absolute -right-1.5 -top-1.5 grid size-4 shrink-0 place-items-center rounded-full",
              "font-code text-[9px] tabular",
              state === "has-error" || state === "failed"
                ? "bg-status-failed text-fg-on-accent"
                : "bg-status-waiting text-fg-on-accent",
              "outline-none focus-visible:focus-ring",
            )}
          >
            {issueCount}
          </button>
        ) : null}
      </div>

      {/* Ports. A trigger has no input; an end has no output — drawing ports
          that cannot be connected teaches people to try. */}
      {node.kind !== "trigger" ? <Port type="target" position={Position.Left} kind={node.kind} /> : null}
      {node.kind !== "end" ? <Port type="source" position={Position.Right} kind={node.kind} /> : null}
      {/* Tool calls get a second, error-typed output so a failure path is
          drawn from a different port than the success path. */}
      {node.kind === "tool" && !compact ? (
        <Port type="source" position={Position.Bottom} id="error" kind={node.kind} />
      ) : null}
    </div>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[9px] tabular"
    >
      {children}
    </span>
  );
}

function CommitGlyph() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
      <path d={cellPath(9, 9)} transform="translate(0.5 0.5)" fill="currentColor" opacity={0.9} />
    </svg>
  );
}

function GateGlyph() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
      <path d="M5 1 8.5 2.6v3.1C8.5 7.5 5 9 5 9S1.5 7.5 1.5 5.7V2.6z" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Memoised on the fields that actually change what is drawn.
 *
 * React Flow re-renders every node on any store change — a pan, a selection, a
 * single node moving. At 200 nodes that is 200 reconciliations per frame, each
 * one recomputing an SVG cell path. Comparing the drawn fields directly keeps a
 * pan at one reconciliation per node per zoom bucket instead of per frame.
 */
export const WorkflowNode = React.memo(WorkflowNodeImpl, (a, b) => {
  const x = a.data as WorkflowNodeData;
  const y = b.data as WorkflowNodeData;
  return (
    a.selected === b.selected
    && x.node === y.node
    && x.state === y.state
    && x.resource === y.resource
    && x.chrome === y.chrome
    && x.issueCount === y.issueCount
    && x.compact === y.compact
    && x.dimmed === y.dimmed
    && x.emphasised === y.emphasised
  );
});
