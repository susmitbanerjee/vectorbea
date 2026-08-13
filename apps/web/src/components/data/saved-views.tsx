"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field } from "~/components/ui/field";
import { Checkbox } from "~/components/ui/choice";

/* ══════════════════════════════════════════════════════════════════════════════
   QUICK FILTERS + SAVED VIEWS

   Quick filters are the four or five questions asked hourly, one click each.
   Saved views are the ones a person asks repeatedly enough to name.

   SHARING IS A URL, NOT A RECORD. A saved view serialises entirely into the
   query string, so "share" is "copy the address bar" and a colleague opening it
   needs no permission grant, no sync and no accepted invitation. The stored list
   is only a set of bookmarks to URLs the operator could have typed.
══════════════════════════════════════════════════════════════════════════════ */

export interface QuickFilter {
  id: string;
  label: string;
  query: string;
  /** Live count, rendered when known — a chip that says how much is behind it. */
  count?: number;
  tone?: "neutral" | "failed" | "waiting" | "live";
}

const CHIP_TONE: Record<NonNullable<QuickFilter["tone"]>, string> = {
  neutral: "text-fg-secondary",
  failed: "text-status-failed",
  waiting: "text-status-waiting",
  live: "text-status-live",
};

export function QuickFilters({
  filters, activeQuery, onApply, className,
}: {
  filters: QuickFilter[];
  activeQuery: string;
  onApply: (query: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Quick filters" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {filters.map((filter) => {
        const active = activeQuery.trim() === filter.query.trim();
        return (
          <button
            key={filter.id}
            onClick={() => onApply(active ? "" : filter.query)}
            aria-pressed={active}
            className={cn(
              "font-ui text-caption inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
              active
                ? "bg-accent-subtle border-accent-border text-accent"
                : "bg-surface-raised border-subtle hover:border-default text-fg-secondary",
            )}
          >
            <span className={active ? undefined : CHIP_TONE[filter.tone ?? "neutral"]}>{filter.label}</span>
            {filter.count !== undefined ? (
              <span className="font-code tabular text-fg-muted text-[10px]">
                {filter.count.toLocaleString("en-GB")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── Saved views ──────────────────────────────────────────────────────────── */

export interface SavedView {
  id: string;
  name: string;
  query: string;
  /** Shown in the sidebar's Runs section. */
  pinned: boolean;
  /** Applied when Runs is opened with no query of its own. */
  isDefault: boolean;
}

const storageKey = (scope: string) => `vectorbea-saved-views:${scope}`;

export const SEED_VIEWS: SavedView[] = [
  { id: "v-failed-today", name: "Failed today", query: "status:failed since:24h", pinned: true, isDefault: false },
  { id: "v-postgres", name: "Blocked on Postgres", query: "status:queued workflow:renewals", pinned: true, isDefault: false },
  { id: "v-expensive", name: "Expensive runs", query: "cost:>0.01", pinned: false, isDefault: false },
];

export const SEED_WORKFLOW_VIEWS: SavedView[] = [
  { id: "wv-failing", name: "Failing in production", query: "health:failing env:production", pinned: true, isDefault: false },
  { id: "wv-postgres", name: "Bound to Postgres", query: "connection:postgres", pinned: true, isDefault: false },
  { id: "wv-drafts", name: "Unpublished drafts", query: "status:draft", pinned: false, isDefault: false },
];

/**
 * Saved views, scoped per entity.
 *
 * The scope is in the storage key, not just in the query, because a Runs view
 * pasted into the Workflows bar parses as three unknown fields — a saved view
 * that cannot run is worse than no saved view, and sharing one store between two
 * schemas guarantees that outcome the first time someone switches pages.
 */
export function useSavedViews(scope = "runs", seed: SavedView[] = SEED_VIEWS): {
  views: SavedView[];
  save: (view: Omit<SavedView, "id">) => void;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<SavedView>) => void;
} {
  const [views, setViews] = React.useState<SavedView[]>(seed);

  // After mount, never during render — a localStorage read in the initialiser
  // makes the server and first client render disagree.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(scope));
      if (raw) setViews(JSON.parse(raw));
    } catch {}
  }, [scope]);

  const persist = React.useCallback((next: SavedView[]) => {
    setViews(next);
    try { window.localStorage.setItem(storageKey(scope), JSON.stringify(next)); } catch {}
  }, [scope]);

  return {
    views,
    save: (view) => persist([...views, { ...view, id: `v-${Date.now().toString(36)}` }]),
    remove: (id) => persist(views.filter((v) => v.id !== id)),
    update: (id, patch) =>
      persist(
        views.map((v) =>
          v.id === id
            ? { ...v, ...patch }
            // Only one default can exist, so setting one clears the others.
            : patch.isDefault ? { ...v, isDefault: false } : v,
        ),
      ),
  };
}

export function SavedViewsMenu({
  views, currentQuery, onApply, onSave, onRemove, onUpdate,
}: {
  views: SavedView[];
  currentQuery: string;
  onApply: (query: string) => void;
  onSave: (view: Omit<SavedView, "id">) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<SavedView>) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pinned, setPinned] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  const matching = views.find((v) => v.query.trim() === currentQuery.trim());

  const copyLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("q", currentQuery);
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm">
          {matching ? matching.name : "Views"}
          <ChevronGlyph />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className={cn(
            "motion-overlay z-popover bg-surface-overlay border-subtle shadow-2",
            "w-[min(22rem,calc(100vw-2rem))] rounded-md border p-2",
          )}
        >
          <Text variant="eyebrow" tone="muted" className="mb-1.5 block px-1">Saved views</Text>

          {views.length === 0 ? (
            <Text variant="caption" tone="muted" className="block px-1 py-2">
              None yet. Save the query you are looking at to start.
            </Text>
          ) : (
            <ul className="grid gap-px">
              {views.map((view) => (
                <li key={view.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => { onApply(view.query); setOpen(false); }}
                    className={cn(
                      "min-w-0 flex-1 rounded-xs px-2 py-1.5 text-left",
                      "hover:bg-surface-hover transition-colors duration-fast",
                      "outline-none focus-visible:focus-ring",
                    )}
                  >
                    <span className="font-ui text-body-sm text-fg-primary flex items-center gap-1.5">
                      {view.name}
                      {view.isDefault ? (
                        <span className="font-ui text-[10px] text-accent">default</span>
                      ) : null}
                    </span>
                    <span className="font-code text-mono-sm text-fg-muted block truncate">{view.query}</span>
                  </button>

                  <button
                    onClick={() => onUpdate(view.id, { pinned: !view.pinned })}
                    aria-pressed={view.pinned}
                    aria-label={view.pinned ? `Unpin ${view.name}` : `Pin ${view.name} to the sidebar`}
                    title={view.pinned ? "Pinned to sidebar" : "Pin to sidebar"}
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-xs",
                      "transition-colors duration-fast outline-none focus-visible:focus-ring",
                      view.pinned ? "text-accent" : "text-fg-disabled hover:text-fg-primary",
                    )}
                  >
                    <PinGlyph filled={view.pinned} />
                  </button>

                  <button
                    onClick={() => onUpdate(view.id, { isDefault: true })}
                    aria-label={`Make ${view.name} the default view`}
                    title="Set as default"
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-xs",
                      "transition-colors duration-fast outline-none focus-visible:focus-ring",
                      view.isDefault ? "text-accent" : "text-fg-disabled hover:text-fg-primary",
                    )}
                  >
                    <StarGlyph filled={view.isDefault} />
                  </button>

                  <button
                    onClick={() => onRemove(view.id)}
                    aria-label={`Delete ${view.name}`}
                    className={cn(
                      "text-fg-disabled hover:text-status-failed grid size-6 shrink-0 place-items-center rounded-xs",
                      "transition-colors duration-fast outline-none focus-visible:focus-ring",
                    )}
                  >
                    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                      <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-subtle mt-2 border-t pt-2">
            {currentQuery.trim() === "" ? (
              <Text variant="caption" tone="muted" className="block px-1">
                Write a query to save it as a view.
              </Text>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  onSave({ name: name.trim(), query: currentQuery, pinned, isDefault: false });
                  setName("");
                  setOpen(false);
                }}
                className="grid gap-2"
              >
                <Field label="Save this query as">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Failed in production"
                  />
                </Field>
                <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(v === true)}>
                  Pin to the sidebar
                </Checkbox>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
                    Save view
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={copyLink}>
                    {copied ? "Link copied" : "Copy link"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ── Glyphs ───────────────────────────────────────────────────────────────── */

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <path d="M3 4.5L6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinGlyph({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <path
        d="M7.2 1.4 10.6 4.8 9 5.2 6.6 7.6 6.9 9.4 2.6 5.1 4.4 5.4 6.8 3z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <path d="M4.2 7.8 2 10" fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
    </svg>
  );
}

function StarGlyph({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <path
        d="M6 1.4 7.4 4.4 10.6 4.8 8.3 7 8.9 10.2 6 8.7 3.1 10.2 3.7 7 1.4 4.8 4.6 4.4z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
