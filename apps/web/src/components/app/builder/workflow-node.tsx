"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "~/lib/cn";
import { cellPath } from "~/components/app/ribbon/geometry";
import { NODE_MARKS } from "~/components/icons/nodes";
import { ProviderLogo } from "~/components/ui/provider-logo";
import { NODE_SIZE, nodeSize } from "./store";
import { TeamDiagram } from "./team-diagram";
import { readTeamConfig, POLICY_INFO, joinPolicyLabel, depthCounts, longestChain } from "~/lib/workflows/team";
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
  agent_team: "bg-accent-subtle text-accent border-accent-border",
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
 * Larger hit area than visual size: the visible cell is 12px, the grab target is
 * 32px. The connector sits half inside the node so it remains easy to acquire.
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
        "!size-8 !border-0 !bg-transparent",
        "!rounded-none",
        position === Position.Right ? "!-right-4" : position === Position.Left ? "!-left-4" : "",
      )}
      style={position === Position.Bottom
        ? { bottom: -16, top: "auto", left: id === "error" ? "70%" : "50%" }
        : position === Position.Top ? { top: -16, bottom: "auto", left: "50%" } : undefined}
      aria-label={`${id === "error" ? "Error" : `${position}`} connector of ${kind} node`}
    >
      <svg viewBox="0 0 12 12" className="pointer-events-none absolute inset-0 m-auto size-3" aria-hidden="true">
        <path
          d={cellPath(12, 12)}
          fill={isError ? "var(--status-failed-subtle)" : "var(--bg-base)"}
          stroke={isError ? "var(--status-failed)" : "var(--border-default)"}
          strokeWidth={1.4}
        />
        <circle cx={6} cy={6} r={1.5} fill={isError ? "var(--status-failed)" : "var(--border-default)"} />
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

  const isTeam = node.kind === "agent_team";
  const size = nodeSize(node);
  const w = size.width;
  /* A team collapses to the ordinary compact bar. Below 60% zoom the member
     chips are 6px of illegible grey, and 200px of them costs the same paint
     time as the label somebody can actually read. */
  const h = compact ? 40 : size.height;

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

      <div
        className={cn(
          "relative flex h-full min-w-0 gap-2",
          isTeam && !compact ? "flex-col items-stretch py-2" : "items-center",
          compact ? "px-2" : "px-2.5",
        )}
      >
        {/* A team draws its own body — a roster and the delegation between
            its members — because its failure modes are properties of that
            graph's shape and nothing shaped like two lines of text can show
            them. Everything else uses the standard mark/label/status body. */}
        {isTeam && !compact ? (
          <TeamBody node={node} width={w - 20} />
        ) : (
          <>
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
          </>
        )}

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

      {/* Loose mode makes these direction-neutral connectors. The node where
          the drag starts remains the directed source. */}
      <Port type="source" position={Position.Left} id="left" kind={node.kind} />
      <Port type="source" position={Position.Right} id="right" kind={node.kind} />
      <Port type="source" position={Position.Top} id="top" kind={node.kind} />
      <Port type="source" position={Position.Bottom} id="bottom" kind={node.kind} />
      {/* Tool calls get a second, error-typed output so a failure path is
          drawn from a different port than the success path. */}
      {node.kind === "tool" && !compact ? (
        <Port type="source" position={Position.Bottom} id="error" kind={node.kind} />
      ) : null}
    </div>
  );
}

/**
 * A team node's body: the roster, the delegation between its members, and the
 * three numbers that bound it.
 *
 * ── WHY THE DIAGRAM IS THE NODE AND NOT AN ICON ─────────────────────────────
 * Every other node type is fully described by "what it is" plus "what it is
 * bound to", which fits on two lines. A team is not: it is a graph, and its
 * failure modes — an unreachable member, a delegation cycle, a chain deeper
 * than the limit — are properties of that graph's SHAPE. Rendering it as
 * "Agent team · 4 members" would put every one of those behind a click, which
 * is to say behind a decision somebody has to think to make.
 *
 * The three numbers underneath are the ones that end a run: depth, activations,
 * and the cost ceiling. They are drawn even when they are defaults, because
 * "this team has no cost ceiling" is exactly the fact that is invisible until
 * an invoice makes it visible.
 */
function TeamBody({ node, width }: { node: VersionNode; width: number }) {
  const team = React.useMemo(() => readTeamConfig(node.config), [node.config]);
  const info = POLICY_INFO[team.policy];

  /* Members with no agent picked. The diagram draws them differently — a roster
     row that names nobody is dropped by the runtime's parser, so it is a member
     that exists on the canvas and not in the run. */
  const unbound = React.useMemo(
    () => new Set(team.roster.filter((m) => !m.agentId).map((m) => m.alias)),
    [team.roster],
  );

  const chain = React.useMemo(
    () => (depthCounts(team.policy) ? longestChain(team).hops : 0),
    [team],
  );

  const budget = team.budget.maxCostCents > 0
    ? `$${(team.budget.maxCostCents / 100).toFixed(2)}`
    : team.budget.maxTotalTokens > 0
      ? `${Math.round(team.budget.maxTotalTokens / 1000)}k tok`
      : "no ceiling";

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 truncate">
          {node.name}
        </span>
        <span
          className="border-subtle text-fg-muted font-code shrink-0 rounded-xs border px-1 text-[9px]"
          title={`${info.label} — ${info.summary} ${info.terminates}`}
        >
          {team.policy}
        </span>
      </div>

      <TeamDiagram
        team={team}
        width={width}
        height={node.kind === "agent_team" && team.roster.length > 3 ? 200 : 84}
        unbound={unbound}
        className="shrink-0"
      />

      <div className="flex min-w-0 items-center gap-1.5">
        <Chip
          title={depthCounts(team.policy)
            ? `Delegation is ${chain} deep against a limit of ${team.limits.maxDepth}`
            : `A ${team.policy} transfers rather than delegates, so it does not grow the depth`}
        >
          {depthCounts(team.policy) ? `d${chain}/${team.limits.maxDepth}` : "flat"}
        </Chip>
        <Chip title={`At most ${team.limits.maxActivations} activations across the whole tree`}>
          {team.limits.maxActivations}a
        </Chip>
        <Chip title={joinPolicyLabel(team.joinPolicy)}>{joinPolicyLabel(team.joinPolicy)}</Chip>
        <span
          className={cn(
            "font-code ml-auto shrink-0 truncate text-[9px] tabular",
            team.budget.maxCostCents > 0 || team.budget.maxTotalTokens > 0
              ? "text-fg-muted"
              : "text-status-waiting",
          )}
          title={
            team.budget.maxCostCents > 0 || team.budget.maxTotalTokens > 0
              ? "This team ends in CeilingExceeded if it spends past this."
              : "A zero budget means NO ceiling, not a ceiling of zero. Nothing here bounds the spend."
          }
        >
          {budget}
        </span>
      </div>
    </>
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
