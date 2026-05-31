"use client";

/**
 * FieldPicker — the core visual mapping drawer.
 *
 * Shows all available field sources (Workflow Input, upstream nodes) in a
 * searchable tree. User selects a field → mapping is confirmed.
 *
 * Layout:
 *   Left column:  source groups
 *   Right column: field tree for selected source + preview
 *   Bottom:       selected field preview + transform + confirm
 */

import { useState, useMemo } from "react";
import {
  ChevronDown, ChevronRight, Search, X, Check,
  ArrowRight, Database, Globe2, Bot, BrainCircuit,
  GitBranch, Zap, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  FieldSource, NodeOutputField, VisualMapping, VisualMappingField,
  TransformType, FieldType,
} from "@/types/workflow-mapping";
import { checkTypeCompatibility, TRANSFORM_LABELS } from "@/types/workflow-mapping";

// ─── Source icon ──────────────────────────────────────────────────────────────

function SourceIcon({ nodeType }: { nodeType?: string }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (nodeType) {
    case "trigger":   return <Zap className={cls} style={{ color: "#2563EB" }} />;
    case "agent":     return <BrainCircuit className={cls} style={{ color: "#7C3AED" }} />;
    case "llm":       return <BrainCircuit className={cls} style={{ color: "#9333EA" }} />;
    case "http_tool": return <Globe2 className={cls} style={{ color: "#059669" }} />;
    case "db_read":
    case "db_write":  return <Database className={cls} style={{ color: "#0369A1" }} />;
    case "branch":    return <GitBranch className={cls} style={{ color: "#7C3AED" }} />;
    case "system":    return <Hash className={cls} style={{ color: "#64748B" }} />;
    default:          return <Bot className={cls} style={{ color: "#64748B" }} />;
  }
}

// ─── Type chip ────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<FieldType | string, string> = {
  string: "#2563EB", number: "#059669", boolean: "#D97706",
  array: "#7C3AED", object: "#0891B2", date: "#EA580C",
  datetime: "#EA580C", uuid: "#64748B", any: "#94A3B8", unknown: "#CBD5E1",
};
function TypeChip({ type }: { type: FieldType }) {
  return (
    <span
      className="rounded px-1 py-px font-mono"
      style={{ fontSize: 9, fontWeight: 700, background: `${TYPE_COLOR[type]}18`, color: TYPE_COLOR[type] }}
    >
      {type}
    </span>
  );
}

// ─── Field tree node ──────────────────────────────────────────────────────────

interface FieldNodeProps {
  field: NodeOutputField;
  depth: number;
  onSelect: (field: NodeOutputField) => void;
  selected: string | null;
  targetType?: FieldType;
}

function FieldNode({ field, depth, onSelect, selected, targetType }: FieldNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = field.children && field.children.length > 0;
  const isSelected = selected === field.path;

  const compat = targetType ? checkTypeCompatibility(field.type, targetType) : "unknown";
  const incompatible = compat === "incompatible";

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer transition-colors",
          isSelected ? "bg-blue-50" : "hover:bg-slate-50",
          incompatible && "opacity-40",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => !incompatible && onSelect(field)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 text-slate-400 hover:text-slate-600"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : <span className="w-3 shrink-0" />}

        <span className="flex-1 min-w-0">
          <span className={cn("text-[12.5px] font-medium truncate", isSelected ? "text-blue-700" : "text-slate-800")}>
            {field.label}
          </span>
          {field.isArrayItem && (
            <span className="ml-1 text-[10px] text-slate-400">[]</span>
          )}
        </span>

        <TypeChip type={field.type} />

        {compat === "needs_conversion" && (
          <span className="text-[9px] font-semibold text-amber-600">⚠ convert</span>
        )}
        {isSelected && <Check className="h-3 w-3 shrink-0 text-blue-600" />}
      </div>

      {hasChildren && expanded && (
        <div>
          {field.children!.map(child => (
            <FieldNode key={child.path} field={child} depth={depth + 1}
              onSelect={onSelect} selected={selected} targetType={targetType} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Preview panel ────────────────────────────────────────────────────────────

function PreviewPanel({ field, sourceLabel }: { field: NodeOutputField | null; sourceLabel: string }) {
  if (!field) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center px-4">
        <p style={{ fontSize: 12, color: "#94A3B8" }}>Select a field to see a preview</p>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3">
      <div>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
          Selected field
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{sourceLabel}</span>
          <ArrowRight className="h-3 w-3 text-slate-400" />
          <span style={{ fontSize: 13, color: "#334155" }}>{field.label}</span>
          <TypeChip type={field.type} />
        </div>
        {field.description && (
          <p style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>{field.description}</p>
        )}
      </div>
      <div>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
          Sample value
        </p>
        {field.sampleValue !== undefined ? (
          <pre
            className="rounded-xl font-mono overflow-auto"
            style={{ fontSize: 11, background: "#F8FAFC", border: "1px solid #E2E8F0", padding: "8px 10px", maxHeight: 80, color: "#334155" }}
          >
            {JSON.stringify(field.sampleValue, null, 2)}
          </pre>
        ) : (
          <p style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic" }}>No sample yet — test the node to get a preview</p>
        )}
      </div>
    </div>
  );
}

// ─── Main FieldPicker ─────────────────────────────────────────────────────────

interface FieldPickerProps {
  /** The input field label being mapped */
  targetLabel: string;
  targetType?: FieldType;
  /** Available upstream sources */
  sources: FieldSource[];
  /** Current mapping (for initial selection) */
  current?: VisualMapping;
  onConfirm: (mapping: VisualMapping) => void;
  onClose: () => void;
}

export function FieldPicker({
  targetLabel, targetType, sources, current, onConfirm, onClose,
}: FieldPickerProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    sources[0]?.sourceId ?? "workflow_input",
  );
  const [selectedField, setSelectedField]   = useState<NodeOutputField | null>(null);
  const [search, setSearch]                 = useState("");
  const [transform, setTransform]           = useState<TransformType>("as_is");
  const [showAdvanced, setShowAdvanced]     = useState(false);
  const [advancedExpr, setAdvancedExpr]     = useState<string>(
    current?.type === "expression" ? current.expression : "",
  );

  const selectedSource = sources.find(s => s.sourceId === selectedSourceId);

  const filteredFields = useMemo(() => {
    if (!selectedSource) return [];
    if (!search) return selectedSource.fields;
    const q = search.toLowerCase();
    function filter(fields: NodeOutputField[]): NodeOutputField[] {
      return fields.flatMap(f => {
        const match = f.label.toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
        const childMatches = f.children ? filter(f.children) : [];
        if (match) return [{ ...f, children: f.children }];
        if (childMatches.length) return [{ ...f, children: childMatches }];
        return [];
      });
    }
    return filter(selectedSource.fields);
  }, [selectedSource, search]);

  function handleConfirm() {
    if (showAdvanced) {
      onConfirm({ type: "expression", expression: advancedExpr });
      return;
    }
    if (!selectedField) return;
    const base: VisualMappingField = {
      type: "field",
      sourceId: selectedSourceId,
      path: selectedField.path,
      previewValue: selectedField.sampleValue,
      previewLabel: `${selectedSource?.label} → ${selectedField.label}`,
    };
    if (transform !== "as_is") {
      onConfirm({ type: "transform", source: base, transform });
    } else {
      onConfirm(base);
    }
  }

  const canConfirm = showAdvanced ? !!advancedExpr : !!selectedField;
  const compat = selectedField && targetType
    ? checkTypeCompatibility(selectedField.type, targetType)
    : "unknown";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.4)", backdropFilter: "blur(2px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white"
        style={{ boxShadow: "0 24px 60px rgba(15,23,42,0.18)", maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #E2E8F0" }}>
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>Map field</p>
            <p style={{ fontSize: 12, color: "#64748B" }}>
              Target: <strong>{targetLabel}</strong>
              {targetType && <TypeChip type={targetType} />}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                showAdvanced ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
              )}
            >
              Advanced
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showAdvanced ? (
          /* Advanced expression editor */
          <div className="p-5 space-y-3">
            <p style={{ fontSize: 12, color: "#64748B" }}>
              Enter a template expression manually. Use{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">{`{{ steps.nodeId.output.field }}`}</code>{" "}
              or{" "}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">{`{{ input.fieldName }}`}</code>
            </p>
            <textarea
              value={advancedExpr}
              onChange={e => setAdvancedExpr(e.target.value)}
              rows={4}
              placeholder="e.g. {{ steps.fetchCustomer.output.customer.id }}"
              className="w-full rounded-xl border border-slate-200 bg-white font-mono px-3 py-2 text-[12.5px] text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            />
            <p style={{ fontSize: 11, color: "#94A3B8", fontStyle: "italic" }}>
              Advanced expressions bypass type checking and transform options.
            </p>
          </div>
        ) : (
          /* Visual picker */
          <div className="flex" style={{ height: "min(480px, 60vh)" }}>
            {/* Source list */}
            <div className="w-44 shrink-0 overflow-y-auto border-r border-slate-100 py-2">
              {sources.map(src => (
                <button
                  key={src.sourceId}
                  type="button"
                  onClick={() => { setSelectedSourceId(src.sourceId); setSelectedField(null); }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                    selectedSourceId === src.sourceId ? "bg-blue-50" : "hover:bg-slate-50",
                  )}
                >
                  <SourceIcon nodeType={src.nodeType} />
                  <span
                    className="truncate text-[12px] font-medium"
                    style={{ color: selectedSourceId === src.sourceId ? "#1D4ED8" : "#334155" }}
                  >
                    {src.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Field tree */}
            <div className="flex flex-1 flex-col min-w-0">
              {/* Search */}
              <div className="px-3 py-2 border-b border-slate-100">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search fields…"
                    className="h-8 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-[12.5px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              {/* Fields */}
              <div className="flex-1 overflow-y-auto py-1">
                {filteredFields.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[12px] text-slate-400">No fields found</p>
                ) : filteredFields.map(field => (
                  <FieldNode
                    key={field.path} field={field} depth={0}
                    onSelect={setSelectedField}
                    selected={selectedField?.path ?? null}
                    targetType={targetType}
                  />
                ))}
              </div>

              {/* Preview + transform */}
              <div style={{ borderTop: "1px solid #F1F5F9" }}>
                <PreviewPanel field={selectedField} sourceLabel={selectedSource?.label ?? ""} />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ borderTop: "1px solid #E2E8F0" }}
        >
          <div className="flex items-center gap-2">
            {!showAdvanced && selectedField && (
              <>
                <label style={{ fontSize: 12, color: "#64748B" }}>Transform:</label>
                <select
                  value={transform}
                  onChange={e => setTransform(e.target.value as TransformType)}
                  className="h-7 appearance-none rounded-lg border border-slate-200 bg-white px-2 pr-6 text-[12px] text-slate-700 outline-none"
                >
                  {(Object.entries(TRANSFORM_LABELS) as [TransformType, string][]).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </>
            )}
            {compat === "needs_conversion" && (
              <span style={{ fontSize: 11, color: "#B45309" }}>⚠ Type conversion needed</span>
            )}
            {compat === "incompatible" && (
              <span style={{ fontSize: 11, color: "#B91C1C" }}>✕ Incompatible types</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="h-8 rounded-xl border border-slate-200 px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm || compat === "incompatible"}
              className="h-8 rounded-xl bg-[#2563EB] px-4 text-[13px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40"
            >
              Use this field
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
