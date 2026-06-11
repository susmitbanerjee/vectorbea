"use client";

/**
 * InputFieldBuilder — no-JSON editor for a workflow's entry inputs.
 *
 * The trigger node is the only place a user defines input shape. Instead of
 * a JSON-Schema textarea, they add fields by name + type + required. We
 * convert to/from JSON Schema under the hood — the user never sees JSON.
 */

import { useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

type FieldKind = "string" | "number" | "integer" | "boolean" | "object" | "array";

interface Row {
  id: string;
  name: string;
  type: FieldKind;
  required: boolean;
}

const TYPE_OPTIONS: { value: FieldKind; label: string; color: string }[] = [
  { value: "string",  label: "Text",     color: "#2563EB" },
  { value: "number",  label: "Number",   color: "#059669" },
  { value: "integer", label: "Integer",  color: "#059669" },
  { value: "boolean", label: "True/False", color: "#CA8A04" },
  { value: "object",  label: "Object",   color: "#0891B2" },
  { value: "array",   label: "List",     color: "#7C3AED" },
];

function schemaToRows(schema?: Record<string, unknown>): Row[] {
  if (!schema || typeof schema !== "object") return [];
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, def]) => ({
    id: crypto.randomUUID(),
    name,
    type: (def?.type as FieldKind) ?? "string",
    required: required.has(name),
  }));
}

function rowsToSchema(rows: Row[]): Record<string, unknown> | undefined {
  const valid = rows.filter((r) => r.name.trim());
  if (valid.length === 0) return undefined;
  const properties: Record<string, { type: string }> = {};
  const required: string[] = [];
  for (const r of valid) {
    const key = r.name.trim();
    properties[key] = { type: r.type };
    if (r.required) required.push(key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

export function InputFieldBuilder({
  schema,
  onChange,
}: {
  schema?: Record<string, unknown>;
  onChange: (schema: Record<string, unknown> | undefined) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => schemaToRows(schema));

  function commit(next: Row[]) {
    setRows(next);
    onChange(rowsToSchema(next));
  }
  const update = (id: string, patch: Partial<Row>) => commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => commit(rows.filter((r) => r.id !== id));
  const add = () => commit([...rows, { id: crypto.randomUUID(), name: "", type: "string", required: false }]);

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#D7DBE0] bg-[#FAFBFB] px-3 py-4 text-center">
          <p className="text-[12px] text-[#6B7280]">No inputs yet — this workflow runs with no parameters.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-1.5 rounded-[9px] border border-[#E0E3E6] bg-white px-2 py-1.5">
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-[#C9CED4]" />
              <input
                value={r.name}
                onChange={(e) => update(r.id, { name: e.target.value.replace(/\s+/g, "_") })}
                placeholder="field_name"
                className="h-8 min-w-0 flex-1 rounded-[6px] border border-[#E0E3E6] bg-white px-2 font-mono text-[12.5px] text-[#0B0D0F] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[#9CCFBB] focus:ring-2 focus:ring-[#E6F4EF]"
              />
              <select
                value={r.type}
                onChange={(e) => update(r.id, { type: e.target.value as FieldKind })}
                className="h-8 shrink-0 rounded-[6px] border border-[#E0E3E6] bg-white px-1.5 text-[12px] text-[#4B5563] outline-none focus:border-[#9CCFBB]"
              >
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => update(r.id, { required: !r.required })}
                title="Required"
                className={cn(
                  "h-8 shrink-0 rounded-[6px] border px-2 text-[11px] font-semibold transition-colors",
                  r.required ? "border-[#9CCFBB] bg-[#E6F4EF] text-[#006B45]" : "border-[#E0E3E6] bg-white text-[#9CA3AF] hover:bg-[#F3F4F5]",
                )}
              >
                req
              </button>
              <button type="button" onClick={() => remove(r.id)} title="Remove" className="flex h-8 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#9CA3AF] transition-colors hover:bg-[#FEF2F2] hover:text-[#DC2626]">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={add}
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-dashed border-[#C9CED4] bg-white px-3 text-[12px] font-semibold text-[#4B5563] transition-colors hover:border-[#9CCFBB] hover:bg-[#E6F4EF] hover:text-[#006B45]"
      >
        <Plus className="h-3.5 w-3.5" /> Add input field
      </button>
    </div>
  );
}
