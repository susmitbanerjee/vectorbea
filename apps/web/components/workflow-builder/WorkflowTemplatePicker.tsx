"use client";

/**
 * WorkflowTemplatePicker
 *
 * Shown when a brand-new workflow has no saved graph.
 * User picks a template (or starts blank) → triggers onSelect callback
 * with the chosen WorkflowTemplate.
 */

import React from "react";
import {
  Bot,
  GitBranch,
  Globe,
  Search,
  ShieldCheck,
  Zap,
  Plus,
} from "lucide-react";
import type { WorkflowTemplate, WorkflowGraph } from "@/types/workflow-graph";

// ─── Blank-canvas mini-template ───────────────────────────────────────────────

const BLANK_GRAPH: WorkflowGraph = {
  nodes: [
    {
      id: "t1",
      type: "trigger",
      position: { x: 180, y: 120 },
      data: { label: "Trigger", nodeType: "trigger", previewStatus: "idle" },
    },
    {
      id: "e1",
      type: "end",
      position: { x: 180, y: 300 },
      data: { label: "End", nodeType: "end", previewStatus: "idle" },
    },
  ],
  edges: [
    { id: "t1-e1", source: "t1", target: "e1", sourceHandle: null, targetHandle: null, data: { edgeType: "default" } },
  ],
  version: "1",
};

const BLANK_TEMPLATE: WorkflowTemplate = {
  id: "blank",
  name: "Blank Canvas",
  description: "Start from scratch with a trigger and end node.",
  complexity: "simple",
  tags: ["blank"],
  graph: BLANK_GRAPH,
};

// ─── Template cards config ────────────────────────────────────────────────────

type TemplateCard = {
  template: WorkflowTemplate;
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  tag: string;
  tagColor: string;
};

function buildCards(templates: WorkflowTemplate[]): TemplateCard[] {
  const find = (id: string) => templates.find(t => t.id === id);

  const iconMap: Record<string, { icon: React.ElementType; iconColor: string; bgColor: string; tag: string; tagColor: string }> = {
    "customer-renewal":  { icon: GitBranch, iconColor: "#7C3AED", bgColor: "#F5F3FF", tag: "Complex",   tagColor: "#7C3AED" },
    "content-moderation":{ icon: ShieldCheck, iconColor: "#FCD34D", bgColor: "rgba(252,211,77,0.07)", tag: "Approval",  tagColor: "#FCD34D" },
    "data-enrichment":   { icon: Search,    iconColor: "#0891B2", bgColor: "#ECFEFF",  tag: "Data",      tagColor: "#0891B2" },
    "research-agent":    { icon: Globe,     iconColor: "#059669", bgColor: "#ECFDF5", tag: "Research",  tagColor: "#059669" },
    "customer-support":  { icon: Bot,       iconColor: "#2563EB", bgColor: "#EFF6FF",  tag: "Support",   tagColor: "#2563EB" },
    "lead-scoring":      { icon: Zap,       iconColor: "#D97706", bgColor: "#FFFBEB",  tag: "Sales",     tagColor: "#D97706" },
  };

  const cards: TemplateCard[] = [];
  for (const [id, meta] of Object.entries(iconMap)) {
    const t = find(id);
    if (t) cards.push({ template: t, ...meta });
  }

  // Fill remaining slots from templates list
  for (const t of templates) {
    if (!cards.find(c => c.template.id === t.id)) {
      cards.push({
        template: t,
        icon: GitBranch,
        iconColor: "#64748B",
        bgColor: "rgba(100,116,139,0.06)",
        tag: "Template",
        tagColor: "#64748B",
      });
    }
  }

  return cards;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface WorkflowTemplatePickerProps {
  templates: WorkflowTemplate[];
  workflowName: string;
  onSelect: (template: WorkflowTemplate) => void;
}

export function WorkflowTemplatePicker({ templates, workflowName, onSelect }: WorkflowTemplatePickerProps) {
  const cards = buildCards(templates);

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-10">
      {/* Header */}
      <div className="mb-8 text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
        >
          <GitBranch className="h-5 w-5" style={{ color: "#2563EB" }} />
        </div>
        <h2 className="text-[18px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Start building <span style={{ color: "#2563EB" }}>{workflowName}</span>
        </h2>
        <p className="mt-1.5 text-[13px]" style={{ color: "var(--text-faint)" }}>
          Pick a template to jump-start your workflow, or start with a blank canvas.
        </p>
      </div>

      {/* Template grid */}
      <div className="grid w-full max-w-3xl grid-cols-2 gap-3 lg:grid-cols-3">
        {/* Blank canvas card — always first */}
        <button
          type="button"
          onClick={() => onSelect(BLANK_TEMPLATE)}
          className="group relative flex flex-col gap-3 rounded-xl p-4 text-left transition-all duration-150"
          style={{
            background: "rgba(100,116,139,0.05)",
            border: "1px dashed rgba(148,163,184,0.20)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "#93C5FD";
            (e.currentTarget as HTMLElement).style.background = "#F5F9FF";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(148,163,184,0.20)";
            (e.currentTarget as HTMLElement).style.background = "rgba(100,116,139,0.05)";
          }}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.12)" }}
          >
            <Plus className="h-4 w-4" style={{ color: "var(--text-faint)" }} />
          </div>
          <div>
            <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Blank Canvas
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
              Start from scratch
            </p>
          </div>
        </button>

        {/* Template cards */}
        {cards.map(({ template, icon: Icon, iconColor, bgColor, tag, tagColor }) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            className="group relative flex flex-col gap-3 rounded-xl p-4 text-left transition-all duration-150"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--legacy-border-subtle)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = iconColor + "50";
              (e.currentTarget as HTMLElement).style.background = bgColor;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--legacy-border-subtle)";
              (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
            }}
          >
            {/* Tag pill */}
            <div className="flex items-start justify-between gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: bgColor, border: `1px solid ${iconColor}25` }}
              >
                <Icon className="h-4 w-4" style={{ color: iconColor }} />
              </div>
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest"
                style={{ background: `${tagColor}15`, color: tagColor }}
              >
                {tag}
              </span>
            </div>

            <div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {template.name}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
                {template.description}
              </p>
            </div>

            {/* Mini node count */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>
                {template.graph.nodes.length} nodes · {template.graph.edges.length} edges
              </span>
            </div>
          </button>
        ))}
      </div>

      <p className="mt-6 text-[11px]" style={{ color: "rgba(100,116,139,0.5)" }}>
        You can always apply a different template later from the node palette.
      </p>
    </div>
  );
}
