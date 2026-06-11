"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonBlockProps {
  value: unknown;
  maxHeight?: number;
  className?: string;
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
    <div className={cn("relative rounded-xl border border-slate-200 bg-slate-50", className)}>
      {label && (
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {label}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-slate-400 transition-colors hover:text-slate-700"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
      <pre
        className="overflow-auto p-3 font-mono text-[11.5px] leading-relaxed text-slate-700"
        style={{ maxHeight }}
      >
        {json}
      </pre>
      {!label && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-[10px] text-slate-500 transition-colors hover:text-slate-700 backdrop-blur-sm"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? "copied" : "copy"}
        </button>
      )}
    </div>
  );
}
