"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { formatSpan, formatSpanPrecise } from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   SLA COUNTDOWN RING

   A ring rather than a bar because the quantity is a countdown, and a closing
   arc reads as time running out in a way a shrinking bar does not.

   THREE TONES, NOT A GRADIENT. Neutral until half the SLA is gone, ember from
   50%, signal past the deadline. A continuous hue ramp would mean the colour
   changes every minute and therefore never means anything — the operator learns
   nothing from "slightly more orange than an hour ago". Three discrete states are
   three discrete decisions: ignore, plan, act.
══════════════════════════════════════════════════════════════════════════════ */

export interface SlaRingProps {
  /** 1 = full SLA remaining, 0 = deadline, negative handled by `tone`. */
  fraction: number;
  remainingMs: number;
  tone: "ok" | "pressured" | "breached";
  size?: number;
  className?: string;
}

const TONE_STROKE: Record<SlaRingProps["tone"], string> = {
  ok: "var(--status-success)",
  pressured: "var(--status-waiting)",
  breached: "var(--status-failed)",
};

const TONE_TEXT: Record<SlaRingProps["tone"], string> = {
  ok: "text-status-success",
  pressured: "text-status-waiting",
  breached: "text-status-failed",
};

export function SlaRing({ fraction, remainingMs, tone, size = 56, className }: SlaRingProps) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  // A breached gate shows a full ring in signal rather than an empty one —
  // an empty ring reads as "nothing here" at exactly the moment it means the
  // opposite.
  const shown = tone === "breached" ? 1 : fraction;

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          tone === "breached"
            ? `SLA breached ${formatSpanPrecise(-remainingMs)} ago`
            : `${formatSpanPrecise(remainingMs)} remaining of the SLA`
        }
      >
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--surface-sunken, var(--bg-sunken))" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown)}
          // Starts at 12 o'clock and closes clockwise.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <span className="absolute inset-0 grid place-items-center text-center leading-none">
        <Text variant="caption" tone="inherit" tabular className={cn("font-medium", TONE_TEXT[tone])}>
          {tone === "breached" ? `+${formatSpan(-remainingMs)}` : formatSpan(remainingMs)}
        </Text>
      </span>
    </div>
  );
}
