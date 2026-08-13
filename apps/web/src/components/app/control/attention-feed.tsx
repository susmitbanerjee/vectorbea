"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/input";
import { MonoId } from "~/components/ui/mono-id";
import { Radio, RadioGroup } from "~/components/ui/choice";
import { formatSpan, type AttentionItem, type AttentionSeverity } from "~/mocks/control";
import {
  BlastRadiusIcon, ApprovalGateIcon, IncidentIcon, QueueDepthIcon,
  RecoveryEngineIcon, CheckpointIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   BAND 2 · NEEDS ATTENTION

   A triage feed, not a notification list. Every item is three things and no
   more: what is wrong, what it is taking down with it, and the one action that
   resolves it. Anything that cannot state all three does not belong here — it
   belongs in the activity stream at the bottom of the page.

   BLAST RADIUS IS THE POINT. "Postgres Answers is failing" is a fact. "Postgres
   Answers is failing, blocking 3 workflows, 7 tools and 22 queued runs" is a
   priority. The second one is what makes an operator fix this before the
   approval that has been waiting 19 hours.

   DISMISSAL TAKES A REASON. A dismiss button with no reason produces a feed
   people clear without reading. The reason is also the only signal we would ever
   have that an item is badly tuned.
══════════════════════════════════════════════════════════════════════════════ */

const SEVERITY_STYLE: Record<AttentionSeverity, { rail: string; label: string; text: string }> = {
  critical: { rail: "bg-status-failed", label: "Critical", text: "text-status-failed" },
  high: { rail: "bg-status-waiting", label: "High", text: "text-status-waiting" },
  medium: { rail: "bg-fg-muted", label: "Medium", text: "text-fg-muted" },
};

const KIND_ICON: Record<AttentionItem["kind"], IconComponent> = {
  connection: BlastRadiusIcon,
  approval: ApprovalGateIcon,
  workflow: RecoveryEngineIcon,
  quota: QueueDepthIcon,
  incident: IncidentIcon,
};

const DISMISS_REASONS = [
  { value: "expected", label: "Expected — planned work" },
  { value: "resolved", label: "Already resolved elsewhere" },
  { value: "not-actionable", label: "Not actionable by this team" },
  { value: "noise", label: "This should not have been flagged" },
];

export interface AttentionFeedProps {
  items: AttentionItem[];
  className?: string;
}

export function AttentionFeed({ items, className }: AttentionFeedProps) {
  const [dismissed, setDismissed] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState<AttentionItem | null>(null);

  const visible = items.filter((i) => !dismissed[i.id]);
  const dismissedCount = Object.keys(dismissed).length;

  return (
    <section aria-labelledby="attention-heading" className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Text variant="heading-sm" tone="max" as="h2" id="attention-heading">
          Needs attention
        </Text>
        {visible.length > 0 ? (
          <Text variant="caption" tone="muted">
            {visible.length} item{visible.length === 1 ? "" : "s"} · sorted by severity, then age
          </Text>
        ) : null}
        {dismissedCount > 0 ? (
          <button
            onClick={() => setDismissed({})}
            className={cn(
              "font-ui text-caption text-fg-muted hover:text-fg-primary ml-auto rounded-xs px-1",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            Restore {dismissedCount} dismissed
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <AllClear hadItems={items.length > 0} />
      ) : (
        <ul className="grid gap-2">
          {visible.map((item) => (
            <AttentionCard key={item.id} item={item} onDismiss={() => setPending(item)} />
          ))}
        </ul>
      )}

      <DismissDialog
        item={pending}
        onClose={() => setPending(null)}
        onConfirm={(reason) => {
          if (pending) setDismissed((d) => ({ ...d, [pending.id]: reason }));
          setPending(null);
        }}
      />
    </section>
  );
}

/* ── Card ─────────────────────────────────────────────────────────────────── */

function AttentionCard({ item, onDismiss }: { item: AttentionItem; onDismiss: () => void }) {
  const severity = SEVERITY_STYLE[item.severity];
  const Glyph = KIND_ICON[item.kind];

  return (
    <li
      className={cn(
        "border-subtle bg-surface-raised relative overflow-hidden rounded-md border",
        "hover:border-default transition-colors duration-fast",
      )}
    >
      {/* Severity rail. Colour on a 3px edge rather than a tinted card — a wall
          of tinted cards reads as decoration and stops encoding anything. */}
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]", severity.rail)} />

      <div className="flex flex-wrap items-start gap-3 py-3 pl-5 pr-3">
        <Glyph size={17} aria-hidden="true" className={cn("mt-0.5 shrink-0", severity.text)} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Text variant="body-sm" tone="primary" className="font-medium">
              {item.problem}
            </Text>
            <Text variant="caption" tone="muted" className="tabular">
              {formatSpan(item.since)}
            </Text>
          </div>

          {/* Blast radius as discrete facts. Prose here would have to be read;
              these can be scanned. */}
          <ul className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
            {item.blastRadius.map((fact, i) => (
              <li key={fact.label} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden="true" className="text-fg-disabled mr-1">·</span> : null}
                {fact.id ? (
                  // Rule 8: identifiers are mono, middle-truncated and
                  // click-to-copy. During an incident the id is the thing that
                  // gets pasted into a ticket, so copying it must not require
                  // opening the run.
                  <span className="flex items-center gap-1">
                    <MonoId value={fact.value} head={7} tail={4} srLabel={`${fact.label} identifier`} />
                    <Text variant="caption" tone="muted">{fact.label}</Text>
                  </span>
                ) : fact.href ? (
                  <Link
                    href={fact.href as Route}
                    className={cn(
                      "font-ui text-caption text-fg-secondary hover:text-accent rounded-xs",
                      "underline decoration-dotted underline-offset-2",
                      "transition-colors duration-fast outline-none focus-visible:focus-ring",
                    )}
                  >
                    <span className="tabular">{fact.value}</span> {fact.label}
                  </Link>
                ) : (
                  <Text variant="caption" tone="muted">
                    <span className="tabular">{fact.value}</span> {fact.label}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button asChild size="sm" variant={item.severity === "critical" ? "primary" : "secondary"}>
            <Link href={item.action.href as Route}>{item.action.label}</Link>
          </Button>
          <button
            onClick={onDismiss}
            aria-label={`Dismiss: ${item.problem}`}
            className={cn(
              "text-fg-disabled hover:text-fg-primary hover:bg-surface-hover grid size-7 place-items-center rounded-sm",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

/**
 * An achievement, stated as one. "No data" would be both wrong (there is plenty
 * of data) and demoralising for the one state on this page worth celebrating.
 */
function AllClear({ hadItems }: { hadItems: boolean }) {
  return (
    <div className="border-status-success-border bg-status-success-subtle rounded-md border p-5 text-center">
      <CheckpointIcon size={22} aria-hidden="true" className="text-status-success mx-auto" />
      <Text variant="body" tone="primary" className="mt-2 block font-medium">
        {hadItems ? "Everything triaged." : "Nothing needs you right now."}
      </Text>
      <Text variant="body-sm" tone="secondary" className="mx-auto mt-1 block max-w-[46ch]">
        No failing connections, no approval past half its SLA, no workflow failing repeatedly, and
        you are inside quota. Runs are executing and checkpointing on their own.
      </Text>
    </div>
  );
}

/* ── Dismiss ──────────────────────────────────────────────────────────────── */

function DismissDialog({
  item, onClose, onConfirm,
}: {
  item: AttentionItem | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState(DISMISS_REASONS[0].value);
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (item) { setReason(DISMISS_REASONS[0].value); setNote(""); }
  }, [item]);

  return (
    <Dialog.Root open={item !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed",
            "bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-[min(30rem,calc(100vw-2rem))] sm:rounded-lg",
            "p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">Dismiss this item</Text>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              {item?.problem}
            </Text>
          </Dialog.Description>

          <div className="mt-4">
            <Text variant="label" tone="primary" className="mb-2 block">Why are you dismissing it?</Text>
            <RadioGroup value={reason} onValueChange={setReason} aria-label="Dismissal reason">
              {DISMISS_REASONS.map((r) => (
                <Radio key={r.value} value={r.value}>{r.label}</Radio>
              ))}
            </RadioGroup>
          </div>

          <div className="mt-3">
            <Textarea
              minRows={2}
              maxRows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the next person on call should know (optional)"
              aria-label="Dismissal note"
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button variant="primary" size="sm" onClick={() => onConfirm(reason)}>
              Dismiss item
            </Button>
          </div>

          <Text variant="caption" tone="muted" className="mt-3 block">
            Dismissing hides it from this feed. It does not resolve the underlying condition, and the
            item returns if the condition worsens.
          </Text>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
