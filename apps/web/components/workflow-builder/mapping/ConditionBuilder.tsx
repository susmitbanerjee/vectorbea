"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppSelect } from "@/components/ui/app-select";
import type {
  VisualConditionGroup, VisualCondition,
  VisualMappingField, ConditionOperator, FieldSource, FieldType,
} from "@/types/workflow-mapping";
import { OPERATOR_LABELS } from "@/types/workflow-mapping";
import { FieldPicker } from "./FieldPicker";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NEEDS_RIGHT_VALUE: ConditionOperator[] = [
  "equals","not_equals","contains","not_contains","starts_with","ends_with",
  "gt","gte","lt","lte","array_length_gt","array_length_gte","array_contains",
];

function newCondition(): VisualCondition {
  return {
    id: crypto.randomUUID(),
    left: { type: "field", sourceId: "workflow_input", path: "input" },
    operator: "equals",
    rightLiteral: "",
  };
}

function newGroup(): VisualConditionGroup {
  return { id: crypto.randomUUID(), logic: "and", conditions: [newCondition()] };
}

// ─── FieldSelector button ─────────────────────────────────────────────────────

function FieldSelector({
  field, sources, label, onChange,
}: {
  field: VisualMappingField;
  sources: FieldSource[];
  label: string;
  onChange: (f: VisualMappingField) => void;
}) {
  const [open, setOpen] = useState(false);
  const display = field.previewLabel ?? `${field.sourceId} → ${field.path}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 min-w-0 max-w-[160px] items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11.5px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
      >
        <span className="truncate">{display}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <FieldPicker
          targetLabel={label}
          sources={sources}
          current={field}
          onConfirm={m => {
            if (m.type === "field") onChange(m);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─── Single condition row ─────────────────────────────────────────────────────

function ConditionRow({
  condition, sources, onChange, onRemove,
}: {
  condition: VisualCondition;
  sources: FieldSource[];
  onChange: (c: VisualCondition) => void;
  onRemove: () => void;
}) {
  const needsRight = NEEDS_RIGHT_VALUE.includes(condition.operator);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Left field */}
      <FieldSelector
        field={condition.left}
        sources={sources}
        label="Left side"
        onChange={left => onChange({ ...condition, left })}
      />

      {/* Operator */}
      <AppSelect
        className="h-7 w-[150px] text-[11.5px]"
        value={condition.operator}
        onValueChange={(v) => onChange({ ...condition, operator: v as ConditionOperator })}
        options={(Object.entries(OPERATOR_LABELS) as [ConditionOperator, string][]).map(([op, label]) => ({ value: op, label }))}
      />

      {/* Right value */}
      {needsRight && (
        <input
          value={String(condition.rightLiteral ?? "")}
          onChange={e => onChange({ ...condition, rightLiteral: e.target.value })}
          placeholder="value"
          className="h-7 w-24 rounded-lg border border-slate-200 bg-white px-2 text-[11.5px] outline-none focus:border-[#9CCFBB] focus:ring-2 focus:ring-[#E6F4EF]"
        />
      )}

      {/* Delete */}
      <button
        type="button"
        onClick={onRemove}
        className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-red-200 hover:text-red-500 transition-colors flex items-center justify-center"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Condition group (recursive for AND/OR) ───────────────────────────────────

function ConditionGroupEditor({
  group, sources, onChange, depth = 0,
}: {
  group: VisualConditionGroup;
  sources: FieldSource[];
  onChange: (g: VisualConditionGroup) => void;
  depth?: number;
}) {
  function updateCondition(idx: number, updated: VisualCondition | VisualConditionGroup) {
    const conditions = [...group.conditions];
    conditions[idx] = updated;
    onChange({ ...group, conditions });
  }
  function removeCondition(idx: number) {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== idx) });
  }
  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, newCondition()] });
  }

  return (
    <div
      className={cn("space-y-2 rounded-xl p-3", depth > 0 && "border border-slate-200 bg-slate-50/50")}
    >
      {group.conditions.map((c, idx) => (
        <div key={"id" in c ? c.id : idx}>
          {idx > 0 && (
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-slate-200" />
              <button
                type="button"
                onClick={() => onChange({ ...group, logic: group.logic === "and" ? "or" : "and" })}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-100 transition-colors"
              >
                {group.logic}
              </button>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          )}
          {"conditions" in c ? (
            <ConditionGroupEditor
              group={c as VisualConditionGroup}
              sources={sources}
              onChange={g => updateCondition(idx, g)}
              depth={depth + 1}
            />
          ) : (
            <ConditionRow
              condition={c as VisualCondition}
              sources={sources}
              onChange={u => updateCondition(idx, u)}
              onRemove={() => removeCondition(idx)}
            />
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addCondition}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 text-[11.5px] font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors"
      >
        <Plus className="h-3 w-3" />
        Add condition
      </button>
    </div>
  );
}

// ─── Main ConditionBuilder ────────────────────────────────────────────────────

interface ConditionBuilderProps {
  group: VisualConditionGroup;
  sources: FieldSource[];
  onChange: (g: VisualConditionGroup) => void;
}

export function ConditionBuilder({ group, sources, onChange }: ConditionBuilderProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p style={{ fontSize: 12, fontWeight: 700, color: "#334155", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Conditions
        </p>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11.5, color: "#64748B" }}>All conditions joined by:</span>
          <button
            type="button"
            onClick={() => onChange({ ...group, logic: group.logic === "and" ? "or" : "and" })}
            className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11.5px] font-bold uppercase text-blue-600 hover:bg-blue-50 transition-colors"
          >
            {group.logic.toUpperCase()}
          </button>
        </div>
      </div>
      <ConditionGroupEditor group={group} sources={sources} onChange={onChange} />
    </div>
  );
}
