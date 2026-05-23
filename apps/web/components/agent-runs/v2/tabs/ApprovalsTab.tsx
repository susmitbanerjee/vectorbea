import { CheckCircle2, Clock, MessageSquare, User, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovalUiModel } from "@/types/agent-run-ui";

function fmt(ts?: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function getStatusCfg(status: string) {
  switch (status) {
    case "APPROVED": return { icon: CheckCircle2, label: "Approved", color: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/[0.03]" };
    case "REJECTED": return { icon: XCircle, label: "Rejected", color: "text-red-600 dark:text-red-400", border: "border-red-500/20", bg: "bg-red-500/[0.03]" };
    case "EXPIRED": return { icon: Clock, label: "Expired", color: "text-muted-foreground", border: "border-border", bg: "bg-muted/20" };
    default: return { icon: Clock, label: "Pending", color: "text-amber-600 dark:text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/[0.03]" };
  }
}

interface ApprovalsTabProps {
  approvals: ApprovalUiModel[];
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
}

export function ApprovalsTab({ approvals, onApprove, onReject }: ApprovalsTabProps) {
  if (approvals.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No approval requests in this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {approvals.map(ap => {
        const scfg = getStatusCfg(ap.status);
        const StatusIcon = scfg.icon;
        return (
          <div key={ap.id} className={cn("rounded-xl border p-5 space-y-4", scfg.border, scfg.bg)}>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">{ap.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Related to: <span className="font-medium text-foreground">{ap.relatedAgent}</span>
                  {" "} · step: <span className="font-mono text-[11px]">{ap.relatedStep}</span>
                </p>
              </div>
              <div className={cn("flex items-center gap-1.5 text-sm font-semibold", scfg.color)}>
                <StatusIcon className="h-4 w-4" /> {scfg.label}
              </div>
            </div>

            {/* Message */}
            <p className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-sm leading-relaxed">
              {ap.message}
            </p>

            {/* Payload preview */}
            {ap.payloadPreview !== undefined && ap.payloadPreview !== null && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Payload preview
                </p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-[#0f0f0f] p-3 text-[11px] text-[#e5e7eb]">
                  {JSON.stringify(ap.payloadPreview as Record<string, unknown>, null, 2)}
                </pre>
              </div>
            )}

            {/* Timeline row */}
            <div className="grid grid-cols-2 gap-4 border-t border-border/30 pt-3 sm:grid-cols-4">
              <MetaItem label="Requested">{fmt(ap.requestedAt)}</MetaItem>
              {ap.decidedAt && <MetaItem label="Decided">{fmt(ap.decidedAt)}</MetaItem>}
              {ap.decidedBy && (
                <MetaItem label="Decided by">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {ap.decidedBy}
                  </span>
                </MetaItem>
              )}
            </div>

            {/* Reason */}
            {ap.decisionReason && (
              <div className="flex items-start gap-2 border-t border-border/30 pt-3">
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-sm italic text-muted-foreground">&ldquo;{ap.decisionReason}&rdquo;</p>
              </div>
            )}

            {/* Pending CTAs */}
            {ap.status === "PENDING" && (onApprove ?? onReject) && (
              <div className="flex gap-2 border-t border-border/30 pt-3">
                {onApprove && (
                  <button
                    type="button"
                    onClick={() => onApprove(ap.id)}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                  >
                    Approve
                  </button>
                )}
                {onReject && (
                  <button
                    type="button"
                    onClick={() => onReject(ap.id)}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-500/20 transition-colors"
                  >
                    Reject
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="mt-0.5 text-[12px] font-medium text-foreground">{children}</p>
    </div>
  );
}
