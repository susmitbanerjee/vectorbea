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
      { nodeType: "trigger", description: "Start on schedule, webhook, or manual trigger" },
      { nodeType: "end", description: "Mark workflow as complete" },
    ],
  },
  {
    label: "AI",
    items: [
      { nodeType: "agent", description: "Reason, plan, extract, classify, or generate" },
      { nodeType: "llm", description: "Direct LLM inference with a configured model" },
      { nodeType: "tool", description: "Call a registered tool or external API" },
    ],
  },
  {
    label: "Control Flow",
    items: [
      { nodeType: "branch", description: "Route using deterministic conditions" },
      { nodeType: "parallel", description: "Fan-out to multiple concurrent branches" },
      { nodeType: "join", description: "Merge and synchronize branches" },
      { nodeType: "timer", description: "Sleep, delay, or wait for a duration" },
    ],
  },
  {
    label: "Governance",
    items: [
      { nodeType: "approval", description: "Pause until a human approves or rejects" },
      { nodeType: "checkpoint", description: "Enable replay from this exact point" },
      { nodeType: "artifact", description: "Store and name an output artifact" },
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
      className="group relative flex cursor-grab items-center gap-2.5 rounded-[10px] border border-transparent px-2.5 py-2 transition-all duration-150 hover:border-[#E0E3E6] hover:bg-[#FAFBFB] active:cursor-grabbing active:scale-[0.98] active:opacity-80"
      title={`Drag to canvas or click to add — ${item.description}`}
      style={{ userSelect: "none" }}
    >
      {/* Flat solid type tile + white glyph — distinct per type, no gloss */}
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
        style={{ background: meta.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)" }}
      >
        <Icon
          strokeWidth={2}
          style={{ color: "#FFFFFF", width: 15, height: 15 }}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold leading-snug text-[#0B0D0F]">
          {meta.label}
        </p>
        <p className="mt-px text-[10.5px] leading-snug text-[#9CA3AF] line-clamp-1 transition-colors group-hover:text-[#6B7280]">
          {item.description}
        </p>
      </div>
    </div>
  );
}

// ─── Template chip ────────────────────────────────────────────────────────────

const COMPLEXITY_COLORS = {
  simple: "text-emerald-600",
  intermediate: "text-amber-600",
  advanced: "text-violet-600",
};

function TemplateItem({ template, onApply }: { template: WorkflowTemplate; onApply: () => void }) {
  return (
    <button
      type="button"
      onClick={onApply}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-all duration-150 hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold text-slate-800">{template.name}</p>
        <span className={cn("shrink-0 text-[9px] font-semibold uppercase tracking-wider", COMPLEXITY_COLORS[template.complexity])}>
          {template.complexity}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-500 line-clamp-2">{template.description}</p>
    </button>
  );
}

// ─── Section (collapsible) ────────────────────────────────────────────────────

const SECTION_ACCENT: Record<string, string> = {
  Core: "#94a3b8",
  AI: "#7C3AED",
  "Control Flow": "#0891B2",
  Governance: "#D97706",
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
  const dot = SECTION_ACCENT[label] ?? "#94a3b8";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 transition-colors hover:bg-slate-50"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="flex-1 text-left text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400 hover:text-slate-600">
          {label}
        </span>
        {count !== undefined && (
          <span
            className="rounded px-1.5 py-px text-[9px] font-semibold tabular-nums"
            style={{ background: `${dot}18`, color: dot }}
          >
            {count}
          </span>
        )}
        {open
          ? <ChevronDown className="h-3 w-3 text-slate-300" />
          : <ChevronRight className="h-3 w-3 text-slate-300" />
        }
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
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid #ECEEEF" }}>
        <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">
          Node Palette
        </span>
      </div>

      {/* Search */}
      <div className="px-3 pt-2.5 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-200 bg-white pl-7 pr-3 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#E6F4EF] focus:border-[#9CCFBB] transition-colors"
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
        className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 transition-all"
      >
        <LayoutTemplate className="h-3.5 w-3.5" style={{ color: "#7C3AED" }} />
        <span className="flex-1 text-left">Quick Templates</span>
        <span
          className="rounded px-1.5 py-px text-[9px] font-semibold"
          style={{ background: "#F5F3FF", color: "#7C3AED" }}
        >
          {WORKFLOW_TEMPLATES.length}
        </span>
        {showTemplates ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
      </button>

      {showTemplates && (
        <div className="mx-3 mb-3 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2">
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
              <p className="px-3 py-4 text-center text-[12px] text-slate-400">
                No nodes match &ldquo;{search}&rdquo;
              </p>
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
      <div className="px-3 py-2.5" style={{ borderTop: "1px solid #ECEEEF" }}>
        <p className="text-center font-mono text-[9.5px] tracking-wide text-[#9CA3AF]">
          ⠿ drag to canvas · click to add
        </p>
      </div>
    </div>
  );
}
