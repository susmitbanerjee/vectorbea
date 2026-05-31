"use client";

import { useState } from "react";
import { ArrowRight, Link2, Link2Off, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeInputField, VisualMapping, FieldType, FieldSource } from "@/types/workflow-mapping";
import { FieldPicker } from "./FieldPicker";
import { compileMapping } from "@/lib/workflows/mapping-compiler";

// ─── Type chip ────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  string: "#2563EB", number: "#059669", boolean: "#D97706",
  array: "#7C3AED", object: "#0891B2", any: "#94A3B8",
};
function TypeChip({ type }: { type: FieldType }) {
  return (
    <span className="rounded px-1 py-px font-mono" style={{
      fontSize: 9, fontWeight: 700,
      background: `${TYPE_COLOR[type] ?? "#94A3B8"}18`,
      color: TYPE_COLOR[type] ?? "#94A3B8",
    }}>
      {type}
    </span>
  );
}

// ─── Mapping summary ──────────────────────────────────────────────────────────

function MappingSummary({ mapping, previewValue }: { mapping: VisualMapping; previewValue?: unknown }) {
  if (mapping.type === "unset" || mapping.type === "literal" && !mapping.value) {
    return <span style={{ fontSize: 11.5, color: "#94A3B8", fontStyle: "italic" }}>Not mapped</span>;
  }
  if (mapping.type === "literal") {
    return (
      <span style={{ fontSize: 11.5, color: "#059669" }}>
        Literal: <code className="font-mono">{JSON.stringify(mapping.value)}</code>
      </span>
    );
  }
  if (mapping.type === "expression") {
    return (
      <code className="font-mono" style={{ fontSize: 10.5, color: "#7C3AED" }}>
        {mapping.expression.slice(0, 60)}{mapping.expression.length > 60 ? "…" : ""}
      </code>
    );
  }
  if (mapping.type === "field") {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span style={{ fontSize: 11.5, color: "#334155" }}>{mapping.previewLabel ?? `${mapping.sourceId} → ${mapping.path}`}</span>
        {previewValue !== undefined && (
          <span
            className="rounded-md border font-mono"
            style={{ fontSize: 10, padding: "1px 5px", background: "#F8FAFC", borderColor: "#E2E8F0", color: "#64748B" }}
          >
            {typeof previewValue === "object" ? JSON.stringify(previewValue).slice(0, 30) : String(previewValue)}
          </span>
        )}
      </div>
    );
  }
  if (mapping.type === "transform") {
    return (
      <div className="flex items-center gap-1.5">
        <span style={{ fontSize: 11.5, color: "#334155" }}>{mapping.source.previewLabel ?? mapping.source.path}</span>
        <ArrowRight className="h-3 w-3 text-slate-400" />
        <span style={{ fontSize: 11, color: "#7C3AED", fontWeight: 600 }}>{mapping.transform}</span>
      </div>
    );
  }
  return <span style={{ fontSize: 11.5, color: "#64748B" }}>Custom mapping</span>;
}

// ─── InputMappingRow ──────────────────────────────────────────────────────────

interface InputMappingRowProps {
  field: NodeInputField;
  sources: FieldSource[];
  onChange: (key: string, mapping: VisualMapping) => void;
}

export function InputMappingRow({ field, sources, onChange }: InputMappingRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const isMapped = field.mapping.type !== "unset";
  const hasIssue = field.validationStatus &&
    field.validationStatus !== "ok" && field.validationStatus !== "no_sample";
  const isWarning = field.validationStatus === "no_sample" ||
    field.validationStatus === "type_conversion_needed";

  return (
    <>
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
          hasIssue ? "border-red-200 bg-red-50/40" :
          isWarning ? "border-amber-200 bg-amber-50/30" :
          isMapped ? "border-emerald-200 bg-emerald-50/20" : "border-slate-200 bg-white",
        )}
      >
        {/* Status dot */}
        <div className="mt-1 shrink-0">
          {isMapped
            ? <div className="h-2 w-2 rounded-full bg-emerald-500" />
            : field.required
            ? <div className="h-2 w-2 rounded-full bg-amber-400" />
            : <div className="h-2 w-2 rounded-full bg-slate-200" />
          }
        </div>

        {/* Field info */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{field.label}</span>
            {field.required && (
              <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-px" style={{ fontSize: 9, fontWeight: 700, color: "#DC2626", letterSpacing: "0.05em" }}>
                REQUIRED
              </span>
            )}
            <TypeChip type={field.type} />
            {hasIssue && <AlertTriangle className="h-3 w-3 text-red-500" />}
          </div>
          {field.description && (
            <p style={{ fontSize: 11.5, color: "#64748B" }}>{field.description}</p>
          )}
          <MappingSummary mapping={field.mapping} previewValue={field.previewValue} />
        </div>

        {/* Map button */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors",
            isMapped
              ? "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
          )}
        >
          {isMapped ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
          {isMapped ? "Change" : "Map"}
        </button>
      </div>

      {pickerOpen && (
        <FieldPicker
          targetLabel={field.label}
          targetType={field.type}
          sources={sources}
          current={field.mapping}
          onConfirm={mapping => { onChange(field.key, mapping); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
