"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { evaluateCron } from "~/lib/cron";
import { Input } from "./input";
import { useFieldControl } from "./field";

/**
 * <CronInput> — a cron expression that shows what it means and when it fires.
 *
 * The raw field alone is not an acceptable control for this value. Design §12
 * requires errors that say how to fix the problem, and the equivalent for a
 * schedule is a preview: the expression, its prose translation, and the next
 * five occurrences in the target timezone. An operator who can see
 * "Every 5 minutes · next 14:05, 14:10, 14:15" cannot ship "*&#47;5 * * * *" when they
 * meant hours.
 *
 * The preview area is a FIXED HEIGHT across valid, invalid and empty states, so
 * typing never makes the form below it jump.
 */

const PRESETS = [
  { label: "Every 5 min", expression: "*/5 * * * *" },
  { label: "Hourly", expression: "0 * * * *" },
  { label: "Daily 09:00", expression: "0 9 * * *" },
  { label: "Weekdays 09:00", expression: "0 9 * * 1-5" },
  { label: "Monthly 1st", expression: "0 0 1 * *" },
];

export interface CronInputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** IANA zone the schedule runs in. Occurrences are rendered in it. */
  timezone?: string;
  disabled?: boolean;
  className?: string;
  /** Number of upcoming fire times to show. */
  previewCount?: number;
}

export function CronInput({
  value, onValueChange, timezone, disabled, className, previewCount = 5,
}: CronInputProps) {
  const field = useFieldControl();

  const result = React.useMemo(
    () => evaluateCron(value, timezone, previewCount),
    [value, timezone, previewCount],
  );

  const formatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: timezone,
      }),
    [timezone],
  );

  return (
    <div className={cn("grid gap-2", className)}>
      <Input
        mono
        value={value}
        disabled={disabled ?? field.disabled}
        placeholder="*/5 * * * *"
        spellCheck={false}
        aria-invalid={value.trim() !== "" && !result.valid ? true : undefined}
        aria-describedby={field["aria-describedby"]}
        onChange={(e) => onValueChange(e.target.value)}
      />

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.expression}
            type="button"
            disabled={disabled}
            onClick={() => onValueChange(p.expression)}
            className={cn(
              "font-ui text-caption rounded-xs border px-1.5 py-0.5",
              "transition-colors duration-instant outline-none focus-visible:focus-ring",
              value.trim() === p.expression
                ? "bg-accent-subtle text-accent border-accent-border"
                : "bg-surface-hover border-subtle text-fg-secondary hover:text-fg-primary",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Fixed height: valid, invalid and empty all occupy the same box. */}
      <div
        className={cn(
          "min-h-[104px] rounded-sm border p-2.5",
          result.valid
            ? "bg-surface-sunken border-subtle"
            : value.trim() === ""
              ? "bg-surface-sunken border-subtle"
              : "bg-status-failed-subtle border-status-failed-border",
        )}
        aria-live="polite"
      >
        <p
          className={cn(
            "font-ui text-body-sm mb-1.5",
            result.valid ? "text-fg-primary" : "text-status-failed",
          )}
        >
          {result.valid ? result.description : (result.error ?? "That is not a valid cron expression.")}
        </p>

        {result.valid ? (
          <>
            <p className="font-ui text-caption text-fg-muted mb-1">
              Next {result.next.length} runs{timezone ? ` · ${timezone.replace(/_/g, " ")}` : ""}
            </p>
            <ol className="grid gap-0.5">
              {result.next.map((d) => (
                <li key={d.toISOString()} className="font-code text-mono-sm tabular text-fg-secondary">
                  {formatter.format(d)}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="font-ui text-caption text-fg-muted">
            Five fields: minute, hour, day of month, month, day of week. Pick a preset above to start
            from something valid.
          </p>
        )}
      </div>
    </div>
  );
}
