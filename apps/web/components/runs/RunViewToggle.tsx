"use client";
import type { ViewMode } from "@/types/runs";
import { Briefcase, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function RunViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {(["business", "engineering"] as ViewMode[]).map(m => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-all",
            mode === m
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-500 hover:text-slate-800",
          )}
        >
          {m === "business" ? <Briefcase className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
          {m === "business" ? "Business View" : "Engineering View"}
        </button>
      ))}
    </div>
  );
}
