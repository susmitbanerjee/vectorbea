import { cn } from "@/lib/utils";
import type { AuditLogUiModel } from "@/types/agent-run-ui";

const ACTION_COLORS: Record<string, string> = {
  RUN_CREATED: "text-muted-foreground",
  RUN_STARTED: "text-blue-600",
  RUN_SUCCEEDED: "text-emerald-600",
  RUN_FAILED: "text-red-600",
  APPROVAL_REQUESTED: "text-amber-600",
  APPROVAL_APPROVED: "text-emerald-600",
  APPROVAL_REJECTED: "text-red-600",
  HTTP_CALL_FAILED: "text-red-600",
  CRM_UPDATE_EXECUTED: "text-cyan-600",
};

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface AuditTabProps {
  entries: AuditLogUiModel[];
}

export function AuditTab({ entries }: AuditTabProps) {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">No audit events recorded.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            {["Time", "Action", "Actor", "Entity", "Details"].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {entries.map((entry, i) => (
            <tr key={entry.id} className={cn("hover:bg-muted/20 transition-colors", i % 2 === 0 ? "" : "bg-muted/[0.03]")}>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                {fmtTime(entry.time)}
              </td>
              <td className="px-4 py-2.5">
                <span className={cn("font-mono text-[11px] font-medium", ACTION_COLORS[entry.action] ?? "text-muted-foreground")}>
                  {entry.action}
                </span>
              </td>
              <td className="px-4 py-2.5 text-[12px] font-medium text-foreground whitespace-nowrap">{entry.actor}</td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{entry.entity}</td>
              <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{entry.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
