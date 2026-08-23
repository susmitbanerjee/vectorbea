"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useScope } from "~/lib/workspace/workspace-provider";
import { cn } from "~/lib/cn";
import { AdminState, AdminInlineState, describeAdminFailure } from "./admin-states";

/* ══════════════════════════════════════════════════════════════════════════════
   USAGE & LIMITS

   ONLY METERS THAT ARE ACTUALLY METERED APPEAR HERE.

   The plan defines eight, and two of them — `replay_runs` and
   `scheduled_regression_runs` — have no write path anywhere in the codebase:
   nothing calls `recordUsageEvent` with either delta, so the ledger can only
   ever return zero for them. Rendering "0 / 5,000 · 5,000 remaining" for a
   counter that will never move is not a neutral omission, it is a false
   statement about what the platform is watching, and the first time it matters
   is when somebody plans capacity against it. They are named at the bottom of
   the page as not yet instrumented instead — which is the honest version and
   costs one line.

   FOUR SOURCES, FOUR OUTCOMES. Meters, plan, seats and audit events come from
   different systems and the route now reports each one separately, so a
   workspace whose audit table has not been provisioned still sees its meters,
   its plan and its seat count rather than a single red box over the whole page.
══════════════════════════════════════════════════════════════════════════════ */

type Meter =
  | "traces" | "replay_runs" | "evaluation_executions" | "provider_executions"
  | "judge_executions" | "scheduled_regression_runs" | "provider_arena_runs"
  | "notification_emails";

type SourceResult<T> = { ok: true; value: T } | { ok: false; reason: string; code?: string };

interface UsageResponse {
  meters: SourceResult<{
    planTier: string;
    month: string;
    resetAt: string;
    usage: Record<Meter, number>;
    limits: Record<Meter, number | null>;
  }>;
  plan: SourceResult<{ planTier: string; maxSeats: number; monthlyAuditLimit: number }>;
  seats: SourceResult<{ used: number; limit: number }>;
  auditEvents: SourceResult<{ used: number; limit: number }>;
}

const LABELS: Record<Meter, string> = {
  traces: "Runtime traces",
  replay_runs: "Replay runs",
  evaluation_executions: "Evaluation executions",
  provider_executions: "Provider executions",
  judge_executions: "Judge executions",
  scheduled_regression_runs: "Scheduled regression runs",
  provider_arena_runs: "Provider arena runs",
  notification_emails: "Notification emails",
};

/**
 * The meters with a real write path, verified against every `recordUsageEvent`
 * call site rather than against the plan definition. If you add a meter to the
 * plan, it belongs here only once something increments it.
 */
const INSTRUMENTED: Meter[] = [
  "traces",
  "evaluation_executions",
  "provider_executions",
  "judge_executions",
  "provider_arena_runs",
  "notification_emails",
];

const NOT_INSTRUMENTED: Meter[] = ["replay_runs", "scheduled_regression_runs"];

export function UsageView() {
  const { workspaceId } = useScope();

  const query = useQuery<UsageResponse, Error>({
    queryKey: ["usage-limits", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const response = await fetch(
        `/api/settings/usage?workspaceId=${encodeURIComponent(workspaceId!)}`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as UsageResponse | { error?: string; code?: string };
      if (!response.ok || !("meters" in json)) {
        const error = new Error(("error" in json && json.error) || "Failed to load usage");
        (error as Error & { code?: string }).code = "code" in json ? json.code : undefined;
        throw error;
      }
      return json;
    },
  });

  const meters = query.data?.meters;
  const plan = query.data?.plan;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Usage & limits"
        description="What this workspace has consumed against its plan this month, and the operational targets Control measures against."
        metadata={
          plan?.ok ? (
            <>
              <Text variant="caption" tone="secondary" className="capitalize">{plan.value.planTier} plan</Text>
              {meters?.ok ? (
                <Text variant="caption" tone="muted">
                  Resets {new Date(meters.value.resetAt).toLocaleDateString()}
                </Text>
              ) : null}
            </>
          ) : undefined
        }
      />

      {query.isPending ? <UsageSkeleton /> : null}

      {query.error ? (() => {
        const failure = describeAdminFailure(query.error, "usage and limits");
        return (
          <AdminState
            tone={failure.tone}
            title={failure.title}
            body={failure.body}
            action={failure.retryable
              ? <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Try again</Button>
              : undefined}
          />
        );
      })() : null}

      {query.data ? (
        <div className="grid gap-3">
          <section className="grid gap-2 sm:grid-cols-2">
            <SourceCard result={query.data.seats} label="Workspace seats" noun="seats" />
            <SourceCard result={query.data.auditEvents} label="Audit events this month" noun="audit events" />
          </section>

          {meters?.ok ? (
            <section>
              <Text variant="eyebrow" tone="muted" className="mb-2 block">Metered this month</Text>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {INSTRUMENTED.map((meter) => (
                  <UsageCard
                    key={meter}
                    label={LABELS[meter]}
                    used={meters.value.usage[meter] ?? 0}
                    limit={meters.value.limits[meter] ?? null}
                  />
                ))}
              </div>
              <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
                {NOT_INSTRUMENTED.map((meter) => LABELS[meter]).join(" and ")} are defined by the plan but
                nothing increments them yet, so they are not shown rather than shown as zero.
              </Text>
            </section>
          ) : meters ? (
            <AdminInlineStateFor result={meters} noun="usage meters" onRetry={() => void query.refetch()} />
          ) : null}

          {workspaceId ? <OperationalBudgetPanel workspaceId={workspaceId} /> : null}
        </div>
      ) : null}
    </PageContainer>
  );
}

/* ── Per-source rendering ─────────────────────────────────────────────────── */

function SourceCard({
  result, label, noun,
}: {
  result: SourceResult<{ used: number; limit: number }>;
  label: string;
  noun: string;
}) {
  if (result.ok) return <UsageCard label={label} used={result.value.used} limit={result.value.limit} />;
  const failure = describeAdminFailure({ message: result.reason, code: result.code }, noun);
  return (
    <div className="border-subtle bg-surface-raised rounded-lg border p-3">
      <Text variant="label" tone="primary" className="mb-2 block">{label}</Text>
      <AdminInlineState tone={failure.tone} title={failure.title} body={failure.body} />
    </div>
  );
}

function AdminInlineStateFor({
  result, noun, onRetry,
}: {
  result: Extract<SourceResult<unknown>, { ok: false }>;
  noun: string;
  onRetry: () => void;
}) {
  const failure = describeAdminFailure({ message: result.reason, code: result.code }, noun);
  return (
    <AdminInlineState
      tone={failure.tone}
      title={failure.title}
      body={failure.body}
      action={failure.retryable ? <Button size="xs" variant="secondary" onClick={onRetry}>Retry</Button> : undefined}
    />
  );
}

function UsageCard({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const percent = limit === null ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone = percent >= 100 ? "bg-status-failed" : percent >= 80 ? "bg-status-waiting" : "bg-accent";
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Text variant="label" tone="primary">{label}</Text>
        <Text variant="caption" tone="secondary" tabular>
          {used.toLocaleString()} / {limit === null ? "Unlimited" : limit.toLocaleString()}
        </Text>
      </div>
      {limit !== null ? (
        <>
          <div
            className="bg-surface-sunken mt-2 h-1.5 overflow-hidden rounded-full"
            role="meter"
            aria-valuenow={used}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-label={`${label}: ${used} of ${limit}`}
          >
            <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
          </div>
          <Text variant="caption" tone="muted" className="mt-1 block">
            {Math.max(limit - used, 0).toLocaleString()} remaining
          </Text>
        </>
      ) : (
        <Text variant="caption" tone="muted" className="mt-2 block">No monthly cap on this plan.</Text>
      )}
    </section>
  );
}

function UsageSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <div key={index} className="border-subtle bg-surface-raised h-[5.5rem] animate-pulse rounded-lg border" />
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="border-subtle bg-surface-raised h-[5.5rem] animate-pulse rounded-lg border" />
        ))}
      </div>
    </div>
  );
}

/* ── Operational budgets ──────────────────────────────────────────────────── */

interface OperationalBudget {
  configured: boolean;
  reliabilityTarget: number | null;
  dailySpendLimitUsd: number | null;
  approvalSlaMinutes: number | null;
  updatedAt: string | null;
}

/**
 * Workspace objectives, not execution limits.
 *
 * These three numbers are what Control grades against — the failure budget, the
 * spend line and the point a waiting approval counts as breached. They are
 * deliberately the only settings on this page: a limits screen that also lets
 * you edit per-workflow timeouts is a screen where nobody can tell which
 * control actually stops a runaway run.
 */
function OperationalBudgetPanel({ workspaceId }: { workspaceId: string }) {
  const [reliability, setReliability] = React.useState("");
  const [dailySpend, setDailySpend] = React.useState("");
  const [approvalSla, setApprovalSla] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  const apply = React.useCallback((next: OperationalBudget) => {
    setReliability(next.reliabilityTarget === null ? "" : String(next.reliabilityTarget * 100));
    setDailySpend(next.dailySpendLimitUsd === null ? "" : String(next.dailySpendLimitUsd));
    setApprovalSla(next.approvalSlaMinutes === null ? "" : String(next.approvalSlaMinutes));
  }, []);

  const query = useQuery<OperationalBudget, Error>({
    queryKey: ["control-budget", workspaceId],
    queryFn: async () => {
      const response = await fetch(
        `/api/settings/control-budget?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as OperationalBudget | { error?: string; code?: string };
      if (!response.ok || !("configured" in json)) {
        const error = new Error(("error" in json && json.error) || "Failed to load the operational budget");
        (error as Error & { code?: string }).code = "code" in json ? json.code : undefined;
        throw error;
      }
      return json;
    },
  });

  React.useEffect(() => {
    if (query.data && !loaded) { apply(query.data); setLoaded(true); }
  }, [query.data, loaded, apply]);

  const optional = (value: string) => (value.trim() === "" ? null : Number(value));

  const errors = React.useMemo(() => {
    const reliabilityPercent = optional(reliability);
    const daily = optional(dailySpend);
    const sla = optional(approvalSla);
    return {
      reliability: reliabilityPercent !== null && (!Number.isFinite(reliabilityPercent) || reliabilityPercent < 90 || reliabilityPercent > 99.999)
        ? "Between 90 and 99.999. Below 90 is not a target anyone acts on." : undefined,
      dailySpend: daily !== null && (!Number.isFinite(daily) || daily <= 0)
        ? "A positive amount, or blank for no limit." : undefined,
      approvalSla: sla !== null && (!Number.isInteger(sla) || sla < 5 || sla > 10_080)
        ? "Whole minutes, 5 to 10,080 (one week)." : undefined,
    };
  }, [reliability, dailySpend, approvalSla]);

  const invalid = Object.values(errors).some(Boolean);

  async function save() {
    if (invalid) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/settings/control-budget?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reliabilityTarget: optional(reliability) === null ? null : optional(reliability)! / 100,
            dailySpendLimitUsd: optional(dailySpend),
            approvalSlaMinutes: optional(approvalSla),
          }),
        },
      );
      const json = (await response.json()) as OperationalBudget | { error?: string };
      if (!response.ok || !("configured" in json)) {
        throw new Error(("error" in json && json.error) || "Failed to save");
      }
      apply(json);
      setMessage({ tone: "ok", text: "Saved. Control grades against these from the next evaluation." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="operational-budgets" className="border-subtle bg-surface-raised rounded-lg border">
      <header className="border-subtle flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <Text variant="heading-sm" tone="max" as="h2" className="block">Operational budgets</Text>
          <Text variant="body-sm" tone="muted" className="mt-0.5 block max-w-[68ch] leading-snug">
            What Control measures this workspace against. These are objectives, not enforcement — per-workflow
            timeouts and per-tool approval gates are what actually stop a run.
          </Text>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void save()}
          loading={saving}
          loadingLabel="Saving"
          disabled={query.isPending || invalid || Boolean(query.error)}
        >
          Save budgets
        </Button>
      </header>

      <div className="p-4">
        {query.error ? (() => {
          const failure = describeAdminFailure(query.error, "operational budgets");
          return <AdminInlineState tone={failure.tone} title={failure.title} body={failure.body} />;
        })() : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <Field
                label="Reliability target"
                error={errors.reliability}
                description="Sets the failure budget Control spends against."
              >
                <Input
                  mono inputMode="decimal" value={reliability} placeholder="Not set"
                  onChange={(event) => setReliability(event.target.value)}
                  suffix={<Text variant="caption" tone="muted">%</Text>}
                  disabled={query.isPending}
                />
              </Field>
              <Field
                label="Daily spend limit"
                error={errors.dailySpend}
                description="Draws the budget line on Spend today."
              >
                <Input
                  mono inputMode="decimal" value={dailySpend} placeholder="Not set"
                  onChange={(event) => setDailySpend(event.target.value)}
                  prefix={<Text variant="caption" tone="muted">$</Text>}
                  disabled={query.isPending}
                />
              </Field>
              <Field
                label="Approval SLA"
                error={errors.approvalSla}
                description="When a waiting approval counts as breached."
              >
                <Input
                  mono inputMode="numeric" value={approvalSla} placeholder="Not set"
                  onChange={(event) => setApprovalSla(event.target.value)}
                  suffix={<Text variant="caption" tone="muted">min</Text>}
                  disabled={query.isPending}
                />
              </Field>
            </div>

            <Text
              variant="caption"
              tone={message?.tone === "error" ? "inherit" : "muted"}
              className={cn("mt-3 block", message?.tone === "error" && "text-status-failed")}
            >
              {message?.text
                ?? (query.isPending ? "Loading…"
                  : query.data?.configured ? "Configured for this workspace. Blank a field to remove that objective."
                    : "No objectives set. Control falls back to its defaults until you set one.")}
            </Text>
          </>
        )}
      </div>
    </section>
  );
}
