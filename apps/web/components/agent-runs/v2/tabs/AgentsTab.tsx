import { Bot, Clock, Coins, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentExecutionSummary, TimelineEventStatus } from "@/types/agent-run-ui";

function fmtDur(ms?: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const STATUS_CONFIG: Record<TimelineEventStatus, { dot: string; label: string; text: string }> = {
  SUCCEEDED: { dot: "bg-emerald-500", label: "Succeeded", text: "text-emerald-600 dark:text-emerald-400" },
  FAILED: { dot: "bg-red-500", label: "Failed", text: "text-red-600 dark:text-red-400" },
  RUNNING: { dot: "bg-blue-500 animate-pulse", label: "Running", text: "text-blue-600 dark:text-blue-400" },
  WAITING: { dot: "bg-amber-500", label: "Waiting", text: "text-amber-600 dark:text-amber-400" },
  PENDING: { dot: "bg-muted-foreground/40", label: "Pending", text: "text-muted-foreground" },
  CANCELLED: { dot: "bg-muted-foreground/40", label: "Cancelled", text: "text-muted-foreground" },
  SKIPPED: { dot: "bg-muted-foreground/30", label: "Skipped", text: "text-muted-foreground" },
};

interface AgentsTabProps {
  agents: AgentExecutionSummary[];
}

export function AgentsTab({ agents }: AgentsTabProps) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <Bot className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No agent execution data available.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => {
        const scfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.PENDING;
        return (
          <div
            key={agent.id}
            className={cn(
              "rounded-xl border p-4 space-y-3",
              agent.status === "FAILED"
                ? "border-red-500/20 bg-red-500/[0.02]"
                : agent.status === "RUNNING"
                  ? "border-blue-500/20 bg-blue-500/[0.02]"
                  : "border-border/60 bg-card/50",
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10">
                  <Bot className="h-3.5 w-3.5 text-violet-500" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold leading-tight">{agent.name}</p>
                  <p className="text-[11px] text-muted-foreground">{agent.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={cn("h-1.5 w-1.5 rounded-full", scfg.dot)} />
                <span className={cn("text-[11px] font-medium", scfg.text)}>{scfg.label}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={<Clock className="h-3 w-3" />} label="Duration" value={fmtDur(agent.durationMs)} />
              <Stat icon={<span className="text-[10px]">#</span>} label="Steps" value={String(agent.stepsCount)} />
              {agent.tokensUsed !== undefined && agent.tokensUsed > 0 && (
                <Stat icon={<Zap className="h-3 w-3" />} label="Tokens" value={agent.tokensUsed.toLocaleString()} />
              )}
              {agent.estimatedCostUsd !== undefined && agent.estimatedCostUsd > 0 && (
                <Stat icon={<Coins className="h-3 w-3" />} label="Cost" value={`$${agent.estimatedCostUsd.toFixed(4)}`} />
              )}
            </div>

            {/* Tools used */}
            {agent.toolsUsed && agent.toolsUsed.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Tools used</p>
                <div className="flex flex-wrap gap-1">
                  {agent.toolsUsed.map(t => (
                    <span key={t} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {t.length > 30 ? `${t.slice(0, 30)}…` : t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Output summary */}
            {agent.outputSummary && (
              <p className="text-[12px] text-muted-foreground border-t border-border/40 pt-2.5">{agent.outputSummary}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-[10px] text-muted-foreground/70">{label}</p>
        <p className="text-[12px] font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}
