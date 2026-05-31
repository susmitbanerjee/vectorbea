/**
 * Vectorbea Visual Mapping System
 *
 * Data contract model for the user-friendly no-code mapping experience.
 * Users work with NodeInputField / NodeOutputField / VisualMapping.
 * At save time, compileVisualMappings() converts these to runtime expressions.
 */

// ─── Field types ──────────────────────────────────────────────────────────────

export type FieldType =
  | "string" | "number" | "boolean" | "object" | "array"
  | "date" | "datetime" | "uuid" | "null" | "any" | "unknown";

// ─── Output field tree ────────────────────────────────────────────────────────

export interface NodeOutputField {
  /** Dot-notation path from the node output root, e.g. "customer.id" */
  path: string;
  /** Human label, e.g. "Customer ID" */
  label: string;
  type: FieldType;
  description?: string;
  example?: string;
  /** Actual sample value from last test/run */
  sampleValue?: unknown;
  nullable?: boolean;
  /** Nested child fields (for objects/arrays) */
  children?: NodeOutputField[];
  /** True if this is an array item descriptor */
  isArrayItem?: boolean;
}

// ─── Available source (upstream node output group) ────────────────────────────

export interface FieldSource {
  /** "workflow_input" | "run_metadata" | node ID like "n1003" */
  sourceId: string;
  /** Human-readable name, e.g. "Fetch Customer Data" or "Workflow Input" */
  label: string;
  /** Icon hint */
  nodeType?: string;
  fields: NodeOutputField[];
  /** True if this is the built-in workflow input */
  isWorkflowInput?: boolean;
}

// ─── Visual mapping (what the UI stores) ─────────────────────────────────────

export type VisualMappingType =
  | "field"          // reference to a specific upstream field
  | "literal"        // hard-coded literal value
  | "expression"     // advanced raw expression ({{ ... }})
  | "transform"      // source field + transform applied
  | "template"       // string template with inserted field refs
  | "object_builder" // build an object from multiple source fields
  | "unset";         // explicitly no mapping

export interface VisualMappingField {
  type: "field";
  /** Source ID (node ID or "workflow_input") */
  sourceId: string;
  /** Dot-notation path within that source */
  path: string;
  /** Pre-resolved preview (from sample data) */
  previewValue?: unknown;
  previewLabel?: string;   // "Workflow Input → Customer ID"
}

export interface VisualMappingLiteral {
  type: "literal";
  value: string | number | boolean | null;
}

export interface VisualMappingExpression {
  type: "expression";
  /** Raw {{ ... }} expression */
  expression: string;
}

export interface VisualMappingTransform {
  type: "transform";
  source: VisualMappingField;
  transform: TransformType;
  /** Extra param for transforms that need it (e.g. index for array, join separator) */
  param?: string | number;
}

export interface VisualMappingTemplate {
  type: "template";
  /** Template string with {sourceId.path} placeholders */
  template: string;
  /** Referenced field sources for resolution */
  refs: VisualMappingField[];
}

export interface VisualMappingObjectBuilder {
  type: "object_builder";
  fields: { key: string; mapping: VisualMapping }[];
}

export interface VisualMappingUnset {
  type: "unset";
}

export type VisualMapping =
  | VisualMappingField
  | VisualMappingLiteral
  | VisualMappingExpression
  | VisualMappingTransform
  | VisualMappingTemplate
  | VisualMappingObjectBuilder
  | VisualMappingUnset;

// ─── Transform options ────────────────────────────────────────────────────────

export type TransformType =
  | "as_is"
  | "to_string"
  | "to_number"
  | "to_boolean"
  | "first_item"
  | "last_item"
  | "count"
  | "join"
  | "wrap_in_array"
  | "extract_field"
  | "default_if_missing"
  | "lowercase"
  | "uppercase"
  | "trim";

export const TRANSFORM_LABELS: Record<TransformType, string> = {
  as_is:             "Use as-is",
  to_string:         "Convert to string",
  to_number:         "Convert to number",
  to_boolean:        "Convert to boolean",
  first_item:        "Pick first item",
  last_item:         "Pick last item",
  count:             "Count items",
  join:              "Join array",
  wrap_in_array:     "Wrap in array",
  extract_field:     "Extract field",
  default_if_missing:"Default if missing",
  lowercase:         "Lowercase",
  uppercase:         "Uppercase",
  trim:              "Trim whitespace",
};

// ─── Input field descriptor ───────────────────────────────────────────────────

export interface NodeInputField {
  /** Programmatic key (matches keys in inputMappingJson) */
  key: string;
  /** Human label */
  label: string;
  type: FieldType;
  required: boolean;
  description?: string;
  example?: string;
  defaultValue?: unknown;
  /** Current visual mapping */
  mapping: VisualMapping;
  /** Validation status after compiling */
  validationStatus?: MappingValidationStatus;
  /** Preview of the resolved value from sample data */
  previewValue?: unknown;
}

// ─── Type compatibility ───────────────────────────────────────────────────────

export type TypeCompatibility =
  | "compatible"
  | "needs_conversion"
  | "incompatible"
  | "unknown";

export function checkTypeCompatibility(source: FieldType, target: FieldType): TypeCompatibility {
  if (target === "any" || source === "any" || target === "unknown" || source === "unknown") return "unknown";
  if (source === target) return "compatible";
  const conversions: Partial<Record<FieldType, FieldType[]>> = {
    string:  ["number", "boolean"],
    number:  ["string"],
    boolean: ["string"],
    array:   [],
    object:  [],
  };
  if (conversions[target]?.includes(source)) return "needs_conversion";
  return "incompatible";
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type MappingValidationStatus =
  | "ok"
  | "missing_required"
  | "future_reference"
  | "unknown_source"
  | "type_incompatible"
  | "type_conversion_needed"
  | "secret_reference"
  | "no_sample";

export interface MappingValidationIssue {
  nodeId: string;
  fieldKey: string;
  status: MappingValidationStatus;
  message: string;
  severity: "error" | "warning";
}

// ─── Condition builder (branch node) ─────────────────────────────────────────

export type ConditionOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "starts_with" | "ends_with"
  | "gt" | "gte" | "lt" | "lte"
  | "exists" | "not_exists"
  | "is_empty" | "is_not_empty"
  | "is_true" | "is_false"
  | "array_length_gt" | "array_length_gte"
  | "array_contains";

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals:          "equals",
  not_equals:      "does not equal",
  contains:        "contains",
  not_contains:    "does not contain",
  starts_with:     "starts with",
  ends_with:       "ends with",
  gt:              "is greater than",
  gte:             "is ≥",
  lt:              "is less than",
  lte:             "is ≤",
  exists:          "exists",
  not_exists:      "does not exist",
  is_empty:        "is empty",
  is_not_empty:    "is not empty",
  is_true:         "is true",
  is_false:        "is false",
  array_length_gt: "array length >",
  array_length_gte:"array length ≥",
  array_contains:  "array contains",
};

export interface VisualCondition {
  id: string;
  left: VisualMappingField;
  operator: ConditionOperator;
  /** Right-hand side — either a literal value or another field */
  rightLiteral?: string | number | boolean;
  rightField?: VisualMappingField;
}

export interface VisualConditionGroup {
  id: string;
  logic: "and" | "or";
  conditions: (VisualCondition | VisualConditionGroup)[];
}
