import {
  CheckCircle2,
  Clock,
  Coins,
  DollarSign,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RunStatusBadge, ApprovalStatusBadge } from "@/components/agent-runs/StatusBadge";
import type { MockRun } from "@/mocks/agent-run.mock";
import { cn } from "@/lib/utils";

interface RunSummaryCardsProps {
  run: MockRun;
}

function fmtDur(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  children: React.ReactNode;
}

function StatCard({ icon, iconBg, label, children }: StatCardProps) {
  return (
    <Card className="p-5">
      <CardContent className="p-0">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              iconBg,
            )}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <div className="mt-0.5 text-sm font-semibold text-foreground">{children}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function RunSummaryCards({ run }: RunSummaryCardsProps) {
  const completedSteps = run.steps.filter((s) => s.status === "SUCCEEDED").length;
  const totalSteps = run.steps.length;

  const topApproval = run.approvals[0];
  const approvalLabel = topApproval
    ? topApproval.status.charAt(0) + topApproval.status.slice(1).toLowerCase()
    : "None";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard
        icon={<CheckCircle2 className="h-4.5 w-4.5 h-[18px] w-[18px] text-white" />}
        iconBg={
          run.status === "SUCCEEDED"
            ? "bg-emerald-500"
            : run.status === "FAILED"
              ? "bg-red-500"
              : "bg-primary"
        }
        label="Status"
      >
        <RunStatusBadge status={run.status} />
      </StatCard>

      <StatCard
        icon={<Clock className="h-[18px] w-[18px] text-blue-600 dark:text-blue-400" />}
        iconBg="bg-blue-500/10"
        label="Duration"
      >
        {fmtDur(run.durationMs)}
      </StatCard>

      <StatCard
        icon={<Coins className="h-[18px] w-[18px] text-purple-600 dark:text-purple-400" />}
        iconBg="bg-purple-500/10"
        label="Total tokens"
      >
        {run.totalTokens != null ? run.totalTokens.toLocaleString() : "—"}
      </StatCard>

      <StatCard
        icon={<DollarSign className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-400" />}
        iconBg="bg-emerald-500/10"
        label="Est. cost"
      >
        {run.estimatedCostUsd != null ? `$${run.estimatedCostUsd.toFixed(4)}` : "—"}
      </StatCard>

      <StatCard
        icon={<ShieldCheck className="h-[18px] w-[18px] text-amber-600 dark:text-amber-400" />}
        iconBg="bg-amber-500/10"
        label="Approval"
      >
        {topApproval ? (
          <ApprovalStatusBadge status={topApproval.status} />
        ) : (
          <span className="text-sm text-muted-foreground">{approvalLabel}</span>
        )}
      </StatCard>

      <StatCard
        icon={<Layers className="h-[18px] w-[18px] text-sky-600 dark:text-sky-400" />}
        iconBg="bg-sky-500/10"
        label="Steps completed"
      >
        <span
          className={cn(
            "tabular-nums",
            completedSteps === totalSteps ? "text-emerald-600 dark:text-emerald-400" : "",
          )}
        >
          {completedSteps}/{totalSteps} completed
        </span>
      </StatCard>
    </div>
  );
}
