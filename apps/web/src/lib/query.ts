import type { Run, RunStatus } from "~/lib/runs/model";
import type { Workflow, WorkflowStatus } from "~/lib/workflows/model";

/* ══════════════════════════════════════════════════════════════════════════════
   QUERY LANGUAGE — P06 Part C.

   `status:failed workflow:renewals since:24h cost:>0.01`

   A real language, not a search box. The distinction that matters: a search box
   makes you guess what it matches, and silently returns nothing when you guess
   wrong. This parses to a structured AST, reports WHERE it failed by character
   offset, and can state back in English what it understood — so a query that
   returns nothing is legibly a query about nothing, not a broken search.

   Deliberately not a full grammar. No parentheses, no OR, no negation groups.
   Terms are ANDed, one bare term does a substring match across name and id.
   Everything past that costs syntax an operator has to learn for cases that
   almost never come up on a run list.
══════════════════════════════════════════════════════════════════════════════ */

export type Comparator = ":" | ">" | "<" | ">=" | "<=";

export interface QueryTerm {
  /** Field key, or null for a bare search term. */
  key: string | null;
  comparator: Comparator;
  value: string;
  /** Character offsets in the source, for highlighting and error placement. */
  start: number;
  end: number;
  /** Set when the term is understood but unusable. */
  error?: string;
  /** Offsets of the key portion specifically, for token colouring. */
  keyEnd?: number;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  errors: { message: string; start: number; end: number }[];
}

/* ── Schema ───────────────────────────────────────────────────────────────── */

export type FieldKind = "enum" | "text" | "number" | "duration" | "relative-time";

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  description: string;
  /** For enums — the complete set, used for autocomplete and validation. */
  values?: readonly string[];
  /** Comparators beyond `:` that this field accepts. */
  numeric?: boolean;
  /**
   * The clause this field contributes to the plain-English restatement.
   *
   * On the field rather than in one big switch because the switch was the thing
   * that made the parser run-only: a second entity meant a second copy of the
   * whole function, and the two drifted the first time a field was renamed.
   */
  phrase?: (value: string, comparatorWord: string) => string;
}

/**
 * A parser instance: which fields exist, and how to talk about them.
 *
 * One schema per searchable entity. `parseQuery`, `suggest` and `explainQuery`
 * all take one, so adding Workflows search cost a field list rather than a
 * second parser.
 */
export interface QuerySchema {
  /** Stable id, also used as the saved-views storage key. */
  id: string;
  /** Plural noun the English restatement opens with. */
  subject: string;
  /** What an empty query means. */
  emptyExplanation: string;
  placeholder: string;
  /** aria-label for the input. */
  label: string;
  fields: FieldSpec[];
}

export const RUN_FIELDS: FieldSpec[] = [
  {
    key: "status", kind: "enum", description: "Run outcome",
    values: ["succeeded", "failed", "running", "queued", "awaiting-approval", "cancelled"],
    phrase: (v) => v,
  },
  {
    key: "workflow", kind: "text", description: "Workflow name, substring match",
    phrase: (v) => `in a workflow named like “${v}”`,
  },
  {
    key: "env", kind: "enum", description: "Environment",
    values: ["production", "staging", "development"],
    phrase: (v) => `in ${v}`,
  },
  {
    key: "trigger", kind: "enum", description: "How the run started",
    values: ["schedule", "webhook", "manual", "api"],
    phrase: (v) => `started by ${v}`,
  },
  {
    key: "since", kind: "relative-time", description: "Started within, e.g. 24h, 7d, 30m",
    phrase: (v) => `started in the last ${humaniseSpan(v)}`,
  },
  {
    key: "cost", kind: "number", description: "USD, e.g. >0.01", numeric: true,
    phrase: (v, word) => `cost ${word} $${v}`,
  },
  {
    key: "tokens", kind: "number", description: "Token count, e.g. >5000", numeric: true,
    phrase: (v, word) => `tokens ${word} ${v}`,
  },
  {
    key: "duration", kind: "duration", description: "Wall clock, e.g. >30s, <2m", numeric: true,
    phrase: (v, word) => `ran ${word.replace("is ", "")} ${v}`,
  },
  {
    key: "steps", kind: "number", description: "Node count, e.g. >10", numeric: true,
    phrase: (v, word) => `step count ${word} ${v}`,
  },
  {
    key: "incident", kind: "text", description: "Incident id the run was clustered into",
    phrase: (v) => `clustered into incident ${v}`,
  },
  {
    key: "id", kind: "text", description: "Run id, substring match",
    phrase: (v) => `with an id containing “${v}”`,
  },
];

export const RUN_QUERY: QuerySchema = {
  id: "runs",
  subject: "Runs",
  emptyExplanation: "All runs, newest first.",
  placeholder: "status:failed workflow:renewals since:24h",
  label: "Filter runs",
  fields: RUN_FIELDS,
};

/* ── Workflows ────────────────────────────────────────────────────────────── */

export const WORKFLOW_FIELDS: FieldSpec[] = [
  {
    key: "status", kind: "enum", description: "Lifecycle state",
    values: ["active", "draft", "paused", "archived"],
    phrase: (v) => v,
  },
  {
    key: "trigger", kind: "enum", description: "How the workflow starts",
    values: ["schedule", "webhook", "manual", "api"],
    phrase: (v) => `triggered by ${v}`,
  },
  {
    key: "env", kind: "enum", description: "Environment",
    values: ["production", "staging", "development"],
    phrase: (v) => `in ${v}`,
  },
  {
    key: "owner", kind: "text", description: "Owning team, substring match",
    phrase: (v) => `owned by ${v}`,
  },
  { key: "tag", kind: "text", description: "Tag, exact match", phrase: (v) => `tagged ${v}` },
  {
    key: "health", kind: "enum", description: "Success rate band over the last 30 runs",
    values: ["healthy", "degraded", "failing"],
    phrase: (v) => `whose health is ${v}`,
  },
  { key: "name", kind: "text", description: "Name, substring match", phrase: (v) => `named like “${v}”` },
  {
    key: "node", kind: "text", description: "Matches node names, tools and config values",
    phrase: (v) => `containing a node matching “${v}”`,
  },
  {
    key: "connection", kind: "text", description: "A connection the workflow binds",
    phrase: (v) => `bound to connection “${v}”`,
  },
  {
    key: "steps", kind: "number", description: "Node count, e.g. >10", numeric: true,
    phrase: (v, word) => `step count ${word} ${v}`,
  },
  {
    key: "rate", kind: "number", description: "Success rate percentage, e.g. <80", numeric: true,
    phrase: (v, word) => `success rate ${word} ${v}%`,
  },
  {
    key: "spend", kind: "number", description: "30-day spend in USD, e.g. >0.5", numeric: true,
    phrase: (v, word) => `30-day spend ${word} $${v}`,
  },
  {
    key: "version", kind: "number", description: "Published version, e.g. >4", numeric: true,
    phrase: (v, word) => `version ${word} ${v}`,
  },
];

export const WORKFLOW_QUERY: QuerySchema = {
  id: "workflows",
  subject: "Workflows",
  emptyExplanation: "All workflows, worst health first.",
  placeholder: "status:active health:failing node:postgres",
  label: "Filter workflows",
  fields: WORKFLOW_FIELDS,
};

/* ── Registries ───────────────────────────────────────────────────────────── */

export const AGENT_FIELDS: FieldSpec[] = [
  { key: "status", kind: "enum", description: "Lifecycle state", values: ["active", "paused", "draft"], phrase: (v) => v },
  { key: "type", kind: "enum", description: "What the agent is for", values: ["task", "router", "reviewer", "researcher"], phrase: (v) => `of type ${v}` },
  { key: "provider", kind: "text", description: "Model provider", phrase: (v) => `on ${v}` },
  { key: "model", kind: "text", description: "Model id, substring match", phrase: (v) => `running ${v}` },
  { key: "owner", kind: "text", description: "Owning team", phrase: (v) => `owned by ${v}` },
  { key: "tool", kind: "text", description: "Granted tool, substring match", phrase: (v) => `granted ${v}` },
  { key: "rate", kind: "number", description: "Success rate, e.g. <80", numeric: true, phrase: (v, w) => `success rate ${w} ${v}%` },
  { key: "cost", kind: "number", description: "Average cost per run, e.g. >0.01", numeric: true, phrase: (v, w) => `cost per run ${w} $${v}` },
  { key: "runs", kind: "number", description: "Runs in 30 days, e.g. >100", numeric: true, phrase: (v, w) => `runs ${w} ${v}` },
  { key: "grants", kind: "number", description: "Number of tool grants", numeric: true, phrase: (v, w) => `tool grants ${w} ${v}` },
  {
    key: "governance", kind: "enum", description: "Holds a high-risk grant with no approval gate",
    values: ["ok", "violation"],
    phrase: (v) => (v === "violation" ? "holding an ungated high-risk grant" : "whose grants are all gated"),
  },
];

export const AGENT_QUERY: QuerySchema = {
  id: "agents",
  subject: "Agents",
  emptyExplanation: "All agents, most used first.",
  placeholder: "status:active provider:anthropic rate:<80",
  label: "Filter agents",
  fields: AGENT_FIELDS,
};

export const TOOL_FIELDS: FieldSpec[] = [
  { key: "status", kind: "enum", description: "Lifecycle state", values: ["active", "paused", "draft"], phrase: (v) => v },
  { key: "type", kind: "enum", description: "How the tool is implemented", values: ["http", "db-read", "db-write", "builtin", "mcp"], phrase: (v) => `of type ${v}` },
  { key: "risk", kind: "enum", description: "Risk tier", values: ["low", "medium", "high", "critical"], phrase: (v) => `at ${v} risk` },
  { key: "connection", kind: "text", description: "Bound connection", phrase: (v) => `bound to ${v}` },
  { key: "owner", kind: "text", description: "Owning team", phrase: (v) => `owned by ${v}` },
  { key: "rate", kind: "number", description: "Success rate, e.g. <90", numeric: true, phrase: (v, w) => `success rate ${w} ${v}%` },
  { key: "calls", kind: "number", description: "Calls in 30 days", numeric: true, phrase: (v, w) => `calls ${w} ${v}` },
  { key: "latency", kind: "number", description: "p95 latency in ms, e.g. >1000", numeric: true, phrase: (v, w) => `p95 latency ${w} ${v}ms` },
  { key: "failing", kind: "enum", description: "Has a recorded last error", values: ["true", "false"], phrase: (v) => (v === "true" ? "with a recorded error" : "with no recorded error") },
  { key: "policy", kind: "enum", description: "Policy contradicts the risk tier", values: ["ok", "violation"], phrase: (v) => (v === "violation" ? "whose policy contradicts its risk tier" : "whose policy matches its tier") },
];

export const TOOL_QUERY: QuerySchema = {
  id: "tools",
  subject: "Tools",
  emptyExplanation: "All tools, riskiest first.",
  placeholder: "risk:high policy:violation",
  label: "Filter tools",
  fields: TOOL_FIELDS,
};

const SCHEMA_INDEX = new WeakMap<FieldSpec[], Map<string, FieldSpec>>();

/** Memoised so a keystroke does not rebuild the index for every token. */
function indexOf(fields: FieldSpec[]): Map<string, FieldSpec> {
  let index = SCHEMA_INDEX.get(fields);
  if (!index) {
    index = new Map(fields.map((f) => [f.key, f]));
    SCHEMA_INDEX.set(fields, index);
  }
  return index;
}

/* ── Parse ────────────────────────────────────────────────────────────────── */

/** Splits on whitespace but keeps "quoted phrases" together. */
function tokenise(input: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i += 1;
    if (i >= input.length) break;
    const start = i;
    let text = "";
    let quote: string | null = null;
    while (i < input.length) {
      const ch = input[i];
      if (quote) {
        if (ch === quote) { quote = null; i += 1; continue; }
        text += ch; i += 1; continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
      if (/\s/.test(ch)) break;
      text += ch; i += 1;
    }
    out.push({ text, start });
  }
  return out;
}

export function parseQuery(input: string, fields: FieldSpec[] = RUN_FIELDS): ParsedQuery {
  const terms: QueryTerm[] = [];
  const errors: ParsedQuery["errors"] = [];
  const byKey = indexOf(fields);

  for (const token of tokenise(input)) {
    const end = token.start + token.text.length;
    const match = /^([a-zA-Z_]+)(>=|<=|[:><])(.*)$/.exec(token.text);

    if (!match) {
      // A bare word searches name and id. `status:` with nothing after it is a
      // partial the user is still typing, not an error worth shouting about.
      terms.push({ key: null, comparator: ":", value: token.text, start: token.start, end });
      continue;
    }

    const [, key, comparator, rawValue] = match;
    const spec = byKey.get(key);
    const keyEnd = token.start + key.length;

    if (!spec) {
      const message = `Unknown field “${key}”. Try ${nearestKeys(key, fields).join(", ")}.`;
      errors.push({ message, start: token.start, end: keyEnd });
      terms.push({ key, comparator: comparator as Comparator, value: rawValue, start: token.start, end, keyEnd, error: message });
      continue;
    }

    if (comparator !== ":" && !spec.numeric) {
      const message = `“${key}” only supports “:”, not “${comparator}”.`;
      errors.push({ message, start: keyEnd, end: keyEnd + comparator.length });
      terms.push({ key, comparator: comparator as Comparator, value: rawValue, start: token.start, end, keyEnd, error: message });
      continue;
    }

    let error: string | undefined;
    if (rawValue !== "") {
      if (spec.kind === "enum" && !spec.values!.includes(rawValue)) {
        error = `“${rawValue}” is not a ${key}. Options: ${spec.values!.join(", ")}.`;
      } else if (spec.kind === "relative-time" && parseRelativeMs(rawValue) === null) {
        error = `“${rawValue}” is not a duration. Use 30m, 24h or 7d.`;
      } else if (spec.kind === "duration" && parseDurationMs(rawValue) === null) {
        error = `“${rawValue}” is not a duration. Use 800ms, 30s or 2m.`;
      } else if (spec.kind === "number" && !Number.isFinite(Number(rawValue))) {
        error = `“${rawValue}” is not a number.`;
      }
      if (error) errors.push({ message: error, start: keyEnd + comparator.length, end });
    }

    terms.push({
      key, comparator: comparator as Comparator, value: rawValue,
      start: token.start, end, keyEnd, error,
    });
  }

  return { terms, errors };
}

/** Cheap edit-distance suggestion so a typo names its own fix. */
function nearestKeys(input: string, fields: FieldSpec[]): string[] {
  const scored = fields.map((f) => ({ key: f.key, d: distance(input, f.key) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  return scored.map((s) => s.key);
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

/* ── Value parsing ────────────────────────────────────────────────────────── */

/** `24h` → ms. Null when it is not a relative span. */
export function parseRelativeMs(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(m|h|d|w)$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2] as "m" | "h" | "d" | "w"];
  return n * unit;
}

/** `800ms` · `30s` · `2m` → ms. */
export function parseDurationMs(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] as "ms" | "s" | "m" | "h"];
  return n * unit;
}

/* ── Match ────────────────────────────────────────────────────────────────── */

function compare(actual: number, comparator: Comparator, expected: number): boolean {
  switch (comparator) {
    case ">": return actual > expected;
    case "<": return actual < expected;
    case ">=": return actual >= expected;
    case "<=": return actual <= expected;
    default: return actual === expected;
  }
}

/**
 * Compiles the parsed query to a predicate.
 *
 * Compiled once per query rather than re-interpreted per row: at 10,000 rows a
 * switch inside the row loop is 10,000 switches, and the filter budget for this
 * page is 100ms total.
 */
export function compileRunPredicate(
  parsed: ParsedQuery,
  now: number,
): (run: Run) => boolean {
  const checks: ((run: Run) => boolean)[] = [];

  for (const term of parsed.terms) {
    if (term.error || term.value === "") continue;
    const { key, comparator, value } = term;

    if (key === null) {
      const needle = value.toLowerCase();
      checks.push((r) =>
        r.workflowName.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle));
      continue;
    }

    switch (key) {
      case "status": checks.push((r) => r.status === (value as RunStatus)); break;
      case "workflow": {
        const needle = value.toLowerCase();
        checks.push((r) => r.workflowName.toLowerCase().includes(needle));
        break;
      }
      case "env": checks.push((r) => r.environment === value); break;
      case "trigger": checks.push((r) => r.trigger === value); break;
      case "id": {
        const needle = value.toLowerCase();
        checks.push((r) => r.id.toLowerCase().includes(needle));
        break;
      }
      case "incident": checks.push((r) => r.incidentId === value); break;
      case "since": {
        const span = parseRelativeMs(value);
        if (span === null) break;
        const floor = now - span;
        checks.push((r) => Date.parse(r.startedAt) >= floor);
        break;
      }
      case "cost": {
        const n = Number(value);
        checks.push((r) => compare(r.costUsd, comparator, n));
        break;
      }
      case "tokens": {
        const n = Number(value);
        checks.push((r) => compare(r.tokens, comparator, n));
        break;
      }
      case "steps": {
        const n = Number(value);
        checks.push((r) => compare(r.nodes.length, comparator, n));
        break;
      }
      case "duration": {
        const ms = parseDurationMs(value);
        if (ms === null) break;
        checks.push((r) => r.durationMs !== null && compare(r.durationMs, comparator, ms));
        break;
      }
    }
  }

  if (checks.length === 0) return () => true;
  if (checks.length === 1) return checks[0];
  return (run) => {
    for (const check of checks) if (!check(run)) return false;
    return true;
  };
}

/* ── Workflows ────────────────────────────────────────────────────────────── */

export type HealthBand = "healthy" | "degraded" | "failing";

/**
 * Success rate to a word.
 *
 * Bands rather than a raw percentage because "failing" is the filter an operator
 * actually wants at 3am, and 87.5% is a number they would have to threshold in
 * their head. The cuts are the same ones the health column paints with.
 */
export function healthBand(successRate: number): HealthBand {
  if (successRate >= 90) return "healthy";
  if (successRate >= 60) return "degraded";
  return "failing";
}

/**
 * Compiles a workflow query to a predicate.
 *
 * `searchText` is supplied by the caller rather than computed here: matching a
 * bare term against node contents means reading the workflow's live version,
 * and a predicate that resolves version fixtures per row would do it once per
 * row per keystroke. The caller builds the haystack once and hands it in.
 */
export function compileWorkflowPredicate(
  parsed: ParsedQuery,
  searchText: (workflow: Workflow) => string,
): (workflow: Workflow) => boolean {
  const checks: ((w: Workflow) => boolean)[] = [];

  for (const term of parsed.terms) {
    if (term.error || term.value === "") continue;
    const { key, comparator, value } = term;
    const needle = value.toLowerCase();

    if (key === null) {
      checks.push((w) => searchText(w).includes(needle));
      continue;
    }

    switch (key) {
      case "status": checks.push((w) => w.status === (value as WorkflowStatus)); break;
      case "trigger": checks.push((w) => w.trigger === value); break;
      case "env": checks.push((w) => w.environment === value); break;
      case "owner": checks.push((w) => w.owner.toLowerCase().includes(needle)); break;
      case "tag": checks.push((w) => w.tags.some((t) => t.toLowerCase() === needle)); break;
      case "health": checks.push((w) => healthBand(w.successRate30d) === value); break;
      case "name": checks.push((w) => w.name.toLowerCase().includes(needle)); break;
      // `node:` is the deliberate narrow version of the bare term — it searches
      // the graph only, so `node:postgres` does not match a workflow that merely
      // mentions Postgres in its description.
      case "node": checks.push((w) => searchText(w).includes(needle)); break;
      case "connection":
        checks.push((w) => w.connectionNames.some((c) => c.toLowerCase().includes(needle)));
        break;
      case "steps": {
        const n = Number(value);
        checks.push((w) => compare(w.stepCount, comparator, n));
        break;
      }
      case "rate": {
        const n = Number(value);
        checks.push((w) => compare(w.successRate30d, comparator, n));
        break;
      }
      case "spend": {
        const n = Number(value);
        checks.push((w) => compare(w.spend30dUsd, comparator, n));
        break;
      }
      case "version": {
        const n = Number(value);
        checks.push((w) => compare(w.version, comparator, n));
        break;
      }
    }
  }

  if (checks.length === 0) return () => true;
  if (checks.length === 1) return checks[0];
  return (workflow) => {
    for (const check of checks) if (!check(workflow)) return false;
    return true;
  };
}

/* ── Registry predicates ──────────────────────────────────────────────────── */

/**
 * A generic compiler for the registries.
 *
 * Both take the same shape — enums, substring text, numeric comparisons — so
 * they share one compiler driven by an accessor table rather than carrying two
 * near-identical switch statements that drift the first time a field is added.
 */
export function compileRecordPredicate<T>(
  parsed: ParsedQuery,
  accessors: Record<string, (record: T) => string | number | string[]>,
  searchText: (record: T) => string,
): (record: T) => boolean {
  const checks: ((record: T) => boolean)[] = [];

  for (const term of parsed.terms) {
    if (term.error || term.value === "") continue;
    const needle = term.value.toLowerCase();

    if (term.key === null) {
      checks.push((r) => searchText(r).includes(needle));
      continue;
    }

    const get = accessors[term.key];
    if (!get) continue;

    const numeric = Number(term.value);
    checks.push((record) => {
      const actual = get(record);
      if (Array.isArray(actual)) return actual.some((v) => String(v).toLowerCase().includes(needle));
      if (typeof actual === "number") {
        return Number.isFinite(numeric) ? compare(actual, term.comparator, numeric) : false;
      }
      const text = String(actual).toLowerCase();
      // Enums match exactly, free text matches as a substring: `type:http`
      // should not also return `db-write`, but `owner:ops` should find
      // `platform-ops`.
      return term.comparator === ":" && text === needle ? true : text.includes(needle);
    });
  }

  if (checks.length === 0) return () => true;
  if (checks.length === 1) return checks[0];
  return (record) => {
    for (const check of checks) if (!check(record)) return false;
    return true;
  };
}

/* ── Explain ──────────────────────────────────────────────────────────────── */

const COMPARATOR_WORD: Record<Comparator, string> = {
  ":": "is", ">": "is over", "<": "is under", ">=": "is at least", "<=": "is at most",
};

/**
 * Plain English for the active query, shown beneath the input.
 *
 * This is the honesty check on the parser. If the sentence does not describe
 * what you meant, the query does not either — which is much easier to notice
 * than an empty result table.
 */
export function explainQuery(parsed: ParsedQuery, schema: QuerySchema = RUN_QUERY): string {
  const usable = parsed.terms.filter((t) => !t.error && t.value !== "");
  if (usable.length === 0) return schema.emptyExplanation;

  const byKey = indexOf(schema.fields);
  const parts = usable.map((term) => {
    if (term.key === null) return `matching “${term.value}”`;
    const spec = byKey.get(term.key);
    if (!spec?.phrase) return `${term.key} ${term.comparator} ${term.value}`;
    return spec.phrase(term.value, COMPARATOR_WORD[term.comparator]);
  });

  return `${schema.subject} ${parts.join(", ")}.`;
}

function humaniseSpan(value: string): string {
  const m = /^(\d+(?:\.\d+)?)(m|h|d|w)$/.exec(value);
  if (!m) return value;
  const n = Number(m[1]);
  const word = { m: "minute", h: "hour", d: "day", w: "week" }[m[2] as "m" | "h" | "d" | "w"];
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/* ── Autocomplete ─────────────────────────────────────────────────────────── */

export interface Suggestion {
  /** What gets inserted. */
  insert: string;
  label: string;
  detail: string;
  kind: "field" | "value";
}

/**
 * Suggestions for the caret position.
 *
 * Keys before the comparator, values after it. Returning field suggestions
 * while someone is typing a value is the fastest way to make autocomplete
 * feel like it is fighting you.
 */
export function suggest(
  input: string, caret: number, fields: FieldSpec[] = RUN_FIELDS,
): { suggestions: Suggestion[]; replaceFrom: number } {
  const before = input.slice(0, caret);
  const wordStart = Math.max(0, before.lastIndexOf(" ") + 1);
  const word = before.slice(wordStart);

  const split = /^([a-zA-Z_]+)(>=|<=|[:><])(.*)$/.exec(word);

  if (split) {
    const [, key, comparator, partial] = split;
    const spec = indexOf(fields).get(key);
    if (!spec?.values) return { suggestions: [], replaceFrom: wordStart };
    return {
      replaceFrom: wordStart,
      suggestions: spec.values
        .filter((v) => v.startsWith(partial))
        .map((v) => ({
          insert: `${key}${comparator}${v}`,
          label: v,
          detail: `${key} ${COMPARATOR_WORD[comparator as Comparator]} ${v}`,
          kind: "value" as const,
        })),
    };
  }

  return {
    replaceFrom: wordStart,
    suggestions: fields
      .filter((f) => f.key.startsWith(word.toLowerCase()))
      .map((f) => ({
        insert: `${f.key}:`,
        label: `${f.key}:`,
        detail: f.description,
        kind: "field" as const,
      })),
  };
}

/** Serialises terms back to a query string — used by chips and clusters. */
export function toQueryString(terms: { key: string; comparator?: Comparator; value: string }[]): string {
  return terms.map((t) => `${t.key}${t.comparator ?? ":"}${t.value}`).join(" ");
}
