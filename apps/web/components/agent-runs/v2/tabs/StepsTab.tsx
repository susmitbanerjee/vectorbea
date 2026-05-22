import { cn } from "@/lib/utils";
import type { RunStepUiModel } from "@/types/agent-run-ui";

function fmtDur(ms?: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtTime(ts?: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const STATUS_MAP: Record<string, string> = {
  SUCCEEDED: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  FAILED: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
  RUNNING: "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  WAITING: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PENDING: "border-border bg-muted/40 text-muted-foreground",
  SKIPPED: "border-border bg-muted/30 text-muted-foreground/60",
};

const TYPE_COLORS: Record<string, string> = {
  LLM_CALL: "text-purple-600 dark:text-purple-400",
  TOOL_CALL: "text-cyan-600 dark:text-cyan-400",
  HTTP_CALL: "text-teal-600 dark:text-teal-400",
  APPROVAL_GATE: "text-amber-600 dark:text-amber-400",
  SYSTEM: "text-muted-foreground",
};

interface StepsTabProps {
  steps: RunStepUiModel[];
}

export function StepsTab({ steps }: StepsTabProps) {
  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">#</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Agent</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Name</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Type</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Status</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Started</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Duration</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Tokens</th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {steps.map(step => (
            <tr key={step.id} className="hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{step.index}</td>
              <td className="px-4 py-2.5">
                <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] text-violet-600 dark:text-violet-400">
                  {step.agentName}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className="text-[13px] font-medium">{step.name}</span>
                {step.errorMessage && (
                  <p className="mt-0.5 font-mono text-[11px] text-red-500 truncate max-w-[240px]" title={step.errorMessage}>
                    {step.errorMessage}
                  </p>
                )}
              </td>
              <td className="px-4 py-2.5">
                <span className={cn("font-mono text-[11px] font-medium", TYPE_COLORS[step.type] ?? "text-muted-foreground")}>
                  {step.type}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className={cn(
                  "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                  STATUS_MAP[step.status] ?? STATUS_MAP.PENDING,
                )}>
                  {step.status}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{fmtTime(step.startedAt)}</td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{fmtDur(step.durationMs)}</td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                {step.tokensUsed ? step.tokensUsed.toLocaleString() : "—"}
              </td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                {step.estimatedCostUsd ? `$${step.estimatedCostUsd.toFixed(4)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
