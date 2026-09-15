import type { contracts } from "@vectorbea/shared";
import { operationById } from "~/content/integrations";
import { resolveTool, type BuilderRegistry } from "./use-builder-registry";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT A STEP RECEIVES AND WHAT IT PRODUCES — the model behind Inputs and Output.

   ── THE MAPPING IS STORED WHERE THE WORKER READS IT ─────────────────────────
   The Inputs tab used to keep its bindings in React state beside the canvas.
   Nothing wrote them into the graph, so every mapping a person made vanished on
   reload and never reached a run: `WorkflowGraph.convertNode` reads a node's
   `config.inputMapping`, and that key was never set. Mappings now live in
   `config.inputMapping` as `{ inputName: value }`, where a value is either text
   typed by the author or a reference `{{ steps.<nodeId>.output.<field> }}` —
   the form `MappingResolver` resolves, keyed by node ID so renaming a step does
   not break the steps after it.

   ── FIELDS COME FROM THE REGISTRY, NEVER FROM A FIXTURE ─────────────────────
   The old tree offered `result.decision` and "discount above policy cap" for
   every agent, whatever it was. An agent's fields are its registered output
   schema plus its full reply; a tool's are its output schema. When nothing
   describes a step's output, it is offered as its full result rather than as
   invented field names a run would never produce.
══════════════════════════════════════════════════════════════════════════════ */

export type ValueKind = "text" | "number" | "boolean" | "list" | "record" | "any";

export const VALUE_KIND_LABEL: Record<ValueKind, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes or no",
  list: "List",
  record: "Record",
  any: "Any",
};

export interface StepInput {
  id: string;
  label: string;
  kind: ValueKind;
  required: boolean;
  help: string | null;
  /** Added by the author rather than declared by the tool. Can be renamed or removed. */
  custom: boolean;
}

export interface StepField {
  /** Relative to the step's output: `changes`, `summary.title`. */
  path: string;
  label: string;
  kind: ValueKind;
  help: string | null;
}

export interface SourceStep {
  id: string;
  name: string;
  kind: string;
  /** Hops back. The nearest step is nearly always the one somebody means. */
  distance: number;
  fields: StepField[];
}

export interface StepRef {
  nodeId: string;
  path: string;
}

interface GraphNodeLike { id: string; name: string; kind: string; config: Record<string, unknown> }
interface NodeLike { node: GraphNodeLike }
interface EdgeLike { source: string; target: string }

/** Kinds that take nothing from earlier steps. */
const NO_INPUTS = new Set(["trigger", "checkpoint", "end"]);
/** Kinds whose output is not something a later step reads. */
const NO_OUTPUT = new Set(["checkpoint", "end", "branch", "wait", "merge", "parallel"]);

/* ── Names ────────────────────────────────────────────────────────────────── */

/** `changeCount` → "Change count", `thread_ts` → "Thread ts". */
export function humanize(id: string): string {
  const words = id
    .replace(/\[\d*\]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/** For matching `change_count`, `changeCount` and "Change count" as one name. */
export function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A new input name from a field path: the last segment, as the tool or agent wrote it. */
export function inputNameFor(path: string): string {
  return path.split(".").pop() ?? path;
}

/* ── Schemas ──────────────────────────────────────────────────────────────── */

function kindOf(raw: unknown): ValueKind {
  const name = Array.isArray(raw) ? raw.find((entry) => entry !== "null") : raw;
  switch (name) {
    case "string": return "text";
    case "integer":
    case "number": return "number";
    case "boolean": return "boolean";
    case "array": return "list";
    case "object": return "record";
    default: return "any";
  }
}

interface SchemaProperty { type?: unknown; description?: unknown; title?: unknown; properties?: unknown }

function propertiesOf(schema: unknown): [string, SchemaProperty][] {
  const properties = (schema as { properties?: unknown } | null)?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.entries(properties as Record<string, unknown>).map(([k, v]) => [k, (v ?? {}) as SchemaProperty]);
}

/** Top-level fields, and one level into records — deeper than that nobody picks from a list. */
export function schemaFields(schema: unknown): StepField[] {
  const out: StepField[] = [];
  for (const [id, property] of propertiesOf(schema)) {
    const kind = kindOf(property.type);
    out.push({
      path: id,
      label: typeof property.title === "string" && property.title ? property.title : humanize(id),
      kind,
      help: typeof property.description === "string" && property.description ? property.description : null,
    });
    if (kind === "record") {
      for (const [childId, child] of propertiesOf(property)) {
        out.push({
          path: `${id}.${childId}`,
          label: `${humanize(id)} · ${typeof child.title === "string" && child.title ? child.title : humanize(childId)}`,
          kind: kindOf(child.type),
          help: typeof child.description === "string" && child.description ? child.description : null,
        });
      }
    }
  }
  return out;
}

/* ── Stored mapping ───────────────────────────────────────────────────────── */

export function readInputMapping(config: Record<string, unknown>): Record<string, string> {
  const raw = config.inputMapping ?? config.inputMappings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/** The reference `MappingResolver` resolves. */
export function stepRef(nodeId: string, path: string): string {
  return `{{ steps.${nodeId}.output.${path} }}`;
}

const REF = /^\{\{\s*(?:steps\.)?(.+?)\.output\.(.+?)\s*\}\}$/;

/**
 * The step and field a value refers to, when the whole value is one reference.
 *
 * Accepts the canonical `steps.<id>.output.<field>`, the builder's older
 * `<id>.output.<field>`, and a step NAME in place of the id — which is what the
 * worker also accepts, and what people type by hand.
 */
export function parseStepRef(value: string, nodes: NodeLike[]): StepRef | null {
  const match = REF.exec(value.trim());
  if (!match) return null;
  const [, ref, path] = match;
  const byId = nodes.find((n) => n.node.id === ref);
  const node = byId ?? nodes.find((n) => n.node.name.trim().toLowerCase() === ref.trim().toLowerCase());
  return node ? { nodeId: node.node.id, path } : null;
}

/* ── What a step receives ─────────────────────────────────────────────────── */

/** A tool's declared parameters, labelled the way the tool dialog labelled them. */
function toolInputs(tool: contracts.Tool): StepInput[] | null {
  const schema = tool.inputSchema as { properties?: unknown; required?: unknown } | null;
  const entries = propertiesOf(schema);
  if (entries.length === 0) return null;
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as unknown[]).filter((r): r is string => typeof r === "string") : []);
  const operation = operationById(typeof tool.config?.operationId === "string" ? tool.config.operationId : null);
  return entries.map(([id, property]) => {
    const param = operation?.params.find((p) => p.name === id);
    return {
      id,
      label: param?.label ?? (typeof property.title === "string" && property.title ? property.title : humanize(id)),
      kind: param?.type === "number" ? "number" : param ? "text" : kindOf(property.type),
      required: required.has(id),
      help: param?.help ?? (typeof property.description === "string" && property.description ? property.description : null),
      custom: false,
    };
  });
}

/**
 * The inputs a step takes.
 *
 * A tool declares its own. Every other step takes whatever named values its
 * author passes it — an agent reads them all as its input data — so its inputs
 * ARE its mapping, and none is required.
 */
export function stepInputs(node: Pick<GraphNodeLike, "kind" | "config">, registry: BuilderRegistry): StepInput[] {
  if (NO_INPUTS.has(node.kind)) return [];
  const mapping = readInputMapping(node.config);

  if (node.kind === "tool") {
    const tool = resolveTool(node.config, registry);
    const declared = tool ? toolInputs(tool) : null;
    if (declared) {
      const extra = Object.keys(mapping).filter((key) => !declared.some((d) => d.id === key));
      return [...declared, ...extra.map((id) => customInput(id))];
    }
  }
  return Object.keys(mapping).map((id) => customInput(id));
}

function customInput(id: string): StepInput {
  return { id, label: humanize(id), kind: "any", required: false, help: null, custom: true };
}

/** Whether this step lets its author add named inputs. */
export function takesCustomInputs(node: Pick<GraphNodeLike, "kind">): boolean {
  return !NO_INPUTS.has(node.kind);
}

/* ── What a step produces ─────────────────────────────────────────────────── */

/* ── Fields an agent step is asked to return ──────────────────────────────── */

export type OutputFieldType = "string" | "number" | "boolean" | "array" | "object";

export interface OutputFieldDef {
  name: string;
  type: OutputFieldType;
  description?: string;
}

export const OUTPUT_FIELD_TYPES: { value: OutputFieldType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes or no" },
  { value: "array", label: "List" },
  { value: "object", label: "Record" },
];

const FIELD_KIND: Record<OutputFieldType, ValueKind> = {
  string: "text", number: "number", boolean: "boolean", array: "list", object: "record",
};

/** `config.outputFields`, as `AgentNodeExecutor.stepOutputFields` reads it. */
export function readOutputFields(config: Record<string, unknown>): OutputFieldDef[] {
  const raw = config.outputFields;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    const type = OUTPUT_FIELD_TYPES.some((t) => t.value === e.type) ? (e.type as OutputFieldType) : "string";
    return [{
      name: typeof e.name === "string" ? e.name : "",
      type,
      ...(typeof e.description === "string" && e.description ? { description: e.description } : {}),
    }];
  });
}

/** What the worker accepts as a field name: letters, digits and underscores. */
export function cleanFieldName(value: string): string {
  return value.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "").replace(/^[0-9]+/, "").slice(0, 64);
}

const FULL_REPLY: StepField = {
  path: "content", label: "Full reply", kind: "text",
  help: "Everything the agent wrote.",
};

export function stepOutputs(node: Pick<GraphNodeLike, "kind" | "config">, registry: BuilderRegistry): StepField[] {
  if (NO_OUTPUT.has(node.kind)) return [];

  /* An agent step's named fields are the ones declared ON THE STEP, because
     those are the ones the worker asks the model for. The agent's registered
     output schema is not sent by any path that runs a workflow step, so offering
     its fields here would offer values that never arrive. */
  if (node.kind === "agent") {
    const declared = readOutputFields(node.config)
      .filter((f) => f.name && f.name !== "content")
      .map((f) => ({ path: f.name, label: humanize(f.name), kind: FIELD_KIND[f.type], help: f.description ?? null }));
    return [...declared, FULL_REPLY];
  }
  if (node.kind === "llm") return [FULL_REPLY];

  if (node.kind === "tool") {
    const tool = resolveTool(node.config, registry);
    if (!tool) return [];
    const declared = schemaFields(tool.outputSchema);
    if (declared.length > 0) return declared;
    if (tool.type === "database") {
      return [
        { path: "rows", label: "Rows", kind: "list", help: "The rows the query returned." },
        { path: "rowCount", label: "Row count", kind: "number", help: null },
      ];
    }
    if (tool.type === "http") {
      return [
        { path: "body", label: "Response", kind: "any", help: "What the service answered." },
        { path: "statusCode", label: "Status code", kind: "number", help: null },
      ];
    }
    return [];
  }

  if (node.kind === "approval") {
    return [
      { path: "decision", label: "Decision", kind: "text", help: null },
      { path: "resolvedBy", label: "Approved by", kind: "text", help: null },
    ];
  }

  if (node.kind === "trigger") {
    return schemaFields(node.config.inputSchema);
  }

  return [];
}

/** Every step before this one that produces something, nearest first. */
export function sourceSteps(
  nodeId: string,
  nodes: NodeLike[],
  edges: EdgeLike[],
  registry: BuilderRegistry,
): SourceStep[] {
  const distance = new Map<string, number>();
  const queue: { id: string; d: number }[] = [{ id: nodeId, d: 0 }];
  while (queue.length > 0) {
    const { id, d } = queue.shift()!;
    for (const edge of edges) {
      if (edge.target !== id) continue;
      if (edge.source === nodeId) continue;
      const known = distance.get(edge.source);
      if (known !== undefined && known <= d + 1) continue;
      distance.set(edge.source, d + 1);
      queue.push({ id: edge.source, d: d + 1 });
    }
  }
  const out: SourceStep[] = [];
  for (const [id, d] of distance) {
    const node = nodes.find((n) => n.node.id === id)?.node;
    if (!node) continue;
    const fields = stepOutputs(node, registry);
    if (fields.length === 0) continue;
    out.push({ id, name: node.name, kind: node.kind, distance: d, fields });
  }
  return out.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}

/* ── Suggestions ──────────────────────────────────────────────────────────── */

/**
 * The earlier field an input most likely wants: same name, nearest step first.
 *
 * Deliberately only names. A type or description match guesses, and a wrong
 * guess on a message tool posts the wrong thing; an exact name match is what the
 * author already did by giving both ends the same name.
 */
export function suggestFor(inputId: string, sources: SourceStep[]): (StepRef & { stepName: string; label: string }) | null {
  const key = nameKey(inputId);
  for (const source of sources) {
    const field = source.fields.find((f) => nameKey(inputNameFor(f.path)) === key || nameKey(f.label) === key);
    if (field) return { nodeId: source.id, path: field.path, stepName: source.name, label: field.label };
  }
  return null;
}

/* ── Who reads a step's output ────────────────────────────────────────────── */

export interface Consumer {
  nodeId: string;
  nodeName: string;
  inputId: string;
  path: string;
}

export function consumersOf(nodeId: string, nodes: NodeLike[]): Consumer[] {
  const out: Consumer[] = [];
  for (const { node } of nodes) {
    if (node.id === nodeId) continue;
    for (const [inputId, value] of Object.entries(readInputMapping(node.config))) {
      const ref = parseStepRef(value, nodes);
      if (ref?.nodeId === nodeId) out.push({ nodeId: node.id, nodeName: node.name, inputId, path: ref.path });
    }
  }
  return out;
}
