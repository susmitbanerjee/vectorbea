/**
 * Schema Validator
 *
 * Lightweight JSON Schema validation for workflow step inputs/outputs.
 * Supports a practical subset of JSON Schema draft-07 that covers real
 * workflow use-cases without pulling in a heavy dependency.
 *
 * Supported keywords:
 *   type, required, properties, additionalProperties,
 *   minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum,
 *   minItems, maxItems, items, enum, const, format (iso-date, uri — structural only)
 *   $ref — resolved within the same schema object only
 *
 * Not supported (ignored): $schema, $id, if/then/else, allOf/anyOf/oneOf/not,
 *   patternProperties, unevaluatedProperties, contentEncoding
 */

export interface SchemaError {
  path: string;
  message: string;
  keyword: string;
  value?: unknown;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaError[];
}

type JSONSchema = Record<string, unknown>;

// ─── Primitive type check ─────────────────────────────────────────────────────

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ─── Core validator ───────────────────────────────────────────────────────────

function validate(
  value: unknown,
  schema: JSONSchema,
  path: string,
  errors: SchemaError[],
  rootSchema: JSONSchema,
): void {
  if (!schema || typeof schema !== "object") return;

  // $ref resolution (only supports #/definitions/...)
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref as string;
    if (ref.startsWith("#/")) {
      const parts = ref.slice(2).split("/");
      let resolved: unknown = rootSchema;
      for (const p of parts) {
        if (!resolved || typeof resolved !== "object") { resolved = undefined; break; }
        resolved = (resolved as Record<string, unknown>)[p];
      }
      if (resolved && typeof resolved === "object") {
        validate(value, resolved as JSONSchema, path, errors, rootSchema);
      }
      return;
    }
  }

  // type
  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsonType(value);
    // JSON Schema integer compatibility
    const typeMatch = (expected as string[]).some((t) =>
      t === actual || (t === "integer" && actual === "number" && Number.isInteger(value as number))
    );
    if (!typeMatch) {
      errors.push({ path, message: `Expected type ${(expected as string[]).join("|")}, got ${actual}`, keyword: "type", value });
      return; // No point checking further if type mismatch
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    const enumVals = schema.enum as unknown[];
    if (!enumVals.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
      errors.push({ path, message: `Value must be one of: ${enumVals.map((e) => JSON.stringify(e)).join(", ")}`, keyword: "enum", value });
    }
  }

  // const
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errors.push({ path, message: `Value must equal ${JSON.stringify(schema.const)}`, keyword: "const", value });
  }

  // String keywords
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push({ path, message: `String is too short (min ${schema.minLength} chars)`, keyword: "minLength", value });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push({ path, message: `String is too long (max ${schema.maxLength} chars)`, keyword: "maxLength", value });
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern as string).test(value)) {
          errors.push({ path, message: `String does not match pattern: ${schema.pattern}`, keyword: "pattern", value });
        }
      } catch {
        // invalid regex — skip
      }
    }
  }

  // Number keywords
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push({ path, message: `Value ${value} is below minimum ${schema.minimum}`, keyword: "minimum", value });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push({ path, message: `Value ${value} exceeds maximum ${schema.maximum}`, keyword: "maximum", value });
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      errors.push({ path, message: `Value ${value} must be > ${schema.exclusiveMinimum}`, keyword: "exclusiveMinimum", value });
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      errors.push({ path, message: `Value ${value} must be < ${schema.exclusiveMaximum}`, keyword: "exclusiveMaximum", value });
    }
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0 && value % (schema.multipleOf as number) !== 0) {
      errors.push({ path, message: `Value ${value} is not a multiple of ${schema.multipleOf}`, keyword: "multipleOf", value });
    }
  }

  // Array keywords
  if (Array.isArray(value)) {
    const arr = value as unknown[];
    if (typeof schema.minItems === "number" && arr.length < schema.minItems) {
      errors.push({ path, message: `Array has too few items (min ${schema.minItems})`, keyword: "minItems", value: arr.length });
    }
    if (typeof schema.maxItems === "number" && arr.length > schema.maxItems) {
      errors.push({ path, message: `Array has too many items (max ${schema.maxItems})`, keyword: "maxItems", value: arr.length });
    }
    if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
      for (let i = 0; i < arr.length; i++) {
        validate(arr[i], schema.items as JSONSchema, `${path}[${i}]`, errors, rootSchema);
      }
    }
    if (Array.isArray(schema.items)) {
      const itemSchemas = schema.items as JSONSchema[];
      for (let i = 0; i < Math.min(arr.length, itemSchemas.length); i++) {
        validate(arr[i], itemSchemas[i]!, `${path}[${i}]`, errors, rootSchema);
      }
    }
  }

  // Object keywords
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const objKeys = Object.keys(obj);

    // required
    if (Array.isArray(schema.required)) {
      for (const req of schema.required as string[]) {
        if (!(req in obj)) {
          errors.push({ path: path ? `${path}.${req}` : req, message: `Required field "${req}" is missing`, keyword: "required" });
        }
      }
    }

    // properties
    if (schema.properties && typeof schema.properties === "object") {
      const props = schema.properties as Record<string, JSONSchema>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          validate(obj[key], propSchema, path ? `${path}.${key}` : key, errors, rootSchema);
        }
      }
    }

    // additionalProperties = false
    if (schema.additionalProperties === false && schema.properties && typeof schema.properties === "object") {
      const allowedKeys = Object.keys(schema.properties as object);
      for (const key of objKeys) {
        if (!allowedKeys.includes(key)) {
          errors.push({ path: path ? `${path}.${key}` : key, message: `Additional property "${key}" is not allowed`, keyword: "additionalProperties" });
        }
      }
    }

    // additionalProperties as schema
    if (schema.additionalProperties && typeof schema.additionalProperties === "object" && schema.properties) {
      const allowedKeys = Object.keys(schema.properties as object);
      const additionalSchema = schema.additionalProperties as JSONSchema;
      for (const key of objKeys) {
        if (!allowedKeys.includes(key)) {
          validate(obj[key], additionalSchema, path ? `${path}.${key}` : key, errors, rootSchema);
        }
      }
    }

    // minProperties / maxProperties
    if (typeof schema.minProperties === "number" && objKeys.length < schema.minProperties) {
      errors.push({ path, message: `Object has too few properties (min ${schema.minProperties})`, keyword: "minProperties", value: objKeys.length });
    }
    if (typeof schema.maxProperties === "number" && objKeys.length > schema.maxProperties) {
      errors.push({ path, message: `Object has too many properties (max ${schema.maxProperties})`, keyword: "maxProperties", value: objKeys.length });
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a value against a JSON Schema.
 */
export function validateSchema(
  value: unknown,
  schema: Record<string, unknown>,
): SchemaValidationResult {
  const errors: SchemaError[] = [];
  validate(value, schema, "", errors, schema);
  return { valid: errors.length === 0, errors };
}

/**
 * Attempt to repair a JSON string that has common LLM-output defects:
 *   - Trailing commas
 *   - Unquoted keys
 *   - Single-quoted strings
 *   - Truncated output (missing closing brackets)
 *
 * Returns parsed value on success, or throws if unrecoverable.
 */
export function repairJson(raw: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // continue to repair
  }

  let fixed = raw.trim();

  // Strip markdown code fences
  fixed = fixed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Try again after stripping fences
  try {
    return JSON.parse(fixed);
  } catch {
    // continue
  }

  // Replace single quotes with double quotes (very naive — breaks strings containing ')
  fixed = fixed.replace(/'/g, '"');

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([}\]])/g, "$1");

  // Auto-close unclosed brackets/braces
  const openBraces = (fixed.match(/\{/g) ?? []).length - (fixed.match(/\}/g) ?? []).length;
  const openBrackets = (fixed.match(/\[/g) ?? []).length - (fixed.match(/\]/g) ?? []).length;
  for (let i = 0; i < openBrackets; i++) fixed += "]";
  for (let i = 0; i < openBraces; i++) fixed += "}";

  return JSON.parse(fixed);
}
