"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonBlockProps {
  value: unknown;
  /** Max height before scroll (default 320px) */
  maxHeight?: number;
  className?: string;
  /** Collapse long strings to this length */
  label?: string;
}

export function JsonBlock({ value, maxHeight = 320, className, label }: JsonBlockProps) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);

  async function handleCopy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={cn("relative rounded-lg border border-border/50 bg-[#0f0f0f] dark:bg-[#0a0a0a]", className)}>
      {label && (
        <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {label}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
      <pre
        className="overflow-auto p-3 font-mono text-[11px] leading-relaxed text-[#e5e7eb]"
        style={{ maxHeight }}
      >
        {json}
      </pre>
      {!label && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 flex items-center gap-1 rounded border border-border/30 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? "copied" : "copy"}
        </button>
      )}
    </div>
  );
}
