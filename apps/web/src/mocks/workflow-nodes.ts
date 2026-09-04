import type { NodeKind } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKFLOW NODES AND THEIR EDIT HISTORY

   The definition side of a workflow, as opposed to the execution side. A
   `RunNode` says what happened; a `VersionNode` says what was configured. The
   version diff compares the second kind, which is why they are separate types
   rather than one type with half its fields null.

   WHY VERSIONS ARE BUILT BY APPLYING OPS RATHER THAN AUTHORED SIDE BY SIDE.

   The diff is the product here, and a diff is only worth looking at if the two
   graphs genuinely differ node by node. Authoring v1 and v2 independently
   produces one of two failures: they come out identical (the diff renders
   nothing) or they come out randomly different (the diff renders noise, and the
   plain-English summary says "11 nodes added, 12 removed" because no node
   identity survived). Deriving each version from the previous one through
   explicit add / remove / set operations guarantees node identity is preserved
   exactly where it should be, and that every difference the diff reports is a
   difference somebody deliberately made.

   It also means the change summary in the timeline cannot disagree with the
   diff, because both are computed from the same operations.
══════════════════════════════════════════════════════════════════════════════ */

/** A JSON-ish config tree. Diffed by flattened dotted path. */
export type NodeConfig = Record<string, unknown>;

export interface VersionNode {
  /** Stable across versions. Node identity is what makes a diff meaningful. */
  id: string;
  name: string;
  kind: NodeKind;
  config: NodeConfig;
}

/* ── Operations ───────────────────────────────────────────────────────────── */

export type NodeOp =
  /** `after: null` inserts at the head. */
  | { op: "add"; after: string | null; node: VersionNode }
  | { op: "remove"; id: string }
  /** Dotted path into the node's config: `retry.attempts`. */
  | { op: "set"; id: string; path: string; value: unknown }
  | { op: "rename"; id: string; name: string };

function setPath(config: NodeConfig, path: string, value: unknown): NodeConfig {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) return { ...config, [head]: value };
  const child = (config[head] ?? {}) as NodeConfig;
  return { ...config, [head]: setPath(child, rest.join("."), value) };
}

/**
 * Applies an ordered list of operations, returning a NEW node list.
 *
 * Never mutates, because every version holds a reference to its own array and a
 * shared mutation would rewrite history retroactively — the one thing a version
 * record must not do.
 */
export function applyOps(nodes: VersionNode[], ops: NodeOp[]): VersionNode[] {
  let next = nodes.map((n) => ({ ...n, config: { ...n.config } }));

  for (const op of ops) {
    if (op.op === "add") {
      const at = op.after === null ? 0 : next.findIndex((n) => n.id === op.after) + 1;
      // An `after` that no longer exists appends rather than silently dropping
      // the node — a lost node would show up in the diff as a change nobody made.
      const index = op.after !== null && at === 0 ? next.length : at;
      next = [...next.slice(0, index), op.node, ...next.slice(index)];
    } else if (op.op === "remove") {
      next = next.filter((n) => n.id !== op.id);
    } else if (op.op === "set") {
      next = next.map((n) => (n.id === op.id ? { ...n, config: setPath(n.config, op.path, op.value) } : n));
    } else {
      next = next.map((n) => (n.id === op.id ? { ...n, name: op.name } : n));
    }
  }

  return next;
}

/* ── Config vocabulary ────────────────────────────────────────────────────── */

const RETRY = { attempts: 3, backoff: "exponential", maxDelayMs: 8_000 };

export function toolNode(
  id: string, name: string, tool: string, connection: string | null,
  overrides: NodeConfig = {},
): VersionNode {
  return {
    id, name, kind: "tool",
    config: {
      tool,
      connection,
      timeoutMs: 30_000,
      retry: { ...RETRY },
      idempotencyKey: `${tool}:{{run.id}}`,
      ...overrides,
    },
  };
}

export function llmNode(id: string, name: string, overrides: NodeConfig = {}): VersionNode {
  return {
    id, name, kind: "llm",
    config: {
      model: "claude-haiku-4",
      provider: "anthropic",
      temperature: 0,
      maxTokens: 2_048,
      promptVersion: 3,
      outputSchema: "strict",
      retry: { ...RETRY, attempts: 2 },
      ...overrides,
    },
  };
}

export function agentNode(id: string, name: string, overrides: NodeConfig = {}): VersionNode {
  return {
    id, name, kind: "agent",
    config: {
      model: "claude-sonnet-4",
      provider: "anthropic",
      maxSteps: 8,
      toolGrants: ["postgres.query", "slack.postMessage"],
      guardrails: ["no-pii-egress"],
      retry: { ...RETRY, attempts: 2 },
      ...overrides,
    },
  };
}

const NODE_FACTORY: Partial<Record<NodeKind, (id: string, name: string) => VersionNode>> = {
  trigger: (id, name) => ({
    id, name, kind: "trigger",
    config: { cron: "0 9 * * *", timezone: "UTC", jitterSeconds: 0, overlapPolicy: "skip" },
  }),
  branch: (id, name) => ({ id, name, kind: "branch", config: { condition: "tier == 'enterprise'", otherwise: "skip" } }),
  parallel: (id, name) => ({ id, name, kind: "parallel", config: { over: "accounts", maxConcurrency: 8 } }),
  merge: (id, name) => ({ id, name, kind: "merge", config: { strategy: "concat" } }),
  wait: (id, name) => ({ id, name, kind: "wait", config: { forMs: 60_000 } }),
  approval: (id, name) => ({
    id, name, kind: "approval",
    config: { approverGroup: "billing", slaMinutes: 240, onTimeout: "escalate" },
  }),
  checkpoint: (id, name) => ({ id, name, kind: "checkpoint", config: { scope: "run" } }),
  output: (id, name) => ({ id, name, kind: "output", config: { format: "json", destination: "slack:#ops" } }),
  end: (id, name) => ({ id, name, kind: "end", config: {} }),
};

function plainNode(kind: NodeKind, id: string, name: string): VersionNode {
  const make = NODE_FACTORY[kind];
  return make ? make(id, name) : { id, name, kind, config: {} };
}

/* ── Blueprints ───────────────────────────────────────────────────────────── */

export interface Revision {
  author: string;
  /** Hours before NOW that this revision was committed. */
  hoursAgo: number;
  /** Published to this environment, or null for an unpublished draft. */
  publishedTo: "production" | "staging" | "development" | null;
  note: string | null;
  ops: NodeOp[];
}

export interface Blueprint {
  description: string;
  tags: string[];
  base: VersionNode[];
  revisions: Revision[];
}

/* ── The signature workflow, authored by hand ─────────────────────────────────
   renewals-daily is the workflow the whole demo narrative runs through: it is
   the one whose run fails on `contracts.getUpcomingRenewals` because the
   "Postgres Answers" connection is refusing connections. Its history therefore
   has to contain the change that plausibly caused that — v5 raises the tool
   timeout and drops the retry budget — so that comparing v4 against v5 answers
   "did the change help?" with a real regression rather than with noise. */

const RENEWALS_BASE: VersionNode[] = [
  plainNode("trigger", "n-trigger", "Schedule trigger"),
  toolNode("n-load-accounts", "Load account batch", "postgres.query", "Postgres Answers"),
  toolNode("n-renewals", "contracts.getUpcomingRenewals", "contracts.getUpcomingRenewals", "Postgres Answers"),
  plainNode("branch", "n-branch-tier", "Branch on tier"),
  llmNode("n-classify", "Classify intent"),
  llmNode("n-summarise", "Summarise findings"),
  toolNode("n-notify", "slack.postMessage", "slack.postMessage", "Slack — Acme"),
  plainNode("output", "n-report", "Emit report"),
];

const RENEWALS: Blueprint = {
  description: "Finds contracts renewing in the next 30 days, drafts the outreach, and posts the batch to billing.",
  tags: ["billing", "revenue", "daily"],
  base: RENEWALS_BASE,
  revisions: [
    {
      author: "priya.raman", hoursAgo: 41 * 24, publishedTo: "production", note: null,
      ops: [
        { op: "add", after: "n-renewals", node: plainNode("checkpoint", "n-ckpt-1", "Commit checkpoint") },
        { op: "set", id: "n-trigger", path: "cron", value: "0 6 * * *" },
      ],
    },
    {
      author: "priya.raman", hoursAgo: 26 * 24, publishedTo: "production", note: "Enterprise accounts need a human on the loop.",
      ops: [
        { op: "add", after: "n-summarise", node: plainNode("approval", "n-approve", "Await approval") },
        { op: "set", id: "n-approve", path: "approverGroup", value: "billing" },
        { op: "set", id: "n-classify", path: "model", value: "claude-sonnet-4" },
      ],
    },
    {
      author: "d.okafor", hoursAgo: 12 * 24, publishedTo: "production", note: null,
      ops: [
        { op: "add", after: "n-branch-tier", node: plainNode("parallel", "n-fan", "Fan out per account") },
        { op: "add", after: "n-classify", node: plainNode("merge", "n-merge", "Merge results") },
        { op: "remove", id: "n-load-accounts" },
        { op: "set", id: "n-fan", path: "maxConcurrency", value: 12 },
      ],
    },
    {
      author: "d.okafor", hoursAgo: 5 * 24, publishedTo: "production", note: null,
      ops: [
        { op: "set", id: "n-summarise", path: "model", value: "claude-sonnet-4" },
        { op: "set", id: "n-summarise", path: "maxTokens", value: 4_096 },
        { op: "rename", id: "n-notify", name: "Post batch to billing" },
      ],
    },
    {
      /* The regression. Raising the timeout without raising the retry budget
         means a slow connection now burns 90 seconds and then gives up with one
         attempt left instead of three. This is the change the reliability
         comparison is built to catch. */
      author: "priya.raman", hoursAgo: 31, publishedTo: "production",
      note: "Postgres was timing out at 30s during the month-end batch.",
      ops: [
        { op: "set", id: "n-renewals", path: "timeoutMs", value: 90_000 },
        { op: "set", id: "n-renewals", path: "retry.attempts", value: 1 },
        { op: "set", id: "n-renewals", path: "retry.maxDelayMs", value: 2_000 },
      ],
    },
    {
      /* Unpublished draft sitting past the live version — the state the version
         banner on the overview exists to announce. */
      author: "priya.raman", hoursAgo: 3, publishedTo: null, note: null,
      ops: [
        { op: "set", id: "n-renewals", path: "retry.attempts", value: 4 },
        { op: "set", id: "n-renewals", path: "retry.backoff", value: "exponential-jitter" },
        { op: "add", after: "n-renewals", node: toolNode("n-fallback", "Read from replica", "postgres.query", "Postgres Answers", { readonly: true, timeoutMs: 15_000 }) },
      ],
    },
  ],
};

/* ── The rest, generated from a shared vocabulary ──────────────────────────────
   Generated rather than authored because eleven hand-written histories would be
   eleven chances to drift, and only one of them carries narrative weight. The
   generator still emits REAL operations — a workflow's v3 differs from its v2 by
   a named node and a named field, not by a reshuffle. */

const KIND_CYCLE: { kind: NodeKind; name: string }[] = [
  { kind: "trigger", name: "Trigger" },
  { kind: "tool", name: "Load records" },
  { kind: "llm", name: "Classify intent" },
  { kind: "branch", name: "Branch on tier" },
  { kind: "agent", name: "Resolve case" },
  { kind: "tool", name: "Write result" },
  { kind: "checkpoint", name: "Commit checkpoint" },
  { kind: "llm", name: "Summarise findings" },
  { kind: "tool", name: "Notify owner" },
  { kind: "approval", name: "Await approval" },
  { kind: "parallel", name: "Fan out" },
  { kind: "merge", name: "Merge results" },
  { kind: "output", name: "Emit report" },
];

const TOOL_POOL: { tool: string; connection: string | null }[] = [
  { tool: "postgres.query", connection: "Postgres Answers" },
  { tool: "slack.postMessage", connection: "Slack — Acme" },
  { tool: "stripe.getInvoice", connection: "Stripe — Live" },
  { tool: "hubspot.getContact", connection: "HubSpot CRM" },
  { tool: "gmail.send", connection: "Gmail — ops@" },
  { tool: "github.createIssue", connection: "GitHub — acme" },
  { tool: "sheets.appendRow", connection: null },
  { tool: "http.post", connection: null },
];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function generateBase(name: string, stepCount: number, offset: number): VersionNode[] {
  const nodes: VersionNode[] = [];
  let toolIndex = offset;

  for (let i = 0; i < stepCount; i += 1) {
    const template = KIND_CYCLE[(i + offset) % KIND_CYCLE.length];
    // The first node is always the trigger; nothing else may be one.
    const kind = i === 0 ? "trigger" : template.kind === "trigger" ? "tool" : template.kind;
    const label = i === 0 ? "Trigger" : template.name;
    const id = `n-${slug(label)}-${i}`;

    if (kind === "tool") {
      const t = TOOL_POOL[toolIndex % TOOL_POOL.length];
      toolIndex += 1;
      nodes.push(toolNode(id, t.tool, t.tool, t.connection));
    } else if (kind === "llm") {
      nodes.push(llmNode(id, label));
    } else if (kind === "agent") {
      nodes.push(agentNode(id, `${label.split(" ")[0]} agent`));
    } else {
      nodes.push(plainNode(kind, id, label));
    }
  }

  // Never end on a structural node — a workflow that stops at a `parallel` is
  // an unreachable-branch validation error in every version, which would make
  // the publish flow's Validate step read as broken rather than as strict.
  const last = nodes[nodes.length - 1];
  if (last && (last.kind === "parallel" || last.kind === "branch")) {
    nodes.push(plainNode("output", `n-emit-${nodes.length}`, "Emit report"));
  }
  return nodes;
}

const AUTHORS = ["priya.raman", "d.okafor", "m.lindqvist", "s.aggarwal", "tom.ryan"];

/**
 * One revision's worth of operations, chosen from a catalogue by index.
 *
 * Each entry is a change a person would actually make, so the generated
 * summaries read like release notes rather than like a fuzzer's output.
 */
function generateOps(nodes: VersionNode[], index: number, revision: number): NodeOp[] {
  const ops: NodeOp[] = [];
  const llm = nodes.find((n) => n.kind === "llm");
  const tool = nodes.filter((n) => n.kind === "tool")[revision % Math.max(1, nodes.filter((n) => n.kind === "tool").length)];
  const anchor = nodes[Math.min(nodes.length - 1, 2 + revision)];

  switch ((index + revision) % 5) {
    case 0:
      ops.push({ op: "add", after: anchor?.id ?? null, node: plainNode("checkpoint", `n-ckpt-${revision}`, "Commit checkpoint") });
      if (tool) ops.push({ op: "set", id: tool.id, path: "retry.attempts", value: 4 });
      break;
    case 1:
      if (llm) {
        ops.push({ op: "set", id: llm.id, path: "model", value: "claude-sonnet-4" });
        ops.push({ op: "set", id: llm.id, path: "maxTokens", value: 4_096 });
      }
      if (tool) ops.push({ op: "set", id: tool.id, path: "timeoutMs", value: 60_000 });
      break;
    case 2: {
      const removable = nodes.filter((n) => n.kind === "tool" || n.kind === "wait")[1];
      if (removable) ops.push({ op: "remove", id: removable.id });
      ops.push({ op: "add", after: anchor?.id ?? null, node: toolNode(`n-lookup-${revision}`, "hubspot.getContact", "hubspot.getContact", "HubSpot CRM") });
      break;
    }
    case 3:
      ops.push({ op: "add", after: anchor?.id ?? null, node: plainNode("approval", `n-gate-${revision}`, "Await approval") });
      ops.push({ op: "set", id: `n-gate-${revision}`, path: "slaMinutes", value: 120 });
      break;
    default:
      if (tool) {
        ops.push({ op: "set", id: tool.id, path: "retry.backoff", value: "exponential-jitter" });
        ops.push({ op: "set", id: tool.id, path: "idempotencyKey", value: `${String(tool.config.tool)}:{{input.accountId}}` });
        ops.push({ op: "rename", id: tool.id, name: `${String(tool.config.tool)} (idempotent)` });
      }
      break;
  }

  return ops;
}

function generateBlueprint(
  name: string, stepCount: number, versionCount: number, index: number,
  environment: "production" | "staging" | "development",
  hasDraft: boolean,
): Blueprint {
  const base = generateBase(name, stepCount, index);
  const revisions: Revision[] = [];
  let nodes = base;

  for (let r = 0; r < versionCount - 1; r += 1) {
    const ops = generateOps(nodes, index, r);
    const draft = hasDraft && r === versionCount - 2;

    /* One draft in the fixture set is genuinely half-finished: a fan-out added
       without the merge that closes it. Without it, every workflow validates
       clean and the Validate gate never demonstrates the thing it exists for —
       and a gate nobody has seen hold is a gate nobody trusts. This is also the
       most common way a real draft is broken: the author added the branch and
       got interrupted. */
    if (draft && name === "contract-sync") {
      ops.push({
        op: "add",
        after: nodes[1]?.id ?? null,
        node: plainNode("parallel", "n-fan-wip", "Fan out per contract"),
      });
    }

    nodes = applyOps(nodes, ops);
    revisions.push({
      author: AUTHORS[(index + r) % AUTHORS.length],
      // Newer versions land closer together — the shape of a workflow that is
      // actively being worked on rather than one edited on a metronome.
      hoursAgo: Math.round(6 + (versionCount - 1 - r) ** 2 * 9 + index * 3),
      publishedTo: draft ? null : environment,
      note: null,
      ops,
    });
  }

  return {
    description: DESCRIPTIONS[name] ?? "No description yet.",
    tags: TAGS[name] ?? ["untagged"],
    base,
    revisions,
  };
}

const DESCRIPTIONS: Record<string, string> = {
  "renewals-daily": RENEWALS.description,
  "dunning-escalation": "Chases failed payments through three escalating touches, then hands the account to a human.",
  "customer-onboarding": "Provisions a new workspace, seeds the sample data, and books the kickoff call.",
  "refund-approvals": "Routes refund requests over £500 to billing with the invoice and account history attached.",
  "invoice-reconciliation": "Matches Stripe payouts against ledger entries and files the exceptions.",
  "support-triage": "Classifies inbound tickets, tags them, and routes anything urgent to the on-call rota.",
  "usage-rollup": "Aggregates metered usage per account and writes the daily rollup to the warehouse.",
  "churn-signals": "Scores accounts on usage decay and opens a play for anything trending to churn.",
  "contract-sync": "Mirrors signed contracts from the CLM into the billing ledger.",
  "nps-followup": "Sends the survey, reads the free text, and opens a follow-up for every detractor.",
  "trial-conversion": "Nudges trials approaching their end date and flags the ones worth a call.",
};

const TAGS: Record<string, string[]> = {
  "renewals-daily": ["billing", "revenue", "daily"],
  "dunning-escalation": ["billing", "collections"],
  "customer-onboarding": ["lifecycle", "provisioning"],
  "refund-approvals": ["billing", "gated"],
  "invoice-reconciliation": ["finance", "daily"],
  "support-triage": ["support", "realtime"],
  "usage-rollup": ["data", "daily"],
  "churn-signals": ["growth", "scoring"],
  "contract-sync": ["finance", "sync"],
  "nps-followup": ["growth", "survey"],
  "trial-conversion": ["growth", "lifecycle"],
};

/** Blueprint per workflow name. `renewals-daily` is hand-authored; the rest are generated. */
export function blueprintFor(
  name: string, stepCount: number, versionCount: number, index: number,
  environment: "production" | "staging" | "development",
  hasDraft: boolean,
): Blueprint {
  if (name === "renewals-daily") return RENEWALS;
  return generateBlueprint(name, stepCount, versionCount, index, environment, hasDraft);
}

/**
 * The node list AT each version — index 0 is v1, index n is v(n+1).
 *
 * One function, called by both the fixture that builds the workflow row and the
 * one that builds the version records, so "what the live version contains"
 * cannot be answered two different ways on two different screens.
 */
export function versionNodeSets(blueprint: Blueprint): VersionNode[][] {
  const sets: VersionNode[][] = [blueprint.base];
  for (const revision of blueprint.revisions) {
    sets.push(applyOps(sets[sets.length - 1], revision.ops));
  }
  return sets;
}

/* ── Derivations ──────────────────────────────────────────────────────────── */

export function connectionsOf(nodes: VersionNode[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    const c = n.config.connection;
    if (typeof c === "string" && c) out.add(c);
  }
  return [...out];
}

export function toolsOf(nodes: VersionNode[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    const t = n.config.tool;
    if (typeof t === "string" && t) out.add(t);
  }
  return [...out];
}

export function countKind(nodes: VersionNode[], kind: NodeKind): number {
  return nodes.filter((n) => n.kind === kind).length;
}

/** Flattens a config to dotted paths, so two versions can be compared field by field. */
export function flattenConfig(config: NodeConfig, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenConfig(value as NodeConfig, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}
