"use client";
import type { ViewMode } from "@/types/runs";
import { Briefcase, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Logs is now a tab beside the timeline, not a separate view mode.
const VIEW_OPTIONS: { id: ViewMode; label: string; Icon: React.ElementType }[] = [
  { id: "business",    label: "Business",    Icon: Briefcase },
  { id: "engineering", label: "Engineering", Icon: Code2     },
];

export function RunViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {VIEW_OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-all",
            mode === id
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-500 hover:text-slate-800",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
