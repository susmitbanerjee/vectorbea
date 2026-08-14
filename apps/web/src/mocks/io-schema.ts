import type { NodeKind } from "./domain";
import type { VersionNode } from "./workflow-nodes";
import type { BuilderEdge, BuilderNode } from "./builder";

/* ══════════════════════════════════════════════════════════════════════════════
   UNIFIED I/O AND MAPPING — the model behind the Inputs tab.

   The docs promise "Unified I/O & mapping" and no screen has ever delivered it.
   What was missing is not a widget; it is this: a declared INPUT contract per
   node, a declared OUTPUT schema per node, and an expression that binds one to
   the other — plus, crucially, real data to resolve that expression against.

   THE RESOLVED PREVIEW IS THE WHOLE IDEA. A binding written as
   `{{ n1001.output.renewals[0].account_name }}` is a promise about a shape. The
   only way to know whether the promise holds is to evaluate it against
   something real, and the last run is the realest thing available. Everything
   else on the Inputs tab — the tree, the chips, the type warnings — exists to
   get to that one line of resolved text.

   SAMPLE DATA IS THE APPROVALS FIXTURE. The values here are the same Northwind
   Trading Ltd / £842.00 / INV-2026-04182 that the Approvals page shows as
   resolved decision context. That is not a coincidence to be tidied up later:
   the whole point of §10's Approvals note is that the resolved values come from
   the mapping, so the mapping fixture and the approvals fixture must be one
   thing seen from two ends.
══════════════════════════════════════════════════════════════════════════════ */

export type FieldType =
  | "string" | "number" | "boolean" | "object" | "array" | "date" | "any";

export interface FieldSchema {
  /** Dotted path relative to the node's output root: `renewals[0].account_name`. */
  path: string;
  type: FieldType;
  description: string;
  /** Present when the last run produced a value here. */
  sample?: unknown;
  /** Nested fields, for objects and arrays of objects. */
  children?: FieldSchema[];
}

export interface InputDeclaration {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  description: string;
  /** Used when nothing is bound and the input is optional. */
  defaultValue?: unknown;
  /** What a bound expression resolving to null should do. */
  nullPolicy: NullPolicy;
}

export type NullPolicy = "fail" | "use-default" | "pass-null" | "skip-node";

export const NULL_POLICY_LABEL: Record<NullPolicy, string> = {
  fail: "Fail the step",
  "use-default": "Use the default",
  "pass-null": "Pass null through",
  "skip-node": "Skip this step",
};

export const NULL_POLICY_HELP: Record<NullPolicy, string> = {
  fail: "The run stops here and the node is marked failed. Correct when a missing value means the work cannot be done.",
  "use-default": "The default below is substituted. Correct when a missing value has a sensible fallback.",
  "pass-null": "Null is passed to the step, which must handle it. Correct when the step's own logic distinguishes absent from empty.",
  "skip-node": "The step is skipped and the run continues. Correct when the work is optional.",
};

/* ── Input declarations per node kind ─────────────────────────────────────── */

/**
 * What a node needs before it can run.
 *
 * Declared per KIND rather than per instance, because the contract belongs to
 * the step type: every tool call needs its arguments bound, every approval needs
 * something to show the approver. Instance config (which tool, which approver
 * group) lives on the node; the shape of what must be fed in lives here.
 */
export function inputsFor(node: VersionNode): InputDeclaration[] {
  const common: InputDeclaration[] = [];

  switch (node.kind) {
    case "trigger":
      return [];

    case "tool": {
      const tool = String(node.config.tool ?? "");
      return [...common, ...toolParameters(tool)];
    }

    case "llm":
      return [
        ...common,
        { id: "prompt", label: "Prompt", type: "string", required: true, nullPolicy: "fail", description: "The text sent to the model. Bind upstream fields into it to give the model the facts it needs." },
        { id: "context", label: "Context", type: "object", required: false, nullPolicy: "pass-null", description: "Structured context attached alongside the prompt. Use for data the model should read but not be told to repeat." },
      ];

    case "agent":
      return [
        ...common,
        { id: "objective", label: "Objective", type: "string", required: true, nullPolicy: "fail", description: "What the agent is being asked to achieve. Overrides the registered agent's default task for this step only." },
        { id: "input", label: "Working data", type: "object", required: false, nullPolicy: "pass-null", description: "The records the agent reasons over. Bind the collection this step is responsible for." },
        { id: "budgetUsd", label: "Cost ceiling", type: "number", required: false, defaultValue: 0.05, nullPolicy: "use-default", description: "Hard stop for this step's spend. The agent is halted rather than allowed to exceed it." },
      ];

    case "branch":
      return [
        ...common,
        { id: "subject", label: "Subject", type: "any", required: true, nullPolicy: "fail", description: "The value the condition is evaluated against. Usually a field from the step above." },
      ];

    case "parallel":
      return [
        ...common,
        { id: "collection", label: "Collection", type: "array", required: true, nullPolicy: "fail", description: "The list to fan out over. One branch runs per item." },
      ];

    case "merge":
      return [
        ...common,
        { id: "branches", label: "Branch results", type: "array", required: true, nullPolicy: "fail", description: "Results arriving from the concurrent branches. Bound automatically when the fan-out above is bound." },
      ];

    case "wait":
      return [
        ...common,
        { id: "until", label: "Until", type: "date", required: false, nullPolicy: "use-default", description: "A timestamp to wait for. Leave unbound to use the fixed duration on the Configure tab." },
      ];

    case "approval":
      return [
        ...common,
        { id: "subject", label: "Decision subject", type: "string", required: true, nullPolicy: "fail", description: "One line naming what is being approved. This is the first thing the approver reads." },
        { id: "amount", label: "Amount", type: "number", required: false, nullPolicy: "pass-null", description: "The monetary value at stake, if any. Drives which approval policy applies." },
        { id: "context", label: "Decision context", type: "object", required: true, nullPolicy: "fail", description: "The evidence the approver decides on. Every field bound here appears on the Approvals page with its resolved value and its source." },
      ];

    case "output":
      return [
        ...common,
        { id: "payload", label: "Payload", type: "any", required: true, nullPolicy: "fail", description: "What this step emits. Bind the finished result of the work above." },
      ];

    case "checkpoint":
    case "end":
    default:
      return common;
  }
}

/** Parameters for a tool, from its name. Stands in for the real tool schema. */
function toolParameters(tool: string): InputDeclaration[] {
  const table: Record<string, InputDeclaration[]> = {
    "postgres.query": [
      { id: "sql", label: "SQL", type: "string", required: true, nullPolicy: "fail", description: "The statement to run. Bind parameters rather than interpolating values into the string." },
      { id: "params", label: "Parameters", type: "array", required: false, nullPolicy: "use-default", defaultValue: [], description: "Positional parameters, bound safely — this is what stops a value becoming SQL." },
    ],
    "contracts.getUpcomingRenewals": [
      { id: "withinDays", label: "Within days", type: "number", required: true, defaultValue: 30, nullPolicy: "use-default", description: "How far ahead to look. Contracts renewing after this window are not returned." },
      { id: "accountIds", label: "Account ids", type: "array", required: false, nullPolicy: "pass-null", description: "Restrict to specific accounts. Leave unbound to cover the whole book." },
    ],
    "slack.postMessage": [
      { id: "channel", label: "Channel", type: "string", required: true, nullPolicy: "fail", description: "Target channel, including the leading hash." },
      { id: "text", label: "Message", type: "string", required: true, nullPolicy: "fail", description: "The message body. Bind upstream fields to include real values rather than placeholders." },
      { id: "threadTs", label: "Thread", type: "string", required: false, nullPolicy: "pass-null", description: "Reply into an existing thread instead of posting at top level." },
    ],
    "stripe.getInvoice": [
      { id: "invoiceId", label: "Invoice id", type: "string", required: true, nullPolicy: "fail", description: "The Stripe invoice to read." },
    ],
    "hubspot.getContact": [
      { id: "contactId", label: "Contact id", type: "string", required: true, nullPolicy: "fail", description: "The CRM contact to read." },
    ],
    "gmail.send": [
      { id: "to", label: "To", type: "string", required: true, nullPolicy: "fail", description: "Recipient address. A bad binding here sends real mail to the wrong person, so it is worth previewing." },
      { id: "subject", label: "Subject", type: "string", required: true, nullPolicy: "fail", description: "Subject line." },
      { id: "body", label: "Body", type: "string", required: true, nullPolicy: "fail", description: "Message body." },
    ],
  };

  return table[tool] ?? [
    { id: "arguments", label: "Arguments", type: "object", required: true, nullPolicy: "fail", description: "Arguments for the call, shaped by the tool's own schema. Pick a tool on Configure to get a typed form here." },
  ];
}

/* ── Output schemas ───────────────────────────────────────────────────────── */

/**
 * What a node emits, inferred from its kind and its binding.
 *
 * Inferred rather than authored so a node that has never run still offers a tree
 * to bind against — otherwise the mapping UI is empty until after the first run,
 * which is exactly backwards.
 */
export function outputSchemaFor(node: VersionNode): FieldSchema[] {
  switch (node.kind) {
    case "trigger":
      return [
        { path: "firedAt", type: "date", description: "When the trigger fired.", sample: "2026-08-11T06:00:00Z" },
        { path: "cause", type: "string", description: "What started the run.", sample: "schedule" },
      ];

    case "tool":
      return toolOutput(String(node.config.tool ?? ""));

    case "llm":
      return [
        { path: "text", type: "string", description: "The model's response.", sample: "Northwind's renewal is 12 days out and the account is in good standing." },
        { path: "intent", type: "string", description: "Classified intent, when an output schema is declared.", sample: "renewal_outreach" },
        { path: "confidence", type: "number", description: "Model confidence, 0–1.", sample: 0.91 },
        { path: "tokens", type: "number", description: "Tokens consumed by this call.", sample: 1204 },
      ];

    case "agent":
      return [
        { path: "result", type: "object", description: "The agent's structured conclusion.", sample: { decision: "escalate", reason: "discount above policy cap" },
          children: [
            { path: "result.decision", type: "string", description: "What the agent decided.", sample: "escalate" },
            { path: "result.reason", type: "string", description: "Why.", sample: "discount above policy cap" },
          ] },
        { path: "steps", type: "number", description: "Tool calls the agent made.", sample: 4 },
      ];

    case "branch":
      return [
        { path: "taken", type: "string", description: "Which arm was taken.", sample: "true" },
        { path: "subject", type: "any", description: "The value the condition was evaluated against.", sample: "enterprise" },
      ];

    case "parallel":
      return [
        { path: "items", type: "array", description: "The collection being fanned out over.", sample: ["acct_8812", "acct_4417"] },
        { path: "index", type: "number", description: "This branch's position in the fan.", sample: 0 },
      ];

    case "merge":
      return [
        { path: "results", type: "array", description: "Every branch result, in branch order.", sample: [{ ok: true }, { ok: true }] },
        { path: "failures", type: "number", description: "How many branches failed.", sample: 0 },
      ];

    case "approval":
      return [
        { path: "decision", type: "string", description: "approved, rejected, or expired.", sample: "approved" },
        { path: "decidedBy", type: "string", description: "Who decided.", sample: "billing" },
        { path: "decidedAt", type: "date", description: "When.", sample: "2026-08-11T09:14:00Z" },
        { path: "reason", type: "string", description: "Mandatory on reject.", sample: "" },
      ];

    case "wait":
      return [{ path: "waitedMs", type: "number", description: "How long the run actually waited.", sample: 60000 }];

    case "checkpoint":
      return [{ path: "committedAt", type: "date", description: "When the checkpoint committed.", sample: "2026-08-11T06:00:12Z" }];

    default:
      return [{ path: "output", type: "any", description: "This step's output.", sample: null }];
  }
}

function toolOutput(tool: string): FieldSchema[] {
  switch (tool) {
    case "contracts.getUpcomingRenewals":
      return [
        {
          path: "renewals", type: "array",
          description: "Contracts renewing inside the window.",
          sample: [{ account_name: "Northwind Trading Ltd", amount_due: 842, invoice_number: "INV-2026-04182" }],
          children: [
            { path: "renewals[0].account_name", type: "string", description: "Legal account name.", sample: "Northwind Trading Ltd" },
            { path: "renewals[0].account_id", type: "string", description: "Internal account id.", sample: "acct_8812" },
            { path: "renewals[0].amount_due", type: "number", description: "Amount due at renewal, in the account's currency.", sample: 842 },
            { path: "renewals[0].currency", type: "string", description: "ISO currency code.", sample: "GBP" },
            { path: "renewals[0].invoice_number", type: "string", description: "The invoice this renewal bills against.", sample: "INV-2026-04182" },
            { path: "renewals[0].renews_on", type: "date", description: "Renewal date.", sample: "2026-09-01" },
            { path: "renewals[0].term_months", type: "number", description: "Contract term.", sample: 24 },
            { path: "renewals[0].tier", type: "string", description: "Commercial tier — what the branch above routes on.", sample: "enterprise" },
          ],
        },
        { path: "count", type: "number", description: "How many renewals were returned.", sample: 14 },
        { path: "queriedAt", type: "date", description: "When the query ran.", sample: "2026-08-11T06:00:03Z" },
      ];

    case "postgres.query":
      return [
        { path: "rows", type: "array", description: "Result rows.", sample: [{ ltv_gbp: 48210 }],
          children: [
            { path: "rows[0].account_id", type: "string", description: "Account id.", sample: "acct_8812" },
            { path: "rows[0].ltv_gbp", type: "number", description: "Lifetime value in GBP.", sample: 48210 },
            { path: "rows[0].created_at", type: "date", description: "When the account was created.", sample: "2023-06-04" },
          ] },
        { path: "rowCount", type: "number", description: "Number of rows.", sample: 1 },
      ];

    case "stripe.getInvoice":
      return [
        { path: "number", type: "string", description: "Invoice number.", sample: "INV-2026-04182" },
        { path: "amount_due", type: "number", description: "Amount due, in minor units.", sample: 84200 },
        { path: "currency", type: "string", description: "ISO currency code.", sample: "gbp" },
        { path: "status", type: "string", description: "Invoice status.", sample: "open" },
      ];

    case "hubspot.getContact":
      return [
        { path: "company", type: "object", description: "The associated company.",
          children: [
            { path: "company.name", type: "string", description: "Company name.", sample: "Northwind Trading Ltd" },
            { path: "company.domain", type: "string", description: "Primary domain.", sample: "northwind.example" },
          ] },
        { path: "createdate", type: "date", description: "When the contact was created — account age comes from this.", sample: "2023-06-04" },
        { path: "email", type: "string", description: "Primary email.", sample: "ap@northwind.example" },
      ];

    case "slack.postMessage":
      return [
        { path: "ts", type: "string", description: "Message timestamp, usable as a thread id.", sample: "1786697741.004200" },
        { path: "channel", type: "string", description: "Where it landed.", sample: "#billing-ops" },
      ];

    default:
      return [
        { path: "result", type: "any", description: "Whatever the tool returned. Pick a tool on Configure for a typed schema.", sample: null },
      ];
  }
}

/* ── Upstream tree ────────────────────────────────────────────────────────── */

export interface UpstreamNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** Distance in hops. Nearest first — the nearest step is the usual source. */
  distance: number;
  fields: FieldSchema[];
}

/**
 * Every node upstream of this one, with its output schema.
 *
 * Ordered by distance because binding overwhelmingly reaches one step back. A
 * tree sorted by graph position instead puts the trigger first, which is the
 * field somebody wants roughly never.
 */
export function upstreamOf(
  nodeId: string,
  nodes: BuilderNode[],
  edges: BuilderEdge[],
): UpstreamNode[] {
  const byId = new Map(nodes.map((n) => [n.node.id, n.node]));
  const distance = new Map<string, number>();
  const queue: { id: string; d: number }[] = [{ id: nodeId, d: 0 }];

  while (queue.length > 0) {
    const { id, d } = queue.shift()!;
    for (const edge of edges) {
      if (edge.target !== id) continue;
      const next = edge.source;
      if (distance.has(next) && distance.get(next)! <= d + 1) continue;
      distance.set(next, d + 1);
      queue.push({ id: next, d: d + 1 });
    }
  }

  return [...distance.entries()]
    .map(([id, d]) => {
      const node = byId.get(id);
      if (!node) return null;
      return { id, name: node.name, kind: node.kind, distance: d, fields: outputSchemaFor(node) };
    })
    .filter((n): n is UpstreamNode => n !== null)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
}

/* ── Bindings ─────────────────────────────────────────────────────────────── */

export interface Binding {
  /** The input this binds. */
  inputId: string;
  /** `{{ n1001.output.renewals[0].account_name }}` */
  expression: string;
  /** Optional transform applied to the resolved value. */
  transform?: string;
}

/** `{{ nodeId.output.path }}` — the wire format, and what the chip displays. */
export function makeExpression(nodeId: string, path: string): string {
  return `{{ ${nodeId}.output.${path} }}`;
}

/** `Contracts → renewals[0].account_name`, for the human-readable label. */
export function describeExpression(expression: string, upstream: UpstreamNode[]): string | null {
  const parsed = parseExpression(expression);
  if (!parsed) return null;
  const node = upstream.find((u) => u.id === parsed.nodeId);
  if (!node) return `Unknown step ${parsed.nodeId}`;
  return `${node.name} → ${parsed.path}`;
}

export function parseExpression(expression: string): { nodeId: string; path: string } | null {
  const match = /^\{\{\s*([\w-]+)\.output\.(.+?)\s*\}\}$/.exec(expression.trim());
  if (!match) return null;
  return { nodeId: match[1], path: match[2] };
}

/* ── Resolution ───────────────────────────────────────────────────────────── */

/**
 * Resolve a binding against the last run's data.
 *
 * Reads the SAMPLE values off the schema rather than a separate blob, so the
 * type shown beside a field and the value shown under the input can never
 * describe different things. Array indices resolve against the sample of the
 * parent array.
 */
export function resolveExpression(
  expression: string,
  upstream: UpstreamNode[],
): { value: unknown; found: boolean } {
  const parsed = parseExpression(expression);
  if (!parsed) return { value: undefined, found: false };

  const node = upstream.find((u) => u.id === parsed.nodeId);
  if (!node) return { value: undefined, found: false };

  const flat = flattenSchema(node.fields);
  const field = flat.find((f) => f.path === parsed.path);
  if (field && "sample" in field) return { value: field.sample, found: true };

  return { value: undefined, found: false };
}

export function flattenSchema(fields: FieldSchema[]): FieldSchema[] {
  const out: FieldSchema[] = [];
  const walk = (list: FieldSchema[]) => {
    for (const field of list) {
      out.push(field);
      if (field.children) walk(field.children);
    }
  };
  walk(fields);
  return out;
}

/* ── Type checking ────────────────────────────────────────────────────────── */

export interface TypeIssue {
  severity: "error" | "warning";
  message: string;
  /** A transform that would fix it, ready to drop into the transform editor. */
  coercion?: string;
}

/**
 * Compare a bound field's type against the input's declared type.
 *
 * `any` accepts everything, and a number bound to a string input is a warning
 * with a one-click coercion rather than an error — it works at runtime, it is
 * just imprecise, and blocking it would make the mapping UI feel obstructive on
 * the most common mismatch there is.
 */
export function checkType(inputType: FieldType, fieldType: FieldType): TypeIssue | null {
  if (inputType === "any" || fieldType === "any" || inputType === fieldType) return null;

  const coercions: Record<string, { message: string; coercion: string; severity: "error" | "warning" }> = {
    "number->string": { message: "A number is bound to a string input. It will be stringified with the default locale.", coercion: "String(value)", severity: "warning" },
    "string->number": { message: "A string is bound to a number input. It will fail if the value is not numeric.", coercion: "Number(value)", severity: "warning" },
    "date->string": { message: "A date is bound to a string input. Format it explicitly rather than relying on the default.", coercion: "formatDate(value, 'YYYY-MM-DD')", severity: "warning" },
    "array->string": { message: "An array is bound to a string input.", coercion: "value.join(', ')", severity: "warning" },
    "object->string": { message: "An object is bound to a string input, which will render as [object Object].", coercion: "JSON.stringify(value)", severity: "error" },
    "string->array": { message: "A string is bound to an array input.", coercion: "value.split(',')", severity: "error" },
    "string->object": { message: "A string is bound to an object input.", coercion: "JSON.parse(value)", severity: "error" },
    "array->number": { message: "An array is bound to a number input.", coercion: "value.length", severity: "error" },
    "boolean->string": { message: "A boolean is bound to a string input.", coercion: "value ? 'yes' : 'no'", severity: "warning" },
  };

  const entry = coercions[`${fieldType}->${inputType}`];
  if (entry) {
    return { severity: entry.severity, message: entry.message, coercion: entry.coercion };
  }

  return {
    severity: "error",
    message: `A ${fieldType} is bound to a ${inputType} input, and there is no safe conversion between them.`,
  };
}

export function typeOfField(expression: string, upstream: UpstreamNode[]): FieldType | null {
  const parsed = parseExpression(expression);
  if (!parsed) return null;
  const node = upstream.find((u) => u.id === parsed.nodeId);
  if (!node) return null;
  return flattenSchema(node.fields).find((f) => f.path === parsed.path)?.type ?? null;
}

/* ── Transforms ───────────────────────────────────────────────────────────── */

export interface TransformFunction {
  name: string;
  signature: string;
  description: string;
}

/** The function set the transform editor autocompletes. */
export const TRANSFORM_FUNCTIONS: TransformFunction[] = [
  { name: "String", signature: "String(value)", description: "Convert to text." },
  { name: "Number", signature: "Number(value)", description: "Convert to a number. Produces NaN on non-numeric text." },
  { name: "JSON.stringify", signature: "JSON.stringify(value)", description: "Serialise an object or array to text." },
  { name: "JSON.parse", signature: "JSON.parse(value)", description: "Parse text into an object." },
  { name: "upper", signature: "upper(value)", description: "Uppercase." },
  { name: "lower", signature: "lower(value)", description: "Lowercase." },
  { name: "trim", signature: "trim(value)", description: "Strip surrounding whitespace." },
  { name: "round", signature: "round(value, places)", description: "Round to a number of decimal places." },
  { name: "money", signature: "money(value, 'GBP')", description: "Format a number as currency, minor units aware." },
  { name: "formatDate", signature: "formatDate(value, 'YYYY-MM-DD')", description: "Format a date." },
  { name: "default", signature: "default(value, fallback)", description: "Substitute when the value is null or undefined." },
  { name: "join", signature: "value.join(', ')", description: "Join an array into text." },
  { name: "slice", signature: "value.slice(0, 10)", description: "Take part of a string or array." },
  { name: "length", signature: "value.length", description: "Count of items or characters." },
];

/**
 * Evaluate a transform against a resolved value, for the live preview.
 *
 * A deliberately small interpreter over the published function set, not `eval`.
 * The preview runs on every keystroke, so it must never be able to execute
 * arbitrary text — and a transform editor whose preview can run arbitrary code
 * is a transform editor that ships an injection surface into every workspace.
 */
export function evaluateTransform(transform: string, value: unknown): { value: unknown; error: string | null } {
  const source = transform.trim();
  if (!source) return { value, error: null };

  try {
    const match = /^(\w+(?:\.\w+)?)\((.*)\)$/.exec(source);
    const method = /^value\.(\w+)\((.*)\)$/.exec(source);
    const property = /^value\.(\w+)$/.exec(source);

    if (property) {
      if (property[1] === "length") {
        if (typeof value === "string" || Array.isArray(value)) return { value: value.length, error: null };
        return { value: undefined, error: "length is only defined on text and arrays." };
      }
      return { value: (value as Record<string, unknown>)?.[property[1]], error: null };
    }

    if (method) {
      const [, name, rawArgs] = method;
      const args = parseArgs(rawArgs);
      if (name === "join" && Array.isArray(value)) return { value: value.join(String(args[0] ?? ",")), error: null };
      if (name === "slice") {
        if (typeof value === "string" || Array.isArray(value)) {
          return { value: (value as string).slice(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1])), error: null };
        }
        return { value: undefined, error: "slice is only defined on text and arrays." };
      }
      return { value: undefined, error: `Unknown method ${name}.` };
    }

    if (match) {
      const [, name, rawArgs] = match;
      const args = parseArgs(rawArgs);
      switch (name) {
        case "String": return { value: String(value), error: null };
        case "Number": {
          const n = Number(value);
          return Number.isNaN(n)
            ? { value: undefined, error: `“${String(value)}” is not a number.` }
            : { value: n, error: null };
        }
        case "JSON.stringify": return { value: JSON.stringify(value), error: null };
        case "JSON.parse": {
          if (typeof value !== "string") return { value: undefined, error: "JSON.parse needs text." };
          return { value: JSON.parse(value), error: null };
        }
        case "upper": return { value: String(value).toUpperCase(), error: null };
        case "lower": return { value: String(value).toLowerCase(), error: null };
        case "trim": return { value: String(value).trim(), error: null };
        case "round": {
          const places = Number(args[0] ?? 0);
          const n = Number(value);
          return Number.isNaN(n)
            ? { value: undefined, error: "round needs a number." }
            : { value: Number(n.toFixed(places)), error: null };
        }
        case "money": {
          const n = Number(value);
          if (Number.isNaN(n)) return { value: undefined, error: "money needs a number." };
          const currency = String(args[0] ?? "GBP");
          return {
            value: new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n),
            error: null,
          };
        }
        case "formatDate": {
          const d = new Date(String(value));
          if (Number.isNaN(d.getTime())) return { value: undefined, error: `“${String(value)}” is not a date.` };
          return { value: d.toISOString().slice(0, 10), error: null };
        }
        case "default": return { value: value ?? args[0], error: null };
        default: return { value: undefined, error: `Unknown function ${name}.` };
      }
    }

    return { value: undefined, error: "Write a call such as money(value, 'GBP') or value.join(', ')." };
  } catch (error) {
    return { value: undefined, error: error instanceof Error ? error.message : "Could not evaluate." };
  }
}

/** Split a call's arguments, honouring quotes. */
function parseArgs(raw: string): unknown[] {
  if (!raw.trim()) return [];
  const out: unknown[] = [];
  let current = "";
  let quote: string | null = null;

  for (const ch of raw) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === ",") { out.push(coerceArg(current.trim())); current = ""; continue; }
    current += ch;
  }
  if (current.trim() || out.length > 0) out.push(coerceArg(current.trim()));
  return out;
}

function coerceArg(raw: string): unknown {
  if (raw === "") return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

/* ── Display ──────────────────────────────────────────────────────────────── */

/** A resolved value as one readable line. */
export function formatResolved(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? "(empty text)" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}] ${JSON.stringify(value).slice(0, 90)}`;
  return JSON.stringify(value).slice(0, 120);
}

export const TYPE_LABEL: Record<FieldType, string> = {
  string: "text", number: "number", boolean: "true/false",
  object: "object", array: "list", date: "date", any: "any",
};
