"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonViewerProps {
  /** Label shown on the toggle button */
  label: string;
  value: unknown;
  /** Start expanded. Defaults to false. */
  defaultOpen?: boolean;
  /** Extra classes on the outer wrapper */
  className?: string;
}

export function JsonViewer({ label, value, defaultOpen = false, className }: JsonViewerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  if (value === null || value === undefined) return null;

  const json = JSON.stringify(value, null, 2);

  async function handleCopy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={cn("mt-2", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground/50">
          ({Array.isArray(value) ? `${(value as unknown[]).length} items` : `${Object.keys(value as object).length} keys`})
        </span>
      </button>

      {open && (
        <div className="relative mt-2 rounded-lg border border-border bg-muted/40">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground backdrop-blur-sm"
            title="Copy JSON"
          >
            {copied ? (
              <><Check className="h-3 w-3 text-emerald-500" /> Copied</>
            ) : (
              <><Copy className="h-3 w-3" /> Copy</>
            )}
          </button>
          <pre className="max-h-64 overflow-auto p-4 pr-16 text-[11px] leading-5 text-muted-foreground">
            <code>{json}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
