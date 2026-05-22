import { ArrowDown, Bot, Clock, Coins, Wrench, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentExecutionSummary, RunTimelineEventUi, TimelineEventStatus } from "@/types/agent-run-ui";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDur(ms?: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const STATUS: Record<TimelineEventStatus, { dot: string; ring: string; label: string; text: string }> = {
  SUCCEEDED: { dot: "bg-emerald-500", ring: "border-emerald-500/30 bg-emerald-500/[0.06]", label: "Succeeded", text: "text-emerald-500" },
  FAILED:    { dot: "bg-red-500",     ring: "border-red-500/30 bg-red-500/[0.06]",         label: "Failed",    text: "text-red-500" },
  RUNNING:   { dot: "bg-blue-500 animate-pulse", ring: "border-blue-500/30 bg-blue-500/[0.06]", label: "Running", text: "text-blue-500" },
  WAITING:   { dot: "bg-amber-500",  ring: "border-amber-500/30 bg-amber-500/[0.06]",      label: "Waiting",   text: "text-amber-500" },
  PENDING:   { dot: "bg-muted-foreground/40", ring: "border-border bg-muted/30",           label: "Pending",   text: "text-muted-foreground" },
  CANCELLED: { dot: "bg-muted-foreground/40", ring: "border-border bg-muted/30",           label: "Cancelled", text: "text-muted-foreground" },
  SKIPPED:   { dot: "bg-muted-foreground/30", ring: "border-border bg-muted/20",           label: "Skipped",   text: "text-muted-foreground" },
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface FlowTabProps {
  agents: AgentExecutionSummary[];
  timelineEvents: RunTimelineEventUi[];
}

// ─── Derived: build ordered agent flow from AGENT_HANDOFF events ─────────────

interface FlowNode {
  agent: AgentExecutionSummary;
  handoffTo?: string;   // name of next agent in chain
  handoffAt?: string;   // ISO timestamp of handoff
}

function buildFlow(agents: AgentExecutionSummary[], events: RunTimelineEventUi[]): FlowNode[] {
  // Index agents by name
  const byName = new Map(agents.map(a => [a.name, a]));

  // Collect handoff events in order
  const handoffs = events
    .filter(e => e.type === "AGENT_HANDOFF")
    .sort((a, b) => a.sequence - b.sequence);

  // Build ordered list: first agent is the one that produced the first handoff, or just agents[0]
  const ordered: FlowNode[] = [];
  const visited = new Set<string>();

  // Walk handoffs
  for (const handoff of handoffs) {
    const fromName = handoff.agentName;
    const toName = handoff.handoffTo;
    if (fromName && !visited.has(fromName) && byName.has(fromName)) {
      ordered.push({ agent: byName.get(fromName)!, handoffTo: toName, handoffAt: handoff.timestamp });
      visited.add(fromName);
    }
  }

  // Add any agents not yet in the list (last agent, or agents without a handoff)
  for (const agent of agents) {
    if (!visited.has(agent.name)) {
      ordered.push({ agent });
      visited.add(agent.name);
    }
  }

  return ordered;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FlowTab({ agents, timelineEvents }: FlowTabProps) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <Bot className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No agent execution data available.</p>
      </div>
    );
  }

  const flow = buildFlow(agents, timelineEvents);

  return (
    <div className="flex flex-col items-center gap-0 py-2">
      {flow.map((node, idx) => (
        <div key={node.agent.id} className="flex flex-col items-center w-full max-w-xl">
          <AgentFlowNode node={node} index={idx} />
          {/* Connector arrow to next node */}
          {idx < flow.length - 1 && (
            <HandoffConnector handoffTo={node.handoffTo} handoffAt={node.handoffAt} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Agent node card ──────────────────────────────────────────────────────────

function AgentFlowNode({ node, index }: { node: FlowNode; index: number }) {
  const { agent } = node;
  const scfg = STATUS[agent.status] ?? STATUS.PENDING;

  return (
    <div className={cn(
      "w-full rounded-xl border p-4 space-y-3 transition-colors",
      scfg.ring,
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* Index badge */}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-violet-500/25 bg-violet-500/10 font-mono text-[10px] font-bold text-violet-400">
            {index + 1}
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
            <Bot className="h-3.5 w-3.5 text-violet-400" />
          </span>
          <div>
            <p className="text-[13px] font-semibold leading-tight text-foreground">{agent.name}</p>
            <p className="text-[11px] text-muted-foreground">{agent.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", scfg.dot)} />
          <span className={cn("text-[11px] font-medium", scfg.text)}>{scfg.label}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-2">
        <StatChip icon={<Clock className="h-3 w-3" />} value={fmtDur(agent.durationMs)} label="duration" />
        <StatChip icon={<span className="font-mono text-[10px] font-bold">#</span>} value={String(agent.stepsCount)} label="steps" />
        {agent.tokensUsed !== undefined && agent.tokensUsed > 0 && (
          <StatChip icon={<Zap className="h-3 w-3" />} value={agent.tokensUsed.toLocaleString()} label="tokens" />
        )}
        {agent.estimatedCostUsd !== undefined && agent.estimatedCostUsd > 0 && (
          <StatChip icon={<Coins className="h-3 w-3" />} value={`$${agent.estimatedCostUsd.toFixed(4)}`} label="cost" />
        )}
      </div>

      {/* Tools used */}
      {agent.toolsUsed && agent.toolsUsed.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Wrench className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          {agent.toolsUsed.map(t => (
            <span key={t} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {t.length > 28 ? `${t.slice(0, 28)}…` : t}
            </span>
          ))}
        </div>
      )}

      {/* Output summary */}
      {agent.outputSummary && (
        <p className="border-t border-border/40 pt-2.5 text-[12px] leading-relaxed text-muted-foreground">
          {agent.outputSummary}
        </p>
      )}
    </div>
  );
}

// ─── Handoff connector ────────────────────────────────────────────────────────

function HandoffConnector({ handoffTo, handoffAt }: { handoffTo?: string; handoffAt?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <div className="h-4 w-px bg-border/60" />
      <div className="flex items-center gap-1.5 rounded border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1">
        <ArrowDown className="h-3 w-3 text-cyan-400" />
        <span className="font-mono text-[10px] text-cyan-400">
          HANDOFF{handoffTo ? ` → ${handoffTo}` : ""}
        </span>
        {handoffAt && (
          <span className="text-[10px] text-muted-foreground/50 ml-1">
            {new Date(handoffAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>
      <div className="h-4 w-px bg-border/60" />
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-2 py-1">
      <span className="text-muted-foreground/70">{icon}</span>
      <span className="text-[11px] font-medium text-foreground">{value}</span>
      <span className="text-[10px] text-muted-foreground/60">{label}</span>
    </div>
  );
}
