import { RUNS, POSTGRES_INCIDENT_ID } from "./fixtures";
import type { Run, RunNode, RunStatus } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   SCALE FIXTURES + FAILURE CLUSTERING.

   Two things the 163-run fixture set cannot do: prove the table holds 60fps at
   10,000 rows, and produce enough failures for clustering to be worth looking
   at. Both are derived from the real fixtures rather than invented alongside
   them, so a 10,000-row table is the same workspace seen over a longer window,
   not a different product.
══════════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-11T14:20:00Z").getTime();

function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` runs, deterministic, by cycling the real fixtures across a 30-day
 * window and re-keying ids.
 *
 * Cycling rather than generating fresh graphs is the point: every run keeps a
 * real node shape, a real failure position and a real cost, so the inline
 * Ribbon at 10,000 rows is rendering the same variety it will in production.
 */
export function makeRunsAtScale(count: number): Run[] {
  const rng = makeRng(0x51ca1e5);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const out: Run[] = new Array(count);

  for (let i = 0; i < count; i += 1) {
    const source = RUNS[i % RUNS.length];

    let id = "run_";
    for (let c = 0; c < 26; c += 1) id += alphabet[Math.floor(rng() * alphabet.length)];

    // Spread across 30 days, denser toward now — the same clustering the base
    // fixtures use, so `since:24h` returns a plausible slice at any scale.
    const r = rng();
    const age =
      r < 0.35 ? rng() * 6 * 3_600_000 :
      r < 0.62 ? rng() * 24 * 3_600_000 :
      r < 0.85 ? rng() * 7 * 86_400_000 :
      rng() * 30 * 86_400_000;
    const started = NOW - age;

    out[i] = {
      ...source,
      id,
      startedAt: new Date(started).toISOString(),
      finishedAt: source.durationMs === null ? null : new Date(started + source.durationMs).toISOString(),
    };
  }

  return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/* ── Clustering ───────────────────────────────────────────────────────────── */

export interface FailureCluster {
  id: string;
  /** What actually went wrong, in an operator's words. */
  cause: string;
  count: number;
  /** Share of all failures, for the bar. */
  share: number;
  /** The query that isolates this cluster in the table. */
  query: string;
  /** The one action that resolves it. */
  action: { label: string; href: string };
  /** Node position where it dies, if the cluster has one — the Ribbon insight. */
  failsAtStep: number | null;
  firstSeen: number;
  lastSeen: number;
}

/**
 * Groups failed runs by signature.
 *
 * The signature is (error message shape × connection × tool call), NOT the raw
 * message — raw messages carry ids and timestamps, so grouping on them produces
 * 83 clusters of one, which is the problem restated rather than solved.
 */
function signatureOf(run: Run): { key: string; cause: string; action: FailureCluster["action"]; step: number } | null {
  const index = run.nodes.findIndex((n) => n.state === "failed");
  if (index === -1) return null;
  const node: RunNode = run.nodes[index];

  if (node.error?.connection) {
    return {
      key: `connection:${node.error.connection}`,
      cause: `Connection ‘${node.error.connection}’ unavailable`,
      action: { label: "Fix connection", href: "/connections" },
      step: index,
    };
  }

  if (node.error?.toolCall) {
    return {
      key: `tool-timeout:${node.error.toolCall}`,
      cause: `Tool timeout: ${node.error.toolCall} exceeded 30s`,
      action: { label: "Adjust timeout", href: "/tools" },
      step: index,
    };
  }

  // A structured message with no connection or tool: bucket on the message
  // SHAPE. Digits, ids and quoted values are stripped first, because grouping
  // on raw messages produces one cluster per run — the problem restated rather
  // than solved.
  if (node.error?.message) {
    const shape = node.error.message
      .replace(/\d+/g, "#")
      .replace(/['"‘’“”][^'"‘’“”]*['"‘’“”]/g, "…")
      .trim();
    return {
      key: `message:${shape}`,
      cause: node.error.message.replace(/\.$/, ""),
      action: { label: "Inspect", href: "/incidents" },
      step: index,
    };
  }

  // No structured error at all. Bucket by the kind of node that died, which is
  // the most specific thing that is still true.
  const byKind: Record<string, { cause: string; action: FailureCluster["action"] }> = {
    agent: { cause: "Agent returned unparseable output", action: { label: "Inspect", href: "/agents" } },
    llm: { cause: "Model call exceeded its step timeout", action: { label: "Adjust timeout", href: "/agents" } },
    tool: { cause: "Tool call failed without a structured error", action: { label: "Inspect", href: "/tools" } },
    approval: { cause: "Approval expired before a reviewer responded", action: { label: "Review SLA", href: "/approvals" } },
  };
  const fallback = byKind[node.kind] ?? {
    cause: `${node.kind} node failed`,
    action: { label: "Inspect", href: "/runs?status=failed" },
  };
  return { key: `kind:${node.kind}`, cause: fallback.cause, action: fallback.action, step: index };
}

export function clusterFailures(runs: Run[]): FailureCluster[] {
  const failed = runs.filter((r) => r.status === "failed");
  if (failed.length === 0) return [];

  const groups = new Map<string, {
    cause: string;
    action: FailureCluster["action"];
    count: number;
    steps: number[];
    first: number;
    last: number;
    connection?: string;
    tool?: string;
  }>();

  for (const run of failed) {
    const sig = signatureOf(run);
    if (!sig) continue;
    const at = Date.parse(run.startedAt);
    const existing = groups.get(sig.key);
    if (existing) {
      existing.count += 1;
      existing.steps.push(sig.step);
      existing.first = Math.min(existing.first, at);
      existing.last = Math.max(existing.last, at);
    } else {
      groups.set(sig.key, {
        cause: sig.cause, action: sig.action, count: 1, steps: [sig.step], first: at, last: at,
      });
    }
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      // A cluster that always dies at the same node position is a much stronger
      // signal than one that dies anywhere, so it is worth stating.
      const uniqueSteps = new Set(g.steps);
      return {
        id: key,
        cause: g.cause,
        count: g.count,
        share: g.count / failed.length,
        query: queryForCluster(key),
        action: g.action,
        failsAtStep: uniqueSteps.size === 1 ? g.steps[0] : null,
        firstSeen: g.first,
        lastSeen: g.last,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * The query that isolates a cluster.
 *
 * Uses `incident:` where the fixture has a real incident id, because that is
 * what the backend will filter on once P12 lands. Everything else falls back to
 * a workflow-scoped failure query, which is approximate — and the band says so
 * rather than pretending otherwise.
 */
function queryForCluster(key: string): string {
  if (key === "connection:Postgres Answers") return `status:failed incident:${POSTGRES_INCIDENT_ID}`;
  const [kind, detail] = key.split(":");
  if (kind === "tool-timeout") return `status:failed ${detail}`;
  return "status:failed";
}

/** Counts by status, for the quick-filter chips. */
export function countByStatus(runs: Run[]): Record<RunStatus, number> {
  const out: Record<RunStatus, number> = {
    succeeded: 0, failed: 0, running: 0, queued: 0, "awaiting-approval": 0,
    waiting: 0, cancelled: 0,
  };
  for (const r of runs) out[r.status] += 1;
  return out;
}

/**
 * Cost of retrying a set of runs.
 *
 * Only the UNCOMMITTED steps are charged. That is the entire product thesis
 * expressed as a number in a confirmation dialog: retrying 61 runs that each
 * died at step 2 of 12 costs a fraction of re-running them, and the operator
 * should see that before they decide.
 */
export function estimateRetryCost(runs: Run[]): {
  runs: number;
  nodesToReplay: number;
  nodesSaved: number;
  costUsd: number;
  savedUsd: number;
} {
  let nodesToReplay = 0;
  let nodesSaved = 0;
  let costUsd = 0;
  let savedUsd = 0;

  for (const run of runs) {
    for (const node of run.nodes) {
      const committed = node.state === "committed" || node.state === "recovered";
      // Per-node cost is null on nodes that never ran; fall back to the run's
      // mean so an estimate is never silently zero.
      const unit = node.costUsd ?? run.costUsd / Math.max(1, run.nodes.length);
      if (committed) {
        nodesSaved += 1;
        savedUsd += unit;
      } else {
        nodesToReplay += 1;
        costUsd += unit;
      }
    }
  }

  return {
    runs: runs.length,
    nodesToReplay,
    nodesSaved,
    costUsd: Number(costUsd.toFixed(4)),
    savedUsd: Number(savedUsd.toFixed(4)),
  };
}
