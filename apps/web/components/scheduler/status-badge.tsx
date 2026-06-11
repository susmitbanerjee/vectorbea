import { Badge } from "@/components/ui/badge";

type JobStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
type RunStatus = "QUEUED" | "RUNNING" | "WAITING_FOR_APPROVAL" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMEOUT";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; variant: "success" | "warning" | "outline" }> = {
    ACTIVE: { label: "Active", variant: "success" },
    PAUSED: { label: "Paused", variant: "warning" },
    ARCHIVED: { label: "Archived", variant: "outline" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { label: string; variant: "success" | "warning" | "destructive" | "outline" | "default" }> = {
    QUEUED: { label: "Queued", variant: "outline" },
    RUNNING: { label: "Running", variant: "default" },
    WAITING_FOR_APPROVAL: { label: "Awaiting Approval", variant: "warning" },
    SUCCEEDED: { label: "Succeeded", variant: "success" },
    FAILED: { label: "Failed", variant: "destructive" },
    CANCELLED: { label: "Cancelled", variant: "outline" },
    TIMEOUT: { label: "Timeout", variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

export function TriggerBadge({ source }: { source: "MANUAL" | "SCHEDULE" | "RETRY" }) {
  const map = {
    MANUAL: { label: "Manual", variant: "outline" as const },
    SCHEDULE: { label: "Schedule", variant: "default" as const },
    RETRY: { label: "Retry", variant: "warning" as const },
  };
  const { label, variant } = map[source] ?? { label: source, variant: "outline" as const };
  return <Badge variant={variant}>{label}</Badge>;
}
