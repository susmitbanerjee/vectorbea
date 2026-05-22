"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactUiModel } from "@/types/agent-run-ui";

function fmtTime(ts: string) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const TYPE_CONFIG = {
  json: { icon: <FileCode2 className="h-4 w-4" />, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  markdown: { icon: <FileText className="h-4 w-4" />, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
  text: { icon: <FileText className="h-4 w-4" />, color: "text-muted-foreground", bg: "bg-muted/50", border: "border-border" },
  csv: { icon: <FileCode2 className="h-4 w-4" />, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
};

function ArtifactCard({ artifact }: { artifact: ArtifactUiModel }) {
  const [expanded, setExpanded] = useState(false);
  const tcfg = TYPE_CONFIG[artifact.type] ?? TYPE_CONFIG.text;
  const preview = artifact.type === "json"
    ? JSON.stringify(artifact.preview, null, 2)
    : String(artifact.preview);

  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", tcfg.bg, tcfg.border, tcfg.color)}>
          {tcfg.icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold font-mono truncate">{artifact.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {artifact.createdByAgent} · {fmtTime(artifact.createdAt)} · {artifact.sizeLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", tcfg.bg, tcfg.border, tcfg.color)}>
            .{artifact.type}
          </span>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Preview
          </button>
          <button
            type="button"
            title="Download (mock)"
            className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-border transition-colors opacity-50 cursor-not-allowed"
            disabled
          >
            <Download className="h-3 w-3" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/40 px-4 pb-4 pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Preview</p>
          <pre className="max-h-56 overflow-auto rounded-lg bg-[#0f0f0f] p-3 text-[11px] leading-relaxed text-[#e5e7eb]">
            {preview}
          </pre>
        </div>
      )}
    </div>
  );
}

interface ArtifactsTabProps {
  artifacts: ArtifactUiModel[];
}

export function ArtifactsTab({ artifacts }: ArtifactsTabProps) {
  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <FileCode2 className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No artifacts generated in this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""} generated</p>
      </div>
      {artifacts.map(a => <ArtifactCard key={a.id} artifact={a} />)}
    </div>
  );
}
