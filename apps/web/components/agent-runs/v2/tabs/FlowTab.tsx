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
    border: "border-emerald-500/20",
    bg: "bg-emerald-500/5",
    label: "Completed",
    text: "text-emerald-400",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  FAILED: {
    dot: "bg-red-500",
    border: "border-red-500/20",
    bg: "bg-red-500/5",
    label: "Failed",
    text: "text-red-400",
    icon: <XCircle className="h-3 w-3" />,
  },
  RUNNING: {
    dot: "bg-sky-400 animate-pulse",
    border: "border-sky-500/20",
    bg: "bg-sky-500/5",
    label: "Running",
    text: "text-sky-400",
    icon: <Timer className="h-3 w-3" />,
  },
  WAITING: {
    dot: "bg-amber-500",
    border: "border-amber-500/20",
    bg: "bg-amber-500/5",
    label: "Waiting",
    text: "text-amber-400",
    icon: <Clock className="h-3 w-3" />,
  },
  PENDING: {
    dot: "bg-slate-500",
    border: "border-border/40",
    bg: "",
    label: "Pending",
    text: "text-muted-foreground",
    icon: <Clock className="h-3 w-3" />,
  },
  CANCELLED: {
    dot: "bg-slate-500",
    border: "border-border/40",
    bg: "",
    label: "Cancelled",
    text: "text-muted-foreground",
    icon: <XCircle className="h-3 w-3" />,
  },
  SKIPPED: {
    dot: "bg-slate-600",
    border: "border-border/30",
    bg: "",
    label: "Skipped",
    text: "text-muted-foreground/60",
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
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
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
            { dot: "bg-sky-400", label: "Running" },
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
        <div
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium"
          style={{
            background: "rgba(56,189,248,0.08)",
            border: "1px solid rgba(56,189,248,0.18)",
            color: "#38BDF8",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
          RUN START
        </div>
        <div className="h-4 w-px" style={{ background: "rgba(148,163,184,0.15)" }} />
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
        <div className="h-4 w-px" style={{ background: "rgba(148,163,184,0.15)" }} />
        <div
          className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium"
          style={{
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.2)",
            color: "#10B981",
          }}
        >
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
          style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}
        >
          <div className="flex items-center gap-3">
            {/* Index bubble */}
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
              style={{
                background: "rgba(139,92,246,0.15)",
                border: "1px solid rgba(139,92,246,0.25)",
                color: "#A78BFA",
              }}
            >
              {index + 1}
            </div>
            {/* Agent icon */}
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: "rgba(139,92,246,0.1)",
                border: "1px solid rgba(139,92,246,0.2)",
              }}
            >
              <Bot className="h-3.5 w-3.5" style={{ color: "#A78BFA" }} />
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
          {agent.estimatedCostUsd !== undefined && agent.estimatedCostUsd > 0 && (
            <StatItem icon={<Coins className="h-3 w-3" />} label="Cost" value={`$${agent.estimatedCostUsd.toFixed(4)}`} />
          )}
        </div>

        {/* Duration progress bar */}
        {agent.durationMs !== undefined && (
          <div className="px-4 pb-1">
            <div
              className="h-0.5 w-full overflow-hidden rounded-full"
              style={{ background: "rgba(148,163,184,0.08)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${durationPct}%`,
                  background: agent.status === "FAILED" ? "#EF4444" :
                    agent.status === "WAITING" ? "#F59E0B" : "#38BDF8",
                }}
              />
            </div>
          </div>
        )}

        {/* Tools used */}
        {agent.toolsUsed && agent.toolsUsed.length > 0 && (
          <div
            className="mx-4 mb-3 mt-2 rounded-lg px-3 py-2"
            style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }}
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
      <div className="h-3 w-px" style={{ background: "rgba(148,163,184,0.15)" }} />
      <div
        className="flex items-center gap-2 self-stretch rounded-lg px-3 py-2"
        style={{
          background: "rgba(34,211,238,0.04)",
          border: "1px solid rgba(34,211,238,0.12)",
        }}
      >
        <ArrowDown className="h-3 w-3 shrink-0" style={{ color: "#22D3EE" }} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#22D3EE" }}>
          AGENT HANDOFF
        </span>
        {handoffTo && (
          <>
            <span style={{ color: "rgba(148,163,184,0.4)" }}>→</span>
            <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
              {handoffTo}
            </span>
          </>
        )}
        {handoffAt && (
          <span className="ml-auto font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
            {new Date(handoffAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>
      <div className="h-3 w-px" style={{ background: "rgba(148,163,184,0.15)" }} />
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
