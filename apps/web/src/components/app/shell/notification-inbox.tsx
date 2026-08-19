"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { overlaySurface, overlayMotion } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { CountRoll } from "./count-roll";
import { DismissDialog } from "./dismiss-dialog";
import { badgeTone, onOpenInbox, worstSeverity, type InboxSeverity } from "./inbox-signal";
import {
  NOTIFICATIONS, NOTIFICATION_GROUP_LABEL,
  type ShellNotification, type NotificationKind,
} from "~/mocks/shell";
import { buildAttention, formatSpan, type AttentionItem } from "~/mocks/control";
import {
  IncidentIcon, ApprovalGateIcon, DurableRunIcon, LeaseIcon, TokenMeterIcon,
  BlastRadiusIcon, QueueDepthIcon, RecoveryEngineIcon, CheckpointIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   NOTIFICATION INBOX — the triage feed, moved off Control

   This used to be two things: a "Needs attention" band on the Control page that
   RESOLVED problems, and a bell that REPORTED events. Two surfaces competing to
   be the place you look when something is wrong.

   They are one surface now, and it is the bell. The important half is the
   triage half, so the merge keeps its properties rather than the notification
   list's: every actionable item still states what is wrong, what it is taking
   down with it, and the one action that fixes it. Informational notices sit
   below them and cannot colour the badge.

   GROUPED BY TYPE, NOT BY TIME. A reverse-chronological feed is the wrong shape
   here. During an incident forty notices arrive in a minute and a flat list
   buries the approval about to breach its SLA. Grouping keeps each class of
   work at a fixed position, and severity ordering within the group puts the
   thing that needs doing at the top of it.
══════════════════════════════════════════════════════════════════════════════ */

/** Every group the inbox can show, in triage order. */
const GROUP_ORDER = [
  "incident", "connection", "approval", "workflow", "quota", "run", "system",
] as const;

type InboxGroup = (typeof GROUP_ORDER)[number];

const GROUP_LABEL: Record<InboxGroup, string> = {
  ...NOTIFICATION_GROUP_LABEL,
  workflow: "Workflows",
  quota: "Quota",
};

const GROUP_ICON: Record<InboxGroup, IconComponent> = {
  incident: IncidentIcon,
  connection: BlastRadiusIcon,
  approval: ApprovalGateIcon,
  workflow: RecoveryEngineIcon,
  quota: QueueDepthIcon,
  run: DurableRunIcon,
  system: TokenMeterIcon,
};

const SEVERITY_RAIL: Record<InboxSeverity, string> = {
  critical: "bg-status-failed",
  high: "bg-status-waiting",
  medium: "bg-fg-muted",
  info: "bg-transparent",
};

const SEVERITY_TEXT: Record<InboxSeverity, string> = {
  critical: "text-status-failed",
  high: "text-status-waiting",
  medium: "text-fg-muted",
  info: "text-fg-muted",
};

/* ── One shape for both sources ───────────────────────────────────────────── */

interface InboxEntry {
  id: string;
  group: InboxGroup;
  severity: InboxSeverity;
  title: string;
  /** Prose for informational notices. Actionable items use `facts` instead. */
  body?: string;
  /** Blast radius, as discrete scannable facts. */
  facts?: AttentionItem["blastRadius"];
  /** Relative age, already formatted. */
  age: string;
  /** Sort key — smaller is newer. */
  ageValue: number;
  read: boolean;
  /** The action that RESOLVES it. Present on every actionable entry. */
  action?: { label: string; href: string };
  /** Deep link for the row itself. */
  href?: Route;
  /** Only actionable items can be dismissed; a notice is cleared by reading it. */
  dismissible: boolean;
}

function fromAttention(item: AttentionItem): InboxEntry {
  return {
    id: item.id,
    group: item.kind,
    severity: item.severity,
    title: item.problem,
    facts: item.blastRadius,
    age: formatSpan(item.since),
    ageValue: item.since,
    read: false,
    action: item.action,
    dismissible: true,
  };
}

function relativeAge(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function fromNotification(n: ShellNotification): InboxEntry {
  return {
    id: n.id,
    group: n.kind,
    severity: "info",
    title: n.title,
    body: n.body,
    age: relativeAge(n.age),
    ageValue: n.age * 60_000,
    read: n.read,
    href: n.href,
    dismissible: false,
  };
}

/* ── Inbox ────────────────────────────────────────────────────────────────── */

export function NotificationInbox() {
  const [open, setOpen] = React.useState(false);
  const [readIds, setReadIds] = React.useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState<InboxEntry | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Control's severity summary opens this popover.
  React.useEffect(() => onOpenInbox(() => setOpen(true)), []);

  const entries = React.useMemo(() => {
    const merged = [
      ...buildAttention().map(fromAttention),
      ...NOTIFICATIONS.map(fromNotification),
    ];
    return merged
      .filter((e) => !dismissed[e.id])
      .map((e) => (readIds.has(e.id) ? { ...e, read: true } : e));
  }, [dismissed, readIds]);

  const grouped = React.useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: entries
          .filter((e) => e.group === group)
          // Severity first, then newest — the same order the triage feed used.
          .sort((a, b) =>
            a.severity === b.severity
              ? b.ageValue - a.ageValue
              : SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
          ),
      })).filter((g) => g.items.length > 0),
    [entries],
  );

  /* The badge.
   *
   * It counts actionable items, NOT actionable + unread notices. Adding the two
   * looks harmless and puts a different number on the bell than the one Control
   * shows in its "N items need attention" line, for the same moment — and two
   * numbers for one situation on one screen is worse than either number alone.
   *
   * Informational notices still reach the badge, but only when nothing needs
   * doing: then it shows the unread count in neutral, which is the
   * "informational" state. They can never colour it, and they can never inflate
   * a count that claims things need attention.
   */
  const actionable = entries.filter((e) => e.severity !== "info");
  const unreadNotices = entries.filter((e) => e.severity === "info" && !e.read);
  const count = actionable.length > 0 ? actionable.length : unreadNotices.length;
  const worst = worstSeverity(actionable.map((e) => e.severity));
  const tone = badgeTone(count === 0 ? null : worst);

  const markRead = (id: string) => setReadIds((prev) => new Set(prev).add(id));
  const markAllRead = () => setReadIds(new Set(entries.map((e) => e.id)));

  /* Roving focus. Radix gives Tab and Escape; arrow keys are what people
     actually reach for in a list this shape, and without them a keyboard user
     tabs through every action button to reach the fourth row. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const focusables = listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-row]");
    if (!focusables || focusables.length === 0) return;
    e.preventDefault();
    const rows = Array.from(focusables);
    const current = rows.findIndex((r) => r.contains(document.activeElement));
    const next =
      e.key === "ArrowDown"
        ? Math.min(rows.length - 1, current + 1)
        : Math.max(0, current - 1);
    rows[next === -1 ? 0 : next]?.focus();
  };

  return (
    <>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger
          className={cn(
            "relative grid size-7 place-items-center rounded-sm",
            "text-fg-secondary transition-colors duration-fast outline-none",
            "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
          )}
          aria-label={
            actionable.length > 0
              ? `Notifications, ${actionable.length} needing attention, highest severity ${tone.label}`
              : unreadNotices.length > 0
                ? `Notifications, ${unreadNotices.length} unread, nothing needs attention`
                : "Notifications, nothing needs attention"
          }
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
            <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1 4 1 4H3s1-1 1-4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M6.5 13a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {count > 0 ? (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5",
                "grid h-3.5 min-w-3.5 place-items-center rounded-full px-1",
                "font-code text-[9px] leading-none",
                tone.dot, tone.text,
              )}
            >
              <CountRoll value={count} />
            </span>
          ) : null}
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="end"
            sideOffset={6}
            onKeyDown={onKeyDown}
            className={cn(overlaySurface, overlayMotion, "z-popover w-[26rem] max-w-[calc(100vw-2rem)]")}
          >
            <div className="border-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
              <p className="font-ui text-heading-sm text-fg-max">Inbox</p>
              {unreadNotices.length > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className={cn(
                    "font-ui text-caption text-fg-muted rounded-xs px-1.5 py-0.5",
                    "transition-colors duration-instant outline-none",
                    "hover:text-fg-primary focus-visible:focus-ring",
                  )}
                >
                  Mark all read
                </button>
              ) : null}
            </div>

            {/* Capped and scrollable. An inbox that grows the popover past the
                viewport puts its own scrollbar out of reach. */}
            <div ref={listRef} className="max-h-[min(30rem,70vh)] overflow-y-auto">
              {grouped.length === 0 ? (
                <AllClear dismissedCount={Object.keys(dismissed).length} />
              ) : (
                grouped.map(({ group, items }) => (
                  <div key={group} className="border-subtle border-b last:border-b-0">
                    <p className="font-ui text-eyebrow text-fg-muted bg-surface-sunken px-3 py-1 uppercase">
                      {GROUP_LABEL[group]}
                    </p>
                    {items.map((entry) => (
                      <Row
                        key={entry.id}
                        entry={entry}
                        icon={GROUP_ICON[group]}
                        onRead={() => markRead(entry.id)}
                        onDismiss={() => { setOpen(false); setPending(entry); }}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>

            {Object.keys(dismissed).length > 0 ? (
              <div className="border-subtle border-t px-3 py-2">
                <button
                  type="button"
                  onClick={() => setDismissed({})}
                  className={cn(
                    "font-ui text-caption text-fg-muted rounded-xs",
                    "transition-colors duration-instant outline-none",
                    "hover:text-fg-primary focus-visible:focus-ring",
                  )}
                >
                  Restore {Object.keys(dismissed).length} dismissed
                </button>
              </div>
            ) : null}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      <DismissDialog
        problem={pending?.title ?? null}
        onClose={() => setPending(null)}
        onConfirm={(reason) => {
          if (pending) setDismissed((d) => ({ ...d, [pending.id]: reason }));
          setPending(null);
        }}
      />
    </>
  );
}

const SEVERITY_ORDER: Record<InboxSeverity, number> = {
  critical: 0, high: 1, medium: 2, info: 3,
};

/* ── Row ──────────────────────────────────────────────────────────────────── */

function Row({
  entry, icon: Glyph, onRead, onDismiss,
}: {
  entry: InboxEntry;
  icon: IconComponent;
  onRead: () => void;
  onDismiss: () => void;
}) {
  const actionable = entry.severity !== "info";

  return (
    <div
      className={cn(
        "relative flex gap-2.5 px-3 py-2.5",
        "transition-colors duration-instant",
        "hover:bg-surface-hover",
        !entry.read && !actionable && "bg-surface-hover/40",
      )}
    >
      {/* Severity rail on a 3px edge rather than a tinted row — a wall of tinted
          rows reads as decoration and stops encoding anything. */}
      {actionable ? (
        <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]", SEVERITY_RAIL[entry.severity])} />
      ) : null}

      <Glyph size={16} aria-hidden="true" className={cn("mt-0.5 shrink-0", SEVERITY_TEXT[entry.severity])} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {entry.href ? (
            <Link
              href={entry.href}
              data-inbox-row
              onClick={onRead}
              className={cn(
                "font-ui text-body-sm min-w-0 flex-1 truncate rounded-xs outline-none",
                "focus-visible:focus-ring",
                entry.read ? "text-fg-secondary" : "text-fg-primary font-medium",
              )}
            >
              {entry.title}
            </Link>
          ) : (
            <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 font-medium">
              {entry.title}
            </span>
          )}
          <span className="font-code text-mono-sm tabular text-fg-muted shrink-0">{entry.age}</span>
        </div>

        {entry.body ? (
          <span className="font-ui text-caption text-fg-muted mt-0.5 block">{entry.body}</span>
        ) : null}

        {/* Blast radius as discrete facts. Prose here would have to be read;
            these can be scanned. */}
        {entry.facts && entry.facts.length > 0 ? (
          <ul className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
            {entry.facts.map((fact, i) => (
              <li key={fact.label} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden="true" className="text-fg-disabled mr-1">·</span> : null}
                {fact.id ? (
                  <span className="flex items-center gap-1">
                    <MonoId value={fact.value} head={7} tail={4} srLabel={`${fact.label} identifier`} />
                    <span className="font-ui text-caption text-fg-muted">{fact.label}</span>
                  </span>
                ) : (
                  <span className="font-ui text-caption text-fg-muted">
                    <span className="tabular">{fact.value}</span> {fact.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {entry.action ? (
          <div className="mt-2 flex items-center gap-1.5">
            <Button
              asChild
              size="sm"
              variant={entry.severity === "critical" ? "primary" : "secondary"}
            >
              <Link href={entry.action.href as Route} data-inbox-row onClick={onRead}>
                {entry.action.label}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {entry.dismissible ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss: ${entry.title}`}
          className={cn(
            "text-fg-disabled hover:text-fg-primary hover:bg-surface-hover grid size-6 shrink-0 place-items-center self-start rounded-sm",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
          )}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
        </button>
      ) : !entry.read ? (
        <span className="bg-accent mt-1.5 size-1.5 shrink-0 self-start rounded-full" aria-label="Unread" />
      ) : null}
    </div>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

/**
 * An achievement, stated as one. "No notifications" would be both wrong — there
 * is plenty of activity — and flat for the one state here worth celebrating.
 */
function AllClear({ dismissedCount }: { dismissedCount: number }) {
  return (
    <div className="px-4 py-8 text-center">
      <CheckpointIcon size={22} aria-hidden="true" className="text-status-success mx-auto" />
      <p className="font-ui text-body-sm text-fg-primary mt-2 font-medium">
        {dismissedCount > 0 ? "Everything triaged." : "Nothing needs you right now."}
      </p>
      <p className="font-ui text-caption text-fg-muted mx-auto mt-1 max-w-[38ch]">
        No failing connections, no approval past half its SLA, no workflow failing repeatedly, and
        you are inside quota.
      </p>
    </div>
  );
}
