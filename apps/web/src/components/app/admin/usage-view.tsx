"use client";

import * as React from "react";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
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
    {workspaceId ? <div className="mb-3"><OperationalBudgetPanel workspaceId={workspaceId} /></div> : null}
    {data ? <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <UsageCard label="Workspace seats" used={data.seats.used} limit={data.seats.limit} />
        <UsageCard label="Audit events" used={data.auditEvents.used} limit={data.auditEvents.limit} />
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{meters.map((meter) => <UsageCard key={meter} label={LABELS[meter]} used={data.usage[meter]} limit={data.limits[meter]} />)}</div>
    </div> : null}
  </PageContainer>;
}

interface OperationalBudget {
  configured: boolean;
  reliabilityTarget: number | null;
  dailySpendLimitUsd: number | null;
  approvalSlaMinutes: number | null;
  updatedAt: string | null;
}

function OperationalBudgetPanel({ workspaceId }: { workspaceId: string | null }) {
  const [budget, setBudget] = React.useState<OperationalBudget | null>(null);
  const [reliability, setReliability] = React.useState("");
  const [dailySpend, setDailySpend] = React.useState("");
  const [approvalSla, setApprovalSla] = React.useState("");
  const [status, setStatus] = React.useState<"loading" | "idle" | "saving">("loading");
  const [message, setMessage] = React.useState<string | null>(null);

  const applyBudget = React.useCallback((next: OperationalBudget) => {
    setBudget(next);
    setReliability(next.reliabilityTarget === null ? "" : String(next.reliabilityTarget * 100));
    setDailySpend(next.dailySpendLimitUsd === null ? "" : String(next.dailySpendLimitUsd));
    setApprovalSla(next.approvalSlaMinutes === null ? "" : String(next.approvalSlaMinutes));
  }, []);

  React.useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    setStatus("loading");
    fetch(`/api/settings/control-budget?workspaceId=${encodeURIComponent(workspaceId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await response.json() as OperationalBudget | { error?: string };
        if (!response.ok) throw new Error("error" in json ? json.error : "Failed to load budget");
        applyBudget(json as OperationalBudget);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : "Failed to load budget");
      })
      .finally(() => { if (!controller.signal.aborted) setStatus("idle"); });
    return () => controller.abort();
  }, [workspaceId, applyBudget]);

  const optionalNumber = (value: string) => value.trim() === "" ? null : Number(value);

  const save = async () => {
    if (!workspaceId) return;
    const reliabilityPercent = optionalNumber(reliability);
    const daily = optionalNumber(dailySpend);
    const sla = optionalNumber(approvalSla);
    if (
      (reliabilityPercent !== null && (reliabilityPercent < 90 || reliabilityPercent > 99.999)) ||
      (daily !== null && daily <= 0) ||
      (sla !== null && (!Number.isInteger(sla) || sla < 5 || sla > 10_080))
    ) {
      setMessage("Use 90–99.999% reliability, a positive daily budget, and a 5–10,080 minute SLA.");
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/settings/control-budget?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reliabilityTarget: reliabilityPercent === null ? null : reliabilityPercent / 100,
            dailySpendLimitUsd: daily,
            approvalSlaMinutes: sla,
          }),
        },
      );
      const json = await response.json() as OperationalBudget | { error?: string };
      if (!response.ok) throw new Error("error" in json ? json.error : "Failed to save budget");
      applyBudget(json as OperationalBudget);
      setMessage("Operational budget saved. Control now uses these targets.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Failed to save budget");
    } finally {
      setStatus("idle");
    }
  };

  return (
    <section id="operational-budgets" className="border-subtle bg-surface-raised rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Text variant="heading-sm" tone="max" as="h2" className="block">Operational budgets</Text>
          <Text variant="body-sm" tone="muted" className="mt-1 block">
            Workspace objectives for Control. These do not replace per-workflow execution limits.
          </Text>
        </div>
        <Button size="sm" variant="primary" onClick={() => void save()} loading={status === "saving"} disabled={status === "loading"}>
          Save budgets
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <BudgetField label="Reliability target" suffix="%" value={reliability} onChange={setReliability} min="90" max="99.999" step="0.001" help="Sets the allowed failure budget for the selected Control range." />
        <BudgetField label="Daily spend limit" prefix="$" value={dailySpend} onChange={setDailySpend} min="0.01" step="0.01" help="Sets Spend today and the per-bucket budget line." />
        <BudgetField label="Approval SLA" suffix="minutes" value={approvalSla} onChange={setApprovalSla} min="5" max="10080" step="1" help="Defines when waiting approvals become pressured or breached." />
      </div>

      <Text variant="caption" tone={message?.includes("saved") ? "secondary" : "muted"} className="mt-3 block">
        {message ?? (budget?.configured ? "Configured for this workspace." : "No operational budget is currently configured.")}
      </Text>
    </section>
  );
}

function BudgetField({
  label, value, onChange, help, prefix, suffix, min, max, step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help: string;
  prefix?: string;
  suffix?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <Text variant="label" tone="primary" className="block">{label}</Text>
      <div className="border-default bg-surface-base mt-1 flex h-9 items-center rounded-md border px-2 focus-within:border-accent">
        {prefix ? <span className="text-fg-muted mr-1">{prefix}</span> : null}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder="Not set"
          onChange={(event) => onChange(event.target.value)}
          className="font-code text-body-sm text-fg-primary min-w-0 flex-1 bg-transparent outline-none"
        />
        {suffix ? <span className="text-fg-muted ml-1 text-xs">{suffix}</span> : null}
      </div>
      <Text variant="caption" tone="muted" className="mt-1 block">{help}</Text>
    </label>
  );
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
