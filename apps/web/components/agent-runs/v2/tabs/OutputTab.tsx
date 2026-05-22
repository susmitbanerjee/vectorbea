"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

interface OutputTabProps {
  output?: unknown;
  partialOutput?: unknown;
  isFailed?: boolean;
}

function JsonViewer({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);

  async function copy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <><Check className="h-3 w-3 text-emerald-500" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </button>
      </div>
      <pre className="overflow-auto rounded-xl bg-[#0d0d0d] px-5 py-4 text-[12px] leading-relaxed text-[#d1d5db] max-h-[60vh]">
        {json}
      </pre>
    </div>
  );
}

export function OutputTab({ output, partialOutput, isFailed }: OutputTabProps) {
  if (!output && !partialOutput) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500/60" />
        <div>
          <p className="text-sm font-medium">No output available</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isFailed
              ? "The run failed before producing output."
              : "Output will appear here when the run completes."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {output !== undefined && output !== null && <JsonViewer label="Final output" value={output} />}
      {partialOutput !== undefined && partialOutput !== null && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Partial output (run did not complete)</p>
          </div>
          <JsonViewer label="Partial output" value={partialOutput} />
        </div>
      )}
    </div>
  );
}
