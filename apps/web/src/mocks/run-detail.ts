import { RUNS, SIGNATURE_RUN, CONNECTIONS, INCIDENTS, POSTGRES_INCIDENT_ID } from "./fixtures";
import { layoutGraph, type GraphEdge, type LaidOutGraph, type LaidOutNode } from "./graph-layout";
import type { Run, RunNode } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   RUN DETAIL — the data behind the three panes.

   Everything here is DERIVED from the run's nodes, not authored beside them. A
   log line, a graph node and an event row that disagree about when step 4
   committed would be three lies on one screen, and this is the screen an
   operator trusts during an incident.
══════════════════════════════════════════════════════════════════════════════ */

export function getRun(id: string): Run | undefined {
  if (id === SIGNATURE_RUN.id) return SIGNATURE_RUN;
  return RUNS.find((r) => r.id === id);
}

/* ── Graph layout ─────────────────────────────────────────────────────────── */

/**
 * Lays the run out as a graph.
 *
 * The layout itself lives in mocks/graph-layout so the version diff can lay out
 * a draft — which has nodes but no run state — through exactly the same
 * function. See that file for why one implementation is load-bearing.
 */
export type GraphNode = LaidOutNode<RunNode>;
export type RunGraph = LaidOutGraph<RunNode>;
export type { GraphEdge };

export function buildGraph(run: Run): RunGraph {
  return layoutGraph(run.nodes);
}

/* ── Log stream ───────────────────────────────────────────────────────────── */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLine {
  seq: number;
  at: number;
  level: LogLevel;
  /** Node index the line belongs to, for the node filter. */
  nodeIndex: number;
  nodeName: string;
  message: string;
}

const LINE_TEMPLATES: Record<string, string[]> = {
  start: [
    "entering node",
    "resolved {n} input binding(s)",
    "lease acquired, expires in 30s",
  ],
  work: [
    "tool call issued",
    "provider responded 200 in {ms}ms",
    "received {n} row(s)",
    "token usage in={in} out={out}",
    "validating output against declared schema",
    "schema check passed",
  ],
  commit: [
    "commit boundary reached",
    "checkpoint {seq} written",
    "lease renewed",
  ],
  fail: [
    "attempt 1 failed: ECONNREFUSED",
    "backing off 2s before attempt 2",
    "attempt 2 failed: ECONNREFUSED",
    "backing off 4s before attempt 3",
    "attempt 3 failed: ECONNREFUSED",
    "retry budget exhausted",
    "node marked failed, run halting",
  ],
};

function rngFor(seed: string) {
  let a = 0;
  for (let i = 0; i < seed.length; i += 1) a = (a * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The run's log, derived from its nodes.
 *
 * `padTo` inflates the stream with additional debug lines so the virtualiser is
 * exercised at the 100k the spec names. The real lines stay in their real
 * positions — padding is interleaved, not appended, because a stream that is
 * real for 400 lines and then synthetic for 99,600 tests nothing about
 * scrolling through real content.
 */
export function buildLog(run: Run, padTo = 0): LogLine[] {
  const rng = rngFor(run.id);
  const lines: LogLine[] = [];
  let seq = 0;
  let clock = Date.parse(run.startedAt);

  const push = (level: LogLevel, nodeIndex: number, nodeName: string, message: string) => {
    clock += Math.round(rng() * 340) + 12;
    lines.push({ seq: seq++, at: clock, level, nodeIndex, nodeName, message });
  };

  push("info", 0, run.workflowName, `run ${run.id} accepted, ${run.nodes.length} nodes planned`);

  run.nodes.forEach((node, index) => {
    const reached = node.state !== "pending" && node.state !== "skipped";
    if (!reached) return;

    for (const t of LINE_TEMPLATES.start) {
      push("debug", index, node.name, t.replace("{n}", String(1 + Math.floor(rng() * 3))));
    }

    for (const t of LINE_TEMPLATES.work) {
      push(
        "info",
        index,
        node.name,
        t
          .replace("{ms}", String(Math.round(node.durationMs ?? 400)))
          .replace("{n}", String(Math.floor(rng() * 240)))
          .replace("{in}", String(Math.round((node.tokens ?? 0) * 0.7)))
          .replace("{out}", String(Math.round((node.tokens ?? 0) * 0.3))),
      );
    }

    if (node.state === "failed") {
      for (const [i, t] of LINE_TEMPLATES.fail.entries()) {
        push(i >= 4 ? "error" : "warn", index, node.name, t);
      }
      if (node.error?.message) push("error", index, node.name, node.error.message);
      if (node.error?.connection) {
        push("error", index, node.name, `connection ‘${node.error.connection}’ is unusable`);
      }
    } else if (node.state === "gated") {
      push("warn", index, node.name, "approval gate opened, run suspended");
      push("info", index, node.name, "no compute is consumed while suspended");
    } else if (node.state === "executing") {
      push("info", index, node.name, "in flight");
    } else {
      for (const t of LINE_TEMPLATES.commit) {
        push("debug", index, node.name, t.replace("{seq}", String(index + 1)));
      }
    }
  });

  if (padTo > lines.length) {
    // Interleave, so scrolling passes through real content the whole way.
    const real = [...lines];
    const out: LogLine[] = [];
    const perReal = Math.ceil((padTo - real.length) / Math.max(1, real.length));
    let s = 0;
    let t = Date.parse(run.startedAt);
    for (const line of real) {
      out.push({ ...line, seq: s++ });
      for (let i = 0; i < perReal && out.length < padTo; i += 1) {
        t = line.at + i * 3;
        out.push({
          seq: s++,
          at: t,
          level: "debug",
          nodeIndex: line.nodeIndex,
          nodeName: line.nodeName,
          message: `trace span ${line.nodeIndex}.${i} ctx=${(rng() * 1e9).toString(36).slice(0, 10)}`,
        });
      }
    }
    return out;
  }

  return lines;
}

/* ── Event history ────────────────────────────────────────────────────────── */

export interface RunEvent {
  seq: number;
  at: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * The event-sourced substrate. This is not logging — it is the stream the
 * engine executes from, which is why the timeline can be exact rather than
 * best-effort.
 */
export function buildEvents(run: Run): RunEvent[] {
  const events: RunEvent[] = [];
  let seq = 0;
  let clock = Date.parse(run.startedAt);
  const at = (ms: number) => {
    clock += ms;
    return clock;
  };

  events.push({
    seq: seq++,
    at: clock,
    type: "run.accepted",
    payload: { runId: run.id, workflowId: run.workflowId, trigger: run.trigger, environment: run.environment },
  });
  events.push({ seq: seq++, at: at(40), type: "run.queued", payload: { position: 3 } });
  events.push({ seq: seq++, at: at(820), type: "lease.acquired", payload: { worker: "worker-7c2f", ttlMs: 30000 } });

  run.nodes.forEach((node, index) => {
    const reached = node.state !== "pending" && node.state !== "skipped";
    if (!reached) return;

    events.push({
      seq: seq++,
      at: at(60),
      type: "node.started",
      payload: { nodeId: node.id, name: node.name, kind: node.kind, index },
    });

    if (node.kind === "tool") {
      events.push({
        seq: seq++,
        at: at(20),
        type: "tool.called",
        payload: {
          nodeId: node.id,
          tool: node.error?.toolCall ?? `${node.name}`,
          idempotencyKey: `${run.id}:${node.id}`,
        },
      });
    }

    if (node.state === "failed") {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        events.push({
          seq: seq++,
          at: at(node.durationMs ? node.durationMs / 3 : 900),
          type: "node.attempt_failed",
          payload: { nodeId: node.id, attempt, error: node.error?.message ?? "unknown" },
        });
      }
      events.push({
        seq: seq++,
        at: at(10),
        type: "node.failed",
        payload: { nodeId: node.id, classification: classify(node), retryable: true },
      });
      events.push({ seq: seq++, at: at(4), type: "run.failed", payload: { atNode: node.id, committed: committedCount(run) } });
    } else if (node.state === "gated") {
      events.push({ seq: seq++, at: at(30), type: "gate.opened", payload: { nodeId: node.id, slaMs: 86_400_000 } });
      events.push({ seq: seq++, at: at(2), type: "run.suspended", payload: { reason: "awaiting_approval" } });
    } else if (node.state === "executing") {
      events.push({ seq: seq++, at: at(20), type: "lease.renewed", payload: { worker: "worker-7c2f" } });
    } else {
      if (node.state === "recovered") {
        events.push({
          seq: seq++,
          at: at(node.durationMs ? node.durationMs / 2 : 400),
          type: "node.attempt_failed",
          payload: { nodeId: node.id, attempt: 1, error: "transient provider error" },
        });
      }
      events.push({
        seq: seq++,
        at: at(node.durationMs ?? 400),
        type: "node.committed",
        payload: {
          nodeId: node.id,
          checkpoint: index + 1,
          durationMs: node.durationMs,
          tokens: node.tokens,
          costUsd: node.costUsd,
          attempt: node.attempt ?? 1,
        },
      });
    }
  });

  if (run.status === "succeeded") {
    events.push({ seq: seq++, at: at(30), type: "run.succeeded", payload: { durationMs: run.durationMs, costUsd: run.costUsd } });
  }

  return events;
}

function classify(node: RunNode): string {
  if (node.error?.connection) return "connection_unavailable";
  if (node.error?.toolCall) return "tool_call_failed";
  return "node_failed";
}

export function committedCount(run: Run): number {
  return run.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length;
}

/* ── Recovery diagnosis ───────────────────────────────────────────────────── */

export interface Diagnosis {
  rootCause: string;
  failedNode: { index: number; node: RunNode };
  toolCall: string | null;
  blastRadius: { workflows: number; tools: number; queuedRuns: number } | null;
  committed: number;
  total: number;
  retryNodes: number;
  retryCostUsd: number;
  savedUsd: number;
  connectionId: string | null;
  incidentId: string | null;
  classification: string;
}

/**
 * Everything the Recovery card states, computed once.
 *
 * The retry cost is the number that matters: it is the product thesis rendered
 * as money. Eight of twelve steps survived, so a retry costs four — not twelve.
 */
export function diagnose(run: Run): Diagnosis | null {
  const index = run.nodes.findIndex((n) => n.state === "failed");
  if (index === -1) return null;
  const node = run.nodes[index];

  let retryCostUsd = 0;
  let savedUsd = 0;
  let retryNodes = 0;
  for (const n of run.nodes) {
    const unit = n.costUsd ?? run.costUsd / Math.max(1, run.nodes.length);
    if (n.state === "committed" || n.state === "recovered") savedUsd += unit;
    else {
      retryNodes += 1;
      retryCostUsd += unit;
    }
  }

  const connection = node.error?.connection
    ? CONNECTIONS.find((c) => c.name === node.error!.connection)
    : undefined;

  const queuedRuns = connection?.name === "Postgres Answers" ? 22 : 0;

  return {
    rootCause: node.error?.connection
      ? `Connection ‘${node.error.connection}’ returned status: failed`
      : node.error?.message ?? "Node failed without a structured error",
    failedNode: { index, node },
    toolCall: node.error?.toolCall ?? null,
    blastRadius: connection
      ? { workflows: connection.blastRadius.workflows, tools: connection.blastRadius.tools, queuedRuns }
      : null,
    committed: committedCount(run),
    total: run.nodes.length,
    retryNodes,
    retryCostUsd: Number(retryCostUsd.toFixed(4)),
    savedUsd: Number(savedUsd.toFixed(4)),
    connectionId: connection?.id ?? null,
    incidentId: run.incidentId ?? (connection?.name === "Postgres Answers" ? POSTGRES_INCIDENT_ID : null),
    classification: classify(node),
  };
}

export function incidentFor(run: Run) {
  return INCIDENTS.find((i) => i.id === run.incidentId) ?? null;
}

/* ── Compare ──────────────────────────────────────────────────────────────── */

export interface StepDelta {
  index: number;
  name: string;
  /** null when the step does not exist on one side. */
  durationDeltaMs: number | null;
  tokenDelta: number | null;
  costDelta: number | null;
  diverged: boolean;
  baselineState: RunNode["state"] | null;
  currentState: RunNode["state"] | null;
}

export interface Comparison {
  baseline: Run;
  current: Run;
  steps: StepDelta[];
  durationDeltaMs: number | null;
  tokenDelta: number;
  costDelta: number;
  /** Index of the first step whose state differs — where it went wrong. */
  divergedAt: number | null;
}

/** The most recent successful run of the same workflow. */
export function lastSuccessful(run: Run): Run | undefined {
  return RUNS
    .filter((r) => r.workflowId === run.workflowId && r.status === "succeeded" && r.id !== run.id)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
}

export function compareRuns(current: Run, baseline: Run): Comparison {
  const length = Math.max(current.nodes.length, baseline.nodes.length);
  const steps: StepDelta[] = [];
  let divergedAt: number | null = null;

  for (let i = 0; i < length; i += 1) {
    const c = current.nodes[i];
    const b = baseline.nodes[i];
    const diverged = (c?.state ?? null) !== (b?.state ?? null);
    if (diverged && divergedAt === null) divergedAt = i;

    steps.push({
      index: i,
      name: c?.name ?? b?.name ?? `Step ${i + 1}`,
      durationDeltaMs: c?.durationMs != null && b?.durationMs != null ? c.durationMs - b.durationMs : null,
      tokenDelta: c?.tokens != null && b?.tokens != null ? c.tokens - b.tokens : null,
      costDelta: c?.costUsd != null && b?.costUsd != null ? Number((c.costUsd - b.costUsd).toFixed(4)) : null,
      diverged,
      baselineState: b?.state ?? null,
      currentState: c?.state ?? null,
    });
  }

  return {
    baseline,
    current,
    steps,
    durationDeltaMs:
      current.durationMs != null && baseline.durationMs != null
        ? current.durationMs - baseline.durationMs
        : null,
    tokenDelta: current.tokens - baseline.tokens,
    costDelta: Number((current.costUsd - baseline.costUsd).toFixed(4)),
    divergedAt,
  };
}

/* ── Resolved inputs ──────────────────────────────────────────────────────── */

export interface ResolvedInput {
  field: string;
  value: string;
  /** The upstream node and path that produced it — §10, Inspector. */
  fromNode: string;
  path: string;
}

/** Deterministic per node, so the inspector shows the same thing every visit. */
export function resolvedInputs(run: Run, index: number): ResolvedInput[] {
  const node = run.nodes[index];
  if (!node || index === 0) return [];
  const upstream = run.nodes[index - 1];
  const rng = rngFor(`${run.id}:${node.id}`);

  const pool: ResolvedInput[] = [
    { field: "accountId", value: `acc_${(rng() * 1e9).toString(36).slice(0, 8)}`, fromNode: upstream.name, path: "rows[0].account_id" },
    { field: "lookaheadDays", value: "30", fromNode: "Trigger", path: "input.lookaheadDays" },
    { field: "mrrGbp", value: (2400 + Math.floor(rng() * 8000)).toLocaleString("en-GB"), fromNode: upstream.name, path: "rows[0].mrr_gbp" },
    { field: "tone", value: "formal", fromNode: "—", path: "literal" },
    { field: "renewalDate", value: "2026-09-14", fromNode: upstream.name, path: "rows[0].renewal_date" },
  ];
  return pool.slice(0, 3 + Math.floor(rng() * 3));
}

/** A plausible tool response for the inspector's Output tab. */
export function sampleOutput(run: Run, index: number): unknown {
  const node = run.nodes[index];
  if (!node) return null;
  if (node.state === "failed") {
    return {
      error: {
        code: "ECONNREFUSED",
        message: node.error?.message ?? "connection refused",
        connection: node.error?.connection ?? null,
        attempts: 3,
        retryable: true,
      },
    };
  }
  return {
    ok: true,
    node: node.id,
    checkpoint: index + 1,
    durationMs: node.durationMs,
    tokens: node.tokens,
    costUsd: node.costUsd,
    result: {
      rows: [
        { account_id: "acc_7c2f18ab", renewal_date: "2026-09-14", mrr_gbp: 4820 },
        { account_id: "acc_2ab41f09", renewal_date: "2026-09-21", mrr_gbp: 1290 },
      ],
      rowCount: 2,
    },
  };
}
