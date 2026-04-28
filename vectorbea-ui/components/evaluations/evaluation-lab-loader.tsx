"use client";

/**
 * EvaluationLabLoader — premium chemistry-lab inspired loading screen.
 * Used while evaluation detail / compare / multi-provider data is fetching.
 * Respects prefers-reduced-motion: swaps heavy animation for a simple pulse.
 */

import { useEffect, useState } from "react";

const PHASES = [
  "Loading evaluation run",
  "Fetching dataset results",
  "Preparing provider comparison",
  "Building evaluation report",
] as const;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// SVG chemistry flask — monochrome, elegant
function Flask({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 52" fill="none" className={className} aria-hidden>
      <path
        d="M14 4h12M15 4v16L5 38a6 6 0 0 0 5.2 9h19.6A6 6 0 0 0 35 38L25 20V4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="13" cy="40" r="2" fill="currentColor" opacity="0.5" />
      <circle cx="22" cy="43" r="1.5" fill="currentColor" opacity="0.35" />
      <circle cx="28" cy="38" r="1" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

// Animated liquid fill inside flask outline
function LiquidFlask({ progress }: { progress: number }) {
  const clamp = Math.min(100, Math.max(0, progress));
  // Map 0-100% to flask body height (rough)
  const fillY = 52 - (clamp / 100) * 28;

  return (
    <svg viewBox="0 0 40 52" fill="none" className="h-16 w-12" aria-hidden>
      {/* clip path for liquid */}
      <defs>
        <clipPath id="flask-clip">
          <path d="M15 4v16L5 38a6 6 0 0 0 5.2 9h19.6A6 6 0 0 0 35 38L25 20V4z" />
        </clipPath>
      </defs>
      {/* liquid fill */}
      <rect
        x="0"
        y={fillY}
        width="40"
        height="52"
        clipPath="url(#flask-clip)"
        className="fill-primary/30 transition-all duration-700 ease-out"
      />
      {/* wave ripple on liquid surface */}
      <path
        d={`M0 ${fillY} q5 -3 10 0 t10 0 t10 0 t10 0`}
        clipPath="url(#flask-clip)"
        stroke="none"
        className="fill-primary/20 animate-[wave_2s_ease-in-out_infinite]"
        style={{ transform: `translateY(${fillY}px)`, transformBox: "fill-box" }}
      />
      {/* flask outline */}
      <path
        d="M14 4h12M15 4v16L5 38a6 6 0 0 0 5.2 9h19.6A6 6 0 0 0 35 38L25 20V4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary/70"
      />
      {/* bubbles */}
      <circle cx="18" cy={fillY - 4} r="1.5" className="fill-primary/40 animate-[bubble_1.8s_ease-in_infinite]" />
      <circle cx="24" cy={fillY - 8} r="1" className="fill-primary/30 animate-[bubble_2.4s_ease-in_0.6s_infinite]" />
    </svg>
  );
}

interface EvaluationLabLoaderProps {
  /** Current loading phase index (0–3). Pass null for indeterminate. */
  phase?: number | null;
  /** Optional message to override the phase label */
  message?: string;
}

export function EvaluationLabLoader({ phase = null, message }: EvaluationLabLoaderProps) {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Cycle dots for the phase label
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [reduced]);

  // Elapsed timer
  useEffect(() => {
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const phaseIdx = phase ?? (tick % PHASES.length);
  const phaseLabel = message ?? PHASES[Math.min(phaseIdx, PHASES.length - 1)];
  const dots = reduced ? "…" : ".".repeat((tick % 3) + 1).padEnd(3, " ");

  // Liquid progress: each phase fills ~25%
  const liquidPct = phase != null ? (phase + 1) * 25 : ((tick % 40) / 40) * 100;

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-[#D8CFC2] bg-gradient-to-br from-[#FFFCF7] via-[#FBFAF7] to-[#F8F5EF] px-8 py-12 text-center shadow-sm">
      {/* Flask animation */}
      <div className="relative mb-6 flex items-end gap-6">
        {reduced ? (
          <Flask className="h-16 w-12 text-primary/60 animate-pulse" />
        ) : (
          <>
            <div className="opacity-40 scale-75 origin-bottom">
              <LiquidFlask progress={Math.max(0, liquidPct - 20)} />
            </div>
            <LiquidFlask progress={liquidPct} />
            <div className="opacity-40 scale-75 origin-bottom">
              <LiquidFlask progress={Math.max(0, liquidPct - 10)} />
            </div>
          </>
        )}
      </div>

      {/* Label */}
      <p className="text-sm font-semibold text-foreground/90 tracking-wide">
        {phaseLabel}
        <span className="inline-block w-6 text-left text-primary/70">{dots}</span>
      </p>

      {/* Phase stepper */}
      <div className="mt-4 flex items-center gap-2">
        {PHASES.map((p, i) => (
          <div
            key={p}
            title={p}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i < phaseIdx
                ? "w-4 bg-primary/70"
                : i === phaseIdx
                ? "w-6 bg-primary"
                : "w-3 bg-muted/40"
            }`}
          />
        ))}
      </div>

      {/* Elapsed */}
      <p className="mt-3 text-[11px] text-muted-foreground/50 tabular-nums">
        {elapsedSec}s elapsed
      </p>
    </div>
  );
}
