import { ArrowDown, Bot, CheckCircle2, Clock, Coins, Timer, Wrench, XCircle, Zap } from "lucide-react";
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

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS: Record<TimelineEventStatus, {
  dot: string;
  border: string;
  bg: string;
  label: string;
  text: string;
  icon: React.ReactNode;
}> = {
  SUCCEEDED: {
    dot: "bg-emerald-500",
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    label: "Completed",
    text: "text-emerald-700",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  FAILED: {
    dot: "bg-red-500",
    border: "border-red-200",
    bg: "bg-red-50",
    label: "Failed",
    text: "text-red-700",
    icon: <XCircle className="h-3 w-3" />,
  },
  RUNNING: {
    dot: "bg-teal-500 animate-pulse",
    border: "border-blue-200",
    bg: "bg-blue-50",
    label: "Running",
    text: "text-blue-700",
    icon: <Timer className="h-3 w-3" />,
  },
  WAITING: {
    dot: "bg-amber-500",
    border: "border-amber-200",
    bg: "bg-amber-50",
    label: "Waiting",
    text: "text-amber-700",
    icon: <Clock className="h-3 w-3" />,
  },
  PENDING: {
    dot: "bg-slate-400",
    border: "border-border",
    bg: "bg-muted/30",
    label: "Pending",
    text: "text-muted-foreground",
    icon: <Clock className="h-3 w-3" />,
  },
  CANCELLED: {
    dot: "bg-slate-300",
    border: "border-border",
    bg: "bg-muted/20",
    label: "Cancelled",
    text: "text-muted-foreground",
    icon: <XCircle className="h-3 w-3" />,
  },
  SKIPPED: {
    dot: "bg-slate-200",
    border: "border-border",
    bg: "bg-background",
    label: "Skipped",
    text: "text-muted-foreground/70",
    icon: <Clock className="h-3 w-3" />,
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface FlowTabProps {
  agents: AgentExecutionSummary[];
  timelineEvents: RunTimelineEventUi[];
}

// ─── Build ordered chain from AGENT_HANDOFF events ───────────────────────────

interface FlowNode {
  agent: AgentExecutionSummary;
  handoffTo?: string;
  handoffAt?: string;
  handoffLabel?: string;
}

function buildFlow(agents: AgentExecutionSummary[], events: RunTimelineEventUi[]): FlowNode[] {
  const byName = new Map(agents.map(a => [a.name, a]));
  const handoffs = events
    .filter(e => e.type === "AGENT_HANDOFF")
    .sort((a, b) => a.sequence - b.sequence);

  const ordered: FlowNode[] = [];
  const visited = new Set<string>();

  for (const handoff of handoffs) {
    const fromName = handoff.agentName;
    const toName = handoff.handoffTo;
    if (fromName && !visited.has(fromName) && byName.has(fromName)) {
      ordered.push({
        agent: byName.get(fromName)!,
        handoffTo: toName,
        handoffAt: handoff.timestamp,
        handoffLabel: handoff.summary,
      });
      visited.add(fromName);
    }
  }

  for (const agent of agents) {
    if (!visited.has(agent.name)) {
      ordered.push({ agent });
      visited.add(agent.name);
    }
  }

  return ordered;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FlowTab({ agents, timelineEvents }: FlowTabProps) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <Bot className="h-8 w-8 text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground">No agent execution data available.</p>
      </div>
    );
  }

  const flow = buildFlow(agents, timelineEvents);
  const totalDurationMs = agents.reduce((acc, a) => acc + (a.durationMs ?? 0), 0);

  return (
    <div className="space-y-0">
      {/* Legend */}
      <div
        className="mb-5 flex items-center gap-4 rounded-lg px-4 py-2.5 text-[11px]"
        style={{ background: "var(--surface-2)", border: "1px solid var(--legacy-border-subtle)" }}
      >
        <span style={{ color: "var(--text-faint)" }} className="uppercase tracking-wider font-semibold text-[10px]">
          Agent Chain
        </span>
        <div className="flex items-center gap-1" style={{ color: "var(--text-faint)" }}>
          <span style={{ color: "var(--text-muted)" }}>{flow.length} agents</span>
          <span>·</span>
          <span style={{ color: "var(--text-muted)" }}>{fmtDur(totalDurationMs)} total</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {[
            { dot: "bg-emerald-500", label: "Completed" },
            { dot: "bg-blue-500", label: "Running" },
            { dot: "bg-amber-500", label: "Waiting" },
            { dot: "bg-red-500", label: "Failed" },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
              <span style={{ color: "var(--text-faint)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Run start node */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-medium text-blue-700">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          RUN START
        </div>
        <div className="h-4 w-px bg-border" />
      </div>

      {/* Agent nodes */}
      {flow.map((node, idx) => (
        <div key={node.agent.id} className="flex flex-col items-center">
          <AgentFlowNode node={node} index={idx} total={flow.length} />
          {idx < flow.length - 1 && (
            <HandoffConnector
              handoffTo={node.handoffTo}
              handoffAt={node.handoffAt}
              label={node.handoffLabel}
            />
          )}
        </div>
      ))}

      {/* Run end node */}
      <div className="flex flex-col items-center">
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700">
          <CheckCircle2 className="h-3 w-3" />
          RUN COMPLETE
        </div>
      </div>
    </div>
  );
}

// ─── Agent node ───────────────────────────────────────────────────────────────

function AgentFlowNode({ node, index, total }: { node: FlowNode; index: number; total: number }) {
  const { agent } = node;
  const scfg = STATUS[agent.status] ?? STATUS.PENDING;
  const durationPct = agent.durationMs ? Math.min(100, Math.round((agent.durationMs / 60000) * 100)) : 0;

  return (
    <div
      className={cn("w-full max-w-2xl rounded-xl border transition-all", scfg.border, scfg.bg)}
      style={{ background: "var(--surface-2)", borderColor: undefined }}
      // Override via inline style only for non-status borders
    >
      <div
        className={cn("w-full rounded-xl border", scfg.border)}
        style={{ background: "var(--surface-2)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--legacy-border-subtle)" }}
        >
          <div className="flex items-center gap-3">
            {/* Index bubble */}
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-violet-100 font-mono text-[10px] font-bold text-violet-600">
              {index + 1}
            </div>
            {/* Agent icon */}
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-200 bg-violet-50">
              <Bot className="h-3.5 w-3.5 text-violet-500" />
            </div>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {agent.name}
              </p>
              <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                {agent.role}
              </p>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn("h-1.5 w-1.5 rounded-full", scfg.dot)} />
            <span className={cn("text-[11px] font-medium", scfg.text)}>{scfg.label}</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
          <StatItem icon={<Clock className="h-3 w-3" />} label="Duration" value={fmtDur(agent.durationMs)} />
          <StatItem icon={<span className="font-mono text-[10px] font-bold">#</span>} label="Steps" value={String(agent.stepsCount)} />
          {agent.tokensUsed !== undefined && agent.tokensUsed > 0 && (
            <StatItem icon={<Zap className="h-3 w-3" />} label="Tokens" value={agent.tokensUsed.toLocaleString()} />
          )}
          {agent.estimatedCostUsd != null && agent.estimatedCostUsd > 0 && (
            <StatItem icon={<Coins className="h-3 w-3" />} label="Cost" value={`$${(agent.estimatedCostUsd ?? 0).toFixed(4)}`} />
          )}
        </div>

        {/* Duration progress bar */}
        {agent.durationMs !== undefined && (
          <div className="px-4 pb-1">
            <div
              className="h-0.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--legacy-border-subtle)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${durationPct}%`,
                  background: agent.status === "FAILED" ? "var(--status-failure)" :
                    agent.status === "WAITING" ? "var(--legacy-status-waiting)" : "var(--status-running)",
                }}
              />
            </div>
          </div>
        )}

        {/* Tools used */}
        {agent.toolsUsed && agent.toolsUsed.length > 0 && (
          <div
            className="mx-4 mb-3 mt-2 rounded-lg px-3 py-2"
            style={{ background: "var(--surface-3)", border: "1px solid var(--legacy-border-subtle)" }}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <Wrench className="h-3 w-3 shrink-0" style={{ color: "var(--text-faint)" }} />
              {agent.toolsUsed.map(t => (
                <span
                  key={t}
                  className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    background: "rgba(148,163,184,0.05)",
                    borderColor: "rgba(148,163,184,0.12)",
                    color: "var(--text-muted)",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Output summary */}
        {agent.outputSummary && (
          <div
            className="mx-4 mb-3 rounded-lg px-3 py-2 text-[12px] leading-relaxed"
            style={{
              background: "rgba(56,189,248,0.03)",
              borderLeft: "2px solid rgba(56,189,248,0.3)",
              color: "var(--text-muted)",
            }}
          >
            {agent.outputSummary}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Handoff connector ────────────────────────────────────────────────────────

function HandoffConnector({ handoffTo, handoffAt, label }: {
  handoffTo?: string;
  handoffAt?: string;
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1 w-full max-w-2xl">
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-2 self-stretch rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2">
        <ArrowDown className="h-3 w-3 shrink-0 text-cyan-600" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-cyan-700">
          AGENT HANDOFF
        </span>
        {handoffTo && (
          <>
            <span className="text-muted-foreground/40">→</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {handoffTo}
            </span>
          </>
        )}
        {handoffAt && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
            {new Date(handoffAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>
      <div className="h-3 w-px bg-border" />
    </div>
  );
}

// ─── Stat item ────────────────────────────────────────────────────────────────

function StatItem({ icon, label, value }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: "var(--text-faint)" }}>{icon}</span>
      <div>
        <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{label}</p>
        <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
      </div>
    </div>
  );
}
