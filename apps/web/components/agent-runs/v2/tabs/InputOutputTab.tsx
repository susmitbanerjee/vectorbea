"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

// ─── JSON panel ──────────────────────────────────────────────────────────────

function JsonPanel({
  label,
  value,
  accent,
}: {
  label: string;
  value: unknown;
  accent?: "error" | "warning" | "default";
}) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);

  async function copy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const borderColor =
    accent === "error" ? "rgba(239,68,68,0.25)" :
    accent === "warning" ? "rgba(245,158,11,0.25)" :
    "rgba(148,163,184,0.1)";

  const headerBg =
    accent === "error" ? "rgba(239,68,68,0.05)" :
    accent === "warning" ? "rgba(245,158,11,0.05)" :
    "var(--surface-3)";

  const labelColor =
    accent === "error" ? "#EF4444" :
    accent === "warning" ? "#F59E0B" :
    "var(--text-faint)";

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl"
      style={{ border: `1px solid ${borderColor}`, background: "var(--surface-2)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: headerBg, borderBottom: `1px solid ${borderColor}` }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: labelColor }}>
          {label}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors hover:bg-white/5"
          style={{ color: "var(--text-faint)" }}
        >
          {copied ? <><Check className="h-3 w-3 text-emerald-500" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
        </button>
      </div>

      {/* JSON */}
      <pre
        className="flex-1 overflow-auto px-4 py-4 text-[12px] leading-relaxed font-mono"
        style={{ background: "#060A10", color: "#CBD5E1", maxHeight: "60vh" }}
      >
        {json}
      </pre>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface InputOutputTabProps {
  input?: unknown;
  output?: unknown;
  partialOutput?: unknown;
  errorMessage?: string;
  isFailed?: boolean;
}

export function InputOutputTab({ input, output, partialOutput, errorMessage, isFailed }: InputOutputTabProps) {
  const hasInput = input !== undefined && input !== null;
  const hasOutput = output !== undefined && output !== null;
  const hasPartial = partialOutput !== undefined && partialOutput !== null;

  if (!hasInput && !hasOutput && !hasPartial) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <AlertTriangle className="h-8 w-8" style={{ color: "rgba(245,158,11,0.5)" }} />
        <div>
          <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
            No I/O data available
          </p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            {isFailed ? "The run failed before producing output." : "Data will appear here when the run completes."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Side-by-side: input + output/partial */}
      <div className={hasInput && (hasOutput || hasPartial) ? "grid gap-4 lg:grid-cols-2" : "space-y-4"}>
        {hasInput && <JsonPanel label="Input" value={input} />}
        {hasOutput && <JsonPanel label="Output" value={output} />}
      </div>

      {/* Partial output (failure case) */}
      {hasPartial && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" style={{ color: "#F59E0B" }} />
            <p className="text-[13px] font-medium" style={{ color: "#FCD34D" }}>
              Partial output — run did not complete
            </p>
          </div>
          <JsonPanel label="Partial Output" value={partialOutput} accent="warning" />
        </div>
      )}

      {/* Error block */}
      {errorMessage && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" style={{ color: "#EF4444" }} />
            <p className="text-[13px] font-medium" style={{ color: "#FCA5A5" }}>Error</p>
          </div>
          <JsonPanel label="Error" value={{ error: errorMessage }} accent="error" />
        </div>
      )}
    </div>
  );
}
