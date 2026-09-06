/**
 * Feature flags.
 *
 * Typed, server-evaluable, env-driven. The job is narrow: let UI whose endpoint
 * does not exist yet ship dark, and light up when the endpoint lands — without
 * a branch in every component or a revert when the backend is late.
 *
 * DESIGN
 * ──────
 * The registry below is the whole system. Each flag declares its default and
 * says WHY it exists, so a flag that has been off for six months is legible as
 * either "still blocked" or "someone forgot to delete this".
 *
 * Every gap flag defaults to `false`. That is the rule from the degradation
 * policy: a gapped feature is off in production until its endpoint exists. A
 * flag that defaults on is not a flag, it is a liability.
 *
 * Because the values come from `NEXT_PUBLIC_*`, they are inlined at build time
 * and readable identically in Server Components, route handlers and the
 * browser — no provider, no hydration mismatch, no async read.
 */

/**
 * The flag registry.
 *
 * `blockedBy` is not decoration. It names the gap in
 * docs/integration/API-GAPS.md that keeps the flag off, so the two documents
 * cannot drift apart silently.
 */
const REGISTRY = {
  checkpointRibbon: {
    default: false,
    description: "Per-run checkpoint ribbon on the Runs list.",
    blockedBy: "GAP-01 — ribbon_json exists in the DB but /api/runs does not select it.",
  },
  failureClustering: {
    default: false,
    description: "Group failures by signature on the Incidents screen.",
    blockedBy: "GAP-04 — /api/failure-incidents is a flat list with no group-by.",
  },
  queuePosition: {
    default: true,
    description: "Position and ETA for queued runs.",
    blockedBy: "None — /api/runs/:id/queue-position shipped in V023.",
  },
  connectionBlastRadius: {
    default: false,
    description: "What a broken connection blocks.",
    blockedBy: "GAP-06 — no endpoint computes the dependent workflows/tools/runs.",
  },
  auditLog: {
    default: true,
    description: "Governance audit trail screen.",
    blockedBy: "None — GAP-08 closed: GET /api/audit reads public.audit_log.",
  },
  approvalDecisionContext: {
    default: false,
    description: "Resolved decision values on an approval, not templates.",
    blockedBy: "GAP-09 — ApprovalRoutes still reads the legacy `approvals` table.",
  },
  registryReverseIndex: {
    default: false,
    description: '"Used by" on agents and tools.',
    blockedBy: "GAP-10 — no reverse-index endpoint.",
  },
  workflowVersionDiff: {
    default: false,
    description: "Diff between two published workflow versions.",
    blockedBy: "GAP-11 — versions can be listed, not compared.",
  },
  billing: {
    default: false,
    description: "Plan comparison, upgrade/downgrade, invoices and payment methods.",
    blockedBy:
      "None technically — S4 is complete and tested against the noop provider. " +
      "OFF because there is no bank account: no Stripe or Razorpay credentials " +
      "exist, so every action would run against the noop provider and change our " +
      "schema without charging anybody. Turning this on before a provider is " +
      "configured would show customers a working checkout that takes no money.",
  },
  usageForecasting: {
    default: false,
    description: "Projected spend and quota exhaustion.",
    blockedBy: "GAP-12 — no forecast endpoint or rollup.",
  },
  nodeDebugSnapshots: {
    default: true,
    description: "I/O mapping preview with resolved variable provenance.",
    blockedBy: "None — V017 plus three endpoints, fully served.",
  },
  fleetHealth: {
    default: true,
    description: "Worker fleet health and capacity.",
    blockedBy: "None — /api/workers and /api/control/metrics both serve this.",
  },
} as const satisfies Record<string, FlagDefinition>;

interface FlagDefinition {
  default: boolean;
  description: string;
  blockedBy: string;
}

export type FlagName = keyof typeof REGISTRY;

export const FLAG_NAMES = Object.keys(REGISTRY) as FlagName[];

/**
 * Env overrides.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only for statically analysable
 * member expressions — `process.env[name]` does NOT work in the browser bundle.
 * So the lookup table is written out explicitly. It is tedious and it is the
 * only form that actually reaches the client.
 */
const ENV_OVERRIDES: Record<FlagName, string | undefined> = {
  billing: process.env.NEXT_PUBLIC_FLAG_BILLING,
  checkpointRibbon: process.env.NEXT_PUBLIC_FLAG_CHECKPOINT_RIBBON,
  failureClustering: process.env.NEXT_PUBLIC_FLAG_FAILURE_CLUSTERING,
  queuePosition: process.env.NEXT_PUBLIC_FLAG_QUEUE_POSITION,
  connectionBlastRadius: process.env.NEXT_PUBLIC_FLAG_CONNECTION_BLAST_RADIUS,
  auditLog: process.env.NEXT_PUBLIC_FLAG_AUDIT_LOG,
  approvalDecisionContext: process.env.NEXT_PUBLIC_FLAG_APPROVAL_DECISION_CONTEXT,
  registryReverseIndex: process.env.NEXT_PUBLIC_FLAG_REGISTRY_REVERSE_INDEX,
  workflowVersionDiff: process.env.NEXT_PUBLIC_FLAG_WORKFLOW_VERSION_DIFF,
  usageForecasting: process.env.NEXT_PUBLIC_FLAG_USAGE_FORECASTING,
  nodeDebugSnapshots: process.env.NEXT_PUBLIC_FLAG_NODE_DEBUG_SNAPSHOTS,
  fleetHealth: process.env.NEXT_PUBLIC_FLAG_FLEET_HEALTH,
};

/**
 * Only an explicit "1" or "true" turns something on.
 *
 * An unset or malformed value falls back to the registry default rather than
 * being treated as falsy — otherwise a typo would silently disable a flag whose
 * default is on, which is the failure mode that makes people distrust flags.
 */
function parse(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return fallback;
}

/** Evaluate one flag. Safe in Server Components, route handlers and the browser. */
export function isEnabled(name: FlagName): boolean {
  return parse(ENV_OVERRIDES[name], REGISTRY[name].default);
}

/** Every flag and its current value — for the admin screen and for debugging. */
export function allFlags(): Record<FlagName, boolean> {
  const out = {} as Record<FlagName, boolean>;
  for (const name of FLAG_NAMES) out[name] = isEnabled(name);
  return out;
}

/** The registry entry, so a disabled feature can explain itself in the UI. */
export function describeFlag(name: FlagName): FlagDefinition {
  return REGISTRY[name];
}
