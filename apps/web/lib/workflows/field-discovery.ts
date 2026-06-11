/**
 * Field Discovery — builds the list of available source fields for a given node.
 *
 * Rules:
 * - Only UPSTREAM (previously executed) nodes are available.
 * - Future nodes are never surfaced.
 * - Disconnected nodes are excluded unless advanced mode.
 * - Secrets are never surfaced.
 * - Workflow input is always available.
 */

import type { Node, Edge } from "@xyflow/react";
import type { WFNodeData, WFNodeType, WorkflowGraph } from "@/types/workflow-graph";
import type { FieldSource, NodeOutputField, FieldType } from "@/types/workflow-mapping";

// ─── Topology helpers ─────────────────────────────────────────────────────────

/** Returns the set of node IDs that are strictly upstream of targetNodeId. */
export function getUpstreamNodeIds(targetNodeId: string, edges: Edge[]): Set<string> {
  const upstream = new Set<string>();
  const visited  = new Set<string>();
  const queue    = [targetNodeId];

  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges) {
      if (edge.target === current && !visited.has(edge.source)) {
        upstream.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return upstream;
}

// ─── Schema → output fields ───────────────────────────────────────────────────

/** Convert a JSON Schema to a flat+nested NodeOutputField array. */
export function schemaToOutputFields(
  schema: Record<string, unknown> | undefined,
  sampleData: Record<string, unknown> | undefined,
  prefix = "",
  depth  = 0,
): NodeOutputField[] {
  if (depth > 4) return [];  // prevent infinite recursion for deep schemas
  if (!schema) return inferFieldsFromSample(sampleData ?? {}, prefix, depth);

  const props = schema.properties as Record<string, unknown> | undefined;
  if (!props) return [];

  return Object.entries(props).map(([key, def]) => {
    const d    = def as Record<string, unknown>;
    const path = prefix ? `${prefix}.${key}` : key;
    const type = jsonSchemaTypeToFieldType(d.type as string);
    const field: NodeOutputField = {
      path,
      label:       toLabel(key),
      type,
      description: d.description as string | undefined,
      example:     d.example as string | undefined,
      sampleValue: sampleData ? getNestedValue(sampleData, key) : undefined,
    };
    if (type === "object" && d.properties) {
      field.children = schemaToOutputFields(d as Record<string, unknown>, getNestedValue(sampleData, key) as Record<string, unknown> | undefined, path, depth + 1);
    }
    if (type === "array" && d.items) {
      const items = d.items as Record<string, unknown>;
      if (items.type === "object" && items.properties) {
        field.children = schemaToOutputFields(items, undefined, `${path}[]`, depth + 1);
        field.children = field.children.map(c => ({ ...c, isArrayItem: true }));
      }
    }
    return field;
  });
}

function inferFieldsFromSample(sample: Record<string, unknown>, prefix = "", depth = 0): NodeOutputField[] {
  if (depth > 4 || !sample || typeof sample !== "object") return [];
  return Object.entries(sample).flatMap(([key, val]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const type = inferType(val);
    const field: NodeOutputField = {
      path, label: toLabel(key), type, sampleValue: val,
    };
    if (type === "object" && val && typeof val === "object" && !Array.isArray(val)) {
      field.children = inferFieldsFromSample(val as Record<string, unknown>, path, depth + 1);
    }
    if (type === "array" && Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
      field.children = inferFieldsFromSample(val[0] as Record<string, unknown>, `${path}[]`, depth + 1)
        .map(c => ({ ...c, isArrayItem: true }));
    }
    return field;
  });
}

// ─── Per-node output field definitions ───────────────────────────────────────

/** Returns known output fields for a node based on its type and config. */
export function getNodeOutputFields(
  node: Node<WFNodeData>,
  sampleOutput?: Record<string, unknown>,
): NodeOutputField[] {
  const cfg = node.data;
  const nodeType = cfg.nodeType as WFNodeType;

  // If we have sample output and no schema, infer from sample
  const baseSample = sampleOutput;

  switch (nodeType) {
    case "trigger":
      return schemaToOutputFields(cfg.triggerConfig?.inputSchema as Record<string, unknown> | undefined, baseSample) || [
        { path: "triggeredAt", label: "Triggered At", type: "datetime" },
        { path: "triggeredBy", label: "Triggered By", type: "string" },
      ];

    case "agent": {
      const outputFields = schemaToOutputFields(undefined, baseSample);
      return outputFields.length > 0 ? outputFields : [
        { path: "output", label: "Agent Output", type: "object",
          children: [{ path: "output.result", label: "Result", type: "string" }] },
        { path: "tokensUsed", label: "Tokens Used", type: "number" },
      ];
    }

    case "llm": {
      const schema = cfg.llmConfig?.outputSchema;
      const base   = schema ? schemaToOutputFields(schema as Record<string, unknown>, baseSample) : [];
      return base.length > 0 ? base : [
        { path: "content",    label: "Response Content", type: "string" },
        { path: "tokensUsed", label: "Tokens Used",      type: "number" },
      ];
    }

    case "tool":
    case "http_tool": {
      const extraction = cfg.toolConfig?.outputExtraction ?? cfg.httpToolConfig?.outputExtraction;
      if (extraction?.fieldMappings) {
        return Object.keys(extraction.fieldMappings).map(k => ({
          path: k, label: toLabel(k), type: "any" as FieldType,
          sampleValue: (baseSample as Record<string,unknown>)?.[k],
        }));
      }
      return baseSample
        ? inferFieldsFromSample(baseSample)
        : [{ path: "body", label: "Response Body", type: "object" },
           { path: "status", label: "HTTP Status", type: "number" }];
    }

    case "db_read":
      return [
        { path: "rows",       label: "All Rows",    type: "array",
          sampleValue: baseSample?.rows,
          children: baseSample?.rows && Array.isArray(baseSample.rows) && baseSample.rows.length > 0
            ? inferFieldsFromSample(baseSample.rows[0] as Record<string, unknown>, "rows[]")
                .map(c => ({ ...c, isArrayItem: true }))
            : [{ path: "rows[].id", label: "ID", type: "any" as FieldType, isArrayItem: true }]
        },
        { path: "rowCount",   label: "Row Count",   type: "number" },
        { path: "rows[0]",    label: "First Row",   type: "object" },
      ];

    case "db_write":
      return [
        { path: "rowsAffected", label: "Rows Affected", type: "number" },
        { path: "success",      label: "Success",       type: "boolean" },
      ];

    case "branch":
      return [
        { path: "result",   label: "Condition Result", type: "boolean" },
        { path: "path",     label: "Chosen Path",      type: "string"  },
      ];

    case "transform":
      return baseSample
        ? inferFieldsFromSample(baseSample)
        : [{ path: "result", label: "Transform Result", type: "any" }];

    case "approval":
      return [
        { path: "decision",    label: "Decision",       type: "string" },
        { path: "decidedBy",   label: "Decided By",     type: "string" },
        { path: "decidedAt",   label: "Decided At",     type: "datetime" },
        { path: "reason",      label: "Reason",         type: "string" },
      ];

    default:
      return baseSample
        ? inferFieldsFromSample(baseSample)
        : [{ path: "output", label: "Output", type: "any" }];
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build all available field sources for a given node.
 * Only upstream connected nodes + workflow input are included.
 */
export function buildAvailableFieldsForNode(
  targetNodeId: string,
  nodes: Node<WFNodeData>[],
  edges: Edge[],
  sampleOutputs: Record<string, Record<string, unknown>> = {},
  workflowInputSchema?: Record<string, unknown>,
  workflowInputSample?: Record<string, unknown>,
): FieldSource[] {
  const upstreamIds = getUpstreamNodeIds(targetNodeId, edges);
  const sources: FieldSource[] = [];

  // 1. Workflow input — always available
  const inputFields = schemaToOutputFields(workflowInputSchema, workflowInputSample);
  sources.push({
    sourceId: "workflow_input",
    label: "Workflow Input",
    nodeType: "trigger",
    isWorkflowInput: true,
    fields: inputFields.length > 0 ? inputFields : [
      { path: "input", label: "Full Input", type: "object" },
    ],
  });

  // 2. Run metadata
  sources.push({
    sourceId: "run_metadata",
    label: "Run Metadata",
    nodeType: "system",
    fields: [
      { path: "runId",      label: "Run ID",         type: "uuid" },
      { path: "workflowId", label: "Workflow ID",    type: "uuid" },
      { path: "startedAt",  label: "Started At",     type: "datetime" },
      { path: "triggeredBy",label: "Triggered By",   type: "string" },
    ],
  });

  // 3. Upstream nodes (in graph order by approximate x-position)
  const upstreamNodes = nodes
    .filter(n => upstreamIds.has(n.id))
    .sort((a, b) => (a.position.x ?? 0) - (b.position.x ?? 0));

  for (const node of upstreamNodes) {
    const label = node.data.label || node.data.nodeType || node.id;
    const fields = getNodeOutputFields(node, sampleOutputs[node.id]);
    sources.push({
      sourceId: node.id,
      label,
      nodeType: node.data.nodeType,
      fields,
    });
  }

  return sources;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

function inferType(val: unknown): FieldType {
  if (val === null) return "null";
  if (typeof val === "string") return "string";
  if (typeof val === "number") return "number";
  if (typeof val === "boolean") return "boolean";
  if (Array.isArray(val)) return "array";
  if (typeof val === "object") return "object";
  return "unknown";
}

function jsonSchemaTypeToFieldType(t: string | undefined): FieldType {
  const map: Record<string, FieldType> = {
    string: "string", number: "number", integer: "number",
    boolean: "boolean", object: "object", array: "array", "null": "null",
  };
  return map[t ?? ""] ?? "unknown";
}

function getNestedValue(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key];
}
