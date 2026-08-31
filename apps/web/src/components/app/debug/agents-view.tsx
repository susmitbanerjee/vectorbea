"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import {
  layout,
  joinGroups,
  type Constellation,
  type ConstellationEdge,
  type PlacedEdge,
  type PlacedNode,
} from "./constellation-layout";

/* ══════════════════════════════════════════════════════════════════════════════
   AGENTS — the handoff constellation. §5.3.

   Nodes are activations, edges are handoffs. Everything positional comes from
   `constellation-layout`, which is pure and unit-tested; this file draws.

   ── FOUR THINGS IT HAS TO SAY, IN ORDER OF HOW OFTEN THEY ARE ASKED ─────────

   1. "Why is nothing happening?" — a BLOCKED activation. Greyed, dashed, with
      its reason spelled out. This is the hardest question to answer from a log,
      because the evidence is an absence: no spans, no events, no output. A node
      that renders identically to a healthy one and simply has nothing under it
      is indistinguishable from a rendering bug.

   2. "Why did this cost so much?" — node AREA is token spend, so the expensive
      member is obvious without opening the cost view at all.

   3. "Why did it go round in circles?" — a cycle is one arc with a hit counter
      and the name of the guard that stopped it, beside the agent that kept
      asking. Not N overlapping edges.

   4. "What did it actually ask for?" — hovering an edge shows the contract sent
      and the output returned, side by side. Both come down with the graph, so a
      hover is instant rather than a request.
   ══════════════════════════════════════════════════════════════════════════ */

const STATUS_FILL: Record<string, string> = {
  succeeded: "fill-status-ok/20 stroke-status-ok",
  failed: "fill-status-failed/20 stroke-status-failed",
  running: "fill-status-live/20 stroke-status-live",
  waiting_for_approval: "fill-status-warning/20 stroke-status-warning",
  waiting_for_child: "fill-status-warning/20 stroke-status-warning",
  handed_off: "fill-surface-raised stroke-border-strong",
  cancelled: "fill-surface-raised stroke-border-subtle",
  superseded: "fill-surface-raised stroke-border-subtle",
  pending: "fill-surface-raised stroke-border-subtle",
};

/** `handed_off` is neither success nor failure, and the legend says so. */
const STATUS_LABEL: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
  waiting_for_approval: "Waiting for a person",
  waiting_for_child: "Waiting on its children",
  handed_off: "Handed off — neither success nor failure",
  cancelled: "Cancelled",
  superseded: "Superseded",
  pending: "Never started",
};

const KIND_STYLE: Record<string, string> = {
  DELEGATE: "stroke-border-strong",
  TRANSFER: "stroke-brand",
  BROADCAST: "stroke-status-live",
  RETURN: "stroke-border-subtle",
  ESCALATE: "stroke-status-warning",
};

export function AgentsView({
  constellation,
  onSelectActivation,
  selectedActivationId,
  className,
}: {
  constellation: Constellation;
  onSelectActivation?: (activationId: string) => void;
  selectedActivationId?: string | null;
  className?: string;
}) {
  const l = React.useMemo(() => layout(constellation), [constellation]);
  const groups = React.useMemo(() => joinGroups(constellation.edges), [constellation.edges]);
  const [hovered, setHovered] = React.useState<PlacedEdge | null>(null);

  if (l.nodes.length === 0) {
    return (
      <div className={cn("rounded-lg border border-subtle p-6", className)}>
        <Text variant="body-sm" tone="secondary">
          This run had no agent activations, so there is no constellation to draw. A
          single-agent run without activations enabled looks like this.
        </Text>
      </div>
    );
  }

  const blocked = l.nodes.filter((n) => n.blocked);

  return (
    <div className={cn("grid gap-3", className)}>
      {/*
        THE BLOCKED BRANCHES, ABOVE THE DIAGRAM.

        "Never started because its sibling failed under wait_all" is the most
        common "why is nothing happening" question, and burying the answer inside
        a node somebody has to find first is how it stays unanswered. It leads.
      */}
      {blocked.length > 0 ? (
        <div className="rounded-lg border border-subtle bg-surface-raised p-3">
          <Text variant="label" tone="secondary" className="block">
            {blocked.length} branch{blocked.length === 1 ? "" : "es"} produced nothing
          </Text>
          <ul className="mt-1.5 grid gap-1">
            {blocked.map((n) => (
              <li key={n.id} className="flex flex-wrap items-baseline gap-x-2">
                <Text variant="body-sm" tone="max">{n.agentName}</Text>
                <Text variant="body-sm" tone="secondary">{n.blockedReason}</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The cycles, with the guard that stopped them. */}
      {l.loops.length > 0 ? (
        <div className="rounded-lg border border-status-warning/40 bg-surface-raised p-3">
          <Text variant="label" tone="secondary" className="block">Repeated handoffs</Text>
          <ul className="mt-1.5 grid gap-1">
            {l.loops.map((loop) => (
              <li key={loop.contractHash + loop.fromAgent} className="flex flex-wrap items-baseline gap-x-2">
                <Text variant="body-sm" tone="max">
                  {loop.fromAgent} → {loop.toAgent}
                </Text>
                <Text variant="body-sm" tone="secondary" className="tabular">
                  ×{loop.hits}
                </Text>
                {/* The GUARD, named. A hit counter alone says the loop happened;
                    the guard's name says what ended it, which is the half that
                    tells somebody whether to raise a limit or fix a prompt. */}
                <Text variant="caption" tone="secondary">
                  stopped by HANDOFF_LOOP on the same contract hash
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-auto rounded-lg border border-subtle bg-surface-raised">
        <svg
          width={l.width}
          height={l.height}
          viewBox={`0 0 ${l.width} ${l.height}`}
          role="img"
          aria-label={`Handoff constellation: ${l.nodes.length} activations, ${l.edges.length} handoffs`}
          className="block"
        >
          <defs>
            <marker id="cst-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-fg-secondary" />
            </marker>
          </defs>

          {/* Fan-out brackets, behind everything. Without them, five children of
              one BROADCAST are five unrelated edges and the most interesting fact
              about the run is invisible. */}
          {[...groups.entries()].map(([gid, gEdges]) => {
            const targets = gEdges
              .map((e) => l.nodes.find((n) => n.id === e.to))
              .filter((n): n is PlacedNode => Boolean(n));
            if (targets.length < 2) return null;
            const xs = targets.map((t) => t.x);
            const y = targets[0]!.y - targets[0]!.r - 10;
            return (
              <line key={gid} x1={Math.min(...xs)} y1={y} x2={Math.max(...xs)} y2={y}
                    className="stroke-status-live/40" strokeWidth={2} strokeDasharray="4 3" />
            );
          })}

          {l.edges.map((e) => (
            <g key={e.id}
               onMouseEnter={() => setHovered(e)}
               onMouseLeave={() => setHovered((h) => (h?.id === e.id ? null : h))}>
              <line
                x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                markerEnd="url(#cst-arrow)"
                strokeWidth={e.cyclic ? 2.5 : 1.5}
                strokeDasharray={e.cyclic ? "6 4" : undefined}
                className={cn(KIND_STYLE[e.kind] ?? "stroke-border-strong",
                  e.cyclic && "stroke-status-warning")}
              />
              {/* An invisible fat line so hovering a 1.5px edge is possible. */}
              <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                    strokeWidth={14} stroke="transparent" className="cursor-help" />
              <title>{`${e.kind}${e.reason ? ` — ${e.reason}` : ""}`}</title>
            </g>
          ))}

          {l.nodes.map((n) => (
            <g key={n.id}
               className="cursor-pointer"
               onClick={() => onSelectActivation?.(n.id)}
               tabIndex={0}
               role="button"
               aria-label={`${n.agentName}: ${STATUS_LABEL[n.status] ?? n.status}, ${n.tokens} tokens`}
               onKeyDown={(ev) => {
                 if (ev.key === "Enter" || ev.key === " ") {
                   ev.preventDefault();
                   onSelectActivation?.(n.id);
                 }
               }}>
              <circle
                cx={n.x} cy={n.y} r={n.r}
                strokeWidth={selectedActivationId === n.id ? 3 : 1.5}
                strokeDasharray={n.blocked ? "4 3" : undefined}
                className={cn(
                  STATUS_FILL[n.status] ?? "fill-surface-raised stroke-border-subtle",
                  n.blocked && "opacity-50",
                )}
              />
              <text x={n.x} y={n.y + n.r + 14} textAnchor="middle"
                    className="fill-fg-max font-ui text-[11px]">
                {n.agentName}
              </text>
              <text x={n.x} y={n.y + n.r + 26} textAnchor="middle"
                    className="fill-fg-secondary font-ui text-[10px] tabular">
                {n.tokens.toLocaleString()} tok
              </text>
              <title>
                {`${n.agentName} — ${STATUS_LABEL[n.status] ?? n.status}\n` +
                 `${n.tokens.toLocaleString()} tokens · ${n.iterations} iteration(s)` +
                 (n.blockedReason ? `\n${n.blockedReason}` : "") +
                 (n.stopReason ? `\nStopped: ${n.stopReason}` : "")}
              </title>
            </g>
          ))}
        </svg>
      </div>

      {/*
        THE CONTRACT AND THE OUTPUT, SIDE BY SIDE.

        The pair is the point: a contract alone says what was asked, an output
        alone says what came back, and only the two together say whether the
        child misunderstood or the request was wrong. Both arrive with the graph,
        so this is instant rather than a request per hover.
      */}
      {hovered ? <EdgeDetail edge={hovered} /> : (
        <Text variant="caption" tone="secondary">
          Hover a handoff to see the contract sent and the output returned.
        </Text>
      )}
    </div>
  );
}

function EdgeDetail({ edge }: { edge: ConstellationEdge }) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-raised p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Text variant="label" tone="max">{edge.kind}</Text>
        {edge.reason ? (
          /* The model's stated reason — recorded nowhere else, and usually the
             first thing anyone wants when a run went sideways. */
          <Text variant="body-sm" tone="secondary">{edge.reason}</Text>
        ) : null}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Pane title="Contract sent" body={edge.contract} />
        <Pane title="Output returned" body={edge.output} />
      </div>
    </div>
  );
}

function Pane({ title, body }: { title: string; body: string | null }) {
  return (
    <div className="min-w-0">
      <Text variant="caption" tone="secondary" className="block">{title}</Text>
      <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-subtle bg-surface p-2 font-code text-[11px] text-fg-secondary">
        {body ? pretty(body) : "—"}
      </pre>
    </div>
  );
}

/** Pretty-print JSON, falling back to the raw string rather than throwing. */
function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
