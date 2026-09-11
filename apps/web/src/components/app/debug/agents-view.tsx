"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import {
  layout,
  joinGroups,
  type ActivationSkill,
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

/*
 * ── STATUS COLOURS, FROM TOKENS THAT ACTUALLY EXIST ─────────────────────────
 * This table named `status-ok` and `status-warning`. Neither is a token — the
 * status ramp is success / failed / waiting / live / queued / cancelled — so
 * every succeeded node and every waiting node was drawn with no fill and no
 * stroke at all. The lint rule does not catch it because the names LOOK
 * semantic, which is exactly why the vocabulary lives in one module now.
 */
const STATUS_FILL: Record<string, string> = {
  succeeded: "fill-status-success/20 stroke-status-success",
  failed: "fill-status-failed/20 stroke-status-failed",
  running: "fill-status-live/20 stroke-status-live",
  waiting_for_approval: "fill-status-waiting/20 stroke-status-waiting",
  waiting_for_child: "fill-status-waiting/20 stroke-status-waiting",
  waiting_for_event: "fill-status-waiting/20 stroke-status-waiting",
  /*
   * HANDED OFF IS ITS OWN STATE, and deliberately neither green nor red.
   *
   * A router that correctly transferred did its job: it is not a success (it
   * produced no answer) and it is emphatically not a failure. Given the success
   * hue it would inflate a success rate; given the failure hue it would send
   * somebody debugging a working router. So: the brand ramp, which means "this
   * is a thing the system did" and carries no verdict — the one place brand is
   * allowed near status, because the point is that there is no status.
   */
  handed_off: "fill-brand/10 stroke-brand",
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
  /* Named for what it is waiting on, not just that it is waiting. "Waiting" on
     its own tells an operator nothing they can act on; this says the run is
     fine and the answer is coming from somewhere else. */
  waiting_for_event: "Waiting for an external event",
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
  ESCALATE: "stroke-status-waiting",
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
  const guard = constellation.loopGuard;

  /*
   * ── THE PATH THAT ENDED IN THE FAILURE ──────────────────────────────────
   * The server marks the activation that owns the root-cause span and every
   * ancestor of it, because the failing span is usually a tool call several
   * levels below the agent worth looking at. Emphasising the chain means the eye
   * follows the delegation that broke instead of scanning twelve nodes.
   */
  const onPath = React.useMemo(
    () => new Set(constellation.nodes.filter((n) => n.onRootCausePath).map((n) => n.id)),
    [constellation.nodes],
  );
  const pathEdge = (e: PlacedEdge) =>
    e.from != null && onPath.has(e.from) && onPath.has(e.to);

  /*
   * ── WHY THIS IS EMPTY, ANSWERED FROM THE DATA ───────────────────────────
   *
   * There are two ways to have no nodes and only one of them used to be
   * handled. This branch once said "every run since the harness shipped has at
   * least one activation", which is false, and then said the activation path was
   * switched off — which is true but is OUR deployment configuration, and a
   * person reading their own run should never be shown an environment variable.
   *
   * Both are gone: the API now reconstructs the agent from the iteration record
   * when no activation rows exist, so a single-agent run draws its agent like
   * any other. What is left here is the genuinely empty case — a run with no
   * agent step at all.
   */
  if (l.nodes.length === 0) {
    return (
      <div className={cn("rounded-lg border border-subtle p-6", className)}>
        <Text variant="body-sm" tone="secondary">
          {constellation.emptyCause === "no_agent_steps"
            ? "This run had no agent steps, so there is nothing to draw here. Its work is in the Flow and Timeline views."
            : "No agents ran in this run."}
        </Text>
      </div>
    );
  }

  const blocked = l.nodes.filter((n) => n.blocked);

  /*
   * Say what is NOT in the picture, and only when something is missing.
   *
   * A derived single-agent run is complete — one agent, no handoffs to draw,
   * nothing to warn about, so nothing is said. With two or more derived nodes
   * the edges between them genuinely were not recorded, and silence would let a
   * reader conclude the agents never handed off to each other.
   */
  const missingEdges = constellation.derived === true && l.nodes.length > 1;

  return (
    <div className={cn("grid gap-3", className)}>
      {/*
        THE BLOCKED BRANCHES, ABOVE THE DIAGRAM.

        "Never started because its sibling failed under wait_all" is the most
        common "why is nothing happening" question, and burying the answer inside
        a node somebody has to find first is how it stays unanswered. It leads.
      */}
      {missingEdges ? (
        <div className="rounded-lg border border-subtle bg-surface-raised p-3">
          <Text variant="label" tone="secondary" className="block">
            Handoffs are not shown for this run
          </Text>
          <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[70ch]">
            Each agent below is drawn from its own step record, which is complete
            — the timings and the cost are what the run actually spent. What was
            not recorded is which agent handed to which, so the connections
            between them are absent rather than empty.
          </Text>
        </div>
      ) : null}

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

      {/*
        WHICH SKILLS EACH AGENT WAS WORKING WITH.

        ── WHY THIS IS A PANEL AND NOT A TOOLTIP ────────────────────────────
        A skill changes how an agent behaves, so "why did this agent do that"
        and "which skills did it have" are the same question — and a tooltip is
        the wrong place for an answer somebody needs to read next to the output.
        A granted skill is also not the same as an ACTIVE one: it can be dropped
        because the budget ran out or because the tool it needs was revoked, and
        both cases produce an agent that looks like it ignored its instructions.

        So every activation that composed anything gets a row, and the rows that
        lost something say so first.
      */}
      <SkillsPanel nodes={l.nodes} />

      {/* The cycles, with the guard that is supposed to catch them. */}
      {l.loops.length > 0 ? (
        <div className="rounded-lg border border-status-waiting-border bg-surface-raised p-3">
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
                {/*
                  THE GUARD, NAMED — AND ITS REAL STATE.

                  A hit counter alone says the loop happened; the guard says what
                  is supposed to end it, which is the half that tells somebody
                  whether to raise a limit or fix a prompt.

                  It used to read "stopped by HANDOFF_LOOP", which is a claim the
                  data cannot support: HANDOFF_LOOP is a defined stop reason with
                  no construction site in the runtime — joins, fan-out and the
                  loop guard land in a later phase. So the server sends whether it
                  is enforced, and this says which.
                */}
                <Text variant="caption" tone="secondary">
                  {guard?.enforced
                    ? `stopped by ${guard.name} — ${guard.rule}`
                    : `${guard?.name ?? "HANDOFF_LOOP"} would catch this (${guard?.rule ?? "the same request repeated along the same edge"}), but it is not enforced yet — nothing stopped this loop`}
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
          aria-label={
            `Handoff constellation: ${l.nodes.length} activation${l.nodes.length === 1 ? "" : "s"}, ` +
            `${l.edges.length} handoff${l.edges.length === 1 ? "" : "s"}` +
            (l.loops.length > 0 ? `, ${l.loops.length} repeated handoff loop${l.loops.length === 1 ? "" : "s"}` : "")
          }
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
                strokeWidth={e.cyclic ? 2.5 : pathEdge(e) ? 2.5 : 1.5}
                strokeDasharray={e.cyclic ? "6 4" : undefined}
                className={cn(KIND_STYLE[e.kind] ?? "stroke-border-strong",
                  e.cyclic && "stroke-status-waiting",
                  pathEdge(e) && "stroke-status-failed")}
              />
              {/* An invisible fat line so hovering a 1.5px edge is possible. */}
              <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                    strokeWidth={14} stroke="transparent" className="cursor-help" />

              {/*
                THE LABEL, ON THE EDGE.

                Kind and the model's STATED REASON, which is recorded nowhere
                else and is the first thing anyone asks when a run went sideways.
                In a tooltip it is invisible to anyone scanning the diagram, and
                scanning is what this view is for — so it is drawn, with the
                reason clipped to a length that fits between two columns and the
                whole of it still in the hover panel below.
              */}
              <text
                x={(e.x1 + e.x2) / 2} y={(e.y1 + e.y2) / 2 - 6}
                textAnchor="middle"
                className="pointer-events-none fill-fg-secondary font-ui text-[10px]"
              >
                <tspan className="fill-fg-max">{e.kind}</tspan>
                {e.reason ? <tspan>{` · ${clip(e.reason, 28)}`}</tspan> : null}
              </text>
              <title>{`${e.kind}${e.reason ? ` — ${e.reason}` : ""}`}</title>
            </g>
          ))}

          {/*
            THE CYCLES, DRAWN ONCE EACH.

            A repeated handoff has the same endpoints every time, so as ordinary
            edges they stack into an unreadable blob exactly where the reader is
            looking. One curve, bowed away from the straight path so it cannot be
            mistaken for the delegation that went the other way, with the hit
            count on it.
          */}
          {l.loops.map((loop) => {
            const mx = (loop.x1 + loop.x2) / 2;
            const my = (loop.y1 + loop.y2) / 2;
            /* Bow perpendicular to the line, so the arc clears both nodes. */
            const dx = loop.x2 - loop.x1;
            const dy = loop.y2 - loop.y1;
            const len = Math.max(1, Math.hypot(dx, dy));
            const bow = 48;
            const cx = mx + (-dy / len) * bow;
            const cy = my + (dx / len) * bow;
            return (
              <g key={`loop-${loop.contractHash}-${loop.fromAgent}`}>
                <path
                  d={`M ${loop.x1} ${loop.y1} Q ${cx} ${cy} ${loop.x2} ${loop.y2}`}
                  fill="none"
                  markerEnd="url(#cst-arrow)"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  className="stroke-status-waiting"
                />
                <text x={cx} y={cy - 4} textAnchor="middle"
                      className="pointer-events-none fill-status-waiting font-ui text-[10px]">
                  {`${loop.kind} ×${loop.hits}`}
                </text>
                <title>
                  {`${loop.fromAgent} → ${loop.toAgent} repeated ${loop.hits} times ` +
                   `on the same contract`}
                </title>
              </g>
            );
          })}

          {l.nodes.map((n) => (
            <g key={n.id}
               className="cursor-pointer"
               onClick={() => onSelectActivation?.(n.id)}
               tabIndex={0}
               role="button"
               aria-label={
                 `${n.agentName}: ${STATUS_LABEL[n.status] ?? n.status}, ` +
                 `${n.tokens} tokens` +
                 (n.isRootCause ? ". This is the root cause." : "") +
                 (n.blockedReason ? `. ${n.blockedReason}` : "")
               }
               onKeyDown={(ev) => {
                 if (ev.key === "Enter" || ev.key === " ") {
                   ev.preventDefault();
                   onSelectActivation?.(n.id);
                 }
               }}>
              {/* THE ROOT-CAUSE RING, outside the node so it reads as a mark ON
                  the node rather than as a thicker border of it. */}
              {n.isRootCause ? (
                <circle cx={n.x} cy={n.y} r={n.r + 5}
                        className="fill-none stroke-status-failed" strokeWidth={2} />
              ) : null}
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
                 (n.stopReason ? `\nStopped: ${n.stopReason}` : "") +
                 (activeSkills(n).length > 0
                   ? `\nSkills: ${activeSkills(n).map(skillLabel).join(", ")}`
                   : "")}
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

/**
 * The skills each activation actually ran with.
 *
 * ── THE LIST IS OF WHAT WAS COMPOSED, NOT OF WHAT WAS GRANTED ──────────────
 * Those differ in two ways that both produce the same symptom — an agent that
 * appears to have ignored its instructions — and neither is visible anywhere
 * else:
 *
 *   · the prompt budget ran out, so a skill was cut short or left out entirely;
 *   · a tool the skill requires was revoked after the grant was saved, so the
 *     loader dropped the skill rather than teach the agent to call something
 *     the runtime would refuse.
 *
 * Both are stated here, first, and in the agent's own row. A reader who has
 * just looked at a disappointing output should not have to go and diff a grant
 * table to find out the agent never saw half of it.
 *
 * The VERSION is on every chip because an unpinned grant follows the skill's
 * current version — so "which text did this run see" is only answerable with a
 * number beside the name.
 */
function SkillsPanel({ nodes }: { nodes: PlacedNode[] }) {
  const withSkills = nodes.filter((n) => (n.skills?.length ?? 0) > 0);
  /* Nothing composed: either the feature is off or no agent here holds a skill.
     Both are correctly silent — a panel explaining that a feature flag is off
     tells a person reading their own run about our deployment configuration. */
  if (withSkills.length === 0) return null;

  const degraded = withSkills.filter((n) =>
    (n.skills ?? []).some((s) => !s.included || s.truncated),
  );

  return (
    <div className="rounded-lg border border-subtle bg-surface-raised p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Text variant="label" tone="secondary">Skills in play</Text>
        {degraded.length > 0 ? (
          <Text variant="caption" tone="secondary">
            {degraded.length} agent{degraded.length === 1 ? "" : "s"} did not receive
            every skill granted to {degraded.length === 1 ? "it" : "them"}
          </Text>
        ) : null}
      </div>

      <ul className="mt-2 grid gap-2">
        {withSkills.map((n) => (
          <li key={n.id} className="grid gap-1">
            <Text variant="body-sm" tone="max">{n.agentName}</Text>
            <div className="flex flex-wrap gap-1.5">
              {(n.skills ?? []).map((s) => (
                <SkillChip key={`${s.slug}-${s.version}`} skill={s} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One skill, and what the budget did to it.
 *
 * Three states, and they are deliberately not three shades of the same colour:
 *
 *   · composed whole — quiet. The ordinary case should not compete for
 *     attention with the two that need it.
 *   · cut short — the waiting ramp. The agent saw part of it, which is a
 *     degraded run rather than a broken one.
 *   · never sent — the failed ramp, struck through. The agent did not see it at
 *     all, and every conclusion drawn from its absence is wrong.
 *
 * Never the brand ramp for any of them (rule 11): this is status.
 */
function SkillChip({ skill }: { skill: ActivationSkill }) {
  const tone = !skill.included
    ? "border-status-failed-border bg-status-failed-subtle text-status-failed"
    : skill.truncated
      ? "border-status-waiting-border bg-status-waiting-subtle text-status-waiting"
      : "border-subtle bg-surface text-fg-secondary";

  const note = !skill.included
    ? "never sent — no room left in the prompt"
    : skill.truncated
      ? "cut short to fit the prompt"
      : skill.examplesDropped
        ? "sent without its worked examples"
        : null;

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-sm border px-1.5 py-0.5",
        tone,
      )}
      title={
        `${skill.slug} version ${skill.version}` +
        (skill.provenance === "first_party" ? " · platform skill" : " · written in this workspace") +
        (note ? ` · ${note}` : "") +
        (skill.included ? ` · ${skill.chars} characters of the prompt` : "")
      }
    >
      <span
        className={cn("font-code text-[11px]", !skill.included && "line-through")}
      >
        {skill.slug}
      </span>
      {/* The version is a number in a row of numbers, so it is tabular. */}
      <span className="font-code text-[10px] tabular opacity-80">v{skill.version}</span>
      {note ? <span className="font-ui text-[10px]">{note}</span> : null}
    </span>
  );
}

/** The skills an activation actually received, in composition order. */
function activeSkills(n: PlacedNode): ActivationSkill[] {
  return (n.skills ?? []).filter((s) => s.included);
}

/** `research-brief v3`, with a marker when the budget cut it. */
function skillLabel(s: ActivationSkill): string {
  return `${s.slug} v${s.version}${s.truncated ? " (cut short)" : ""}`;
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

/** Trim a reason to fit between two columns, without cutting mid-word if we can. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}
