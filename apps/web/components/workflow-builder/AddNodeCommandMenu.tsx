"use client";

/**
 * AddNodeCommandMenu — reference-style centered command palette for adding nodes.
 *
 * Dim overlay + centered modal + autofocused search ("What would you like to add?")
 * + category-grouped results with icon / title / subtitle, full keyboard navigation
 * (↑ ↓ to move, ↵ to add, Esc to close). Mirrors the Suga/Railway "Add" modal.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Search, LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_META } from "./NodeIcon";
import type { WFNodeType, WorkflowTemplate } from "@/types/workflow-graph";

interface MenuEntry {
  nodeType: WFNodeType;
  category: string;
  subtitle: string;
}

// Reference-style categories mapped onto Vectorbea node types.
const ENTRIES: MenuEntry[] = [
  { nodeType: "trigger", category: "Trigger", subtitle: "Start on a schedule, webhook, or manual run" },
  { nodeType: "agent", category: "Agent", subtitle: "Reason, plan, extract, classify, or generate" },
  { nodeType: "llm", category: "Agent", subtitle: "Direct LLM inference with a configured model" },
  { nodeType: "tool", category: "Tool", subtitle: "Call a registered tool or external API" },
  { nodeType: "branch", category: "Logic", subtitle: "Branch execution on deterministic conditions" },
  { nodeType: "parallel", category: "Logic", subtitle: "Fan-out to multiple concurrent branches" },
  { nodeType: "join", category: "Logic", subtitle: "Merge and synchronize parallel branches" },
  { nodeType: "timer", category: "Logic", subtitle: "Sleep, delay, or wait for a duration" },
  { nodeType: "approval", category: "Human", subtitle: "Pause until a person approves or rejects" },
  { nodeType: "checkpoint", category: "Data", subtitle: "Enable durable replay from this point" },
  { nodeType: "artifact", category: "Data", subtitle: "Store and name an output artifact" },
  { nodeType: "end", category: "Other", subtitle: "Mark the workflow as complete" },
];

const CATEGORY_ORDER = ["Trigger", "Agent", "Logic", "Tool", "Data", "Human", "Other"];

interface AddNodeCommandMenuProps {
  open: boolean;
  onClose: () => void;
  onAddNode: (type: WFNodeType) => void;
  templates?: WorkflowTemplate[];
  onApplyTemplate?: (template: WorkflowTemplate) => void;
}

export function AddNodeCommandMenu({
  open,
  onClose,
  onAddNode,
  templates,
  onApplyTemplate,
}: AddNodeCommandMenuProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flat, filtered, ordered list of selectable rows (nodes + optional templates).
  type Row =
    | { kind: "node"; entry: MenuEntry }
    | { kind: "template"; template: WorkflowTemplate };

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const nodeRows: Row[] = ENTRIES.filter((e) => {
      if (!q) return true;
      const meta = NODE_META[e.nodeType];
      return (
        meta.label.toLowerCase().includes(q) ||
        e.subtitle.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    }).map((entry) => ({ kind: "node", entry }));

    const templateRows: Row[] = (templates ?? [])
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      .map((template) => ({ kind: "template", template }));

    return [...nodeRows, ...templateRows];
  }, [query, templates]);

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Autofocus the search after the modal paints.
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function commit(row: Row | undefined) {
    if (!row) return;
    if (row.kind === "node") onAddNode(row.entry.nodeType);
    else onApplyTemplate?.(row.template);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(rows[active]);
    }
  }

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  // Group node rows under their category headers, preserving the flat index for nav.
  let flatIndex = -1;
  const grouped: { category: string; items: { row: Row; index: number }[] }[] = [];
  const pushRow = (category: string, row: Row) => {
    flatIndex += 1;
    let bucket = grouped.find((g) => g.category === category);
    if (!bucket) {
      bucket = { category, items: [] };
      grouped.push(bucket);
    }
    bucket.items.push({ row, index: flatIndex });
  };
  for (const cat of CATEGORY_ORDER) {
    for (const row of rows) {
      if (row.kind === "node" && row.entry.category === cat) pushRow(cat, row);
    }
  }
  for (const row of rows) {
    if (row.kind === "template") pushRow("Templates", row);
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-[14vh] animate-fade-in"
      style={{ background: "rgba(0,0,0,0.48)" }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to canvas"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-[540px] overflow-hidden rounded-[12px] border bg-white shadow-[0_24px_64px_rgba(11,13,15,0.22)] animate-fade-in-scale"
        style={{ borderColor: "var(--vb-border, #E0E3E6)" }}
      >
        {/* Search */}
        <div className="flex items-center gap-2.5 border-b px-4" style={{ borderColor: "#E0E3E6", height: 52 }}>
          <Search className="h-4 w-4 shrink-0 text-[#6B7280]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What would you like to add?"
            className="h-full flex-1 bg-transparent text-[14px] text-[#0B0D0F] placeholder:text-[#9CA3AF] outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-[#E0E3E6] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[10px] text-[#6B7280] sm:inline-block">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto vb-scrollbar py-1.5">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[#9CA3AF]">
              Nothing matches &ldquo;{query}&rdquo;
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="px-1.5 pb-1">
                <p className="px-2.5 pt-2 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">
                  {group.category}
                </p>
                {group.items.map(({ row, index }) => {
                  const isActive = index === active;
                  if (row.kind === "template") {
                    return (
                      <button
                        key={`tpl-${row.template.id}`}
                        type="button"
                        data-row={index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => commit(row)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors",
                          isActive ? "bg-[#E6F4EF]" : "hover:bg-[#F3F4F5]",
                        )}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border"
                          style={{ background: "#F3F4F5", borderColor: "#E0E3E6", color: "#007F4E" }}
                        >
                          <LayoutTemplate className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[#0B0D0F]">
                            {row.template.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-[#6B7280]">
                            {row.template.description}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#C9CED4]" />
                      </button>
                    );
                  }
                  const meta = NODE_META[row.entry.nodeType];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={row.entry.nodeType}
                      type="button"
                      data-row={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => commit(row)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors",
                        isActive ? "bg-[#E6F4EF]" : "hover:bg-[#F3F4F5]",
                      )}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
                        style={{ background: meta.color, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.26), 0 1px 3px ${meta.color}40`, color: "#FFFFFF" }}
                      >
                        <Icon strokeWidth={1.9} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[#0B0D0F]">
                          {meta.label}
                        </span>
                        <span className="block truncate text-[11.5px] text-[#6B7280]">
                          {row.entry.subtitle}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#C9CED4]" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t px-4 py-2.5" style={{ borderColor: "#E0E3E6" }}>
          <FooterKey k="↑↓" label="Navigate" />
          <FooterKey k="↵" label="Add" />
          <FooterKey k="esc" label="Close" />
        </div>
      </div>
    </div>
  );
}

function FooterKey({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
      <kbd className="rounded border border-[#E0E3E6] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[10px] text-[#4B5563]">
        {k}
      </kbd>
      {label}
    </span>
  );
}
