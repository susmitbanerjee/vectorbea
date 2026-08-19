import type { contracts } from "@vectorbea/shared";

/**
 * Shaping `workflow_node_debug_snapshots` into what the Inputs tab renders.
 *
 * The snapshot is per-node and field-oriented; the inspector is field-oriented
 * too, but it needs the template and the resolved value and the provenance
 * side by side, per field, with the unresolved fields visible rather than
 * omitted. This module does that join once so the component stays presentational.
 *
 * The rule throughout: an absent value is shown as absent. A field whose
 * expression did not resolve is the single most useful thing on this screen —
 * it is why the node failed — and dropping it because it has no value would
 * hide exactly the row the user came to find.
 */

export type VariableSource = contracts.VariableSource;
export type NodeDebugDetail = contracts.NodeDebugDetail;

export interface ResolvedField {
  field: string;
  /** The raw template, e.g. `Hello {{steps.fetch.name}}`. Null if not templated. */
  template: string | null;
  /** The value after interpolation. `undefined` when the field never resolved. */
  resolved: unknown;
  /** True when the field has no resolved value — the interesting case. */
  missing: boolean;
  /**
   * Expressions contributing to this field.
   *
   * More than one when a field interpolates several, e.g.
   * `{{a.x}}-{{b.y}}`. Each carries its own guessed source node.
   */
  sources: VariableSource[];
  /** True when the field is a literal with no `{{…}}` in it. */
  literal: boolean;
}

function asTemplateString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  // Non-string templates (numbers, nested objects) are shown as JSON so the
  // inspector never renders "[object Object]".
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Join template, resolved value and provenance into one row per field.
 *
 * Field order follows `inputTemplate`, which is the order the node declares —
 * stable across runs, unlike the order `variableSources` happens to be built in.
 * Fields present only in `resolvedInput` are appended, so a value the runtime
 * produced without a declared template still appears.
 */
export function toResolvedFields(snapshot: NodeDebugDetail | null | undefined): ResolvedField[] {
  if (!snapshot) return [];

  const template = snapshot.inputTemplate ?? {};
  const resolved = snapshot.resolvedInput ?? {};
  const sources = snapshot.variableSources ?? [];

  const byField = new Map<string, VariableSource[]>();
  for (const source of sources) {
    const existing = byField.get(source.field) ?? [];
    existing.push(source);
    byField.set(source.field, existing);
  }

  const fields = [
    ...Object.keys(template),
    ...Object.keys(resolved).filter((key) => !(key in template)),
  ];

  return fields.map((field) => {
    const raw = asTemplateString(template[field]);
    const fieldSources = byField.get(field) ?? [];
    const hasValue = field in resolved && resolved[field] !== null && resolved[field] !== undefined;

    return {
      field,
      template: raw,
      resolved: hasValue ? resolved[field] : undefined,
      missing: !hasValue,
      sources: fieldSources,
      // A field with no `{{` never had anything to resolve, so it is not
      // "missing" in the interesting sense even when its value is empty.
      literal: fieldSources.length === 0 && !(raw ?? "").includes("{{"),
    };
  });
}

/** Fields whose expressions did not resolve. The reason the tab exists. */
export function unresolvedFields(fields: ResolvedField[]): ResolvedField[] {
  return fields.filter((f) => f.missing && !f.literal);
}

/**
 * Render a resolved value for display.
 *
 * Distinguishes the three empty-ish cases that a naive `String(value)` collapses
 * into indistinguishable blanks — and which mean completely different things
 * when you are working out why a node failed.
 */
export function formatResolvedValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (value === "") return '""';
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
