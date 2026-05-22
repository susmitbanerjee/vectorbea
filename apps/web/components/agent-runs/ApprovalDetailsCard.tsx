import { CheckCircle2, MessageSquare, User, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalStatusBadge } from "@/components/agent-runs/StatusBadge";
import type { MockApproval } from "@/mocks/agent-run.mock";

interface ApprovalDetailsCardProps {
  approvals: MockApproval[];
}

function fmt(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 border-b border-border/50 py-2.5 last:border-0">
      <span className="text-xs text-muted-foreground self-start pt-px">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

export function ApprovalDetailsCard({ approvals }: ApprovalDetailsCardProps) {
  if (approvals.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {approvals.map((ap) => (
          <div key={ap.id} className="space-y-0">
            <DetailRow label="Title">{ap.title}</DetailRow>
            <DetailRow label="Request message">
              <span className="leading-relaxed">{ap.message}</span>
            </DetailRow>
            <DetailRow label="Requested at">{fmt(ap.requestedAt)}</DetailRow>
            <DetailRow label="Decision">
              <div className="flex items-center gap-2">
                <ApprovalStatusBadge status={ap.status} />
                {ap.status === "APPROVED" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : ap.status === "REJECTED" ? (
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                ) : null}
              </div>
            </DetailRow>
            {ap.decidedAt && (
              <DetailRow label="Decided at">{fmt(ap.decidedAt)}</DetailRow>
            )}
            {ap.decidedBy && (
              <DetailRow label="Decided by">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                    <User className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="font-medium">{ap.decidedBy.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({ap.decidedBy.email})
                  </span>
                </div>
              </DetailRow>
            )}
            {ap.decisionReason && (
              <DetailRow label="Reason">
                <div className="flex items-start gap-2">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="italic text-muted-foreground">
                    &ldquo;{ap.decisionReason}&rdquo;
                  </span>
                </div>
              </DetailRow>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
