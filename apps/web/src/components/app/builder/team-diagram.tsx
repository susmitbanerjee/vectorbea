"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import {
  delegationEdges, entryMember, reachableAliases, findDelegationCycle,
  type TeamConfig,
} from "~/lib/workflows/team";

/* ══════════════════════════════════════════════════════════════════════════════
   THE DELEGATION GRAPH, ON THE NODE.

   ── WHY THIS IS NOT IN THE INSPECTOR ────────────────────────────────────────
   A roster is a graph. Depth, cycles and unreachable members are properties of
   its SHAPE, and a shape is the one thing a list of rows cannot show. Put the
   roster in a config panel and "the researcher delegates to the writer, which
   delegates back to the researcher" is three rows nobody reads as a loop —
   whereas drawn, it is a loop, and the eye finds it before the validator does.

   That is the whole argument for spending a canvas node's area on this rather
   than on a member count. A builder who cannot see the delegation edges cannot
   reason about depth or cycles, and will discover both from a run.

   ── DEPTH IS THE X AXIS ─────────────────────────────────────────────────────
   Members are placed in columns by their distance from the entry, so the
   horizontal extent of the drawing IS the delegation depth — the number the
   depth limit is compared against. A team that is about to breach its limit
   looks wide before anything says so.

   ── WHAT THE DRAWING REFUSES TO GUESS ───────────────────────────────────────
   Nothing here re-derives which member starts, or which grants count. Both come
   from `~/lib/workflows/team`, which mirrors the runtime's own parser — so the
   picture is of the team that would run, not of the config as typed. Those are
   different whenever a grant names a member that does not exist, which is
   exactly when a picture is worth having.
══════════════════════════════════════════════════════════════════════════════ */

export interface TeamDiagramProps {
  team: TeamConfig;
  width: number;
  height: number;
  /** Aliases whose agent is missing or unbound — drawn as incomplete. */
  unbound?: Set<string>;
  /** Suppresses labels below the zoom at which they are unreadable. */
  compact?: boolean;
  className?: string;
}

interface Placed {
  alias: string;
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

const CHIP_H = 20;
const COL_GAP = 26;
const ROW_GAP = 8;

/**
 * Column per delegation depth, rows within a column.
 *
 * Members the entry cannot reach get their own column at the far right rather
 * than being dropped: an unreachable member is the single most important thing
 * to SEE on a roster, and hiding it from the picture would leave the validator
 * as the only thing that knows.
 */
function place(team: TeamConfig, width: number, height: number): Placed[] {
  const entry = entryMember(team);
  if (!entry || team.roster.length === 0) return [];

  const edges = delegationEdges(team);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);

  // BFS depth from the entry. A member reachable by two paths of different
  // lengths sits at the SHORTER one, which is where the runtime would first
  // activate it.
  const depth = new Map<string, number>([[entry.alias, 0]]);
  const queue = [entry.alias];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }

  const reachable = reachableAliases(team);
  const maxReachedDepth = Math.max(0, ...[...depth.values()]);
  const strandedDepth = maxReachedDepth + 1;

  const columns = new Map<number, string[]>();
  for (const m of team.roster) {
    const d = reachable.has(m.alias) ? depth.get(m.alias) ?? 0 : strandedDepth;
    columns.set(d, [...(columns.get(d) ?? []), m.alias]);
  }

  const columnCount = columns.size;
  const chipW = Math.max(
    44,
    Math.floor((width - COL_GAP * Math.max(0, columnCount - 1)) / Math.max(1, columnCount)),
  );

  const roleOf = new Map(team.roster.map((m) => [m.alias, m.role]));
  const placed: Placed[] = [];
  const sortedDepths = [...columns.keys()].sort((a, b) => a - b);

  sortedDepths.forEach((d, columnIndex) => {
    const members = columns.get(d) ?? [];
    const columnHeight = members.length * CHIP_H + (members.length - 1) * ROW_GAP;
    const top = Math.max(0, (height - columnHeight) / 2);
    members.forEach((alias, rowIndex) => {
      placed.push({
        alias,
        role: roleOf.get(alias) ?? "worker",
        x: columnIndex * (chipW + COL_GAP),
        y: top + rowIndex * (CHIP_H + ROW_GAP),
        w: chipW,
        h: CHIP_H,
        depth: d,
      });
    });
  });

  return placed;
}

export function TeamDiagram({
  team, width, height, unbound, compact, className,
}: TeamDiagramProps) {
  const placed = React.useMemo(() => place(team, width, height), [team, width, height]);
  const byAlias = React.useMemo(
    () => new Map(placed.map((p) => [p.alias, p])),
    [placed],
  );
  const edges = React.useMemo(() => delegationEdges(team), [team]);
  const cycle = React.useMemo(() => findDelegationCycle(team), [team]);
  const reachable = React.useMemo(() => reachableAliases(team), [team]);

  /* Edges on the cycle are drawn differently, so the loop is visible as a loop
     rather than as a set of arrows that happen to come back. */
  const cycleEdges = React.useMemo(() => {
    if (!cycle) return new Set<string>();
    const set = new Set<string>();
    for (const [i, from] of cycle.entries()) set.add(`${from}→${cycle[(i + 1) % cycle.length]}`);
    return set;
  }, [cycle]);

  if (placed.length === 0) {
    return (
      <div
        className={cn("grid place-items-center", className)}
        style={{ width, height }}
      >
        <span className="font-ui text-caption text-fg-disabled">No members yet</span>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)} style={{ width, height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="absolute inset-0 overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="team-arrow" viewBox="0 0 8 8" refX="7" refY="4"
            markerWidth="5" markerHeight="5" orient="auto-start-reverse"
          >
            <path d="M0 1 L7 4 L0 7 z" fill="var(--border-strong)" />
          </marker>
          <marker
            id="team-arrow-cycle" viewBox="0 0 8 8" refX="7" refY="4"
            markerWidth="5" markerHeight="5" orient="auto-start-reverse"
          >
            <path d="M0 1 L7 4 L0 7 z" fill="var(--status-failed)" />
          </marker>
        </defs>

        {edges.map((e) => {
          const from = byAlias.get(e.from);
          const to = byAlias.get(e.to);
          if (!from || !to) return null;
          const onCycle = cycleEdges.has(`${e.from}→${e.to}`);

          const x1 = from.x + from.w;
          const y1 = from.y + from.h / 2;
          const x2 = to.x;
          const y2 = to.y + to.h / 2;

          /* A back-edge — one that goes right to left because its target sits in
             an earlier column — is routed BELOW the chips rather than through
             them. Drawn straight it would pass under every chip between the two
             and read as a decoration rather than as the arrow that closes a
             loop. */
          const backwards = x2 <= x1;
          const d = backwards
            ? `M ${x1} ${y1} C ${x1 + 14} ${y1 + 18}, ${x2 - 14} ${y2 + 18}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1 + (x2 - x1) / 2} ${y1}, ${x1 + (x2 - x1) / 2} ${y2}, ${x2} ${y2}`;

          return (
            <path
              key={`${e.from}→${e.to}`}
              d={d}
              fill="none"
              stroke={onCycle ? "var(--status-failed)" : "var(--border-strong)"}
              strokeWidth={onCycle ? 1.6 : 1.2}
              strokeDasharray={onCycle ? "3 2" : undefined}
              markerEnd={`url(#${onCycle ? "team-arrow-cycle" : "team-arrow"})`}
            />
          );
        })}
      </svg>

      {placed.map((p) => {
        const stranded = !reachable.has(p.alias);
        // Only the entry sits at depth 0: the BFS starts there and every
        // stranded member is pushed to a column past the deepest reached one.
        const isEntry = p.depth === 0 && !stranded;
        const incomplete = unbound?.has(p.alias) ?? false;
        return (
          <span
            key={p.alias}
            className={cn(
              "absolute grid place-items-center rounded-xs border px-1",
              "font-ui text-[10px] leading-none",
              stranded
                ? "border-status-failed bg-status-failed-subtle text-status-failed"
                : incomplete
                  ? "border-status-waiting-border bg-status-waiting-subtle text-status-waiting"
                  : isEntry
                    ? "border-accent-border bg-accent-subtle text-accent"
                    : "border-subtle bg-surface-raised text-fg-secondary",
            )}
            style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
            title={
              stranded ? `${p.alias} — nothing reaches this member`
                : incomplete ? `${p.alias} — no agent selected`
                  : `${p.alias} — ${p.role}${isEntry ? ", the entry member" : ""}`
            }
          >
            <span className="w-full truncate text-center">
              {compact ? p.alias.slice(0, 3) : p.alias}
            </span>
          </span>
        );
      })}
    </div>
  );
}
