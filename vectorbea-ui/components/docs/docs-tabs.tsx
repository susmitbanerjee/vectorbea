"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface DocsTabsProps {
  tabs: string[];
  children: React.ReactNode[];
}

/**
 * Minimal tab switcher for the docs — used to toggle between architecture
 * variants (e.g. Intel vs Apple Silicon) without pulling in a full Radix
 * Tabs dependency on the server component pages.
 */
export function DocsTabs({ tabs, children }: DocsTabsProps) {
  const [active, setActive] = useState(0);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      {/* Tab strip */}
      <div className="flex border-b border-border/60 bg-muted/30">
        {tabs.map((label, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={cn(
              "relative px-4 py-2.5 text-[12.5px] font-medium transition-colors select-none cursor-pointer focus:outline-none",
              active === i
                ? "text-foreground after:absolute after:bottom-0 after:inset-x-0 after:h-[2px] after:bg-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Active panel — strip inner border-radius so it blends */}
      <div className="[&_.rounded-xl]:rounded-none [&_.rounded-xl]:border-0 [&_.rounded-xl]:shadow-none">
        {children[active]}
      </div>
    </div>
  );
}
