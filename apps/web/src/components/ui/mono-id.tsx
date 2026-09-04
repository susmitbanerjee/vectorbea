"use client";

import * as React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "~/lib/cn";
import { truncateId } from "~/lib/format";

/**
 * <MonoId> — the canonical rendering of an identifier.
 *
 * CLAUDE.md rule 8: all IDs are mono, middle-truncated and click-to-copy.
 * Middle truncation rather than tail truncation because the tail is what
 * distinguishes two IDs from the same generator — `a35d65ca…3453b5` stays
 * scannable in a column where `a35d65ca…` would not.
 *
 * Hovering reveals the full value; clicking copies it and the tooltip switches
 * to "Copied" for a moment before returning to the value.
 *
 * States: hover · active · focus-visible · disabled · loading (skeleton).
 */

export interface MonoIdProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "children"> {
  /** The full identifier. */
  value: string;
  /** Characters kept at the start. */
  head?: number;
  /** Characters kept at the end. */
  tail?: number;
  /** Render a skeleton in the shape of an ID. */
  loading?: boolean;
  /** Label announced to screen readers. Defaults to "Identifier". */
  srLabel?: string;
}

const COPIED_MS = 1600;

export const MonoId = React.forwardRef<HTMLButtonElement, MonoIdProps>(function MonoId(
  { value, head = 8, tail = 6, loading = false, srLabel = "Identifier", className, disabled, onClick, ...props },
  ref,
) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      } catch {
        // Clipboard blocked (insecure context, or permission denied). Leave the
        // tooltip showing the full value so it can still be selected by hand.
      }
    },
    [onClick, value],
  );

  if (loading) {
    return (
      <span
        aria-hidden="true"
        className={cn("bg-surface-hover inline-block h-4 w-28 rounded-xs align-middle", className)}
      />
    );
  }

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root open={copied ? true : undefined}>
        <Tooltip.Trigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            onClick={handleClick}
            aria-label={`${srLabel} ${value}. Activate to copy.`}
            className={cn(
              "identifier text-fg-secondary inline-flex items-center rounded-xs px-1 py-0.5",
              "transition-colors duration-fast",
              "hover:bg-surface-hover hover:text-fg-primary",
              "active:bg-surface-active",
              "focus-visible:focus-ring focus-visible:text-fg-primary",
              "disabled:text-fg-disabled disabled:pointer-events-none",
              className,
            )}
            {...props}
          >
            {truncateId(value, head, tail)}
          </button>
        </Tooltip.Trigger>

        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className={cn(
              "z-tooltip bg-surface-overlay text-fg-primary border-subtle shadow-2",
              "max-w-[min(90vw,28rem)] rounded-sm border px-2 py-1",
              "font-code text-mono-sm break-all",
            )}
          >
            {copied ? (
              <span className="text-status-success font-ui text-caption">Copied</span>
            ) : (
              value
            )}
            <Tooltip.Arrow className="fill-surface-overlay" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
});
