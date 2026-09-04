"use client";

import * as React from "react";
import { cn } from "~/lib/cn";

/**
 * <CountRoll> — design §7.2 motion 4, "metric roll".
 *
 * Counters interpolate FROM THEIR PREVIOUS VALUE, never from zero, over 420ms
 * on tabular numerals so the width is frozen.
 *
 * Rolling from zero on every update is the common implementation and it is
 * actively misleading here: a badge that flashes 0→7 whenever anything
 * re-renders tells an operator that seven approvals just arrived. Interpolating
 * 6→7 says one did, which is the truth.
 *
 * The first paint does not animate at all — there is no previous value to move
 * from, and animating in from zero would be the same lie.
 */

const DURATION_MS = 420;

export interface CountRollProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number;
}

export function CountRoll({ value, className, ...props }: CountRollProps) {
  const [display, setDisplay] = React.useState(value);
  const fromRef = React.useRef(value);
  const frameRef = React.useRef<number | null>(null);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    // Respect the motion preference: snap rather than tween.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      // --ease-standard, cubic-bezier(.20, 0, 0, 1), approximated for JS.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = to;
    };
  }, [value]);

  return (
    <span className={cn("tabular", className)} {...props}>
      {display}
    </span>
  );
}
