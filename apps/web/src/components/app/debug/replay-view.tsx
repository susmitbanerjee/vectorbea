"use client";

import * as React from "react";
import {
  ArrowClockwise, Prohibit, ShieldCheck, Warning, WarningOctagon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { MonoId } from "~/components/ui/mono-id";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatDuration } from "~/lib/format";
import type {
  ReplayAttempt, ReplayOption, ReplayOptions, SideEffects,
} from "~/lib/api/constellation";
import { TONE, toneForNodeStatus } from "./status-vocabulary";

/**
 * Replay and time travel — the difference between a debugger and a viewer.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * A user must never be unsure whether an action will email a customer.
 *
 * So every action states what it will do in the world BEFORE the confirmation,
 * in a sentence rather than a label, and the confirmation repeats it. An action
 * that cannot be offered says WHY — a greyed control with no reason sends
 * somebody looking for a setting, and, far worse, "replay from iteration 4" that
 * quietly replays from 1 leaves the reader believing three iterations were
 * restored while the run makes three live model calls.
 */

/** How each level is presented. The middle one is why this is not a boolean. */
const EFFECT: Record<SideEffects, {
  icon: React.ComponentProps<typeof Icon>["icon"];
  label: string;
  tone: string;
  border: string;
  fill: string;
}> = {
  NONE: {
    icon: ShieldCheck,
    label: "No side effects",
    tone: "text-status-success",
    border: "border-status-success-border",
    fill: "bg-status-success-subtle",
  },
  LIVE_FROM_POINT: {
    icon: Warning,
    label: "Live from the chosen point",
    tone: "text-status-waiting",
    border: "border-status-waiting-border",
    fill: "bg-status-waiting-subtle",
  },
  REAL: {
    icon: WarningOctagon,
    label: "Real side effects",
    tone: "text-status-failed",
    border: "border-status-failed-border",
    fill: "bg-status-failed-subtle",
  },
};

export function ReplayView({
  options,
  history,
  onRun,
  onOpenRun,
}: {
  options: ReplayOptions;
  history: ReplayAttempt[];
  /** Confirmed and dispatched. The parent owns the request. */
  onRun?: (optionId: string, fromIteration: number | null) => void;
  onOpenRun?: (runId: string) => void;
}) {
  const [confirming, setConfirming] = React.useState<ReplayOption | null>(null);
  const [fromIteration, setFromIteration] = React.useState(1);

  const needsIteration = (o: ReplayOption) =>
    o.id === "replay_from_iteration" || o.id === "replay_with_edit";

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        {options.options.map((o) => (
          <ActionCard
            key={o.id}
            option={o}
            onChoose={() => {
              setFromIteration(1);
              setConfirming(o);
            }}
          />
        ))}
      </div>

      {confirming && (
        <Confirm
          option={confirming}
          highestIteration={options.highestIteration}
          needsIteration={needsIteration(confirming)}
          fromIteration={fromIteration}
          onFromIteration={setFromIteration}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            onRun?.(confirming.id, needsIteration(confirming) ? fromIteration : null);
            setConfirming(null);
          }}
        />
      )}

      {history.length > 1 && <History attempts={history} onOpenRun={onOpenRun} />}
    </div>
  );
}

// ── One action ──────────────────────────────────────────────────────────────

/**
 * The action, its profile, and — when it cannot be offered — the reason.
 *
 * The profile is on the CARD, not behind the confirmation, because the decision
 * to click is the decision that matters. A confirmation that first tells you the
 * consequence has already let you commit to finding out.
 */
function ActionCard({ option: o, onChoose }: { option: ReplayOption; onChoose: () => void }) {
  const e = EFFECT[o.sideEffects];

  return (
    <div className={cn(
      "rounded-md border p-3",
      o.available ? e.border : "border-subtle",
      o.available ? e.fill : "bg-surface-raised",
      !o.available && "opacity-80",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Text variant="label" className={o.available ? "text-fg-max" : "text-fg-secondary"}>
              {o.label}
            </Text>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5",
              o.available ? e.tone : "text-fg-muted",
            )}>
              <Icon icon={e.icon} size="xs" decorative />
              <span className="text-[10px] font-medium">{e.label}</span>
            </span>
          </div>

          <Text variant="caption" className="mt-1 block max-w-[70ch] text-fg-secondary">
            {o.effectSummary}
          </Text>

          {/*
            THE REASON. A disabled control with no explanation sends somebody
            looking for a setting that does not exist — and this is the exact
            place where the alternative is worse than useless: silently replaying
            from 1 instead of from 4.
          */}
          {!o.available && o.reason && (
            <div className="mt-1.5 flex items-start gap-1.5">
              <Icon icon={Prohibit} size="xs" decorative className="mt-0.5 shrink-0 text-fg-muted" />
              <Text variant="caption" className="block max-w-[70ch] text-fg-muted">
                {o.reason}
              </Text>
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant={o.sideEffects === "NONE" ? "primary" : "secondary"}
          disabled={!o.available}
          onClick={onChoose}
        >
          {o.label}
        </Button>
      </div>
    </div>
  );
}

// ── The confirmation ────────────────────────────────────────────────────────

/**
 * Repeat the consequence, then ask.
 *
 * The card already said it; saying it again here is deliberate. This is the last
 * moment before something happens in the world, and a confirmation that only
 * says "are you sure?" is asking about a fact it has not stated.
 */
function Confirm({
  option: o, highestIteration, needsIteration, fromIteration,
  onFromIteration, onCancel, onConfirm,
}: {
  option: ReplayOption;
  highestIteration: number | null;
  needsIteration: boolean;
  fromIteration: number;
  onFromIteration: (n: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const e = EFFECT[o.sideEffects];
  const max = Math.max(1, highestIteration ?? 1);

  return (
    <div
      role="group"
      aria-label={`Confirm: ${o.label}`}
      className={cn("rounded-md border-2 p-3", e.border, e.fill)}
    >
      <div className="flex items-center gap-2">
        <Icon icon={e.icon} size="sm" decorative className={e.tone} />
        <Text variant="label" className={e.tone}>{o.label} — {e.label.toLowerCase()}</Text>
      </div>

      <Text variant="caption" className="mt-1 block max-w-[70ch] text-fg-secondary">
        {o.effectSummary}
      </Text>

      {needsIteration && (
        <label className="mt-2 block">
          <Text variant="caption" className="text-fg-secondary">
            Run live from iteration
          </Text>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={max}
              value={fromIteration}
              onChange={(ev) => onFromIteration(
                Math.min(max, Math.max(1, Number(ev.target.value) || 1)))}
              className={cn(
                "w-20 rounded-sm border border-default bg-surface-raised px-2 py-1 text-xs tabular-nums",
                "focus-visible:focus-ring",
              )}
            />
            {/* What the number MEANS, restated as the reader changes it — the
                difference between "from 4" and "1 to 3 restored" is the whole
                mental model. */}
            <Text variant="caption" className="text-fg-muted">
              {fromIteration <= 1
                ? "nothing is restored — this runs the whole loop again, live"
                : `iterations 1 to ${fromIteration - 1} are restored; ${fromIteration} onward runs live`}
            </Text>
          </div>
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={o.sideEffects === "REAL" ? "danger" : "primary"}
          onClick={onConfirm}
        >
          {o.sideEffects === "NONE" ? "Replay" : "Run it"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>

        {o.sideEffects !== "NONE" && (
          <Text variant="caption" className="text-fg-secondary">
            This is not a rehearsal.
          </Text>
        )}
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

/**
 * Every attempt at this run, so three tries at a fix are comparable.
 *
 * The original is in the list too, marked — a history that showed only the
 * replays would make the thing they are all attempts AT the one row missing.
 */
function History({
  attempts, onOpenRun,
}: {
  attempts: ReplayAttempt[];
  onOpenRun?: (runId: string) => void;
}) {
  return (
    <div className="rounded-md border border-subtle bg-surface-raised">
      <div className="border-b border-subtle px-3 py-2">
        <Text variant="caption" className="font-medium uppercase tracking-wide text-fg-muted">
          Attempts
        </Text>
      </div>
      <ul>
        {attempts.map((at) => {
          const t = TONE[toneForNodeStatus(runToneOf(at.status))];
          return (
            <li key={at.runId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-subtle px-3 py-2 last:border-0">
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", t.solid)} />
              <MonoId value={at.runId} />

              {/* THE BADGE, everywhere a replay appears. Without it a reader
                  comparing four rows has no way to tell which one is the run
                  that actually happened. */}
              {at.isReplay ? (
                <span className="inline-flex items-center gap-1 rounded-xs border border-subtle px-1.5 py-0.5">
                  <Icon icon={ArrowClockwise} size="xs" decorative className="text-fg-muted" />
                  <span className="text-[10px] text-fg-secondary">Replay — not counted</span>
                </span>
              ) : (
                <span className="rounded-xs border border-subtle px-1.5 py-0.5 text-[10px] text-fg-secondary">
                  Original
                </span>
              )}

              {at.isThisRun && (
                <span className="text-[10px] font-medium text-fg-max">you are here</span>
              )}

              <span className={cn("text-xs", t.text)}>{at.status}</span>

              {at.createdAt && at.completedAt && (
                <span className="font-mono text-[11px] tabular-nums text-fg-muted">
                  {formatDuration(Date.parse(at.completedAt) - Date.parse(at.createdAt))}
                </span>
              )}

              {onOpenRun && !at.isThisRun && (
                <button
                  type="button"
                  onClick={() => onOpenRun(at.runId)}
                  className={cn(
                    "ml-auto rounded-xs px-1 text-xs text-fg-link",
                    "transition-opacity hover:opacity-80 motion-reduce:transition-none",
                    "focus-visible:focus-ring",
                  )}
                >
                  Open
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A RUN status onto the shared span vocabulary. */
function runToneOf(status: string): string {
  switch (status) {
    case "succeeded": return "ok";
    case "failed": case "timed_out": case "enqueue_failed": return "error";
    case "running": case "queued": return "running";
    case "cancelled": return "cancelled";
    default: return status;
  }
}
