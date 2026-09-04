"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Kbd } from "~/components/ui/kbd";
import {
  parseQuery, explainQuery, suggest, RUN_QUERY,
  type ParsedQuery, type QuerySchema, type Suggestion,
} from "~/lib/query";

/* ══════════════════════════════════════════════════════════════════════════════
   <QueryBar> — P06 Part C.

   Token-highlighted input, autocomplete on keys and values, inline validation,
   and a plain-English restatement of the active query underneath.

   THE OVERLAY TRICK. Browsers cannot colour ranges inside an <input>, and a
   contenteditable div breaks IME composition, undo history, autofill and mobile
   selection handles — all things an operator relies on and none of which are
   worth reimplementing. So: a real transparent <input> on top, and an
   aria-hidden mirror behind it painting the same characters in the same font at
   the same position, coloured. They cannot drift because they are the same
   string in the same box.

   THE ENGLISH LINE IS NOT DECORATION. It is the honesty check: if the sentence
   does not describe what you meant, neither does the query — much easier to
   notice than an empty result table.
══════════════════════════════════════════════════════════════════════════════ */

export interface QueryBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires on Enter or on picking a suggestion. */
  onSubmit?: (value: string) => void;
  resultCount?: number;
  placeholder?: string;
  /** Which entity is being searched. Defaults to runs. */
  schema?: QuerySchema;
  className?: string;
}

export function QueryBar({
  value, onChange, onSubmit, resultCount, placeholder, schema = RUN_QUERY, className,
}: QueryBarProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [caret, setCaret] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  const parsed = React.useMemo(() => parseQuery(value, schema.fields), [value, schema.fields]);
  const { suggestions, replaceFrom } = React.useMemo(
    () => suggest(value, caret, schema.fields),
    [value, caret, schema.fields],
  );

  React.useEffect(() => { setActive(0); }, [value, caret]);

  const apply = (suggestion: Suggestion) => {
    const next = value.slice(0, replaceFrom) + suggestion.insert + value.slice(caret);
    const nextCaret = replaceFrom + suggestion.insert.length;
    onChange(next);
    setOpen(suggestion.kind === "field");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  };

  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? 0);

  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        className={cn(
          "bg-surface-raised border-default flex items-center gap-2 rounded-md border px-2.5",
          // The focus affordance belongs to the CONTAINER: the <input> inside it
          // is transparent and spans only the middle strip between the glyph and
          // the shortcut hint, so a ring drawn on the input alone is a floating
          // rectangle inside an already-bordered box.
          "focus-within:border-focus transition-colors duration-fast",
          parsed.errors.length > 0 && "border-status-failed-border",
        )}
      >
        <SearchGlyph />

        <div className="relative min-w-0 flex-1">
          {/* Mirror. Same font metrics, same padding, aria-hidden. */}
          <div
            aria-hidden="true"
            className="font-code text-mono pointer-events-none absolute inset-0 flex items-center whitespace-pre overflow-hidden"
          >
            <HighlightedQuery source={value} parsed={parsed} />
          </div>

          <input
            ref={inputRef}
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); syncCaret(); }}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (open && suggestions.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(suggestions.length - 1, a + 1)); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
                if (e.key === "Tab" || (e.key === "Enter" && suggestions[active])) {
                  e.preventDefault(); apply(suggestions[active]); return;
                }
              }
              if (e.key === "Enter") { e.preventDefault(); setOpen(false); onSubmit?.(value); }
              if (e.key === "Escape") { setOpen(false); }
            }}
            placeholder={placeholder ?? schema.placeholder}
            // A plain input's implicit role is textbox, which does not take
            // aria-expanded. The suggestion list makes this a combobox, so say
            // so — otherwise the state is announced to nobody.
            role="combobox"
            aria-label={schema.label}
            aria-invalid={parsed.errors.length > 0}
            aria-autocomplete="list"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="query-suggestions"
            data-no-shortcuts
            spellCheck={false}
            autoComplete="off"
            className={cn(
              "font-code text-mono relative w-full bg-transparent py-2",
              // The real text is transparent; the mirror behind paints it.
              // caret-color keeps the cursor visible.
              "text-transparent caret-fg-primary placeholder:text-fg-disabled",
              // `outline-none` alone was not enough: the unscoped
              // `:focus-visible` in app/globals.css was painting the pre-revamp
              // GREEN ring around this input (CURRENT-STATE §9.9) — success
              // green indicating focus, on every page with a query bar.
              // Suppressing the shadow explicitly is what stops it; this utility
              // sits in the `utilities` layer and the legacy rule in `base`, so
              // it wins. The container's border above remains the affordance.
              "outline-none focus-visible:shadow-none",
            )}
          />
        </div>

        {value ? (
          <button
            onClick={() => { onChange(""); inputRef.current?.focus(); }}
            aria-label="Clear filter"
            className={cn(
              "text-fg-disabled hover:text-fg-primary grid size-5 shrink-0 place-items-center rounded-xs",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <Kbd keys="/" />
        )}
      </div>

      {/* ── Autocomplete ─────────────────────────────────────────────────── */}
      {open && suggestions.length > 0 ? (
        <ul
          id="query-suggestions"
          role="listbox"
          aria-label="Query suggestions"
          className={cn(
            "motion-overlay bg-surface-overlay border-subtle shadow-2 absolute left-0 right-0 top-full z-dropdown mt-1",
            "max-h-64 overflow-y-auto rounded-md border p-1",
          )}
        >
          {suggestions.map((s, i) => (
            <li key={s.insert} role="option" aria-selected={i === active}>
              <button
                onMouseDown={(e) => { e.preventDefault(); apply(s); }}
                onMouseMove={() => setActive(i)}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-xs px-2 py-1.5 text-left",
                  i === active && "bg-surface-hover",
                )}
              >
                <span className="font-code text-mono-sm text-accent shrink-0">{s.label}</span>
                <span className="font-ui text-caption text-fg-muted min-w-0 truncate">{s.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── Errors, then the English restatement ─────────────────────────── */}
      <div className="mt-1.5 min-h-[1.125rem]">
        {parsed.errors.length > 0 ? (
          <Text variant="caption" tone="inherit" className="text-status-failed block">
            {parsed.errors[0].message}
          </Text>
        ) : (
          <Text variant="caption" tone="muted" className="block">
            {explainQuery(parsed, schema)}
            {resultCount !== undefined ? (
              <> <span className="tabular">{resultCount.toLocaleString("en-GB")}</span> matching.</>
            ) : null}
          </Text>
        )}
      </div>
    </div>
  );
}

/* ── Mirror ───────────────────────────────────────────────────────────────── */

/**
 * Paints the query with keys, comparators and values coloured separately, and
 * a wavy underline under anything the parser rejected.
 *
 * Walks the source by offset rather than re-joining the terms, so whitespace the
 * user typed is preserved exactly — otherwise the mirror and the input drift
 * apart by a space and every character after it is misaligned.
 */
function HighlightedQuery({ source, parsed }: { source: string; parsed: ParsedQuery }) {
  const out: React.ReactNode[] = [];
  let cursor = 0;

  for (const [i, term] of parsed.terms.entries()) {
    if (term.start > cursor) {
      out.push(<span key={`gap-${i}`}>{source.slice(cursor, term.start)}</span>);
    }

    const invalid = Boolean(term.error);
    const wavy = invalid ? "underline decoration-wavy decoration-status-failed underline-offset-4" : "";

    if (term.key === null) {
      out.push(
        <span key={`t-${i}`} className={cn("text-fg-primary", wavy)}>
          {source.slice(term.start, term.end)}
        </span>,
      );
    } else {
      const keyEnd = term.keyEnd ?? term.start;
      const comparatorEnd = keyEnd + (term.comparator?.length ?? 1);
      out.push(
        <span key={`t-${i}`} className={wavy}>
          <span className="text-accent">{source.slice(term.start, keyEnd)}</span>
          <span className="text-fg-muted">{source.slice(keyEnd, comparatorEnd)}</span>
          <span className="text-status-success">{source.slice(comparatorEnd, term.end)}</span>
        </span>,
      );
    }
    cursor = term.end;
  }

  if (cursor < source.length) out.push(<span key="tail">{source.slice(cursor)}</span>);
  return <>{out}</>;
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="text-fg-muted size-4 shrink-0" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.2 10.2 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
