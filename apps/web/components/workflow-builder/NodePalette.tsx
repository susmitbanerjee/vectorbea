"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  LayoutTemplate,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_META } from "./NodeIcon";
import type { WFNodeType } from "@/types/workflow-graph";
import type { WorkflowTemplate } from "@/types/workflow-graph";
import { WORKFLOW_TEMPLATES } from "@/lib/workflows/workflow-templates";

// ─── Palette definition ───────────────────────────────────────────────────────

interface PaletteItem {
  nodeType: WFNodeType;
  description: string;
}

const PALETTE_SECTIONS: { label: string; items: PaletteItem[] }[] = [
  {
    label: "Core",
    items: [
      { nodeType: "trigger", description: "Start workflow" },
      { nodeType: "end", description: "Finish workflow" },
    ],
  },
  {
    label: "AI",
    items: [
      { nodeType: "agent", description: "Run a Vectorbea agent" },
      { nodeType: "llm", description: "Direct LLM inference" },
      { nodeType: "tool", description: "Tool or API call" },
    ],
  },
  {
    label: "Control Flow",
    items: [
      { nodeType: "branch", description: "Conditional route" },
      { nodeType: "parallel", description: "Fan-out execution" },
      { nodeType: "join", description: "Merge branches" },
      { nodeType: "timer", description: "Sleep / delay" },
    ],
  },
  {
    label: "Governance",
    items: [
      { nodeType: "approval", description: "Human approval gate" },
      { nodeType: "checkpoint", description: "Replay boundary" },
      { nodeType: "artifact", description: "Store output artifact" },
    ],
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface NodePaletteProps {
  onAddNode: (type: WFNodeType) => void;
  onApplyTemplate: (template: WorkflowTemplate) => void;
}

// ─── Draggable palette item ───────────────────────────────────────────────────

function PaletteItem({ item, onAdd }: { item: PaletteItem; onAdd: () => void }) {
  const meta = NODE_META[item.nodeType];
  const Icon = meta.icon;

  function onDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("application/reactflow-node", item.nodeType);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onAdd}
      className="group relative flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-all hover:border-white/8 hover:bg-white/5 active:cursor-grabbing"
      title={`Drag to canvas or click to add — ${item.description}`}
    >
      {/* Left color accent on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[2px] rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: meta.color }}
      />
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm"
        style={{ background: meta.bgColor, border: `1px solid ${meta.borderColor}` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-foreground/75 transition-colors group-hover:text-foreground">
          {meta.label}
        </p>
        <p className="text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground/60">{item.description}</p>
      </div>
    </div>
  );
}

// ─── Template chip ────────────────────────────────────────────────────────────

const COMPLEXITY_COLORS = {
  simple: "text-emerald-400",
  intermediate: "text-amber-400",
  advanced: "text-violet-400",
};

function TemplateItem({ template, onApply }: { template: WorkflowTemplate; onApply: () => void }) {
  return (
    <button
      type="button"
      onClick={onApply}
      className="w-full rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-left transition-all hover:border-border/70 hover:bg-muted/20"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-foreground/80">{template.name}</p>
        <span className={cn("shrink-0 text-[9px] font-semibold uppercase tracking-wider", COMPLEXITY_COLORS[template.complexity])}>
          {template.complexity}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground/50 line-clamp-2">{template.description}</p>
    </button>
  );
}

// ─── Section (collapsible) ────────────────────────────────────────────────────

const SECTION_COLORS: Record<string, string> = {
  Core: "#94a3b8",
  AI: "#a78bfa",
  "Control Flow": "#38bdf8",
  Governance: "#fcd34d",
};

function Section({
  label,
  children,
  defaultOpen = true,
  count,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dot = SECTION_COLORS[label] ?? "#94a3b8";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 transition-colors hover:bg-white/3"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="flex-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70">
          {label}
        </span>
        {count !== undefined && (
          <span className="rounded px-1.5 py-px text-[9px] font-medium tabular-nums" style={{ background: `${dot}18`, color: dot }}>
            {count}
          </span>
        )}
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground/30" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/30" />}
      </button>
      {open && <div className="px-1 pb-1">{children}</div>}
    </div>
  );
}

// ─── Main palette ─────────────────────────────────────────────────────────────

export function NodePalette({ onAddNode, onApplyTemplate }: NodePaletteProps) {
  const [search, setSearch] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);

  const allItems = PALETTE_SECTIONS.flatMap((s) => s.items);
  const filtered = search
    ? allItems.filter(
        (i) =>
          NODE_META[i.nodeType].label.toLowerCase().includes(search.toLowerCase()) ||
          i.description.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Panel title */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/35">
          Node Palette
        </span>
      </div>
      {/* Search */}
      <div className="px-3 pt-2.5 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/35" />
          <input
            className="w-full rounded-lg border border-white/10 bg-white/5 pl-7 pr-3 py-1.5 text-[12px] text-foreground/80 placeholder:text-muted-foreground/25 focus:outline-none focus:ring-1 focus:ring-violet-400/30 focus:border-violet-400/30 transition-colors"
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Template toggle */}
      <button
        type="button"
        onClick={() => setShowTemplates(!showTemplates)}
        className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-white/8 bg-white/3 px-3 py-2 text-[11px] font-semibold text-muted-foreground/70 hover:border-white/15 hover:bg-white/6 hover:text-foreground transition-all"
      >
        <LayoutTemplate className="h-3.5 w-3.5 text-violet-400" />
        <span className="flex-1 text-left">Quick Templates</span>
        <span className="rounded px-1.5 py-px text-[9px] font-medium" style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa" }}>
          {WORKFLOW_TEMPLATES.length}
        </span>
        {showTemplates ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {showTemplates && (
        <div className="mx-3 mb-3 space-y-1.5 rounded-xl border border-border/40 bg-muted/5 p-2">
          {WORKFLOW_TEMPLATES.map((t) => (
            <TemplateItem key={t.id} template={t} onApply={() => onApplyTemplate(t)} />
          ))}
        </div>
      )}

      {/* Palette items */}
      <div className="flex-1 overflow-y-auto">
        {filtered ? (
          <div className="px-1 pb-2">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-muted-foreground/40">No nodes match &ldquo;{search}&rdquo;</p>
            ) : (
              filtered.map((item) => (
                <PaletteItem key={item.nodeType} item={item} onAdd={() => onAddNode(item.nodeType)} />
              ))
            )}
          </div>
        ) : (
          PALETTE_SECTIONS.map((section) => (
            <Section key={section.label} label={section.label} count={section.items.length}>
              {section.items.map((item) => (
                <PaletteItem key={item.nodeType} item={item} onAdd={() => onAddNode(item.nodeType)} />
              ))}
            </Section>
          ))
        )}
      </div>

      {/* Drag hint */}
      <div className="border-t border-border/20 px-3 py-2.5">
        <p className="text-[10px] text-muted-foreground/25 text-center tracking-wide">
          ⠿ drag · click to add
        </p>
      </div>
    </div>
  );
}
