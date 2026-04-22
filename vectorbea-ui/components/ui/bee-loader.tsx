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
        initial={{ x: -2, y: 0, rotate: -2 }}
        animate={{
          x: [-2, 4, -3, 2, -2],
          y: [0, -7, -2, -8, 0],
          rotate: [-2, 5, -3, 4, -2],
        }}
        transition={{
          duration: 2.2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <motion.div
          className={compact ? "absolute -top-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-primary/70" : "absolute -top-1 left-2 h-2 w-2 rounded-full bg-primary/70"}
          animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        />
        <BeeLogo className={compact ? "h-5 w-5 drop-shadow-sm" : "h-16 w-16 drop-shadow-md"} />
      </motion.div>

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
