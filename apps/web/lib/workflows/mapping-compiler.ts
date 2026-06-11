/**
 * Mapping Compiler — converts visual mappings to Kotlin worker runtime expressions.
 *
 * Visual mappings are human-friendly. Runtime expressions use the
 * {{ steps.nodeId.output.path }} syntax the worker understands.
 * This compiler is the bridge between the two worlds.
 */

import type {
  VisualMapping, VisualMappingField, VisualMappingTransform,
  VisualMappingTemplate, VisualMappingObjectBuilder,
  VisualConditionGroup, VisualCondition,
  TransformType,
} from "@/types/workflow-mapping";

// ─── Expression compiler ──────────────────────────────────────────────────────

/** Compile a single VisualMapping to a runtime template expression. */
export function compileMapping(mapping: VisualMapping): string {
  switch (mapping.type) {
    case "unset":
      return "";

    case "literal":
      if (typeof mapping.value === "string") return mapping.value;
      return JSON.stringify(mapping.value);

    case "expression":
      return mapping.expression;

    case "field":
      return compileFieldRef(mapping);

    case "transform":
      return compileTransform(mapping);

    case "template":
      return compileTemplate(mapping);

    case "object_builder":
      return compileObjectBuilder(mapping);
  }
}

function compileFieldRef(m: VisualMappingField): string {
  if (m.sourceId === "workflow_input") {
    return `{{ input.${m.path} }}`;
  }
  if (m.sourceId === "run_metadata") {
    return `{{ run.${m.path} }}`;
  }
  // Node reference: {{ steps.nodeId.output.path }}
  return `{{ steps.${m.sourceId}.output.${m.path} }}`;
}

function compileTransform(m: VisualMappingTransform): string {
  const source = compileFieldRef(m.source);
  switch (m.transform as TransformType) {
    case "as_is":             return source;
    case "to_string":         return `{{ string(${stripBraces(source)}) }}`;
    case "to_number":         return `{{ number(${stripBraces(source)}) }}`;
    case "to_boolean":        return `{{ boolean(${stripBraces(source)}) }}`;
    case "first_item":        return `{{ ${stripBraces(source)}[0] }}`;
    case "last_item":         return `{{ last(${stripBraces(source)}) }}`;
    case "count":             return `{{ count(${stripBraces(source)}) }}`;
    case "join":              return `{{ join(${stripBraces(source)}, "${m.param ?? ", "}") }}`;
    case "wrap_in_array":     return `{{ [${stripBraces(source)}] }}`;
    case "lowercase":         return `{{ lowercase(${stripBraces(source)}) }}`;
    case "uppercase":         return `{{ uppercase(${stripBraces(source)}) }}`;
    case "trim":              return `{{ trim(${stripBraces(source)}) }}`;
    case "extract_field":     return `{{ ${stripBraces(source)}.${m.param ?? "value"} }}`;
    case "default_if_missing":return `{{ ${stripBraces(source)} ?? "${m.param ?? ""}" }}`;
    default:                  return source;
  }
}

function compileTemplate(m: VisualMappingTemplate): string {
  // Replace {sourceId.path} placeholders with runtime expressions
  let result = m.template;
  for (const ref of m.refs) {
    const placeholder = `{${ref.sourceId}.${ref.path}}`;
    const expr = stripBraces(compileFieldRef(ref));
    result = result.replace(placeholder, `{{ ${expr} }}`);
  }
  return result;
}

function compileObjectBuilder(m: VisualMappingObjectBuilder): string {
  const entries = m.fields.map(({ key, mapping }) => {
    const val = compileMapping(mapping);
    return `"${key}": ${JSON.stringify(val)}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function stripBraces(expr: string): string {
  return expr.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
}

// ─── Input mapping compilation ────────────────────────────────────────────────

/**
 * Compile visual input mappings to the { key: expression } map the worker expects.
 * Returns null entries for unset mappings.
 */
export function compileInputMappings(
  visualMappings: Record<string, VisualMapping>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, mapping] of Object.entries(visualMappings)) {
    const compiled = compileMapping(mapping);
    if (compiled) result[key] = compiled;
  }
  return result;
}

// ─── Condition compiler ───────────────────────────────────────────────────────

/**
 * Compile a VisualConditionGroup to a runtime condition expression string
 * that the branch executor can evaluate.
 */
export function compileConditionGroup(group: VisualConditionGroup): string {
  const parts = group.conditions.map(c => {
    if ("conditions" in c) return `(${compileConditionGroup(c)})`;
    return compileCondition(c as VisualCondition);
  });
  return parts.join(` ${group.logic.toUpperCase()} `);
}

function compileCondition(c: VisualCondition): string {
  const left = stripBraces(compileFieldRef(c.left));

  const right = c.rightField
    ? stripBraces(compileFieldRef(c.rightField))
    : JSON.stringify(c.rightLiteral ?? "");

  switch (c.operator) {
    case "equals":           return `{{ ${left} == ${right} }}`;
    case "not_equals":       return `{{ ${left} != ${right} }}`;
    case "gt":               return `{{ ${left} > ${right} }}`;
    case "gte":              return `{{ ${left} >= ${right} }}`;
    case "lt":               return `{{ ${left} < ${right} }}`;
    case "lte":              return `{{ ${left} <= ${right} }}`;
    case "contains":         return `{{ contains(${left}, ${right}) }}`;
    case "not_contains":     return `{{ !contains(${left}, ${right}) }}`;
    case "starts_with":      return `{{ startsWith(${left}, ${right}) }}`;
    case "ends_with":        return `{{ endsWith(${left}, ${right}) }}`;
    case "exists":           return `{{ ${left} != null }}`;
    case "not_exists":       return `{{ ${left} == null }}`;
    case "is_empty":         return `{{ empty(${left}) }}`;
    case "is_not_empty":     return `{{ !empty(${left}) }}`;
    case "is_true":          return `{{ ${left} == true }}`;
    case "is_false":         return `{{ ${left} == false }}`;
    case "array_length_gt":  return `{{ count(${left}) > ${right} }}`;
    case "array_length_gte": return `{{ count(${left}) >= ${right} }}`;
    case "array_contains":   return `{{ contains(${left}, ${right}) }}`;
    default:                 return `{{ ${left} }}`;
  }
}

// ─── Output extraction compiler ───────────────────────────────────────────────

/**
 * Convert a visual output extraction selection (field path) to an
 * OutputExtractionConfig for HTTP/DB/LLM nodes.
 */
export function compileOutputExtraction(
  mode: "full_response" | "body" | "field" | "custom",
  selectedPath?: string,
  fieldMappings?: Record<string, string>,
) {
  if (mode === "full_response") return { mode: "full_response" as const };
  if (mode === "body") return { mode: "body" as const };
  if (mode === "field" && selectedPath) {
    return { mode: "json_path" as const, jsonPath: `$.${selectedPath}`, outputKey: selectedPath.split(".").pop() ?? "result" };
  }
  if (mode === "custom" && fieldMappings) {
    return { mode: "custom_mapping" as const, fieldMappings };
  }
  return { mode: "full_response" as const };
}

// ─── Round-trip: parse existing expression back to VisualMapping ──────────────

/**
 * Parse an existing runtime expression back to a VisualMapping.
 * Used when loading existing workflow data into the visual mapper.
 */
export function decompileExpression(expr: string): VisualMapping {
  if (!expr) return { type: "unset" };
  if (typeof expr !== "string") return { type: "literal", value: String(expr) };

  // {{ input.path }}
  const inputMatch = expr.match(/^\{\{\s*input\.(.+?)\s*\}\}$/);
  if (inputMatch) return { type: "field", sourceId: "workflow_input", path: inputMatch[1] };

  // {{ steps.nodeId.output.path }}
  const stepMatch = expr.match(/^\{\{\s*steps\.([^.]+)\.output\.(.+?)\s*\}\}$/);
  if (stepMatch) return { type: "field", sourceId: stepMatch[1], path: stepMatch[2] };

  // Contains {{ }} — treat as raw expression
  if (expr.includes("{{")) return { type: "expression", expression: expr };

  // Plain literal
  return { type: "literal", value: expr };
}
