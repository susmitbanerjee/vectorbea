"use client";
import { useState, useMemo } from "react";
import type { WorkflowRun } from "@/types/runs";
import { JsonViewer } from "../JsonViewer";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type EventCategory = "all" | "errors" | "retries" | "approvals" | "llm" | "tools" | "system";

function categorize(type: string): EventCategory {
  if (type.includes("retry")) return "retries";
  if (type.includes("approval")) return "approvals";
  if (type.includes("llm") || type.includes("agent")) return "llm";
  if (type.includes("tool") || type.includes("http") || type.includes("db")) return "tools";
  if (type.includes("error") || type.includes("failed")) return "errors";
  return "system";
}

export function EventHistoryTab({ run }: { run: WorkflowRun }) {
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [category, setCategory]   = useState<EventCategory>("all");
  const [search, setSearch]       = useState("");

  const events = useMemo(() => {
    let items = run.events;
    if (category !== "all") items = items.filter(e => categorize(e.type) === category);
    if (search) items = items.filter(e => e.type.includes(search) || e.stepId?.includes(search));
    return items;
  }, [run.events, category, search]);

  const categories: { id: EventCategory; label: string }[] = [
    { id: "all", label: "All" }, { id: "errors", label: "Errors" },
    { id: "retries", label: "Retries" }, { id: "approvals", label: "Approvals" },
    { id: "llm", label: "LLM" }, { id: "tools", label: "Tools" }, { id: "system", label: "System" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events…"
            className="h-9 w-48 rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-[12.5px] outline-none focus:border-[#9CCFBB] focus:ring-2 focus:ring-[#E6F4EF]" />
        </div>
        {categories.map(c => (
          <button key={c.id} type="button" onClick={() => setCategory(c.id)}
            className={cn("h-8 rounded-xl border px-3 text-[12px] font-semibold transition-colors",
              category === c.id ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            )}>
            {c.label}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="py-12 text-center text-slate-400" style={{ fontSize: 13 }}>No events match your filters.</div>
      ) : (
        <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
          <div className="grid px-4 py-2 border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}>
            {["Event type", "Step", "Timestamp", ""].map(h => (
              <span key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</span>
            ))}
          </div>
          {events.map(evt => {
            const isOpen = expanded === evt.id;
            const time = new Date(evt.timestamp).toLocaleTimeString(undefined, { hour12: false });
            return (
              <div key={evt.id}>
                <div onClick={() => setExpanded(isOpen ? null : evt.id)}
                  className="grid items-center px-4 py-2.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors"
                  style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", fontFamily: "monospace" }}>{evt.type}</span>
                  <span style={{ fontSize: 11.5, color: "#64748B" }}>{evt.stepId ?? "—"}</span>
                  <span style={{ fontSize: 11, color: "#94A3B8", fontFamily: "monospace" }}>{time}</span>
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                </div>
                {isOpen && (
                  <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                    <p style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8 }}>
                      Correlation ID: <code className="font-mono">{evt.correlationId}</code>
                    </p>
                    <JsonViewer data={evt.payload} label="Event payload" defaultExpanded />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
