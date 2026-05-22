"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

export function RawTab({ model }: { model: AgentRunUiModel }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(model, null, 2);

  async function copy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Full normalized run model — for debugging and API integration.</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy all</>}
        </button>
      </div>
      <pre className="overflow-auto rounded-xl bg-[#0d0d0d] px-5 py-4 text-[11px] leading-relaxed text-[#d1d5db] max-h-[70vh]">
        {json}
      </pre>
    </div>
  );
}
