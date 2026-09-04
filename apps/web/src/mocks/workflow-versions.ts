import { WORKFLOWS, RUNS, CONNECTIONS, TOOLS } from "./fixtures";
import { bucket, POLICY, type CostTrend, type TimeRange } from "./control";
import {
  blueprintFor, versionNodeSets, flattenConfig, connectionsOf, countKind,
  type VersionNode,
} from "./workflow-nodes";
import { layoutGraph, type LaidOutGraph } from "./graph-layout";
import type { Environment, Run, RunStatus, Workflow } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKFLOW VERSIONS — the capability the product implies and never shows.

   The builder displays "V1" and a History button with nothing behind it. This is
   what belongs behind it: an immutable record per publish, the reliability each
   version actually achieved, and a diff between any two of them.

   EVERYTHING DERIVED, NOTHING AUTHORED TWICE. The change summary, the config
   diff and the plain-English sentence all come out of one `diffVersions` call.
   A summary that says "3 nodes added" beside a graph showing four is the kind of
   contradiction that makes an operator stop trusting version history entirely —
   and version history is only useful if it is trusted during an incident, which
   is the worst possible time to discover it lies.
══════════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-11T14:20:00Z").getTime();
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  /** 1-based. The number a person says out loud: "we shipped v5 on Tuesday." */
  number: number;
  author: string;
  at: string;
  /** Generated from the diff against the previous version — never authored. */
  changeSummary: string;
  published: boolean;
  publishedTo: Environment | null;
  /** The optional note from the publish dialog. */
  note: string | null;
  nodes: VersionNode[];
  /** Runs that executed ON this version. */
  runCount: number;
  /** Percentage, 0–100. */
  successRate: number;
  avgDurationMs: number;
  spendUsd: number;
}

/* ── Build ────────────────────────────────────────────────────────────────── */

/**
 * Reliability per version, apportioned from the workflow's last-30 window.
 *
 * The newest versions get the newest runs, which is what makes "did the change
 * help?" answerable: a regression introduced in v6 shows up as v6's success rate
 * rather than being averaged into the workflow's lifetime number. Older versions
 * carry progressively more runs because they were live for longer.
 */
function apportion(
  workflow: Workflow, versionCount: number, hasDraft: boolean,
): { runs: RunStatus[]; real: Run[] }[] {
  const window = workflow.last30;
  // Real runs, sliced by the SAME proportions, so a version's average duration
  // and its success rate describe the same stretch of history rather than two
  // unrelated windows.
  const real = RUNS.filter((r) => r.workflowId === workflow.id);
  const out: { runs: RunStatus[]; real: Run[] }[] = [];
  let cursor = window.length;
  let realCursor = real.length;

  // A draft has never been published, so nothing has ever executed on it. Giving
  // it a share of the window would put a success rate beside a version that has
  // never run — the single most misleading number this screen could show.
  const publishedCount = hasDraft ? versionCount - 1 : versionCount;

  for (let v = publishedCount - 1; v >= 0; v -= 1) {
    /* The live version holds most of the window, and each older one holds
       roughly half of what is left. That is the real shape: versions are weeks
       apart and runs are hourly, so the last thirty runs mostly happened on
       whatever is live now. It also keeps the newest version above the
       five-run floor `compareReliability` needs — a comparison that always
       refuses to answer is a comparison nobody opens twice. */
    const share = v === 0 ? cursor : Math.max(1, Math.round(cursor * 0.45));
    const from = Math.max(0, cursor - share);

    const realShare = v === 0 ? realCursor : Math.max(1, Math.round(realCursor * 0.45));
    const realFrom = Math.max(0, realCursor - realShare);

    out.unshift({ runs: window.slice(from, cursor), real: real.slice(realFrom, realCursor) });
    cursor = from;
    realCursor = realFrom;
    if (cursor <= 0) break;
  }

  // Versions that ran before the 30-run window opened have no outcomes in it.
  while (out.length < publishedCount) out.unshift({ runs: [], real: [] });
  if (hasDraft) out.push({ runs: [], real: [] });
  return out;
}

function buildVersions(workflow: Workflow, index: number): WorkflowVersion[] {
  const hasDraft = workflow.draftVersion !== null;
  const versionCount = hasDraft ? workflow.draftVersion! : workflow.version;
  const blueprint = blueprintFor(
    workflow.name, workflow.stepCount, versionCount, index, workflow.environment, hasDraft,
  );
  const sets = versionNodeSets(blueprint);
  const buckets = apportion(workflow, sets.length, hasDraft);

  return sets.map((nodes, i) => {
    const revision = blueprint.revisions[i - 1];
    const bucket = buckets[i]?.runs ?? [];
    const real = buckets[i]?.real ?? [];
    const succeeded = bucket.filter((s) => s === "succeeded").length;
    const settled = bucket.filter((s) => s === "succeeded" || s === "failed").length;
    const isDraft = hasDraft && i === sets.length - 1;

    const timed = real.filter((r) => r.durationMs !== null);
    const avgDurationMs = timed.length > 0
      ? Math.round(timed.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / timed.length)
      : workflow.avgDurationMs ?? 42_000;
    const meanCost = real.length > 0
      ? real.reduce((sum, r) => sum + r.costUsd, 0) / real.length
      : 0.0026;

    // v1's summary has no predecessor to diff against, so it states the shape it
    // started as — the one place a sentence is composed rather than diffed.
    const changeSummary = i === 0
      ? `Created with ${plural(nodes.length, "node")}.`
      : summariseDiff(diffVersions(sets[i - 1], nodes));

    const at = i === 0
      ? NOW - (blueprint.revisions[0]?.hoursAgo ?? 60 * 24) * HOUR - 48 * HOUR
      : NOW - revision.hoursAgo * HOUR;

    return {
      id: `wfv_${workflow.id.slice(3)}_${i + 1}`,
      workflowId: workflow.id,
      number: i + 1,
      author: revision?.author ?? blueprint.revisions[0]?.author ?? "priya.raman",
      at: iso(at),
      changeSummary,
      published: !isDraft,
      publishedTo: isDraft ? null : (revision?.publishedTo ?? workflow.environment),
      note: revision?.note ?? null,
      nodes,
      runCount: bucket.length,
      successRate: settled === 0 ? 0 : Math.round((succeeded / settled) * 100),
      // Both derived from the real runs in this version's slice, so a version
      // that made the workflow slower shows as slower rather than inheriting the
      // workflow's lifetime average and reading "no change" forever.
      avgDurationMs,
      spendUsd: Number((bucket.length * meanCost).toFixed(4)),
    };
  });
}

/**
 * Built on first use, not at import.
 *
 * `buildVersions` calls `summariseDiff`, which reads a lookup table declared
 * further down this file. Building the map at module scope evaluated that call
 * inside the table's temporal dead zone and threw on import — a crash on every
 * route that touches a workflow. Deferring the work also keeps it off the
 * critical path for pages that never open version history.
 */
let VERSIONS: Map<string, WorkflowVersion[]> | null = null;

function allVersions(): Map<string, WorkflowVersion[]> {
  VERSIONS ??= new Map(WORKFLOWS.map((w, i) => [w.id, buildVersions(w, i)]));
  return VERSIONS;
}

/** Every version of a workflow, newest first — the order a timeline is read in. */
export function versionsFor(workflowId: string): WorkflowVersion[] {
  return [...(allVersions().get(workflowId) ?? [])].reverse();
}

export function versionByNumber(workflowId: string, number: number): WorkflowVersion | undefined {
  return allVersions().get(workflowId)?.[number - 1];
}

export function liveVersion(workflowId: string): WorkflowVersion | undefined {
  const all = allVersions().get(workflowId) ?? [];
  return [...all].reverse().find((v) => v.published);
}

export function draftVersion(workflowId: string): WorkflowVersion | undefined {
  const all = allVersions().get(workflowId) ?? [];
  return all[all.length - 1]?.published ? undefined : all[all.length - 1];
}

/**
 * The version to DESCRIBE the workflow with — published if there is one, the
 * newest draft otherwise.
 *
 * Distinct from `liveVersion`, which answers "what is running". A workflow whose
 * only version is an unpublished draft has nothing running, and reporting it as
 * zero steps with no connections would be true of the runtime and useless on a
 * list. Screens that describe use this; screens that make claims about
 * production use `liveVersion`.
 */
export function currentVersion(workflowId: string): WorkflowVersion | undefined {
  const all = allVersions().get(workflowId) ?? [];
  return liveVersion(workflowId) ?? all[all.length - 1];
}

export function getWorkflow(id: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.id === id) ?? WORKFLOWS.find((w) => w.name === id);
}

/* ── Diff ─────────────────────────────────────────────────────────────────── */

export interface FieldDiff {
  path: string;
  before: unknown;
  after: unknown;
  kind: "changed" | "added" | "removed";
}

export interface VersionDiff {
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: string[];
  /** Node id → the fields that changed on it. Only populated for `modified`. */
  fields: Record<string, FieldDiff[]>;
  /** Node id → its name in whichever version has it, for labelling. */
  names: Record<string, string>;
  /** Nodes that stayed but moved position — a reorder is not a modification. */
  moved: string[];
}

/**
 * Node-by-node diff between two versions.
 *
 * Keyed on node id, not on position. Position-keyed diffs report a single
 * insertion at the top as "every node changed", which is both wrong and the
 * exact case a workflow author hits most often.
 */
export function diffVersions(before: VersionNode[], after: VersionNode[]): VersionDiff {
  const beforeById = new Map(before.map((n) => [n.id, n]));
  const afterById = new Map(after.map((n) => [n.id, n]));
  const beforeIndex = new Map(before.map((n, i) => [n.id, i]));
  const afterIndex = new Map(after.map((n, i) => [n.id, i]));

  const diff: VersionDiff = {
    added: [], removed: [], modified: [], unchanged: [], moved: [], fields: {}, names: {},
  };

  for (const node of before) diff.names[node.id] = node.name;
  for (const node of after) diff.names[node.id] = node.name;

  for (const node of after) {
    if (!beforeById.has(node.id)) {
      diff.added.push(node.id);
      continue;
    }
    const previous = beforeById.get(node.id)!;
    const fields = diffConfig(previous, node);
    if (fields.length > 0) {
      diff.modified.push(node.id);
      diff.fields[node.id] = fields;
    } else {
      diff.unchanged.push(node.id);
    }
    if (beforeIndex.get(node.id) !== afterIndex.get(node.id)) diff.moved.push(node.id);
  }

  for (const node of before) {
    if (!afterById.has(node.id)) diff.removed.push(node.id);
  }

  return diff;
}

function diffConfig(before: VersionNode, after: VersionNode): FieldDiff[] {
  const out: FieldDiff[] = [];

  if (before.name !== after.name) {
    out.push({ path: "name", before: before.name, after: after.name, kind: "changed" });
  }

  const a = flattenConfig(before.config);
  const b = flattenConfig(after.config);
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

  for (const path of paths) {
    const has = { before: path in a, after: path in b };
    if (has.before && !has.after) {
      out.push({ path, before: a[path], after: undefined, kind: "removed" });
    } else if (!has.before && has.after) {
      out.push({ path, before: undefined, after: b[path], kind: "added" });
    } else if (JSON.stringify(a[path]) !== JSON.stringify(b[path])) {
      out.push({ path, before: a[path], after: b[path], kind: "changed" });
    }
  }

  return out;
}

/* ── Plain English ────────────────────────────────────────────────────────── */

function plural(n: number, word: string, pluralForm = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralForm}`;
}

/** `a`, `a and b`, `a, b and 2 more` — never "a and b and 2 more". */
function list(items: string[], max: number): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const tail = rest > 0 ? `${rest} more` : shown.pop()!;
  if (shown.length === 0) return tail;
  return `${shown.join(", ")} and ${tail}`;
}

/** Field paths worth naming in a sentence, in the words an operator uses. */
const FIELD_PHRASE: Record<string, string> = {
  "retry.attempts": "retry policy",
  "retry.backoff": "retry policy",
  "retry.maxDelayMs": "retry policy",
  timeoutMs: "timeout",
  model: "model",
  provider: "provider",
  temperature: "temperature",
  maxTokens: "token budget",
  cron: "schedule",
  timezone: "timezone",
  jitterSeconds: "jitter",
  overlapPolicy: "overlap policy",
  connection: "connection",
  idempotencyKey: "idempotency key",
  slaMinutes: "SLA",
  approverGroup: "approver group",
  onTimeout: "timeout behaviour",
  maxConcurrency: "concurrency",
  condition: "branch condition",
  name: "name",
  promptVersion: "prompt version",
};

/**
 * "3 nodes added, 1 removed, retry policy changed on Generate Email."
 *
 * Generated from the diff rather than written by the author, so it is impossible
 * for the sentence and the graph beside it to disagree. It names the specific
 * change when there is one worth naming, and counts when there are too many —
 * a sentence listing nine field changes is not a summary.
 */
export function summariseDiff(diff: VersionDiff): string {
  const parts: string[] = [];

  if (diff.added.length > 0) parts.push(`${plural(diff.added.length, "node")} added`);
  if (diff.removed.length > 0) parts.push(`${diff.removed.length} removed`);

  if (diff.modified.length > 0) {
    // One modified node gets its change named; several get counted.
    if (diff.modified.length <= 2) {
      for (const id of diff.modified) {
        const fields = diff.fields[id] ?? [];
        const phrases = [...new Set(fields.map((f) => FIELD_PHRASE[f.path] ?? f.path.split(".").pop()!))];
        parts.push(`${list(phrases, 2)} changed on ${diff.names[id]}`);
      }
    } else {
      parts.push(`${plural(diff.modified.length, "node")} reconfigured`);
    }
  }

  if (parts.length === 0) {
    return diff.moved.length > 0 ? "Nodes reordered. No configuration changed." : "No changes.";
  }

  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/* ── Diff graphs ──────────────────────────────────────────────────────────── */

export type DiffState = "added" | "removed" | "modified" | "unchanged";

export interface DiffNode extends VersionNode {
  state: DiffState;
}

export function diffState(diff: VersionDiff, id: string): DiffState {
  if (diff.added.includes(id)) return "added";
  if (diff.removed.includes(id)) return "removed";
  if (diff.modified.includes(id)) return "modified";
  return "unchanged";
}

/**
 * The union graph for overlay mode: every node from either version, in the
 * order the newer version puts them, with removed nodes reinserted where they
 * used to sit.
 *
 * A removed node dropped from the overlay makes the overlay identical to the
 * "after" graph, which is the one comparison that tells you nothing.
 */
export function overlayGraph(
  before: VersionNode[], after: VersionNode[], diff: VersionDiff,
): LaidOutGraph<DiffNode> {
  const merged: DiffNode[] = after.map((n) => ({ ...n, state: diffState(diff, n.id) }));

  before.forEach((node, i) => {
    if (!diff.removed.includes(node.id)) return;
    // Reinsert after whichever of its old neighbours survived, so a removed
    // node keeps its place in the sequence rather than piling up at the end.
    const previousSurvivor = before.slice(0, i).reverse().find((n) => !diff.removed.includes(n.id));
    const at = previousSurvivor ? merged.findIndex((n) => n.id === previousSurvivor.id) + 1 : 0;
    merged.splice(at, 0, { ...node, state: "removed" });
  });

  return layoutGraph(merged);
}

export function sideGraph(nodes: VersionNode[], diff: VersionDiff): LaidOutGraph<DiffNode> {
  return layoutGraph(nodes.map((n) => ({ ...n, state: diffState(diff, n.id) })));
}

/* ── Reliability comparison ───────────────────────────────────────────────── */

export interface ReliabilityComparison {
  a: WorkflowVersion;
  b: WorkflowVersion;
  successRateDelta: number;
  durationDelta: number;
  spendDelta: number;
  /** Null when neither version has enough runs to say anything honest. */
  verdict: "better" | "worse" | "no-change" | null;
  sentence: string;
}

/**
 * Did the change help?
 *
 * Refuses to answer below five settled runs on either side. A version with two
 * runs that both passed is not "100% reliable", and rendering it as a green
 * improvement is how a bad change gets promoted.
 */
export function compareReliability(a: WorkflowVersion, b: WorkflowVersion): ReliabilityComparison {
  const successRateDelta = b.successRate - a.successRate;
  const durationDelta = b.avgDurationMs - a.avgDurationMs;
  const spendDelta = b.spendUsd - a.spendUsd;
  const MIN = 5;

  if (a.runCount < MIN || b.runCount < MIN) {
    return {
      a, b, successRateDelta, durationDelta, spendDelta, verdict: null,
      sentence: `Not enough runs to compare. v${a.number} has ${plural(a.runCount, "run")} and v${b.number} has ${plural(b.runCount, "run")}; five each is the floor for a success rate to mean anything.`,
    };
  }

  const verdict = successRateDelta > 4 ? "better" : successRateDelta < -4 ? "worse" : "no-change";
  const direction = successRateDelta > 0 ? "up" : "down";
  const sentence = verdict === "no-change"
    ? `Success rate is unchanged within noise — ${a.successRate}% on v${a.number} against ${b.successRate}% on v${b.number}, across ${plural(a.runCount + b.runCount, "run")}.`
    : `Success rate went ${direction} ${Math.abs(successRateDelta)} points, from ${a.successRate}% on v${a.number} to ${b.successRate}% on v${b.number}, across ${plural(a.runCount + b.runCount, "run")}.`;

  return { a, b, successRateDelta, durationDelta, spendDelta, verdict, sentence };
}

/* ── Validation ───────────────────────────────────────────────────────────── */

export interface ValidationFinding {
  id: string;
  severity: "error" | "warning";
  /** The node that has to change. Null for whole-graph findings. */
  nodeId: string | null;
  nodeName: string | null;
  title: string;
  detail: string;
  /** What to do about it. Never "check your configuration". */
  fix: string;
}

/**
 * Structural and binding checks over a version's nodes.
 *
 * Real checks over the real node list, not a canned list of findings: a
 * validation step that always reports the same three problems teaches an
 * operator to click past it, which defeats the point of gating publish on it.
 */
export function validateVersion(nodes: VersionNode[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const known = new Map(CONNECTIONS.map((c) => [c.name, c]));

  if (nodes.length === 0) {
    findings.push({
      id: "empty", severity: "error", nodeId: null, nodeName: null,
      title: "The workflow has no nodes",
      detail: "There is nothing to publish.",
      fix: "Add a trigger and at least one step in the builder.",
    });
    return findings;
  }

  if (nodes[0].kind !== "trigger") {
    findings.push({
      id: "no-trigger", severity: "error", nodeId: nodes[0].id, nodeName: nodes[0].name,
      title: "The first node is not a trigger",
      detail: `The graph starts at ‘${nodes[0].name}’, which is a ${nodes[0].kind} node. A published workflow needs an entry point.`,
      fix: "Add a schedule, webhook or API trigger ahead of it.",
    });
  }

  nodes.forEach((node, i) => {
    if (i > 0 && node.kind === "trigger") {
      findings.push({
        id: `second-trigger-${node.id}`, severity: "error", nodeId: node.id, nodeName: node.name,
        title: "A second trigger sits mid-graph",
        detail: "Only the first node may be a trigger. Everything after it is unreachable from this one.",
        fix: "Delete this node or split the branch into its own workflow.",
      });
    }

    const connection = node.config.connection;
    if (typeof connection === "string" && connection !== "") {
      const record = known.get(connection);

      /* A connection the workspace does not have is a structural error: the node
         cannot resolve its credentials and the run dies on reaching it. */
      if (!record) {
        findings.push({
          id: `missing-conn-${node.id}`, severity: "error", nodeId: node.id, nodeName: node.name,
          title: `Connection ‘${connection}’ does not exist`,
          detail: `${node.name} binds a connection this workspace has no credentials for, so the node cannot authenticate.`,
          fix: `Create ‘${connection}’ under Connections, or bind this node to one that exists.`,
        });
      } else if (record.status !== "healthy") {
        /* A connection that exists but is DOWN is a warning, deliberately.
           Blocking a publish on it would block the publish that fixes it — and
           the change most likely to be shipped while Postgres is refusing
           connections is the one that stops calling Postgres. It is loud on the
           Publish step's impact panel instead, which is where it belongs. */
        findings.push({
          id: `conn-${node.id}`, severity: "warning", nodeId: node.id, nodeName: node.name,
          title: `Connection ‘${connection}’ is ${record.status}`,
          // Nodes are often named after the tool they call, so naming both
          // produces "postgres.query calls postgres.query through …".
          detail: `${node.name === node.config.tool
            ? `‘${node.name}’ runs through`
            : `${node.name} calls ${String(node.config.tool ?? "a tool")} through`
          } ‘${connection}’, which is ${record.status === "failing" ? "refusing connections" : "responding slowly"} right now. This version will fail there until the connection recovers.`,
          fix: `Fix or rotate ‘${connection}’, or publish anyway if this change is what fixes it.`,
        });
      }
    }

    if (node.config.connection === null && typeof node.config.tool === "string") {
      findings.push({
        id: `unbound-${node.id}`, severity: "warning", nodeId: node.id, nodeName: node.name,
        title: "Tool call has no connection bound",
        detail: `${node.name} calls ${String(node.config.tool)} with no connection selected. It will run with the workspace default, which may not be the one you mean.`,
        fix: "Bind a connection on the node's Configure tab.",
      });
    }

    const idempotency = node.config.idempotencyKey;
    if (node.kind === "tool" && typeof idempotency === "string" && idempotency.includes("{{run.id}}")) {
      findings.push({
        id: `idem-${node.id}`, severity: "warning", nodeId: node.id, nodeName: node.name,
        title: "Idempotency key is scoped to the run",
        detail: `A key of ‘${idempotency}’ makes every retry of a NEW run a fresh call. A retry of the same run is deduplicated; a re-run of the same input is not.`,
        fix: "Key on the input instead, e.g. the account or invoice id.",
      });
    }

    const attempts = (node.config.retry as { attempts?: number } | undefined)?.attempts;
    const timeout = node.config.timeoutMs;
    if (typeof attempts === "number" && attempts < 2 && typeof timeout === "number" && timeout >= 60_000) {
      findings.push({
        id: `retry-${node.id}`, severity: "warning", nodeId: node.id, nodeName: node.name,
        title: "One attempt against a long timeout",
        detail: `${node.name} waits ${Math.round(timeout / 1000)}s and then gives up after ${attempts} attempt. A slow dependency costs the whole run.`,
        fix: "Raise the retry budget to at least 3, or lower the timeout.",
      });
    }
  });

  // Unreachable: anything after a terminal `end` node.
  const endIndex = nodes.findIndex((n) => n.kind === "end");
  if (endIndex !== -1 && endIndex < nodes.length - 1) {
    const orphan = nodes[endIndex + 1];
    findings.push({
      id: `unreachable-${orphan.id}`, severity: "error", nodeId: orphan.id, nodeName: orphan.name,
      title: `‘${orphan.name}’ is unreachable`,
      detail: `The run ends at ‘${nodes[endIndex].name}’, so nothing after it executes.`,
      fix: "Move it above the end node, or delete it.",
    });
  }

  // An open fan with no merge leaves the branches unjoined.
  const fans = countKind(nodes, "parallel");
  const merges = countKind(nodes, "merge");
  if (fans > merges) {
    const fan = nodes.find((n) => n.kind === "parallel")!;
    findings.push({
      id: "unmerged-fan", severity: "error", nodeId: fan.id, nodeName: fan.name,
      title: "A fan-out is never merged",
      detail: `‘${fan.name}’ opens ${plural(fans, "branch", "branches")} but only ${plural(merges, "merge")} closes them. The branches have no join, so the run cannot complete.`,
      fix: "Add a merge node after the parallel branches.",
    });
  }

  return findings;
}

/* ── Simulation ───────────────────────────────────────────────────────────── */

export interface SimulationStep {
  nodeId: string;
  name: string;
  kind: VersionNode["kind"];
  /** Milliseconds. Estimated, and labelled as such everywhere it is shown. */
  durationMs: number;
  costUsd: number;
  /** True when the tool call was faked rather than executed. */
  mocked: boolean;
  /** Present when the step would block on a person. */
  gate: { approverGroup: string; slaMinutes: number } | null;
  /** Set on a branch: which way the dry run went, and why. */
  branch: string | null;
  /** Steps the chosen branch skipped. */
  skipped: boolean;
  note: string | null;
}

export interface SimulationResult {
  steps: SimulationStep[];
  estimatedCostUsd: number;
  estimatedDurationMs: number;
  mockedCalls: number;
  gates: SimulationStep[];
  /** Node ids in execution order — the path painted on the graph. */
  path: string[];
}

const KIND_COST: Partial<Record<VersionNode["kind"], number>> = {
  llm: 0.0026, agent: 0.0089, tool: 0.0004,
};

const KIND_MS: Partial<Record<VersionNode["kind"], number>> = {
  llm: 2_400, agent: 6_800, tool: 900, trigger: 40, branch: 12,
  parallel: 60, merge: 40, checkpoint: 120, wait: 60_000, approval: 0, output: 180, end: 10,
};

/**
 * A dry run with every tool call mocked.
 *
 * Deterministic: the same version simulates to the same path, cost and duration
 * every time. A simulate step whose estimate moves between two clicks is not an
 * estimate, and the number it produces is about to be quoted in a publish
 * decision.
 */
export function simulateVersion(nodes: VersionNode[]): SimulationResult {
  const steps: SimulationStep[] = [];
  let skipping = false;

  for (const node of nodes) {
    const isApproval = node.kind === "approval";
    const cost = KIND_COST[node.kind] ?? 0;
    const duration = KIND_MS[node.kind] ?? 200;

    // A branch takes its true arm in the dry run and reports which one, so the
    // path on the canvas is a claim you can check rather than a default.
    const branch = node.kind === "branch"
      ? `Took the true arm — ${String(node.config.condition ?? "condition")}`
      : null;

    steps.push({
      nodeId: node.id,
      name: node.name,
      kind: node.kind,
      durationMs: skipping ? 0 : duration,
      costUsd: skipping ? 0 : Number(cost.toFixed(4)),
      mocked: node.kind === "tool" || node.kind === "llm" || node.kind === "agent",
      gate: isApproval
        ? {
          approverGroup: String(node.config.approverGroup ?? "billing"),
          slaMinutes: Number(node.config.slaMinutes ?? 240),
        }
        : null,
      branch,
      skipped: skipping,
      note: node.kind === "wait" ? "Wait nodes are collapsed to zero in a dry run." : null,
    });
  }

  const live = steps.filter((s) => !s.skipped);
  return {
    steps,
    estimatedCostUsd: Number(live.reduce((sum, s) => sum + s.costUsd, 0).toFixed(4)),
    // Wait nodes are collapsed: a dry run that reports a 60-second wait as
    // 60 seconds of estimated duration is describing the clock, not the work.
    estimatedDurationMs: live
      .filter((s) => s.kind !== "wait")
      .reduce((sum, s) => sum + s.durationMs, 0),
    mockedCalls: live.filter((s) => s.mocked).length,
    gates: live.filter((s) => s.gate !== null),
    path: live.map((s) => s.nodeId),
  };
}

/* ── Publish impact ───────────────────────────────────────────────────────── */

export interface PublishImpact {
  /** Schedules that will start firing the new version. */
  schedules: { summary: string; detail: string; nextFireAt: string | null }[];
  /** Endpoints whose next request will hit the new version. */
  endpoints: { summary: string; detail: string }[];
  /** Runs currently in flight. They finish on the version they started on. */
  liveRuns: number;
  /** Connections the new version depends on that are not healthy right now. */
  unhealthyConnections: { name: string; status: string }[];
}

export function publishImpact(workflow: Workflow, nodes: VersionNode[]): PublishImpact {
  const used = new Set(connectionsOf(nodes));
  return {
    schedules: workflow.triggers
      .filter((t) => t.kind === "schedule")
      .map((t) => ({ summary: t.summary, detail: t.detail, nextFireAt: t.nextFireAt })),
    endpoints: workflow.triggers
      .filter((t) => t.kind === "webhook" || t.kind === "api")
      .map((t) => ({ summary: t.summary, detail: t.detail })),
    liveRuns: RUNS.filter(
      (r) => r.workflowId === workflow.id && (r.status === "running" || r.status === "queued" || r.status === "awaiting-approval"),
    ).length,
    unhealthyConnections: CONNECTIONS
      .filter((c) => used.has(c.name) && c.status !== "healthy")
      .map((c) => ({ name: c.name, status: c.status })),
  };
}

/* ── Overview data ────────────────────────────────────────────────────────── */

/**
 * Spend for ONE workflow over a range, in the shape the shared cost chart takes.
 *
 * Scoped rather than reusing `buildCostTrend`, which is workspace-wide: a
 * workflow overview showing the whole workspace's spend under this workflow's
 * name is the most quietly wrong chart the product could ship. The budget line
 * is the workspace daily budget divided across the workflows that spend, so an
 * overspending workflow shows as a breach rather than as an unlabelled bar.
 */
export function workflowCostTrend(workflowId: string, range: TimeRange): CostTrend {
  const runs = RUNS.filter((r) => r.workflowId === workflowId);
  const points = bucket(runs, range, NOW).map((b) => ({
    t: b.t,
    costUsd: b.runs.reduce((sum, r) => sum + r.costUsd, 0),
    tokens: b.runs.reduce((sum, r) => sum + r.tokens, 0),
  }));
  const bucketsPerDay = 86_400_000 / range.bucketMs;
  const spenders = Math.max(1, WORKFLOWS.filter((w) => w.spend30dUsd > 0).length);

  return {
    points,
    budgetPerBucketUsd: POLICY.dailyBudgetUsd / bucketsPerDay / spenders,
    totalUsd: points.reduce((s, p) => s + p.costUsd, 0),
    totalTokens: points.reduce((s, p) => s + p.tokens, 0),
  };
}

/** The most recent runs of one workflow, newest first. */
export function recentRuns(workflowId: string, limit = 6): Run[] {
  return RUNS.filter((r) => r.workflowId === workflowId).slice(0, limit);
}

export interface DependencyHealth {
  name: string;
  kind: "connection" | "tool";
  status: "healthy" | "degraded" | "failing" | "unknown";
  detail: string;
  /** Nodes in the live version that would break with it. */
  usedByNodes: string[];
  href: string;
}

/**
 * The connections and tools this workflow depends on, with their health.
 *
 * `usedByNodes` is what turns a red dot into an action: knowing the Postgres
 * connection is failing is a fact, and knowing it is bound to nodes 2 and 3 of
 * eleven is a decision about whether this workflow can run at all.
 */
export function dependencies(workflowId: string): DependencyHealth[] {
  const nodes = currentVersion(workflowId)?.nodes ?? [];
  const out = new Map<string, DependencyHealth>();

  for (const node of nodes) {
    const connection = node.config.connection;
    if (typeof connection === "string" && connection) {
      const record = CONNECTIONS.find((c) => c.name === connection);
      const existing = out.get(`conn:${connection}`);
      if (existing) existing.usedByNodes.push(node.name);
      else {
        out.set(`conn:${connection}`, {
          name: connection,
          kind: "connection",
          status: record?.status ?? "unknown",
          detail: record
            ? record.latencyMs === null
              ? "Not responding"
              : `${record.latencyMs}ms · checked ${new Date(record.lastCheckedAt).toISOString().slice(11, 16)}Z`
            : "Not registered in this workspace",
          usedByNodes: [node.name],
          href: "/connections",
        });
      }
    }

    const tool = node.config.tool;
    if (typeof tool === "string" && tool) {
      const record = TOOLS.find((t) => t.name === tool);
      const existing = out.get(`tool:${tool}`);
      if (existing) existing.usedByNodes.push(node.name);
      else {
        out.set(`tool:${tool}`, {
          name: tool,
          kind: "tool",
          status: record?.lastError ? "degraded" : record ? "healthy" : "unknown",
          detail: record?.lastError ?? (record ? `${record.risk} risk · ${Math.round(record.timeoutMs / 1000)}s timeout` : "Not registered in this workspace"),
          usedByNodes: [node.name],
          href: "/tools",
        });
      }
    }
  }

  const rank = { failing: 0, degraded: 1, unknown: 2, healthy: 3 };
  return [...out.values()].sort((a, b) => rank[a.status] - rank[b.status]);
}

/** What a delete would break. The confirmation names these, never a count. */
export function deleteImpact(workflow: Workflow) {
  const impact = publishImpact(workflow, liveVersion(workflow.id)?.nodes ?? []);
  return {
    ...impact,
    runs: RUNS.filter((r) => r.workflowId === workflow.id).length,
    versions: (allVersions().get(workflow.id) ?? []).length,
  };
}
