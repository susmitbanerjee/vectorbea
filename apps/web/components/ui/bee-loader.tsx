"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const PHASES = [
  "Restoring durable state…",
  "Reading checkpoints…",
  "Connecting the control plane…",
  "Ready to continue…",
];

const CHECKPOINTS = Array.from({ length: 7 }, (_, index) => index);

export function BeeLoader({ compact = false, phase }: { compact?: boolean; phase?: string }) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (compact || phase) return;
    const timer = setInterval(() => {
      setPhaseIndex((index) => (index + 1) % PHASES.length);
    }, 2200);
    return () => clearInterval(timer);
  }, [compact, phase]);

  if (compact) {
    return (
      <div className="flex items-center gap-2" role="status" aria-label="Loading">
        <motion.div
          animate={reduceMotion ? undefined : { y: [0, -2, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <RibbonMark className="h-4 w-4" />
        </motion.div>
        <span className="text-xs text-muted-foreground">Loading…</span>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-6"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-64 w-64 rounded-full bg-[rgba(98,91,246,0.08)] blur-3xl"
      />

      <div className="relative mb-7">
        <motion.div
          aria-hidden="true"
          className="absolute -inset-5 rounded-full border border-[#625BF6]/20"
          animate={reduceMotion ? undefined : { scale: [0.82, 1.35], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
        <motion.div
          animate={reduceMotion ? undefined : { y: [0, -5, 0], rotate: [0, -2, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="relative drop-shadow-[0_14px_22px_rgba(98,91,246,0.28)]"
        >
          <RibbonMark className="h-16 w-16" />
        </motion.div>
      </div>

      <div className="flex items-center gap-1.5" aria-hidden="true">
        {CHECKPOINTS.map((index) => (
          <motion.span
            key={index}
            className="block h-4 w-6 border border-[#625BF6]/25 bg-[#625BF6]/5"
            style={{ clipPath: "polygon(25% 0, 100% 0, 100% 70%, 80% 100%, 0 100%, 0 25%)" }}
            animate={
              reduceMotion
                ? { backgroundColor: "rgba(98,91,246,0.45)" }
                : {
                    backgroundColor: [
                      "rgba(98,91,246,0.05)",
                      "rgba(98,91,246,0.92)",
                      "rgba(98,91,246,0.18)",
                    ],
                    borderColor: [
                      "rgba(98,91,246,0.25)",
                      "rgba(98,91,246,0.9)",
                      "rgba(98,91,246,0.25)",
                    ],
                    y: [0, -2, 0],
                  }
            }
            transition={{
              duration: 1.8,
              repeat: Infinity,
              delay: index * 0.13,
              times: [0, 0.28, 1],
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={phase ?? PHASES[phaseIndex]}
          className="mt-5 text-[12px] font-medium tracking-wide text-muted-foreground"
          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {phase ?? PHASES[phaseIndex]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function RibbonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <path d="M22 10h32v32L42 54H10V22Z" fill="#625BF6" />
      <path
        d="M32 10v44"
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
