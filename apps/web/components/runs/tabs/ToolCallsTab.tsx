"use client";
import { useState } from "react";
import type { WorkflowRun } from "@/types/runs";
import { JsonViewer } from "../JsonViewer";
import { ChevronDown, ChevronRight, Database, Globe2, Mail, Bot, Webhook, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<string, React.ElementType> = {
  llm: Bot, http: Globe2, database: Database, email: Mail, webhook: Webhook, internal: Wrench,
};

const STATUS_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  completed: { text: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
  failed:    { text: "#B91C1C", bg: "#FEF2F2", border: "#FECACA" },
  retried:   { text: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" },
  started:   { text: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
};

export function ToolCallsTab({ run }: { run: WorkflowRun }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (run.toolCalls.length === 0) {
    return <div className="py-12 text-center text-slate-400" style={{ fontSize: 13 }}>No tool calls in this run.</div>;
  }

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      {/* Header */}
      <div className="grid px-4 py-2.5 border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: "2fr 1fr 80px 80px 60px" }}>
        {["Tool", "Step", "Status", "Duration", "Cost"].map(h => (
          <span key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</span>
        ))}
      </div>
      {run.toolCalls.map(tc => {
        const Icon = TOOL_ICONS[tc.toolType] ?? Wrench;
        const s = STATUS_STYLE[tc.status] ?? STATUS_STYLE.started;
        const dur = tc.durationMs ? `${(tc.durationMs / 1000).toFixed(1)}s` : "—";
        const isOpen = expanded === tc.id;
        const step = run.steps.find(s => s.id === tc.stepId);
        return (
          <div key={tc.id}>
            <div
              onClick={() => setExpanded(isOpen ? null : tc.id)}
              className="grid items-center px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors"
              style={{ gridTemplateColumns: "2fr 1fr 80px 80px 60px" }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }} className="truncate">{tc.toolName}</p>
                  <p style={{ fontSize: 11, color: "#94A3B8" }} className="truncate">{tc.requestSummary}</p>
                </div>
              </div>
              <span style={{ fontSize: 11.5, color: "#64748B" }} className="truncate">{step?.businessName ?? tc.stepId}</span>
              <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold")} style={{ background: s.bg, color: s.text, borderColor: s.border }}>
                {tc.status}
              </span>
              <span style={{ fontSize: 12, color: "#475569", fontVariantNumeric: "tabular-nums" }}>{dur}</span>
              <span style={{ fontSize: 11.5, color: "#94A3B8" }}>{tc.costUsd ? `$${tc.costUsd.toFixed(3)}` : "—"}</span>
            </div>
            {isOpen && (
              <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3 space-y-3">
                {tc.error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#B91C1C" }}>Error: {tc.error}</p>
                  </div>
                )}
                {tc.responseSummary && (
                  <p style={{ fontSize: 12, color: "#334155" }}><strong>Response:</strong> {tc.responseSummary}</p>
                )}
                {tc.requestPayload !== undefined && <JsonViewer data={tc.requestPayload} label="Request" />}
                {tc.responsePayload !== undefined && <JsonViewer data={tc.responsePayload} label="Response" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
