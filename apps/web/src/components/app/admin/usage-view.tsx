"use client";

import * as React from "react";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { useScope } from "~/lib/workspace/workspace-provider";
import { cn } from "~/lib/cn";

type Meter = "traces" | "replay_runs" | "evaluation_executions" | "provider_executions" | "judge_executions" | "scheduled_regression_runs" | "provider_arena_runs" | "notification_emails";
interface UsageSnapshot {
  planTier: string;
  month: string;
  resetAt: string;
  usage: Record<Meter, number>;
  limits: Record<Meter, number | null>;
  seats: { used: number; limit: number };
  auditEvents: { used: number; limit: number };
}

const LABELS: Record<Meter, string> = {
  traces: "Runtime traces", replay_runs: "Replay runs", evaluation_executions: "Evaluation executions",
  provider_executions: "Provider executions", judge_executions: "Judge executions",
  scheduled_regression_runs: "Scheduled regression runs", provider_arena_runs: "Provider arena runs",
  notification_emails: "Notification emails",
};

export function UsageView() {
  const { workspaceId } = useScope();
  const [data, setData] = React.useState<UsageSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/settings/usage?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const json = await response.json() as UsageSnapshot | { error?: string };
        if (!response.ok) throw new Error("error" in json ? json.error : "Failed to load usage");
        setData(json as UsageSnapshot);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Failed to load usage"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId]);

  const meters = data ? (Object.keys(data.usage) as Meter[]) : [];
  return <PageContainer>
    <PageHeader eyebrow="Admin" title="Usage & limits" description="Current monthly consumption from the workspace quota ledger." metadata={data ? <Text variant="caption" tone="secondary">{data.planTier} plan · resets {new Date(data.resetAt).toLocaleDateString()}</Text> : undefined} />
    {loading ? <State text="Loading usage…" /> : null}
    {error ? <State text={error} error /> : null}
    {data ? <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <UsageCard label="Workspace seats" used={data.seats.used} limit={data.seats.limit} />
        <UsageCard label="Audit events" used={data.auditEvents.used} limit={data.auditEvents.limit} />
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{meters.map((meter) => <UsageCard key={meter} label={LABELS[meter]} used={data.usage[meter]} limit={data.limits[meter]} />)}</div>
    </div> : null}
  </PageContainer>;
}

function UsageCard({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const percent = limit === null ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone = percent >= 100 ? "bg-status-failed" : percent >= 80 ? "bg-status-waiting" : "bg-accent";
  return <section className="border-subtle bg-surface-raised rounded-lg border p-3">
    <div className="flex items-baseline justify-between gap-2"><Text variant="label" tone="primary">{label}</Text><Text variant="caption" tone="secondary" tabular>{used.toLocaleString()} / {limit === null ? "Unlimited" : limit.toLocaleString()}</Text></div>
    {limit !== null ? <><div className="bg-surface-sunken mt-2 h-1.5 overflow-hidden rounded-full"><div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} /></div><Text variant="caption" tone="muted" className="mt-1 block">{Math.max(limit - used, 0).toLocaleString()} remaining</Text></> : <Text variant="caption" tone="muted" className="mt-2 block">No monthly cap on this plan.</Text>}
  </section>;
}

function State({ text, error }: { text: string; error?: boolean }) { return <div className={cn("rounded-lg border p-5 text-center", error ? "border-status-failed-border bg-status-failed-subtle text-status-failed" : "border-subtle bg-surface-raised")}><Text variant="body-sm" tone="inherit">{text}</Text></div>; }
