import type { Run, RunStatus } from "./model";

export interface FailureCluster {
  id: string;
  cause: string;
  count: number;
  share: number;
  query: string;
  action: { label: string; href: string };
  failsAtStep: number | null;
  firstSeen: number;
  lastSeen: number;
}

export function countByStatus(runs: Run[]): Record<RunStatus, number> {
  const counts: Record<RunStatus, number> = {
    succeeded: 0,
    failed: 0,
    running: 0,
    queued: 0,
    "awaiting-approval": 0,
    waiting: 0,
    cancelled: 0,
  };
  for (const run of runs) counts[run.status] += 1;
  return counts;
}

export function clusterFailures(runs: Run[]): FailureCluster[] {
  const failed = runs.filter((run) => run.status === "failed");
  const groups = new Map<string, {
    cause: string;
    count: number;
    steps: number[];
    first: number;
    last: number;
    incidentId?: string;
  }>();

  for (const run of failed) {
    const step = run.nodes.findIndex((node) => node.state === "failed");
    const message = run.nodes[step]?.error?.message ?? "Run failed without a structured incident";
    const shape = message.replace(/\d+/g, "#").replace(/['"‘’“”][^'"‘’“”]*['"‘’“”]/g, "…");
    const key = run.incidentId ? `incident:${run.incidentId}` : `message:${shape}`;
    const at = Date.parse(run.startedAt);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.steps.push(step);
      group.first = Math.min(group.first, at);
      group.last = Math.max(group.last, at);
    } else {
      groups.set(key, {
        cause: message,
        count: 1,
        steps: [step],
        first: at,
        last: at,
        incidentId: run.incidentId,
      });
    }
  }

  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      cause: group.cause,
      count: group.count,
      share: failed.length === 0 ? 0 : group.count / failed.length,
      query: group.incidentId ? `status:failed incident:${group.incidentId}` : "status:failed",
      action: group.incidentId
        ? { label: "Open incident", href: `/incidents/${group.incidentId}` }
        : { label: "Inspect", href: "/incidents" },
      failsAtStep: new Set(group.steps).size === 1 && group.steps[0] >= 0 ? group.steps[0] : null,
      firstSeen: group.first,
      lastSeen: group.last,
    }))
    .sort((a, b) => b.count - a.count);
}

export function estimateRetryCost(runs: Run[]) {
  let nodesToReplay = 0;
  let nodesSaved = 0;
  let costUsd = 0;
  let savedUsd = 0;

  for (const run of runs) {
    for (const node of run.nodes) {
      const committed = node.state === "committed" || node.state === "recovered";
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

  return { runs: runs.length, nodesToReplay, nodesSaved, costUsd, savedUsd };
}
