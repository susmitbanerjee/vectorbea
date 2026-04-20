"use client";

import { motion } from "framer-motion";

export function BeeLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? "flex items-center gap-2" : "flex min-h-[50vh] flex-col items-center justify-center gap-4"}
      role="status"
      aria-live="polite"
      aria-label="Loading environment"
    >
      <motion.svg
        aria-hidden="true"
        viewBox="0 0 64 64"
        className={compact ? "h-4 w-4 text-zinc-500" : "h-14 w-14 text-zinc-500"}
        fill="none"
        initial={{ y: 0, rotate: 0 }}
        animate={{ y: [0, -4, 0], rotate: [-2, 2, -2] }}
        transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
      >
        <ellipse cx="23" cy="25" rx="10" ry="8" className="fill-zinc-300/60 dark:fill-zinc-700/70" />
        <ellipse cx="41" cy="25" rx="10" ry="8" className="fill-zinc-300/60 dark:fill-zinc-700/70" />
        <ellipse cx="32" cy="36" rx="14" ry="16" className="fill-zinc-500/90 dark:fill-zinc-400/90" />
        <path d="M22 30h20M22 36h20M22 42h20" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        <circle cx="27" cy="34" r="1.4" className="fill-zinc-950 dark:fill-zinc-100" />
        <circle cx="37" cy="34" r="1.4" className="fill-zinc-950 dark:fill-zinc-100" />
        <path d="M30 47c1.6 1.2 2.4 1.2 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </motion.svg>

      {!compact && (
        <motion.p
          className="text-sm font-medium tracking-wide text-zinc-500 dark:text-zinc-400"
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          Loading environment...
        </motion.p>
      )}
    </div>
  );
}
