import type { contracts } from "@vectorbea/shared";
import type { InputDeclaration, FieldType } from "~/mocks/io-schema";
import type { BuilderRegistry, BindableNode } from "../use-builder-registry";
import { stepInputs, type ValueKind } from "../step-io";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT A STEP ASKS FOR

   For every node kind except `tool`, the answer is a property of the kind
   itself — an LLM step takes a prompt and a context, a branch takes a subject —
   and `inputsFor` states it.

   FOR A TOOL STEP IT IS A PROPERTY OF THE TOOL, and that is where the builder
   was inventing things. `inputsFor` matched the node's tool NAME against a
   hard-coded table of six fictional tools (`slack.postMessage`,
   `stripe.getInvoice`, …) and fell back to a single opaque `arguments: object`
   for everything else. Since no real tool has one of those six names, every
   real tool got the fallback: the Inputs tab offered one untyped blob instead
   of the tool's actual parameters, and the operator had to already know the
   shape to bind anything to it.

   A registered tool carries its own `inputSchema` — for database tools the
   guided builder generates it from the columns and filters chosen. Reading the
   declarations off that schema is what makes the Inputs tab describe the tool
   in front of you rather than one that does not exist.
══════════════════════════════════════════════════════════════════════════════ */

/** JSON Schema type → the field type the inspector renders. */
function fieldType(raw: unknown): FieldType {
  const name = Array.isArray(raw)
    // A nullable property is written `["string", "null"]`; the null carries no
    // type information, so the other entry is the answer.
    ? (raw.find((entry) => entry !== "null") ?? "string")
    : raw;
  switch (name) {
    case "string": return "string";
    case "integer":
    case "number": return "number";
    case "boolean": return "boolean";
    case "array": return "array";
    case "object": return "object";
    default: return "any";
  }
}

interface JsonSchemaProperty {
  type?: unknown;
  description?: unknown;
  title?: unknown;
  default?: unknown;
}

/**
 * The declarations a tool's own input schema describes.
 *
 * Returns `null` when the schema says nothing usable, so the caller can fall
 * back rather than render an empty form that looks like the tool takes no
 * arguments.
 */
export function toolInputDeclarations(tool: contracts.Tool): InputDeclaration[] | null {
  const schema = tool.inputSchema as { properties?: unknown; required?: unknown } | null;
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;

  const entries = Object.entries(properties as Record<string, unknown>);
  if (entries.length === 0) return null;

  const required = new Set(
    Array.isArray(schema?.required) ? (schema.required as unknown[]).filter((r): r is string => typeof r === "string") : [],
  );

  return entries.map(([id, raw]) => {
    const property = (raw ?? {}) as JsonSchemaProperty;
    const isRequired = required.has(id);
    const hasDefault = property.default !== undefined;
    return {
      id,
      label: typeof property.title === "string" && property.title ? property.title : id,
      type: fieldType(property.type),
      required: isRequired,
      description:
        typeof property.description === "string" && property.description
          ? property.description
          : `Passed to ${tool.name} as ${id}.`,
      ...(hasDefault ? { defaultValue: property.default } : {}),
      /* A required input with nothing bound must stop the run rather than send
         null into someone else's database. An optional one with a default uses
         it; without a default, null is a legitimate value to pass through. */
      nullPolicy: isRequired ? "fail" : hasDefault ? "use-default" : "pass-null",
    } satisfies InputDeclaration;
  });
}

/**
 * The inputs for any node, in the declaration shape the Configure and Advanced
 * tabs read. A tool's come from its schema; every other step's are the named
 * values its author passes it (see `stepInputs`) — never the per-kind fixture
 * list, which invented a required "Objective" for every agent that no run reads.
 */
export function nodeInputs(node: BindableNode, registry: BuilderRegistry): InputDeclaration[] {
  return stepInputs(node, registry).map((input) => ({
    id: input.id,
    label: input.label,
    type: FIELD_TYPE[input.kind],
    required: input.required,
    description: input.help ?? "",
    nullPolicy: input.required ? "fail" : "pass-null",
  }));
}

const FIELD_TYPE: Record<ValueKind, FieldType> = {
  text: "string", number: "number", boolean: "boolean", list: "array", record: "object", any: "any",
};
