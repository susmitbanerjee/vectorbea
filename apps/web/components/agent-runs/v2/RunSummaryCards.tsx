import { Bot, Clock, Coins, RefreshCw, ShieldCheck, Zap, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentRunUiModel } from "@/types/agent-run-ui";

function fmtDur(ms?: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: "default" | "success" | "error" | "warning" | "purple";
}

function SummaryCard({ label, value, sub, icon, accent = "default" }: CardProps) {
  const accentMap = {
    default: "text-muted-foreground",
    success: "text-emerald-600",
    error: "text-red-600",
    warning: "text-amber-600",
    purple: "text-violet-600",
  };
  return (
    <div
      className="rounded-xl p-4 space-y-2"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{label}</p>
        <span className={cn("h-4 w-4", accentMap[accent])}>{icon}</span>
      </div>
      <p className="text-[22px] font-semibold tracking-tight leading-none" style={{ color: "var(--text-primary)" }}>{value}</p>
      {sub && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{sub}</p>}
    </div>
  );
}

interface RunSummaryCardsProps {
  model: AgentRunUiModel;
}

export function RunSummaryCards({ model }: RunSummaryCardsProps) {
  const { run, agents, steps, approvals } = model;
  const stepsDone = steps.filter(s => s.status === "SUCCEEDED").length;
  const pendingApprovals = approvals.filter(a => a.status === "PENDING").length;
  const currentAgent = run.currentAgent ?? agents.find(a => a.status === "RUNNING")?.name;
  const retryCount = run.attemptNumber - 1;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <SummaryCard
        label="Duration"
        value={fmtDur(run.durationMs)}
        sub={run.finishedAt ? "Completed" : "In progress"}
        icon={<Clock className="h-4 w-4" />}
      />
      <SummaryCard
        label="Agents"
        value={String(agents.length)}
        sub={currentAgent ? `Current: ${currentAgent}` : "All done"}
        icon={<Bot className="h-4 w-4" />}
        accent="purple"
      />
      <SummaryCard
        label="Steps"
        value={`${stepsDone}/${steps.length}`}
        sub={run.currentStep ?? (stepsDone === steps.length ? "All completed" : "In progress")}
        icon={<CheckCircle2 className="h-4 w-4" />}
        accent={stepsDone === steps.length ? "success" : "default"}
      />
      <SummaryCard
        label="Tokens"
        value={run.totalTokens ? run.totalTokens.toLocaleString() : "—"}
        sub={run.estimatedCostUsd != null ? `$${(run.estimatedCostUsd ?? 0).toFixed(4)} est.` : undefined}
        icon={<Zap className="h-4 w-4" />}
      />
      <SummaryCard
        label="Cost"
        value={run.estimatedCostUsd != null ? `$${(run.estimatedCostUsd ?? 0).toFixed(4)}` : "—"}
        sub="Estimated USD"
        icon={<Coins className="h-4 w-4" />}
      />
      {approvals.length > 0 && (
        <SummaryCard
          label="Approvals"
          value={pendingApprovals > 0 ? `${pendingApprovals} pending` : `${approvals.length} done`}
          sub={pendingApprovals > 0 ? "Waiting for decision" : "All decided"}
          icon={<ShieldCheck className="h-4 w-4" />}
          accent={pendingApprovals > 0 ? "warning" : "success"}
        />
      )}
      {retryCount > 0 && (
        <SummaryCard
          label="Retries"
          value={String(retryCount)}
          sub="Attempt(s) before this"
          icon={<RefreshCw className="h-4 w-4" />}
          accent="warning"
        />
      )}
      {run.status === "FAILED" && (
        <SummaryCard
          label="Status"
          value="Failed"
          sub={run.errorMessage ? run.errorMessage.slice(0, 40) + "…" : "See error above"}
          icon={<XCircle className="h-4 w-4" />}
          accent="error"
        />
      )}
    </div>
  );
}
