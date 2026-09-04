"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { controlBase, useFieldControl } from "./field";

/**
 * <TagInput> — free-form list of short strings (labels, allowed domains,
 * recipients, env keys).
 *
 * Commits on Enter, comma or blur; Backspace on an empty input removes the last
 * tag, which is the behaviour anyone who has used a mail client already knows.
 * Duplicates are rejected silently rather than with an error, because the user's
 * intent ("this tag should be present") is already satisfied.
 */
export interface TagInputProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Reject a candidate tag. Return a message to explain, or null to accept. */
  validate?: (tag: string) => string | null;
  max?: number;
}

export const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(function TagInput(
  { value, onValueChange, placeholder = "Add and press Enter", disabled, className, validate, max },
  ref,
) {
  const field = useFieldControl();
  const [draft, setDraft] = React.useState("");
  const [reason, setReason] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

  const isDisabled = disabled ?? field.disabled ?? false;
  const atLimit = max !== undefined && value.length >= max;

  const commit = React.useCallback(() => {
    const tag = draft.trim().replace(/,$/, "");
    if (!tag) return;
    if (value.includes(tag)) { setDraft(""); return; }
    if (atLimit) { setReason(`Limit of ${max} reached.`); return; }
    const problem = validate?.(tag) ?? null;
    if (problem) { setReason(problem); return; }
    onValueChange([...value, tag]);
    setDraft("");
    setReason(null);
  }, [draft, value, onValueChange, validate, atLimit, max]);

  const remove = (tag: string) => {
    onValueChange(value.filter((t) => t !== tag));
    setReason(null);
  };

  return (
    <div className="grid gap-1">
      <div
        className={cn(
          controlBase,
          "flex min-h-8 flex-wrap items-center gap-1 p-1",
          "focus-within:focus-ring focus-within:border-focus",
          isDisabled && "cursor-not-allowed opacity-50",
          className,
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className={cn(
              "bg-surface-hover border-subtle text-fg-primary",
              "inline-flex items-center gap-1 rounded-xs border py-0.5 pl-1.5 pr-1",
              "font-ui text-caption",
            )}
          >
            <span className="max-w-40 truncate">{tag}</span>
            <button
              type="button"
              disabled={isDisabled}
              onClick={(e) => { e.stopPropagation(); remove(tag); }}
              aria-label={`Remove ${tag}`}
              className={cn(
                "text-fg-muted hover:text-status-failed rounded-xs",
                "transition-colors duration-instant outline-none focus-visible:focus-ring",
              )}
            >
              <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true">
                <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          id={field.id}
          value={draft}
          disabled={isDisabled}
          placeholder={value.length === 0 ? placeholder : undefined}
          aria-invalid={field["aria-invalid"] ?? (reason ? true : undefined)}
          aria-describedby={field["aria-describedby"]}
          onChange={(e) => { setDraft(e.target.value); setReason(null); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
            else if (e.key === "Backspace" && draft === "" && value.length > 0) {
              remove(value[value.length - 1]);
            }
          }}
          className={cn(
            "font-ui text-body-sm text-fg-primary placeholder:text-fg-muted",
            "min-w-24 flex-1 bg-transparent px-1 outline-none",
          )}
        />
      </div>

      {reason ? (
        <p role="alert" className="font-ui text-caption text-status-failed">{reason}</p>
      ) : null}
    </div>
  );
});
