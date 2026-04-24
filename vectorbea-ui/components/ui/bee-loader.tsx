"use client";

import { motion } from "framer-motion";
import { BeeLogo } from "@/components/brand/bee-logo";

export function BeeLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? "flex items-center gap-2" : "flex min-h-[50vh] flex-col items-center justify-center gap-4"}
      role="status"
      aria-live="polite"
      aria-label="Loading environment"
    >
      <motion.div
        className={compact ? "relative h-5 w-5" : "relative h-16 w-16"}
        animate={{ scale: [1, 1.04, 1] }}
        transition={{
          duration: 2.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <BeeLogo className={compact ? "h-5 w-5 drop-shadow-sm" : "h-16 w-16 drop-shadow-md"} />
      </motion.div>

      {!compact && (
        <motion.p
          className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400"
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          Loading environment...
        </motion.p>
      )}
    </div>
  );
}
