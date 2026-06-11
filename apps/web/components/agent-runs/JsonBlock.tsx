"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonBlockProps {
  label?: string;
  value: unknown;
  defaultOpen?: boolean;
  maxHeight?: string;
  className?: string;
}

export function JsonBlock({
  label = "JSON",
  value,
  defaultOpen = false,
  maxHeight = "16rem",
  className,
}: JsonBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  if (value === null || value === undefined) return null;

  const json = JSON.stringify(value, null, 2);
  const keyCount =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.keys(value).length
      : Array.isArray(value)
        ? value.length
        : null;

  async function handleCopy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className={cn("rounded-md border border-border/60", className)}>
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-t-md"
      >
        <div className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {keyCount !== null && (
            <span className="text-[10px] text-muted-foreground/60">
              ({keyCount} {Array.isArray(value) ? "items" : "keys"})
            </span>
          )}
        </div>
        {open && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void handleCopy(); }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        )}
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-border/60 rounded-b-md overflow-hidden">
          <pre
            className="overflow-auto bg-muted/40 p-3 text-[11px] leading-relaxed text-foreground/80"
            style={{ maxHeight }}
          >
            {json}
          </pre>
        </div>
      )}
    </div>
  );
}
