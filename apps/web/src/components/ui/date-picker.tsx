"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { controlBase, controlSize, useFieldControl, type ControlSize } from "./field";
import { overlaySurface, overlayMotion } from "./select";
import { IconButton } from "./button";

/* ══════════════════════════════════════════════════════════════════════════════
   DATES

   No date library. Everything here is Intl plus arithmetic on local Date
   objects — react-day-picker and date-fns together are ~40 KB to render a
   7×6 grid and add days, and both would need their own theming fought into line.

   Operator-relevant behaviour the default pickers miss:
     - TODAY is always marked, even when another day is selected. An operator
       reading a run's start date needs the offset from now at a glance.
     - Weekends are dimmed, because schedules cluster on weekdays.
     - The grid is a real <table> with role semantics, so a screen reader
       announces "row 3, Wednesday 14" rather than a wall of buttons.
══════════════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && startOfDay(a).getTime() === startOfDay(b).getTime();
}
function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
}

/** The 42 cells of a month grid, Monday-first, including neighbouring days. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  // getDay() is Sunday-first; shift so Monday is column 0.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * DAY_MS);
  return Array.from({ length: 42 }, (_, i) => startOfDay(new Date(start.getTime() + i * DAY_MS)));
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const fullLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const mediumLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

interface CalendarProps {
  /** Selected day, or the range being built. */
  selected: Date | null;
  rangeStart?: Date | null;
  rangeEnd?: Date | null;
  onSelect: (date: Date) => void;
  min?: Date;
  max?: Date;
}

function Calendar({ selected, rangeStart, rangeEnd, onSelect, min, max }: CalendarProps) {
  const [month, setMonth] = React.useState<Date>(() => startOfDay(selected ?? rangeStart ?? new Date()));
  const today = startOfDay(new Date());
  const days = React.useMemo(() => monthGrid(month), [month]);

  const disabled = (d: Date) =>
    (min ? d < startOfDay(min) : false) || (max ? d > startOfDay(max) : false);

  const inRange = (d: Date) =>
    !!rangeStart && !!rangeEnd && d > startOfDay(rangeStart) && d < startOfDay(rangeEnd);

  return (
    <div className="w-64 p-2">
      <div className="mb-2 flex items-center justify-between gap-1">
        <IconButton size="sm" variant="ghost" label="Previous month"
          onClick={() => setMonth(addMonths(month, -1))} icon={<Arrow dir="left" />} />
        <span className="font-ui text-body-sm text-fg-primary font-medium" aria-live="polite">
          {monthLabel.format(month)}
        </span>
        <IconButton size="sm" variant="ghost" label="Next month"
          onClick={() => setMonth(addMonths(month, 1))} icon={<Arrow dir="right" />} />
      </div>

      <table role="grid" className="w-full border-collapse">
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w} scope="col" className="font-ui text-caption text-fg-muted pb-1 font-normal">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>
              {days.slice(week * 7, week * 7 + 7).map((d) => {
                const outside = d.getMonth() !== month.getMonth();
                const isSelected = sameDay(d, selected) || sameDay(d, rangeStart ?? null) || sameDay(d, rangeEnd ?? null);
                const isToday = sameDay(d, today);
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const off = disabled(d);
                // aria-selected belongs on the gridcell, not on the button —
                // the button role does not support it.
                return (
                  <td key={d.toISOString()} role="gridcell" aria-selected={isSelected} className="p-0">
                    <button
                      type="button"
                      disabled={off}
                      aria-label={fullLabel.format(d)}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => onSelect(d)}
                      className={cn(
                        "font-code text-mono-sm tabular relative grid size-8 place-items-center rounded-xs",
                        "transition-colors duration-instant outline-none focus-visible:focus-ring",
                        "hover:not-disabled:bg-surface-hover",
                        outside ? "text-fg-disabled" : weekend ? "text-fg-muted" : "text-fg-primary",
                        inRange(d) && "bg-accent-subtle",
                        isSelected && "bg-accent text-fg-on-accent hover:not-disabled:bg-accent",
                        off && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {d.getDate()}
                      {/* Today marker: a dot, so it survives being selected. */}
                      {isToday ? (
                        <span
                          className={cn(
                            "absolute bottom-1 size-1 rounded-full",
                            isSelected ? "bg-fg-on-accent" : "bg-accent",
                          )}
                        />
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d={dir === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"}
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* ── DatePicker ─────────────────────────────────────────────────────────── */

export interface DatePickerProps {
  value: Date | null;
  onValueChange: (value: Date | null) => void;
  placeholder?: string;
  size?: ControlSize;
  min?: Date;
  max?: Date;
  disabled?: boolean;
  className?: string;
}

export const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(function DatePicker(
  { value, onValueChange, placeholder = "Pick a date", size = "md", min, max, disabled, className },
  ref,
) {
  const field = useFieldControl();
  const [open, setOpen] = React.useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        ref={ref}
        id={field.id}
        disabled={disabled ?? field.disabled}
        aria-invalid={field["aria-invalid"]}
        aria-describedby={field["aria-describedby"]}
        className={cn(
          controlBase, controlSize[size],
          "flex items-center justify-between gap-2 text-left",
          !value && "text-fg-muted",
          className,
        )}
      >
        <span className={cn(value && "font-code tabular")}>
          {value ? mediumLabel.format(value) : placeholder}
        </span>
        <span className="text-fg-muted"><CalendarGlyph /></span>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={4} className={cn(overlaySurface, overlayMotion)}>
          <Calendar
            selected={value}
            min={min}
            max={max}
            onSelect={(d) => { onValueChange(d); setOpen(false); }}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});

/* ── DateRangePicker ────────────────────────────────────────────────────────
   Two clicks build the range. Presets come first because in practice an
   operator picks "Last 24 hours" ninety percent of the time and only reaches
   for the grid when investigating a specific incident. */

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface DateRangePickerProps {
  value: DateRange;
  onValueChange: (value: DateRange) => void;
  size?: ControlSize;
  disabled?: boolean;
  className?: string;
  presets?: { label: string; days: number }[];
}

const DEFAULT_PRESETS = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

export const DateRangePicker = React.forwardRef<HTMLButtonElement, DateRangePickerProps>(
  function DateRangePicker(
    { value, onValueChange, size = "md", disabled, className, presets = DEFAULT_PRESETS },
    ref,
  ) {
    const field = useFieldControl();
    const [open, setOpen] = React.useState(false);

    const pick = (d: Date) => {
      // No start, or a complete range already → begin a new one.
      if (!value.start || (value.start && value.end)) onValueChange({ start: d, end: null });
      else if (d < value.start) onValueChange({ start: d, end: value.start });
      else onValueChange({ start: value.start, end: d });
    };

    const summary = value.start
      ? value.end
        ? `${mediumLabel.format(value.start)} – ${mediumLabel.format(value.end)}`
        : `${mediumLabel.format(value.start)} – …`
      : "Pick a range";

    return (
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger
          ref={ref}
          id={field.id}
          disabled={disabled ?? field.disabled}
          aria-invalid={field["aria-invalid"]}
          className={cn(
            controlBase, controlSize[size],
            "flex items-center justify-between gap-2 text-left",
            !value.start && "text-fg-muted",
            className,
          )}
        >
          <span className={cn(value.start && "font-code tabular text-mono-sm")}>{summary}</span>
          <span className="text-fg-muted"><CalendarGlyph /></span>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content align="start" sideOffset={4}
            className={cn(overlaySurface, overlayMotion, "flex")}>
            <div className="border-subtle grid content-start gap-0.5 border-r p-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const end = startOfDay(new Date());
                    onValueChange({ start: startOfDay(new Date(end.getTime() - p.days * DAY_MS)), end });
                    setOpen(false);
                  }}
                  className={cn(
                    "font-ui text-body-sm text-fg-secondary rounded-xs px-2 py-1 text-left",
                    "transition-colors duration-instant outline-none",
                    "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Calendar
              selected={null}
              rangeStart={value.start}
              rangeEnd={value.end}
              onSelect={pick}
            />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  },
);
