import { APPROVALS, INCIDENTS, RUNS, WORKFLOWS, CONNECTIONS, POSTGRES_INCIDENT_ID } from "./fixtures";
import type { Approval, ApprovalContext, Incident, Run } from "./domain";

/* ══════════════════════════════════════════════════════════════════════════════
   GOVERNANCE — approvals and incidents.

   Both surfaces are about a human taking responsibility: for a decision an agent
   proposed, or for a failure nobody has picked up. The data here is shaped
   around what a person needs to defend that responsibility later — the evidence
   behind a value, and the trail of who did what.
══════════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-11T14:20:00Z").getTime();
const HOUR = 3_600_000;

/* ── Approvals ────────────────────────────────────────────────────────────── */

export type ApprovalDecision = "approved" | "rejected" | "changes-requested";

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
  reason?: string;
  /** The context AS IT WAS at decision time — §10 requires this. */
  contextSnapshot?: ApprovalContext[];
}

export interface EvidenceStep {
  /** Index into the run's nodes, so the link resolves to a real step. */
  nodeIndex: number;
  nodeName: string;
  /** Which context fields this step produced. */
  produces: string[];
  durationMs: number;
  summary: string;
}

export interface GateView extends Approval {
  status: "pending" | ApprovalDecision;
  slaMs: number;
  /** Who it goes to if the SLA breaches. */
  escalatesTo: string;
  approverGroup: string;
  /** Risk tier of the action being gated — drives the bulk-approve policy. */
  risk: "low" | "medium" | "high" | "critical";
  run: Run | undefined;
  evidence: EvidenceStep[];
  audit: AuditEntry[];
  decidedBy?: string;
  decidedAt?: number;
  decisionReason?: string;
}

const SLA_MS = 24 * HOUR;

/**
 * Evidence for a gate: which steps produced the values the reviewer is reading.
 *
 * Derived from the context entries' `source` strings, which already name the
 * producing tool call. That is the point of storing source alongside value —
 * "£842.00" is a number to trust or not; "£842.00 from stripe.getInvoice →
 * amount_due at step 4" is a number you can check.
 */
function evidenceFor(approval: Approval, run: Run | undefined): EvidenceStep[] {
  if (!run) return [];
  const byStep = new Map<number, EvidenceStep>();

  for (const entry of approval.context) {
    const toolName = entry.source.split(" → ")[0].trim();
    let index = run.nodes.findIndex((n) => n.name === toolName);
    if (index === -1) {
      // Policy- and literal-sourced values have no producing step; attribute
      // them to the trigger rather than dropping them from the audit.
      index = 0;
    }
    const node = run.nodes[index];
    const existing = byStep.get(index);
    if (existing) existing.produces.push(entry.label);
    else {
      byStep.set(index, {
        nodeIndex: index,
        nodeName: node.name,
        produces: [entry.label],
        durationMs: node.durationMs ?? 0,
        summary: entry.source,
      });
    }
  }

  return [...byStep.values()].sort((a, b) => a.nodeIndex - b.nodeIndex);
}

/* Gates need DISTINCT runs. The base fixtures only guarantee a real runId on the
   first approval, so a naive fallback pointed every gate at the same run — two
   different decisions citing one run is the kind of incoherence that makes a
   reviewer stop trusting the evidence panel. */
const GATED_RUNS = RUNS.filter((r) => r.status === "awaiting-approval");

function gateFrom(
  approval: Approval,
  overrides: Partial<GateView>,
  fallbackIndex = 0,
): GateView {
  const run =
    RUNS.find((r) => r.id === approval.runId) ??
    GATED_RUNS[fallbackIndex % Math.max(1, GATED_RUNS.length)];
  return {
    ...approval,
    status: "pending",
    slaMs: SLA_MS,
    escalatesTo: "platform-ops on-call",
    approverGroup: "billing",
    risk: "high",
    run,
    evidence: evidenceFor(approval, run),
    audit: [
      {
        at: Date.parse(approval.requestedAt),
        actor: approval.requester,
        action: "Gate opened",
      },
    ],
    ...overrides,
  };
}

/**
 * The gate list.
 *
 * Two pending from the base fixtures plus decided ones, because a screen with
 * only pending items never exercises the Approved and Rejected tabs and the
 * audit trail has nothing to show.
 */
export const GATES: GateView[] = [
  gateFrom(APPROVALS[0], { risk: "high" }, 0),
  gateFrom(
    { ...APPROVALS[1], runId: GATED_RUNS[1]?.id ?? APPROVALS[1].runId },
    { risk: "critical", approverGroup: "billing", escalatesTo: "VP Finance" },
    1,
  ),
  gateFrom(
    {
      ...APPROVALS[0],
      id: "apr_9f31c204",
      workflowName: "renewals-daily",
      nodeName: "Approve outreach",
      requestedAt: new Date(NOW - 30 * HOUR).toISOString(),
      slaRemainingMs: 0,
      requester: "renewals-daily",
      context: [
        { label: "Customer", value: "Northwind Traders", source: "hubspot.getContact → company.name" },
        { label: "Risk score", value: "82/100", source: "Triage agent → churn_risk" },
        { label: "ARR", value: "$148,000", source: "postgres.query → arr_usd" },
        { label: "Recommendation", value: "Escalate to CSM", source: "Triage agent → recommendation" },
        { label: "Renewal date", value: "2026-09-14", source: "contracts.getUpcomingRenewals → renewal_date" },
      ],
    },
    {
      status: "approved",
      risk: "medium",
      decidedBy: "priya.raman",
      decidedAt: NOW - 26 * HOUR,
      decisionReason: "Risk score consistent with the last two renewals; CSM already engaged.",
      audit: [
        { at: NOW - 30 * HOUR, actor: "renewals-daily", action: "Gate opened" },
        { at: NOW - 28 * HOUR, actor: "system", action: "Reminder sent to billing" },
        {
          at: NOW - 26 * HOUR,
          actor: "priya.raman",
          action: "Approved",
          reason: "Risk score consistent with the last two renewals; CSM already engaged.",
          contextSnapshot: [
            { label: "Risk score", value: "82/100", source: "Triage agent → churn_risk" },
            { label: "ARR", value: "$148,000", source: "postgres.query → arr_usd" },
          ],
        },
      ],
    },
  ),
  gateFrom(
    {
      ...APPROVALS[1],
      id: "apr_4b78de10",
      workflowName: "refund-approvals",
      nodeName: "Approve refund",
      requestedAt: new Date(NOW - 52 * HOUR).toISOString(),
      slaRemainingMs: 0,
      requester: "dunning-escalation",
      context: [
        { label: "Customer", value: "Halcyon Systems Ltd", source: "hubspot.getContact → company.name" },
        { label: "Refund amount", value: "£4,120.00", source: "stripe.getInvoice → amount_due" },
        { label: "Reason given", value: "Service credit for outage", source: "Classify intent → reason" },
        { label: "Policy cap", value: "£2,500.00", source: "Policy: refund_cap_gbp" },
      ],
    },
    {
      status: "rejected",
      risk: "critical",
      decidedBy: "marcus.hale",
      decidedAt: NOW - 48 * HOUR,
      decisionReason: "Exceeds the £2,500 policy cap. Needs a finance exception before it can be approved.",
      audit: [
        { at: NOW - 52 * HOUR, actor: "dunning-escalation", action: "Gate opened" },
        {
          at: NOW - 48 * HOUR,
          actor: "marcus.hale",
          action: "Rejected",
          reason: "Exceeds the £2,500 policy cap. Needs a finance exception before it can be approved.",
        },
      ],
    },
  ),
];

/** Milliseconds waited, and remaining, against the gate's SLA. */
export function slaState(gate: GateView): {
  waitedMs: number;
  remainingMs: number;
  fraction: number;
  tone: "ok" | "pressured" | "breached";
} {
  const waited = SLA_MS - gate.slaRemainingMs;
  const remaining = gate.slaRemainingMs;
  const fraction = Math.max(0, Math.min(1, remaining / gate.slaMs));
  return {
    waitedMs: waited,
    remainingMs: remaining,
    fraction,
    tone: remaining < 0 ? "breached" : fraction <= 0.5 ? "pressured" : "ok",
  };
}

export const REJECT_REASONS = [
  "Exceeds policy limits",
  "Insufficient evidence in the context",
  "Customer contact is out of date",
  "Duplicate of an earlier request",
  "Needs a finance exception first",
];

/**
 * Whether a set of gates can be bulk-approved.
 *
 * The guard is deliberately strict: same workflow, same gate, same risk tier,
 * none critical. Bulk approve is the single most dangerous control in the
 * product — it is a human taking responsibility for N decisions they did not
 * read individually — so it may only apply where the decisions are genuinely
 * the same decision repeated.
 */
export function bulkApprovable(gates: GateView[]): { ok: boolean; reason: string } {
  if (gates.length === 0) return { ok: false, reason: "Select gates to approve." };
  if (gates.length === 1) return { ok: true, reason: "" };

  const critical = gates.filter((g) => g.risk === "critical");
  if (critical.length > 0) {
    return { ok: false, reason: `${critical.length} of these are critical risk and must be decided individually.` };
  }
  const workflows = new Set(gates.map((g) => g.workflowName));
  if (workflows.size > 1) {
    return { ok: false, reason: `Spans ${workflows.size} workflows. Bulk approve requires one workflow.` };
  }
  const nodes = new Set(gates.map((g) => g.nodeName));
  if (nodes.size > 1) {
    return { ok: false, reason: `Spans ${nodes.size} different gates. Bulk approve requires one gate.` };
  }
  const risks = new Set(gates.map((g) => g.risk));
  if (risks.size > 1) {
    return { ok: false, reason: "Mixed risk tiers. Bulk approve requires one tier." };
  }
  return { ok: true, reason: "" };
}

/* ── Incidents ────────────────────────────────────────────────────────────── */

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "acknowledged" | "resolved" | "muted";

export interface IncidentActivity {
  at: number;
  actor: string;
  action: string;
  note?: string;
}

export interface IncidentView extends Omit<Incident, "status"> {
  status: IncidentStatus;
  severity: IncidentSeverity;
  /** The classified error and the component that failed. */
  classification: string;
  failingComponent: string;
  componentHref: string;
  blastRadius: {
    workflows: number;
    tools: number;
    connections: number;
    runs: number;
    /** Wasted spend: tokens burned on runs that then died. */
    costOfFailureUsd: number;
  };
  activity: IncidentActivity[];
  mutedUntil: number | null;
  /** Signature stops firing for this long → auto-resolve. */
  autoResolveAfterMs: number;
  externalTracker: string | null;
}

function affectedRuns(signature: string, incidentId: string): Run[] {
  if (incidentId === POSTGRES_INCIDENT_ID) {
    return RUNS.filter(
      (r) => r.status === "failed" && r.nodes.some((n) => n.error?.connection === "Postgres Answers"),
    );
  }
  const token = signature.split(" · ")[1] ?? "";
  return RUNS.filter(
    (r) => r.status === "failed" && r.nodes.some((n) => n.error?.toolCall?.includes(token) || n.name.includes(token)),
  );
}

function costOfFailure(runs: Run[]): number {
  // Only the committed work is wasted — the steps that never ran cost nothing.
  return Number(
    runs
      .reduce(
        (sum, r) =>
          sum +
          r.nodes
            .filter((n) => n.state === "committed" || n.state === "recovered")
            .reduce((s, n) => s + (n.costUsd ?? 0), 0),
        0,
      )
      .toFixed(4),
  );
}

const SEVERITY_BY_OCCURRENCES = (n: number): IncidentSeverity =>
  n >= 40 ? "critical" : n >= 20 ? "high" : n >= 5 ? "medium" : "low";

export const INCIDENT_VIEWS: IncidentView[] = INCIDENTS.map((incident, i) => {
  const runs = affectedRuns(incident.signature, incident.id);
  const connectionName = incident.id === POSTGRES_INCIDENT_ID ? "Postgres Answers" : null;
  const connection = connectionName ? CONNECTIONS.find((c) => c.name === connectionName) : undefined;

  const activity: IncidentActivity[] = [
    { at: Date.parse(incident.firstSeen), actor: "recovery-engine", action: "Incident opened from failure signature" },
  ];
  if (incident.status === "acknowledged") {
    activity.push({
      at: Date.parse(incident.firstSeen) + 2 * HOUR,
      actor: incident.assignee ?? "platform-ops",
      action: "Acknowledged",
      note: "Looking at provider latency now.",
    });
  }
  activity.push({
    at: Date.parse(incident.lastSeen),
    actor: "recovery-engine",
    action: `Occurrence ${incident.occurrences} recorded`,
  });

  return {
    ...incident,
    status: incident.status as IncidentStatus,
    severity: SEVERITY_BY_OCCURRENCES(incident.occurrences),
    classification: incident.signature.split(" · ")[0],
    failingComponent: connection?.name ?? incident.signature.split(" · ")[1] ?? "unknown",
    componentHref: connection ? `/connections/${connection.id}` : "/tools",
    blastRadius: {
      workflows: incident.affectedWorkflows.length,
      tools: connection?.blastRadius.tools ?? 2,
      connections: connection ? 1 : 0,
      runs: incident.affectedRuns,
      costOfFailureUsd: costOfFailure(runs),
    },
    activity,
    mutedUntil: null,
    autoResolveAfterMs: 6 * HOUR,
    externalTracker: i === 1 ? "JIRA-4821" : null,
  };
});

export function getIncident(id: string): IncidentView | undefined {
  return INCIDENT_VIEWS.find((i) => i.id === id);
}

export function incidentRuns(incident: IncidentView): Run[] {
  return affectedRuns(incident.signature, incident.id);
}

/** Workflows touched, resolved to real records for the links. */
export function incidentWorkflows(incident: IncidentView) {
  return incident.affectedWorkflows
    .map((name) => WORKFLOWS.find((w) => w.name === name))
    .filter(Boolean);
}

/**
 * How long since the signature last fired, against the auto-resolve window.
 * Surfacing this is what makes auto-resolve trustworthy rather than surprising.
 */
export function autoResolveProgress(incident: IncidentView): { quietMs: number; fraction: number } {
  const quiet = NOW - Date.parse(incident.lastSeen);
  return { quietMs: quiet, fraction: Math.max(0, Math.min(1, quiet / incident.autoResolveAfterMs)) };
}
