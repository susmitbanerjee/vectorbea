"use client";

import * as React from "react";
import Link from "next/link";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { overlaySurface, overlayMotion } from "~/components/ui/select";
import { CountRoll } from "./count-roll";
import {
  NOTIFICATIONS, NOTIFICATION_GROUP_LABEL,
  type ShellNotification, type NotificationKind,
} from "~/mocks/shell";
import {
  IncidentIcon, ApprovalGateIcon, DurableRunIcon, LeaseIcon, TokenMeterIcon,
} from "~/components/icons/domain";

/**
 * <NotificationInbox> — grouped by type, not by time.
 *
 * A reverse-chronological feed is the wrong shape here. During an incident,
 * forty notifications arrive in a minute and a flat list buries the one approval
 * that is about to breach its SLA. Grouping by type keeps each class of work
 * reachable at a fixed position, and each entry deep-links to the thing itself
 * rather than to a list you then have to search.
 */

const KIND_ICON: Record<NotificationKind, typeof IncidentIcon> = {
  incident: IncidentIcon,
  approval: ApprovalGateIcon,
  run: DurableRunIcon,
  connection: LeaseIcon,
  system: TokenMeterIcon,
};

const KIND_TONE: Record<NotificationKind, string> = {
  incident: "text-status-failed",
  approval: "text-status-waiting",
  run: "text-status-succeeded",
  connection: "text-status-failed",
  system: "text-fg-muted",
};

function relativeAge(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function NotificationInbox() {
  const [items, setItems] = React.useState<ShellNotification[]>(NOTIFICATIONS);
  const unread = items.filter((n) => !n.read).length;

  const grouped = React.useMemo(() => {
    const order: NotificationKind[] = ["incident", "connection", "approval", "run", "system"];
    return order
      .map((kind) => ({ kind, items: items.filter((n) => n.kind === kind) }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  const markAllRead = () => setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  const markRead = (id: string) =>
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        className={cn(
          "relative grid size-7 place-items-center rounded-sm",
          "text-fg-secondary transition-colors duration-fast outline-none",
          "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
        )}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1 4 1 4H3s1-1 1-4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M6.5 13a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {unread > 0 ? (
          <span
            className={cn(
              "bg-status-failed text-fg-on-accent absolute -right-0.5 -top-0.5",
              "grid h-3.5 min-w-3.5 place-items-center rounded-full px-1",
              "font-code text-[9px] leading-none",
            )}
          >
            <CountRoll value={unread} />
          </span>
        ) : null}
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className={cn(overlaySurface, overlayMotion, "z-popover w-88 max-w-[calc(100vw-2rem)]")}
        >
          <div className="border-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
            <p className="font-ui text-heading-sm text-fg-max">Inbox</p>
            {unread > 0 ? (
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

          <div className="max-h-96 overflow-y-auto">
            {grouped.length === 0 ? (
              <p className="font-ui text-body-sm text-fg-muted px-3 py-6 text-center">
                Nothing needs you right now.
              </p>
            ) : (
              grouped.map((group) => {
                const Glyph = KIND_ICON[group.kind];
                return (
                  <div key={group.kind} className="border-subtle border-b last:border-b-0">
                    <p className="font-ui text-eyebrow text-fg-muted bg-surface-sunken px-3 py-1 uppercase">
                      {NOTIFICATION_GROUP_LABEL[group.kind]}
                    </p>
                    {group.items.map((n) => (
                      <Link
                        key={n.id}
                        href={n.href}
                        onClick={() => markRead(n.id)}
                        className={cn(
                          "flex gap-2.5 px-3 py-2 outline-none",
                          "transition-colors duration-instant",
                          "hover:bg-surface-hover focus-visible:focus-ring",
                          !n.read && "bg-surface-hover/40",
                        )}
                      >
                        <Glyph size={16} aria-hidden="true" className={cn("mt-0.5 shrink-0", KIND_TONE[n.kind])} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={cn(
                              "font-ui text-body-sm truncate",
                              n.read ? "text-fg-secondary" : "text-fg-primary font-medium",
                            )}>
                              {n.title}
                            </span>
                            <span className="font-code text-mono-sm tabular text-fg-muted ml-auto shrink-0">
                              {relativeAge(n.age)}
                            </span>
                          </span>
                          <span className="font-ui text-caption text-fg-muted block">{n.body}</span>
                        </span>
                        {!n.read ? (
                          <span className="bg-accent mt-1.5 size-1.5 shrink-0 rounded-full" aria-label="Unread" />
                        ) : null}
                      </Link>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
