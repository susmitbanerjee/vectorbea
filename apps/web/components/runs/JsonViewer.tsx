"use client";
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { redactSensitiveData } from "@/lib/redaction";

export function JsonViewer({
  data, label, redact = true, defaultExpanded = true,
}: {
  data: unknown; label?: string; redact?: boolean; defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied]     = useState(false);
  const safe   = redact ? redactSensitiveData(data) : data;
  // JSON.stringify(undefined) returns undefined (not a string) — guard it
  const json   = safe !== undefined ? (JSON.stringify(safe, null, 2) ?? "null") : "null";

  function copy() {
    void navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden" style={{ background: "#FAFBFC" }}>
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
        style={{ borderBottom: expanded ? "1px solid #E2E8F0" : undefined }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {label ?? "Payload"}
          </span>
          <span style={{ fontSize: 10.5, color: "#94A3B8" }}>
            {json.length > 1000 ? `${(json.length / 1000).toFixed(1)} KB` : `${json.length} chars`}
          </span>
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); copy(); }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {expanded && (
        <pre
          className="overflow-auto p-3 font-mono text-[11.5px] leading-relaxed"
          style={{ maxHeight: 320, color: "#334155", background: "#FAFBFC" }}
        >
          {json}
        </pre>
      )}
    </div>
  );
}
