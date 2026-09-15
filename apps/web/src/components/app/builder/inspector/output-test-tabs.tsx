"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { useBuilderRegistry, resolveTool } from "../use-builder-registry";
import {
  stepOutputs, consumersOf, readOutputFields, cleanFieldName, humanize,
  VALUE_KIND_LABEL, OUTPUT_FIELD_TYPES,
  type Consumer, type OutputFieldDef, type OutputFieldType,
} from "../step-io";
import type { BuilderNode } from "~/lib/workflows/builder-graph";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   OUTPUT — what later steps can use from this one.

   A list of named fields and which later steps read each one. It used to show a
   JSON "sample from the last run" that was a fixture — the same invented
   decision/reason for every agent — and a Test tab that simulated a call with a
   timer. Both are gone.

   For an agent step the fields are EDITABLE here, because this is where the
   need is noticed: building the step after it and finding nothing to pick. Each
   field is sent to the agent as part of its task (`AgentNodeExecutor`), so what
   is listed is what arrives.
══════════════════════════════════════════════════════════════════════════════ */

export function OutputTab({
  node, nodes, onFieldsChange,
}: {
  node: VersionNode;
  nodes: BuilderNode[];
  onFieldsChange: (fields: OutputFieldDef[]) => void;
}) {
  const registry = useBuilderRegistry();
  const fields = React.useMemo(() => stepOutputs(node, registry), [node, registry]);
  const consumers = React.useMemo(() => consumersOf(node.id, nodes), [node.id, nodes]);

  const byPath = new Map<string, Consumer[]>();
  for (const c of consumers) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);

  if (node.kind === "agent") {
    return <AgentFields node={node} byPath={byPath} onChange={onFieldsChange} />;
  }

  const tool = node.kind === "tool" ? resolveTool(node.config, registry) : null;
  if (fields.length === 0) {
    return (
      <div className="p-3">
        <Text variant="body-sm" tone="secondary" className="block">
          {node.kind === "tool" && !tool ? "Pick a tool on Configure first."
            : node.kind === "tool" ? "This tool doesn't describe what it returns, so later steps can't pick fields from it."
              : "Later steps don't read anything from this step."}
        </Text>
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-3">
      <Text variant="caption" tone="muted" className="block">Later steps can use these on their Inputs tab.</Text>
      <ul className="border-subtle divide-subtle divide-y rounded-md border">
        {fields.map((field) => (
          <li key={field.path} className="grid gap-0.5 px-2.5 py-2">
            <div className="flex items-baseline gap-2">
              <Text variant="body-sm" tone="primary" className="min-w-0 flex-1 truncate font-medium">{field.label}</Text>
              <Text variant="caption" tone="disabled" className="shrink-0">{VALUE_KIND_LABEL[field.kind]}</Text>
            </div>
            {field.help ? <Text variant="caption" tone="muted" className="line-clamp-2 block leading-snug">{field.help}</Text> : null}
            <UsedBy readers={byPath.get(field.path)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── An agent step's fields ───────────────────────────────────────────────── */

function AgentFields({
  node, byPath, onChange,
}: {
  node: VersionNode;
  byPath: Map<string, Consumer[]>;
  onChange: (fields: OutputFieldDef[]) => void;
}) {
  const fields = readOutputFields(node.config);

  const update = (index: number, patch: Partial<OutputFieldDef>) =>
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const remove = (index: number) => onChange(fields.filter((_, i) => i !== index));
  const add = () => onChange([...fields, { name: "", type: "string" }]);

  const names = fields.map((f) => f.name);

  return (
    <div className="grid gap-3 p-3">
      <Text variant="caption" tone="muted" className="block leading-snug">
        Name the values this agent should return. Later steps pick them on their Inputs tab.
      </Text>

      <ul className="grid gap-2">
        {fields.map((field, index) => {
          const duplicate = field.name !== "" && names.indexOf(field.name) !== index;
          const readers = byPath.get(field.name);
          return (
            <li key={index} className="border-subtle bg-surface-raised grid gap-1.5 rounded-md border p-2">
              <div className="flex items-center gap-1.5">
                <Input
                  value={field.name}
                  onChange={(e) => update(index, { name: cleanFieldName(e.target.value) })}
                  placeholder="Name, e.g. changeCount"
                  aria-label="Field name"
                  className="h-8 min-w-0 flex-1 text-body-sm"
                />
                <div className="w-28 shrink-0">
                  <Select
                    value={field.type}
                    onValueChange={(v) => update(index, { type: v as OutputFieldType })}
                    options={OUTPUT_FIELD_TYPES}
                    aria-label={`Type of ${field.name || "this field"}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Remove ${field.name || "this field"}`}
                  className={cn(
                    "text-fg-disabled hover:text-status-failed grid size-6 shrink-0 place-items-center rounded-xs",
                    "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  )}
                >
                  <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
                    <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <Input
                value={field.description ?? ""}
                onChange={(e) => update(index, { description: e.target.value || undefined })}
                placeholder="What it holds (helps the agent fill it in)"
                aria-label={`Description of ${field.name || "this field"}`}
                className="h-8 text-body-sm"
              />
              {duplicate ? (
                <Text variant="caption" tone="inherit" className="text-status-failed">Another field already has this name.</Text>
              ) : null}
              <UsedBy readers={readers} />
            </li>
          );
        })}

        <li className="border-subtle rounded-md border border-dashed px-2.5 py-2">
          <div className="flex items-baseline gap-2">
            <Text variant="body-sm" tone="primary" className="min-w-0 flex-1 font-medium">Full reply</Text>
            <Text variant="caption" tone="disabled">Always included</Text>
          </div>
          <Text variant="caption" tone="muted" className="block">Everything the agent wrote.</Text>
          <UsedBy readers={byPath.get("content")} />
        </li>
      </ul>

      <div>
        <Button size="xs" variant="secondary" onClick={add}>Add a field</Button>
      </div>
    </div>
  );
}

function UsedBy({ readers }: { readers: Consumer[] | undefined }) {
  if (!readers || readers.length === 0) return null;
  return (
    <Text variant="caption" tone="secondary" className="block">
      Used by {[...new Set(readers.map((r) => `${r.nodeName} (${humanize(r.inputId)})`))].join(", ")}
    </Text>
  );
}
