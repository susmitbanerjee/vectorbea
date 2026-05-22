import {
  CheckCircle2,
  CircleDot,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  XCircle,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MockAuditEntry } from "@/mocks/agent-run.mock";
import { cn } from "@/lib/utils";

interface AuditTrailTableProps {
  entries: MockAuditEntry[];
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ACTION_STYLE: Record<
  string,
  { icon: React.ReactNode; textClass: string; bgClass: string; borderClass: string }
> = {
  RUN_CREATED: {
    icon: <CircleDot className="h-3.5 w-3.5" />,
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/50",
    borderClass: "border-border",
  },
  RUN_STARTED: {
    icon: <Play className="h-3.5 w-3.5" />,
    textClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
  },
  STEP_COMPLETED: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    textClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
  },
  APPROVAL_REQUESTED: {
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    textClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
  },
  APPROVAL_APPROVED: {
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    textClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
  },
  APPROVAL_REJECTED: {
    icon: <ShieldX className="h-3.5 w-3.5" />,
    textClass: "text-red-600 dark:text-red-400",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
  },
  RUN_RESUMED: {
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    textClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-500/10",
    borderClass: "border-blue-500/20",
  },
  RUN_SUCCEEDED: {
    icon: <Zap className="h-3.5 w-3.5" />,
    textClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
  },
  RUN_FAILED: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    textClass: "text-red-600 dark:text-red-400",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
  },
};

function ActionChip({ action }: { action: string }) {
  const style = ACTION_STYLE[action];
  if (!style) {
    return (
      <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
        {action}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold",
        style.bgClass,
        style.borderClass,
        style.textClass,
      )}
    >
      {style.icon}
      {action}
    </span>
  );
}

export function AuditTrailTable({ entries }: AuditTrailTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                  Time
                </th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                  Action
                </th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                  Actor
                </th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={cn(
                    "border-b border-border/50 last:border-0 transition-colors hover:bg-muted/20",
                    i % 2 === 0 ? "bg-transparent" : "bg-muted/[0.03]",
                  )}
                >
                  <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted-foreground">
                    {fmtTime(entry.timestamp)}
                  </td>
                  <td className="px-5 py-3">
                    <ActionChip action={entry.action} />
                  </td>
                  <td className="px-5 py-3 text-xs font-medium text-foreground">
                    {entry.actor}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {entry.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
