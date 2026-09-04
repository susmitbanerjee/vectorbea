"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { NODE_MARKS } from "~/components/icons/nodes";
import type { NodeKind } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   LEFT PALETTE

   The existing taxonomy is preserved wholesale — Start / AI / Logic / Apps /
   Human / Output. It is a good taxonomy: it groups by what a step DOES to the
   run rather than by which subsystem implements it, which is why somebody
   looking for "pause until a person says yes" finds it under Human instead of
   under a vendor name.

   Only the node-type vocabulary is updated: the legacy `join`, `timer` and
   `artifact` become `merge`, `wait` and `output`, matching the marks in §6.2 and
   the types every other surface already uses.
══════════════════════════════════════════════════════════════════════════════ */

export interface PaletteItem {
  kind: NodeKind;
  label: string;
  description: string;
}

export const PALETTE: { group: string; items: PaletteItem[] }[] = [
  {
    group: "Start",
    items: [
      { kind: "trigger", label: "Trigger", description: "Start on a schedule, a webhook, or by hand" },
    ],
  },
  {
    group: "AI",
    items: [
      { kind: "agent", label: "Agent", description: "Reason, plan, and call tools to reach a goal" },
      { kind: "llm", label: "Model call", description: "One model call — summarise, extract, classify" },
    ],
  },
  {
    group: "Logic",
    items: [
      { kind: "branch", label: "Branch", description: "Route on a condition" },
      { kind: "parallel", label: "Fan out", description: "Run a step per item, concurrently" },
      { kind: "merge", label: "Merge", description: "Join concurrent branches back together" },
      { kind: "wait", label: "Wait", description: "Pause for a duration or until a time" },
    ],
  },
  {
    group: "Apps",
    items: [
      { kind: "tool", label: "Tool call", description: "Call a tool, app action, or external API" },
    ],
  },
  {
    group: "Human",
    items: [
      { kind: "approval", label: "Approval gate", description: "Hold the run until a person decides" },
    ],
  },
  {
    group: "Output",
    items: [
      { kind: "checkpoint", label: "Checkpoint", description: "Commit here, so a retry resumes from this point" },
      { kind: "output", label: "Output", description: "Emit the result somewhere" },
      { kind: "end", label: "End", description: "Mark the run complete" },
    ],
  },
];

export interface QuickTemplate {
  id: string;
  name: string;
  description: string;
  kinds: NodeKind[];
}

/** Shapes people build over and over, as one click instead of six. */
export const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: "gated-tool",
    name: "Gated tool call",
    description: "Approval, then the call, then a checkpoint",
    kinds: ["approval", "tool", "checkpoint"],
  },
  {
    id: "fan-merge",
    name: "Fan out and merge",
    description: "Per-item work, joined back together",
    kinds: ["parallel", "tool", "merge"],
  },
  {
    id: "classify-route",
    name: "Classify and route",
    description: "A model call feeding a branch",
    kinds: ["llm", "branch"],
  },
];

export function Palette({
  collapsed, onToggle, onAdd, onApplyTemplate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onAdd: (kind: NodeKind, label: string) => void;
  onApplyTemplate: (template: QuickTemplate) => void;
}) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();

  const groups = React.useMemo(() => {
    if (!needle) return PALETTE;
    return PALETTE
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => i.label.toLowerCase().includes(needle)
            || i.description.toLowerCase().includes(needle)
            || i.kind.includes(needle),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [needle]);

  if (collapsed) {
    return (
      <aside className="border-subtle bg-surface-base flex w-11 shrink-0 flex-col items-center gap-1 border-r py-2">
        <CollapseButton collapsed onClick={onToggle} />
        <div className="border-subtle mt-1 w-6 border-t" />
        {PALETTE.flatMap((g) => g.items).map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => onAdd(item.kind, item.label)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/vectorbea-node", item.kind);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={`${item.label} — ${item.description}`}
            aria-label={`Add ${item.label}`}
            className={cn(
              "grid size-7 shrink-0 cursor-grab place-items-center rounded-sm",
              "text-fg-muted hover:bg-surface-hover hover:text-fg-primary",
              "transition-colors duration-fast outline-none focus-visible:focus-ring active:cursor-grabbing",
            )}
          >
            <Mark kind={item.kind} size={15} />
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="border-subtle bg-surface-base flex w-56 shrink-0 flex-col border-r">
      <div className="border-subtle flex items-center gap-1.5 border-b p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search steps"
          aria-label="Search steps"
          className="h-7 text-body-sm"
        />
        <CollapseButton collapsed={false} onClick={onToggle} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <Text variant="caption" tone="muted" className="block px-1 py-2">
            No step matches “{query}”. Every step type is listed here — if it is not in this list,
            the product does not have it.
          </Text>
        ) : (
          groups.map((group) => (
            <section key={group.group} className="mb-3">
              <Text variant="eyebrow" tone="muted" className="mb-1 block px-1">{group.group}</Text>
              <ul className="grid gap-px">
                {group.items.map((item) => (
                  <li key={item.kind}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/vectorbea-node", item.kind);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onAdd(item.kind, item.label)}
                      className={cn(
                        "flex w-full cursor-grab items-start gap-2 rounded-sm px-1.5 py-1.5 text-left",
                        "hover:bg-surface-hover transition-colors duration-fast",
                        "outline-none focus-visible:focus-ring active:cursor-grabbing",
                      )}
                    >
                      <span className="border-subtle bg-surface-hover text-fg-secondary mt-px grid size-6 shrink-0 place-items-center rounded-xs border">
                        <Mark kind={item.kind} size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-ui text-body-sm text-fg-primary block truncate">{item.label}</span>
                        <span className="font-ui text-caption text-fg-muted block leading-snug">{item.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="border-subtle border-t p-2">
        <Text variant="eyebrow" tone="muted" className="mb-1 block px-1">Quick templates</Text>
        <ul className="grid gap-px">
          {QUICK_TEMPLATES.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => onApplyTemplate(template)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left",
                  "hover:bg-surface-hover transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                <span className="flex shrink-0 -space-x-1">
                  {template.kinds.map((kind) => (
                    <span
                      key={kind}
                      className="border-subtle bg-surface-raised text-fg-muted grid size-5 place-items-center rounded-xs border"
                    >
                      <Mark kind={kind} size={10} />
                    </span>
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="font-ui text-body-sm text-fg-primary block truncate">{template.name}</span>
                  <span className="font-ui text-caption text-fg-muted block truncate">{template.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function Mark({ kind, size }: { kind: NodeKind; size: number }) {
  const entry = NODE_MARKS.find((m) => m.type === kind);
  if (!entry) return null;
  const Icon = entry.Icon;
  return <Icon size={size} aria-hidden="true" />;
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? "Expand the palette" : "Collapse the palette"}
      title={collapsed ? "Expand the palette" : "Collapse the palette"}
      className={cn(
        "text-fg-muted hover:text-fg-primary grid size-7 shrink-0 place-items-center rounded-sm",
        "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
      )}
    >
      <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="2" width="9" height="8" rx="1.2" />
        <path d="M4.6 2v8" />
        {collapsed ? <path d="M6.6 4.6 8 6 6.6 7.4" /> : <path d="M8.4 4.6 7 6l1.4 1.4" />}
      </svg>
    </button>
  );
}
