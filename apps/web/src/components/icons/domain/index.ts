import type { IconComponent } from "../types";
import {
  CheckpointIcon, ResumeFromCheckpointIcon, DurableRunIcon, ReplayIcon,
  LeaseIcon, CommitBoundaryIcon,
} from "./durability";
import { QueueDepthIcon, WorkerIcon, BackpressureIcon, InFlightIcon } from "./queue";
import { FanOutIcon, MergeIcon, BranchIcon, LoopIterativeIcon, WaitUntilIcon } from "./graph";
import {
  ApprovalGateIcon, GateApprovedIcon, GateRejectedIcon, SlaTimerIcon, EscalationIcon,
} from "./human";
import { IncidentIcon, RecoveryEngineIcon, BlastRadiusIcon, RootCauseIcon } from "./failure";
import {
  ToolCallIcon, AgentBrainIcon, ByokKeyIcon, TokenMeterIcon, BudgetBurnIcon,
} from "./execution";

export * from "./durability";
export * from "./queue";
export * from "./graph";
export * from "./human";
export * from "./failure";
export * from "./execution";
export { CELL_LG, CELL_MD, CELL_SM, cellPath, Mark } from "./_cell";

export type DomainIconFamily =
  | "durability" | "queue" | "graph" | "human" | "failure" | "execution";

/**
 * The bespoke domain set — design §6.1.
 *
 * NOTE ON THE COUNT: §6.1 is headed "28 bespoke domain marks" but the list
 * beneath it names 29 (6 durability + 4 queue + 5 graph + 5 human + 4 failure +
 * 5 execution). All 29 named marks are drawn; the heading is off by one.
 */
export const DOMAIN_ICONS: {
  name: string;
  family: DomainIconFamily;
  Icon: IconComponent;
  meaning: string;
}[] = [
  // ── Durability ───────────────────────────────────────────────────────────
  { name: "checkpoint", family: "durability", Icon: CheckpointIcon, meaning: "Committed work that survives a crash" },
  { name: "resume-from-checkpoint", family: "durability", Icon: ResumeFromCheckpointIcon, meaning: "Restart at the last commit, not the beginning" },
  { name: "durable-run", family: "durability", Icon: DurableRunIcon, meaning: "A run whose progress persists" },
  { name: "replay", family: "durability", Icon: ReplayIcon, meaning: "Re-execute a completed run" },
  { name: "lease", family: "durability", Icon: LeaseIcon, meaning: "Time-bounded claim on a job" },
  { name: "commit-boundary", family: "durability", Icon: CommitBoundaryIcon, meaning: "The line durability is measured against" },

  // ── Queue ────────────────────────────────────────────────────────────────
  { name: "queue-depth", family: "queue", Icon: QueueDepthIcon, meaning: "How much work is waiting" },
  { name: "worker", family: "queue", Icon: WorkerIcon, meaning: "A process leasing jobs off the queue" },
  { name: "backpressure", family: "queue", Icon: BackpressureIcon, meaning: "Intake refusing further work" },
  { name: "in-flight", family: "queue", Icon: InFlightIcon, meaning: "Accepted and moving, not yet committed" },

  // ── Graph ────────────────────────────────────────────────────────────────
  { name: "fan-out", family: "graph", Icon: FanOutIcon, meaning: "One step dispatching to many" },
  { name: "merge", family: "graph", Icon: MergeIcon, meaning: "Many branches converging into one" },
  { name: "branch", family: "graph", Icon: BranchIcon, meaning: "A conditional split" },
  { name: "loop-iterative", family: "graph", Icon: LoopIterativeIcon, meaning: "Repeat until a condition holds" },
  { name: "wait-until", family: "graph", Icon: WaitUntilIcon, meaning: "Suspend pending a condition or time" },

  // ── Human ────────────────────────────────────────────────────────────────
  { name: "approval-gate", family: "human", Icon: ApprovalGateIcon, meaning: "Blocked on a person's decision" },
  { name: "gate-approved", family: "human", Icon: GateApprovedIcon, meaning: "A person allowed it through" },
  { name: "gate-rejected", family: "human", Icon: GateRejectedIcon, meaning: "A person refused it" },
  { name: "sla-timer", family: "human", Icon: SlaTimerIcon, meaning: "Time budget on a pending decision" },
  { name: "escalation", family: "human", Icon: EscalationIcon, meaning: "Handed up a level" },

  // ── Failure ──────────────────────────────────────────────────────────────
  { name: "incident", family: "failure", Icon: IncidentIcon, meaning: "A cluster of failures with one signature" },
  { name: "recovery-engine", family: "failure", Icon: RecoveryEngineIcon, meaning: "Automated re-execution of broken work" },
  { name: "blast-radius", family: "failure", Icon: BlastRadiusIcon, meaning: "Everything a failure reaches" },
  { name: "root-cause", family: "failure", Icon: RootCauseIcon, meaning: "The single source behind many symptoms" },

  // ── Execution ────────────────────────────────────────────────────────────
  { name: "tool-call", family: "execution", Icon: ToolCallIcon, meaning: "An external capability invoked" },
  { name: "agent-brain", family: "execution", Icon: AgentBrainIcon, meaning: "Model reasoning with tool grants" },
  { name: "byok-key", family: "execution", Icon: ByokKeyIcon, meaning: "Customer-supplied provider credential" },
  { name: "token-meter", family: "execution", Icon: TokenMeterIcon, meaning: "Consumption against a ceiling" },
  { name: "budget-burn", family: "execution", Icon: BudgetBurnIcon, meaning: "Spend rate against remaining budget" },
];

export const DOMAIN_ICON_FAMILIES: DomainIconFamily[] = [
  "durability", "queue", "graph", "human", "failure", "execution",
];
