"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "~/lib/cn";

/**
 * <Slider> — for bounded numeric input where the RANGE matters more than the
 * exact figure (concurrency, timeouts, sampling rate, budget ceilings).
 *
 * The live value is rendered in tabular mono above the thumb, because a slider
 * without a readout is unusable for anything an operator has to justify later.
 * Range mode (two thumbs) comes free from Radix.
 */
export interface SliderProps
  extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Render the current value(s) above the track. */
  showValue?: boolean;
  /** Appended to the readout — "ms", "×", "%". */
  unit?: string;
  /** Format the readout. Defaults to the raw number. */
  format?: (value: number) => string;
}

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(function Slider(
  { className, showValue = true, unit, format, value, defaultValue, disabled, ...props },
  ref,
) {
  const current = (value ?? defaultValue ?? [0]) as number[];
  const render = (n: number) => `${format ? format(n) : n}${unit ?? ""}`;

  return (
    <div className="grid gap-2">
      {showValue ? (
        <output
          className={cn(
            "font-code text-mono-sm tabular text-fg-primary justify-self-end",
            disabled && "text-fg-disabled",
          )}
          aria-live="off"
        >
          {current.map(render).join(" – ")}
        </output>
      ) : null}

      <SliderPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <SliderPrimitive.Track className="bg-surface-active relative h-1 w-full grow rounded-full">
          <SliderPrimitive.Range className="bg-accent absolute h-full rounded-full" />
        </SliderPrimitive.Track>
        {current.map((_, i) => (
          <SliderPrimitive.Thumb
            key={i}
            className={cn(
              "border-accent bg-surface-raised block size-3.5 rounded-full border-2",
              "transition-[box-shadow,scale] duration-fast ease-standard",
              "outline-none focus-visible:focus-ring",
              "hover:scale-110",
              "data-[disabled]:cursor-not-allowed data-[disabled]:hover:scale-100",
            )}
          />
        ))}
      </SliderPrimitive.Root>
    </div>
  );
});
