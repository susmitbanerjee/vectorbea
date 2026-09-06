"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { Text } from "~/components/ui/text";
import type { CellState, RunNode } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   THE RECOVERY LOOP — the hero.

   Not a headline over a screenshot. A run executes, commits node by node, dies
   on a tool call at step 7, and RESUMES FROM CHECKPOINT 6 — visibly not from
   zero. The Ribbon keeps its committed cells across the failure, which is the
   entire product claim in eight seconds. A competitor cannot screenshot their
   way to it, because the claim is about what happens over time.

   IMPLEMENTATION NOTES
   - No video, no canvas, no animation library. One interval driving React state
     into the same <CheckpointRibbon> the product ships, plus a log list. The
     whole module is a few KB on top of components the page already loads.
   - The timeline is DATA, not a sequence of setTimeouts. That makes it
     scrubbable for free: dragging the control just sets the frame index.
   - Under prefers-reduced-motion it does not run at all. It renders the
     post-recovery end state — which is the most persuasive frame anyway — with
     a play control for anyone who wants to watch it.
══════════════════════════════════════════════════════════════════════════════ */

const NODE_NAMES = [
  "Schedule trigger",
  "Load account batch",
  "contracts.getUpcomingRenewals",
  "Classify renewal risk",
  "Branch on tier",
  "postgres.query",
  "stripe.getInvoice",
  "Draft outreach",
  "Await approval",
  "slack.postMessage",
  "Commit checkpoint",
  "Emit report",
];

const TOTAL = NODE_NAMES.length;
/** Zero-based: the run dies on node index 6, which reads as "step 7". */
const FAIL_INDEX = 6;
/** It resumes from the last durable commit — index 5, "checkpoint 6". */
const RESUME_INDEX = 5;

interface Frame {
  /** Cell state per node. */
  states: CellState[];
  /** Log line revealed at this frame, if any. */
  log?: { text: string; tone: "info" | "commit" | "error" | "recover" };
  /** Caption describing what the viewer is watching. */
  caption: string;
  /** Frames hold longer at the dramatic beats. */
  hold: number;
}

function fill(count: number, state: CellState): CellState[] {
  return Array.from({ length: count }, () => state);
}

/**
 * Build the whole loop as an array of frames.
 *
 * Written out rather than generated so the pacing is authored: the failure and
 * the resume hold for nearly a second each, and the routine commits go by fast.
 */
function buildTimeline(): Frame[] {
  const frames: Frame[] = [];
  const base = fill(TOTAL, "pending");

  frames.push({
    states: [...base],
    caption: "Run accepted",
    log: { text: "accept  run_01JBQZ8XK4 · renewals-daily · production", tone: "info" },
    hold: 700,
  });

  // Commit nodes 0–5.
  for (let i = 0; i <= RESUME_INDEX; i += 1) {
    const states = [...base];
    for (let j = 0; j < i; j += 1) states[j] = "committed";
    states[i] = "executing";
    frames.push({
      states,
      caption: `Executing ${NODE_NAMES[i]}`,
      log: { text: `exec    ${NODE_NAMES[i]}`, tone: "info" },
      hold: 260,
    });

    const committed = [...states];
    committed[i] = "committed";
    frames.push({
      states: committed,
      caption: `Checkpoint ${i + 1} committed`,
      log: { text: `commit  checkpoint ${i + 1} · durable`, tone: "commit" },
      hold: 240,
    });
  }

  // Node 6 executes, then fails.
  const executing = fill(TOTAL, "pending");
  for (let j = 0; j <= RESUME_INDEX; j += 1) executing[j] = "committed";
  executing[FAIL_INDEX] = "executing";
  frames.push({
    states: executing,
    caption: `Executing ${NODE_NAMES[FAIL_INDEX]}`,
    log: { text: `exec    ${NODE_NAMES[FAIL_INDEX]}`, tone: "info" },
    hold: 620,
  });

  const failed = [...executing];
  failed[FAIL_INDEX] = "failed";
  frames.push({
    states: failed,
    caption: "Tool call failed — connection refused",
    log: { text: "error   stripe.getInvoice · ECONNREFUSED after 3 attempts", tone: "error" },
    hold: 900,
  });
  frames.push({
    states: [...failed],
    caption: "6 of 12 committed. Nothing before the failure is lost.",
    log: { text: "paused  6 of 12 nodes committed", tone: "error" },
    hold: 1100,
  });

  // Recovery: resume from checkpoint 6, not from zero.
  frames.push({
    states: [...failed],
    caption: "Resuming from checkpoint 6",
    log: { text: "resume  from checkpoint 6 · 0 nodes replayed", tone: "recover" },
    hold: 900,
  });

  const resumed = [...executing];
  resumed[FAIL_INDEX] = "executing";
  frames.push({
    states: resumed,
    caption: `Re-executing ${NODE_NAMES[FAIL_INDEX]} only`,
    log: { text: `exec    ${NODE_NAMES[FAIL_INDEX]} · attempt 2`, tone: "info" },
    hold: 520,
  });

  const recovered = [...resumed];
  recovered[FAIL_INDEX] = "recovered";
  frames.push({
    states: recovered,
    caption: "Recovered — committed on attempt 2",
    log: { text: `commit  checkpoint ${FAIL_INDEX + 1} · recovered`, tone: "recover" },
    hold: 620,
  });

  // Finish the remaining nodes.
  for (let i = FAIL_INDEX + 1; i < TOTAL; i += 1) {
    const states = [...recovered];
    for (let j = FAIL_INDEX + 1; j < i; j += 1) states[j] = "committed";
    states[i] = "executing";
    frames.push({
      states,
      caption: `Executing ${NODE_NAMES[i]}`,
      log: { text: `exec    ${NODE_NAMES[i]}`, tone: "info" },
      hold: 200,
    });

    const committed = [...states];
    committed[i] = "committed";
    frames.push({
      states: committed,
      caption: `Checkpoint ${i + 1} committed`,
      log: { text: `commit  checkpoint ${i + 1} · durable`, tone: "commit" },
      hold: 190,
    });
  }

  frames.push({
    states: recovered.map((s, i) => (i === FAIL_INDEX ? "recovered" : "committed")),
    caption: "Complete. One node re-executed, not twelve.",
    log: { text: "done    12 of 12 · 1 node replayed", tone: "recover" },
    hold: 2200,
  });

  return frames;
}

const TIMELINE = buildTimeline();
/** The frame a reduced-motion visitor sees: the argument, already made. */
const END_FRAME = TIMELINE.length - 1;

const LOG_TONE = {
  info: "text-fg-muted",
  commit: "text-status-success",
  error: "text-status-failed",
  recover: "text-accent",
} as const;

/* ── Reserved geometry ────────────────────────────────────────────────────────
   Every box in this module is sized for its WORST frame, never for its current
   one. The loop plays under prose the visitor is reading: a panel that grew a
   row when a log line arrived, or lost one when the tail rolled over, shoved
   the rest of the page up and down for the whole eight seconds.

   So: the log is a fixed-height tail — lines anchor to the bottom and the
   oldest leaves through the top — and the caption and controls hold their
   space whatever text is in them. */

/** How many entries of tail the log shows. */
const LOG_TAIL = 6;
/** One rendered row, in the exact metrics the rows use (fallbacks are the token values). */
const LOG_ROW = "calc(var(--text-mono-sm, 0.71875rem) * var(--text-mono-sm--line-height, 1.55))";
/** Rows reserved: LOG_TAIL entries, with headroom for the long ones that wrap. */
const LOG_ROWS = 9;
/** gap-1 between entries, on the 4px lattice. */
const LOG_GAP = "0.25rem";
const LOG_HEIGHT = `calc(${LOG_ROWS} * ${LOG_ROW} + ${LOG_ROWS - 1} * ${LOG_GAP})`;
/** Top edge fade: what runs off the top has scrolled away, it has not been cut. */
const LOG_FADE = `linear-gradient(to bottom, transparent, black calc(1.5 * ${LOG_ROW}))`;

export function RecoveryLoop({ className }: { className?: string }) {
  const [reduceMotion, setReduceMotion] = React.useState<boolean | null>(null);
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [scrubbing, setScrubbing] = React.useState(false);

  // Decide the initial mode once the preference is readable.
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduceMotion(query.matches);
      setPlaying(!query.matches);
      setFrame(query.matches ? END_FRAME : 0);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // Advance on the current frame's own hold, so pacing is authored per beat.
  React.useEffect(() => {
    if (!playing || scrubbing) return;
    const timer = setTimeout(
      () => setFrame((f) => (f + 1) % TIMELINE.length),
      TIMELINE[frame].hold,
    );
    return () => clearTimeout(timer);
  }, [playing, scrubbing, frame]);

  const current = TIMELINE[frame];

  const nodes = React.useMemo<RunNode[]>(
    () =>
      current.states.map((state, i) => ({
        id: `n${i}`,
        name: NODE_NAMES[i],
        kind: "tool",
        state,
        durationMs: state === "pending" ? null : 400 + i * 130,
        tokens: null,
        costUsd: null,
        at: state === "pending" ? null : new Date().toISOString(),
      })),
    [current.states],
  );

  // The last few log lines, so the stream reads as a tail rather than a wall.
  const logLines = React.useMemo(() => {
    const lines: { text: string; tone: keyof typeof LOG_TONE; key: number }[] = [];
    for (let i = 0; i <= frame; i += 1) {
      const entry = TIMELINE[i].log;
      if (entry) lines.push({ ...entry, key: i });
    }
    return lines.slice(-LOG_TAIL);
  }, [frame]);

  const committed = current.states.filter((s) => s === "committed" || s === "recovered").length;

  return (
    <div
      className={cn(
        "bg-surface-raised border-subtle relative overflow-hidden rounded-lg border",
        className,
      )}
    >
      {/* Chrome strip — a run header, not a fake browser window. */}
      <div className="border-subtle flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <span className="font-code text-mono-sm text-fg-secondary">run_01JBQZ8XK4</span>
        <span className="font-ui text-caption text-fg-muted">renewals-daily</span>
        <span className="bg-surface-active text-fg-muted font-ui text-caption rounded-xs px-1.5 py-0.5">
          production
        </span>
        <span className="font-code text-mono-sm tabular text-fg-muted ml-auto whitespace-nowrap">
          {/* Fixed digit column: 3 -> 12 must not change this string's width,
              or the header rewraps mid-run. */}
          <span className="inline-block w-[2ch] text-right">{committed}</span> / {TOTAL} committed
        </span>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[1.05fr_1fr] lg:p-5">
        {/* ── The Ribbon ─────────────────────────────────────────────── */}
        <div className="min-w-0">
          <Text variant="eyebrow" tone="muted" className="mb-2 block">Checkpoint ribbon</Text>
          <CheckpointRibbon nodes={nodes} size="md" runId="hero-loop" />

          {/* Two lines are reserved for the caption whether it needs one or two. */}
          <p
            className="font-ui text-body-sm text-fg-primary mt-3 h-10 line-clamp-2"
            aria-live="polite"
          >
            {current.caption}
          </p>

          {/* Scrub. A range input, so it is keyboard operable and needs no
              custom drag handling — arrow keys step frame by frame, which is
              the best way to study the failure moment. */}
          <label className="mt-2 block">
            <span className="sr-only">Scrub the run simulation</span>
            <input
              type="range"
              min={0}
              max={TIMELINE.length - 1}
              value={frame}
              onChange={(e) => setFrame(Number(e.target.value))}
              onPointerDown={() => setScrubbing(true)}
              onPointerUp={() => setScrubbing(false)}
              onFocus={() => setScrubbing(true)}
              onBlur={() => setScrubbing(false)}
              className={cn(
                "h-1 w-full cursor-pointer appearance-none rounded-full",
                "bg-surface-active accent-accent",
                "outline-none focus-visible:focus-ring",
              )}
            />
          </label>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className={cn(
                // min-w holds "Pause" and "Play" at one width, so toggling
                // playback cannot rewrap the hint beside it.
                "font-ui text-caption text-fg-muted min-w-11 rounded-xs px-1.5 py-0.5",
                "transition-colors duration-fast outline-none",
                "hover:text-fg-primary focus-visible:focus-ring",
              )}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <span className="font-ui text-caption text-fg-disabled min-w-0 flex-1 truncate">
              {reduceMotion
                ? "Paused — reduced motion is on. Press play to watch the recovery."
                : "Drag to replay the failure."}
            </span>
          </div>
        </div>

        {/* ── The log stream ─────────────────────────────────────────── */}
        <div className="bg-surface-sunken border-subtle flex min-w-0 flex-col rounded-md border p-3">
          <Text variant="eyebrow" tone="muted" className="mb-2 block">Event log</Text>
          {/* The height is reserved, not measured: the tail is pinned to the
              bottom of a fixed box so a new line pushes the oldest out of view
              instead of pushing the page down. */}
          <div
            className="relative overflow-hidden"
            style={{
              height: LOG_HEIGHT,
              // The oldest line fades out through the top edge, so a tail that
              // is longer than the reserved box reads as scrolled rather than
              // cut. Narrow columns wrap more lines and lean on this.
              maskImage: LOG_FADE,
              WebkitMaskImage: LOG_FADE,
            }}
          >
            <ol className="absolute inset-x-0 bottom-0 grid gap-1">
              {logLines.map((line) => (
                <li
                  key={line.key}
                  className={cn(
                    "font-code text-mono-sm break-words",
                    LOG_TONE[line.tone],
                    // Log stream (§7.2 #3): 3px rise, 140ms. Reduced motion
                    // collapses this to an opacity step via the token layer.
                    "animate-[ink-log-line_140ms_var(--ease-entrance)_both]",
                  )}
                >
                  {line.text}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
