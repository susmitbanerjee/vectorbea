"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "~/lib/cn";
import { controlBase, controlSize, useFieldControl, type ControlSize } from "./field";
import { overlaySurface, overlayMotion, menuItem, Chevron, Tick } from "./select";
import { Spinner } from "./spinner";

/**
 * <Combobox> — type-to-filter selection over a list that may be large or remote.
 *
 * Two things make this different from a styled <Select>:
 *
 * ASYNC. Pass `onSearch` and the component owns the debounce, the in-flight
 * spinner, the empty result copy and the error state. Every screen that needs a
 * remote lookup would otherwise reimplement that, badly and differently.
 *
 * VIRTUALISED. Rows render through @tanstack/react-virtual, so a 10,000-option
 * list (every tool in a workspace, every timezone) scrolls at 60fps and mounts
 * ~12 nodes instead of 10,000. The threshold is deliberate rather than always-on:
 * below it, virtualisation costs more than it saves and breaks native find.
 *
 * Keyboard: ↑/↓ move, Enter selects, Escape closes, Home/End jump. The active
 * option is tracked with aria-activedescendant so the input keeps focus and
 * screen readers still announce the highlighted row.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options?: ComboboxOption[];
  value?: string | null;
  onValueChange?: (value: string | null) => void;
  /** Remote search. Returning a promise switches the component into async mode. */
  onSearch?: (query: string) => Promise<ComboboxOption[]>;
  debounceMs?: number;
  placeholder?: string;
  /** Copy shown when the query matches nothing. Directive, per §12. */
  emptyMessage?: string;
  size?: ControlSize;
  disabled?: boolean;
  className?: string;
  /** Virtualise beyond this many rows. */
  virtualiseAfter?: number;
}

/**
 * Row heights, and why there are two.
 *
 * The virtualiser positions rows by multiplying an index by a FIXED height, so
 * this number is not styling — it is the layout contract. A single 32px row
 * fits one line, but an option may also carry a `description`, and two lines
 * need 44. Rendering a two-line row inside a 32px box clipped the description
 * everywhere, and once the list passed `virtualiseAfter` it was worse than
 * cosmetic: rows are absolutely positioned at `index * height`, so every row
 * overlapped the one below it.
 *
 * Measured on the schema-table picker, whose options all carry a description:
 * every row reported `scrollHeight` 34 against `clientHeight` 32.
 */
const ROW_HEIGHT = 32;
const ROW_HEIGHT_WITH_DESCRIPTION = 44;

/**
 * The scroller's viewport height, in one place because two things need it.
 *
 * It caps the list, and it SEEDS the virtualiser. `useVirtualizer` starts with
 * `initialRect: { width: 0, height: 0 }` and only learns the real size when a
 * ResizeObserver fires. A zero-height viewport has no visible range, so the
 * first render of a virtualised list is empty — `getTotalSize()` is right,
 * because it is just count times row height, while `getVirtualItems()` returns
 * nothing at all.
 *
 * Inside a popover that mounts and measures in the same tick, that empty first
 * frame is what the user sees: open the picker against a database with more
 * than `virtualiseAfter` tables and the list is blank, with a correctly-sized
 * scrollbar beside it. Measured at 52 tables: scroller 288px, total range
 * 2288px, rows mounted 0.
 *
 * Seeding the rect means the first frame already has rows and the observer only
 * ever refines it.
 */
const LIST_MAX_HEIGHT = 288;

export const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    options: staticOptions, value, onValueChange, onSearch, debounceMs = 200,
    placeholder = "Search…", emptyMessage, size = "md", disabled, className,
    virtualiseAfter = 40,
  },
  ref,
) {
  const field = useFieldControl();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [remote, setRemote] = React.useState<ComboboxOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);

  const listId = React.useId();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

  const isAsync = typeof onSearch === "function";

  // Local filtering when there is no remote source.
  const options = React.useMemo(() => {
    if (isAsync) return remote;
    const all = staticOptions ?? [];
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [isAsync, remote, staticOptions, query]);

  // Debounced remote search. The request id guards against an earlier, slower
  // response overwriting a later one.
  const requestId = React.useRef(0);
  React.useEffect(() => {
    if (!isAsync || !open) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      onSearch!(query)
        .then((res) => { if (id === requestId.current) { setRemote(res); setLoading(false); } })
        .catch((e: unknown) => {
          if (id !== requestId.current) return;
          setLoading(false);
          setError(e instanceof Error ? e.message : "Search failed. Try again.");
        });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [isAsync, open, query, onSearch, debounceMs]);

  React.useEffect(() => { setActive(0); }, [query, open]);

  /* One height for the whole list rather than per row: the virtualiser needs a
     uniform step, and a list where only some rows are taller would stagger. */
  const rowHeight = React.useMemo(
    () => (options.some((o) => o.description) ? ROW_HEIGHT_WITH_DESCRIPTION : ROW_HEIGHT),
    [options],
  );

  const virtualise = options.length > virtualiseAfter;
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    enabled: virtualise,
    // Width is irrelevant to a vertical list; height is what decides the range.
    initialRect: { width: 0, height: LIST_MAX_HEIGHT },
  });

  const selected = (staticOptions ?? remote).find((o) => o.value === value) ?? null;

  const commit = (o: ComboboxOption) => {
    if (o.disabled) return;
    onValueChange?.(o.value);
    setOpen(false);
    setQuery("");
  };

  const moveTo = (next: number) => {
    const clamped = Math.max(0, Math.min(options.length - 1, next));
    setActive(clamped);
    if (virtualise) virtualizer.scrollToIndex(clamped);
    else scrollRef.current?.querySelector(`[data-index="${clamped}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveTo(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(active - 1); }
    else if (e.key === "Home") { e.preventDefault(); moveTo(0); }
    else if (e.key === "End") { e.preventDefault(); moveTo(options.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const o = options[active]; if (o) commit(o); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const rows = virtualise
    ? virtualizer.getVirtualItems()
    : options.map((_, i) => ({ index: i, key: i, start: i * rowHeight, size: rowHeight }));

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div className={cn("relative flex items-center", className)}>
          <input
            ref={inputRef}
            id={field.id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
            aria-invalid={field["aria-invalid"]}
            aria-describedby={field["aria-describedby"]}
            disabled={disabled ?? field.disabled}
            placeholder={selected ? selected.label : placeholder}
            value={open ? query : (selected?.label ?? "")}
            onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
            onFocus={() => setOpen(true)}
            /* CLICKING THE FIELD HAS TO OPEN IT.
               Opening on focus alone works exactly once. The input KEEPS focus
               after a selection is committed and after Escape, so no focus
               event fires the next time it is clicked and the list simply never
               came back — the field looked dead until you clicked something
               else and returned to it. Idempotent on purpose: clicking an
               already-open list should not toggle it shut under the pointer. */
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(
              controlBase, controlSize[size], "pr-8",
              !selected && !open && "text-fg-muted",
            )}
          />
          <span className="absolute right-2.5 flex items-center">
            {loading ? <Spinner label="Searching" /> : <Chevron />}
          </span>
        </div>
      </PopoverPrimitive.Anchor>

      <PopoverPrimitive.Content
        align="start"
        sideOffset={4}
        // Keep focus in the input so typing continues to filter.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(overlaySurface, overlayMotion, "w-[var(--radix-popover-trigger-width)] p-1")}
      >
        {error ? (
          <p className="text-status-failed font-ui text-caption px-2 py-3">{error}</p>
        ) : options.length === 0 && !loading ? (
          <p className="text-fg-muted font-ui text-caption px-2 py-3">
            {emptyMessage ?? (query ? `Nothing matches “${query}”. Try a shorter term.` : "Start typing to search.")}
          </p>
        ) : (
          <div
            ref={scrollRef}
            id={listId}
            role="listbox"
            /* No `contain: strict` here. It implies `contain: size`, which makes
               the box ignore its contents — against a max-height (rather than a
               fixed height) the scroller collapses to 0px and the virtualizer
               renders zero rows while still reporting the full 19,200px range.
               The bug is invisible in code review and obvious the moment you
               count mounted nodes. */
            className="overflow-y-auto"
            // Not `max-h-72`: the virtualiser is seeded with this number, and a
            // class and a constant that must agree will eventually not.
            style={{ maxHeight: LIST_MAX_HEIGHT }}
          >
            <div
              style={virtualise ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}
            >
              {rows.map((row) => {
                const o = options[row.index];
                if (!o) return null;
                return (
                  <div
                    key={o.value}
                    id={`${listId}-${row.index}`}
                    data-index={row.index}
                    role="option"
                    aria-selected={o.value === value}
                    data-highlighted={row.index === active ? "" : undefined}
                    data-disabled={o.disabled ? "" : undefined}
                    onMouseEnter={() => setActive(row.index)}
                    onClick={() => commit(o)}
                    className={menuItem}
                    style={
                      virtualise
                        ? { position: "absolute", top: 0, left: 0, width: "100%", height: rowHeight, transform: `translateY(${row.start}px)` }
                        : { height: rowHeight }
                    }
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{o.label}</span>
                      {o.description ? (
                        <span className="text-caption text-fg-muted truncate">{o.description}</span>
                      ) : null}
                    </span>
                    {o.value === value ? <Tick className="text-accent ml-auto" /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Root>
  );
});
