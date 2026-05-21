"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BeeLogo } from "@/components/brand/bee-logo";

const PHASES = [
  "Preparing workspace…",
  "Loading evaluation data…",
  "Building report…",
  "Almost ready…",
];

export function BeeLoader({ compact = false, phase }: { compact?: boolean; phase?: string }) {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    if (compact || phase) return;
    const t = setInterval(() => {
      setPhaseIndex((i) => (i + 1) % PHASES.length);
    }, 2200);
    return () => clearInterval(t);
  }, [compact, phase]);

  if (compact) {
    return (
      <div className="flex items-center gap-2" role="status" aria-label="Loading">
        <BeeLogo className="h-4 w-4 animate-[pulse_1.8s_ease-in-out_infinite]" />
        <span className="text-xs text-muted-foreground">Loading…</span>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      {/* Logo with soft pulse ring */}
      <div className="relative">
        <motion.div
          className="absolute inset-0 rounded-full bg-primary/10"
          animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="relative flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-card shadow-md"
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <BeeLogo className="h-7 w-7 drop-shadow-sm" />
        </motion.div>
      </div>

      {/* Progress bar */}
      <div className="w-40 overflow-hidden rounded-full bg-border/40 h-[2px]">
        <motion.div
          className="h-full bg-primary/70 rounded-full"
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Phase label */}
      <AnimatePresence mode="wait">
        <motion.p
          key={phase ?? PHASES[phaseIndex]}
          className="text-[12px] font-medium tracking-wide text-muted-foreground"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {phase ?? PHASES[phaseIndex]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}