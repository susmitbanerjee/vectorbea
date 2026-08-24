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
import { SettingsNav } from "./settings-nav";

/* ══════════════════════════════════════════════════════════════════════════════
   USAGE & LIMITS

   EVERY NUMBER ON THIS PAGE IS ONE THE RUNTIME WOULD REFUSE YOU ON.

   The page used to render a plan tier and eight monthly meters out of a
   Supabase schema — `organizations`, `workspace_usage_monthly` — that no
   deployment provisions and nothing writes to. It therefore reported "usage
   meters are not provisioned in this environment" in every environment, while
   the caps that were genuinely blocking runs sat unread in
   `workspace_usage_policies`.

   What it shows now comes from the tables the platform enforces against:

     Workflow runs today     checked in RunRoutes.trigger against
                             `max_runs_per_day` before a run is accepted. This
                             is the only meter that can hand you a 429, so it
                             leads.
     Workspace caps          workflows, seats and LLM connections against the
                             three counts in the policy row.
     This month              counted, not capped. Shown without a bar, because
                             a progress bar against no limit is decoration
                             pretending to be a control.
     Per-run ceilings        bound one run rather than a period, so they are a
                             definition list, not meters. A ceiling drawn as a
                             half-full bar reads as "half used up", which is not
                             what `max_steps_per_workflow` means.

   NOTHING IS RENDERED AS ZERO BECAUSE IT COULD NOT BE READ. Each source settles
   separately and says which one is unavailable, so a workspace whose beta
   controls row is missing still sees its counters.
══════════════════════════════════════════════════════════════════════════════ */

type SourceResult<T> = { ok: true; value: T } | { ok: false; reason: string; code?: string };

interface Policy {
  provisioned: boolean;
  maxWorkflows: number;
  maxRunsPerDay: number;
  maxConcurrentRuns: number;
  maxStepsPerWorkflow: number;
  maxParallelBranches: number;
  maxRunDurationSeconds: number;
  maxEventsPerRun: number;
  logRetentionDays: number;
  artifactRetentionDays: number;
  maxLlmProviders: number;
  maxTeamMembers: number;
  allowSchedules: boolean;
  allowWebhooks: boolean;
  allowPrivateWorkers: boolean;
  allowSelfCorrection: boolean;
  allowRealDbWrites: boolean;
  allowIterativeAgents: boolean;
  allowAiArchitect: boolean;
}

interface Counters {
  workflowRuns: number;
  simulationRuns: number;
  realRuns: number;
  aiArchitectRequests: number;
  aiArchitectRevisions: number;
  llmCalls: number;
  toolCalls: number;
  eventsStored: number;
}

interface UsageCounters {
  today: Counters;
  month: Counters;
  monthStart: string;
  dayResetAt: string;
  monthResetAt: string;
}

interface Capacity {
  seats: number;
  workflows: number;
  llmConnections: number;
}

interface ExecutionAccess {
  provisioned: boolean;
  accessStatus: "pending" | "approved" | "rejected" | "disabled";
  executionMode: "simulation_only" | "real_execution_enabled" | "disabled";
  realExecutionEnabled: boolean;
  simulationEnabled: boolean;
  disabledReason: string | null;
}

interface AuditVolume {
  today: number;
  month: number;
}

interface UsageResponse {
  policy: SourceResult<Policy>;
  usage: SourceResult<UsageCounters>;
  capacity: SourceResult<Capacity>;
  execution: SourceResult<ExecutionAccess>;
  auditEvents: SourceResult<AuditVolume>;
}

const EXECUTION_LABEL: Record<ExecutionAccess["executionMode"], string> = {
  simulation_only: "Simulation only",
  real_execution_enabled: "Real execution enabled",
  disabled: "Execution disabled",
};

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
      if (!response.ok || !("policy" in json)) {
        const error = new Error(("error" in json && json.error) || "Failed to load usage");
        (error as Error & { code?: string }).code = "code" in json ? json.code : undefined;
        throw error;
      }
      return json;
    },
  });

  const retry = React.useCallback(() => void query.refetch(), [query]);

  const policy = query.data?.policy;
  const usage = query.data?.usage;
  const capacity = query.data?.capacity;
  const execution = query.data?.execution;
  const auditEvents = query.data?.auditEvents;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Usage & limits"
        description="What this workspace is allowed, what it has used, and which of the two the platform will stop you on. Every figure is read from the table the runtime checks."
        metadata={
          query.data ? (
            <>
              {execution?.ok ? (
                <Text variant="caption" tone="secondary">
                  {EXECUTION_LABEL[execution.value.executionMode]}
                </Text>
              ) : null}
              {usage?.ok ? (
                <Text variant="caption" tone="muted">
                  Daily allowance resets {new Date(usage.value.dayResetAt).toLocaleString()}
                </Text>
              ) : null}
            </>
          ) : undefined
        }
      />

      <SettingsNav />

      {query.isPending ? <UsageSkeleton /> : null}

      {query.error ? (() => {
        const failure = describeAdminFailure(query.error, "usage and limits");
        return (
          <AdminState
            tone={failure.tone}
            title={failure.title}
            body={failure.body}
            action={failure.retryable
              ? <Button size="sm" variant="secondary" onClick={retry}>Try again</Button>
              : undefined}
          />
        );
      })() : null}

      {query.data ? (
        <div className="grid gap-5">
          {execution && !execution.ok
            ? <FailureFor result={execution} noun="execution access" onRetry={retry} />
            : execution?.ok
              ? <ExecutionBanner access={execution.value} />
              : null}

          <Section
            title="Today"
            description="The daily allowance is the one limit that returns a 429. It resets at midnight."
          >
            {usage?.ok && policy?.ok ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <MeterCard
                  label="Workflow runs today"
                  used={usage.value.today.workflowRuns}
                  limit={policy.value.maxRunsPerDay}
                  footnote={`Resets ${new Date(usage.value.dayResetAt).toLocaleString()}`}
                />
                <BreakdownCard
                  label="How today's runs were executed"
                  rows={[
                    { label: "Simulated", value: usage.value.today.simulationRuns },
                    { label: "Real", value: usage.value.today.realRuns },
                  ]}
                  footnote="Both count against the same daily allowance."
                />
              </div>
            ) : (
              <SourceFailures
                onRetry={retry}
                sources={[
                  { result: usage, noun: "usage counters" },
                  { result: policy, noun: "workspace limits" },
                ]}
              />
            )}
          </Section>

          <Section
            title="Against this workspace's caps"
            description={
              policy?.ok && !policy.value.provisioned
                ? "This workspace has no policy row, so these are the platform defaults it will be held to."
                : "Counted now, against the numbers stored for this workspace."
            }
          >
            {policy?.ok && capacity?.ok ? (
              <div className="grid gap-2 md:grid-cols-3">
                <MeterCard label="Workflows" used={capacity.value.workflows} limit={policy.value.maxWorkflows} footnote="Archived workflows are not counted." />
                <MeterCard label="Workspace seats" used={capacity.value.seats} limit={policy.value.maxTeamMembers} footnote="Active members only." />
                <MeterCard label="LLM connections" used={capacity.value.llmConnections} limit={policy.value.maxLlmProviders} footnote="Connections of type llm." />
              </div>
            ) : (
              <SourceFailures
                onRetry={retry}
                sources={[
                  { result: policy, noun: "workspace limits" },
                  { result: capacity, noun: "seats and workflows" },
                ]}
              />
            )}
          </Section>

          <Section
            title="This month"
            description="Counted, not capped. Nothing here can refuse a run — it is what the workspace has done since the first of the month."
          >
            {usage?.ok ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <CountCard label="Workflow runs" value={usage.value.month.workflowRuns} />
                  <CountCard label="Real runs" value={usage.value.month.realRuns} />
                  <CountCard label="Simulated runs" value={usage.value.month.simulationRuns} />
                  <CountCard label="Model calls" value={usage.value.month.llmCalls} />
                  <CountCard label="Tool calls" value={usage.value.month.toolCalls} />
                  <CountCard label="Run events stored" value={usage.value.month.eventsStored} />
                  <CountCard label="AI Architect requests" value={usage.value.month.aiArchitectRequests} />
                  {auditEvents?.ok
                    ? <CountCard label="Audit events" value={auditEvents.value.month} />
                    : auditEvents
                      ? <FailureCard result={auditEvents} label="Audit events" noun="audit events" />
                      : null}
                </div>
                <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
                  Since {new Date(usage.value.monthStart).toLocaleDateString()}. Rolls over{" "}
                  {new Date(usage.value.monthResetAt).toLocaleDateString()}.
                </Text>
              </>
            ) : (
              <SourceFailures onRetry={retry} sources={[{ result: usage, noun: "usage counters" }]} />
            )}
          </Section>

          <Section
            title="Per-run ceilings"
            description="These bound a single run rather than a period, so there is nothing to fill up — a run that reaches one of them is stopped."
          >
            {policy?.ok ? <CeilingList policy={policy.value} /> : (
              <SourceFailures onRetry={retry} sources={[{ result: policy, noun: "workspace limits" }]} />
            )}
          </Section>

          <Section
            title="Capabilities"
            description="Feature switches on this workspace's policy. A capability that is off is refused at the API, not hidden in the UI."
          >
            {policy?.ok ? <CapabilityList policy={policy.value} /> : (
              <SourceFailures onRetry={retry} sources={[{ result: policy, noun: "workspace limits" }]} />
            )}
          </Section>

          {workspaceId ? <OperationalBudgetPanel workspaceId={workspaceId} /> : null}
        </div>
      ) : null}
    </PageContainer>
  );
}

/* ── Layout ───────────────────────────────────────────────────────────────── */

function Section({
  title, description, children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <Text variant="eyebrow" tone="muted" as="h2" className="block">{title}</Text>
      <Text variant="caption" tone="muted" className="mt-0.5 mb-2 block max-w-[76ch] leading-snug">
        {description}
      </Text>
      {children}
    </section>
  );
}

/* ── Per-source rendering ─────────────────────────────────────────────────── */

/**
 * Report only the sources that actually failed.
 *
 * A panel that needs two sources and lost one should name the one it lost. The
 * earlier version collapsed the pair into a single sentence, which sent an
 * operator to check a table that was answering perfectly well.
 */
function SourceFailures({
  sources, onRetry,
}: {
  sources: { result: SourceResult<unknown> | undefined; noun: string }[];
  onRetry: () => void;
}) {
  const failed = sources.filter(
    (source): source is { result: Extract<SourceResult<unknown>, { ok: false }>; noun: string } =>
      Boolean(source.result) && source.result!.ok === false,
  );
  if (failed.length === 0) return null;
  return (
    <div className="grid gap-2">
      {failed.map((source) => (
        <FailureFor key={source.noun} result={source.result} noun={source.noun} onRetry={onRetry} />
      ))}
    </div>
  );
}

function FailureFor({
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

function FailureCard({
  result, label, noun,
}: {
  result: Extract<SourceResult<unknown>, { ok: false }>;
  label: string;
  noun: string;
}) {
  const failure = describeAdminFailure({ message: result.reason, code: result.code }, noun);
  return (
    <div className="border-subtle bg-surface-raised rounded-lg border p-3">
      <Text variant="label" tone="primary" className="mb-2 block">{label}</Text>
      <AdminInlineState tone={failure.tone} title={failure.title} body={failure.body} />
    </div>
  );
}

/* ── Cards ────────────────────────────────────────────────────────────────── */

function MeterCard({
  label, used, limit, footnote,
}: {
  label: string;
  used: number;
  limit: number;
  footnote?: string;
}) {
  const percent = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone = used >= limit ? "bg-status-failed" : percent >= 80 ? "bg-status-waiting" : "bg-accent";
  const remaining = Math.max(limit - used, 0);
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Text variant="label" tone="primary">{label}</Text>
        <Text variant="caption" tone="secondary" tabular>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </Text>
      </div>
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
      <Text variant="caption" tone={used >= limit ? "inherit" : "muted"} className={cn("mt-1 block leading-snug", used >= limit && "text-status-failed")}>
        {used >= limit
          ? "At the limit. The next request is refused until this resets or the limit is raised."
          : `${remaining.toLocaleString()} remaining`}
      </Text>
      {footnote ? (
        <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{footnote}</Text>
      ) : null}
    </section>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border p-3">
      <Text variant="label" tone="primary" className="block">{label}</Text>
      <Text variant="heading-sm" tone="max" as="p" className="mt-1 block" tabular>
        {value.toLocaleString()}
      </Text>
    </section>
  );
}

function BreakdownCard({
  label, rows, footnote,
}: {
  label: string;
  rows: { label: string; value: number }[];
  footnote?: string;
}) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border p-3">
      <Text variant="label" tone="primary" className="block">{label}</Text>
      <dl className="mt-2 grid gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2">
            <dt><Text variant="caption" tone="secondary">{row.label}</Text></dt>
            <dd><Text variant="caption" tone="primary" tabular>{row.value.toLocaleString()}</Text></dd>
          </div>
        ))}
      </dl>
      {footnote ? (
        <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">{footnote}</Text>
      ) : null}
    </section>
  );
}

/* ── Ceilings and capabilities ────────────────────────────────────────────── */

function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function CeilingList({ policy }: { policy: Policy }) {
  const rows: { label: string; value: string; note: string }[] = [
    {
      label: "Concurrent runs",
      value: policy.maxConcurrentRuns.toLocaleString(),
      note: "Beyond this, runs queue rather than fail.",
    },
    {
      label: "Steps per workflow",
      value: policy.maxStepsPerWorkflow.toLocaleString(),
      note: "Checked when a workflow is published.",
    },
    {
      label: "Parallel branches",
      value: policy.maxParallelBranches.toLocaleString(),
      note: "How wide one run may fan out.",
    },
    {
      label: "Run duration",
      value: formatSeconds(policy.maxRunDurationSeconds),
      note: "A run past this is stopped, not extended.",
    },
    {
      label: "Events per run",
      value: policy.maxEventsPerRun.toLocaleString(),
      note: "The timeline stops recording past this point.",
    },
    {
      label: "Log retention",
      value: `${policy.logRetentionDays} day${policy.logRetentionDays === 1 ? "" : "s"}`,
      note: "Run events older than this are removed.",
    },
    {
      label: "Artifact retention",
      value: `${policy.artifactRetentionDays} day${policy.artifactRetentionDays === 1 ? "" : "s"}`,
      note: "Stored payloads older than this are removed.",
    },
  ];

  return (
    <dl className="border-subtle divide-subtle bg-surface-raised divide-y rounded-lg border">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2">
          <div className="min-w-0">
            <dt><Text variant="body-sm" tone="primary" className="block">{row.label}</Text></dt>
            <Text variant="caption" tone="muted" className="block leading-snug">{row.note}</Text>
          </div>
          <dd><Text variant="body-sm" tone="max" tabular>{row.value}</Text></dd>
        </div>
      ))}
    </dl>
  );
}

function CapabilityList({ policy }: { policy: Policy }) {
  const capabilities: { label: string; enabled: boolean }[] = [
    { label: "Schedules", enabled: policy.allowSchedules },
    { label: "Webhooks", enabled: policy.allowWebhooks },
    { label: "Private workers", enabled: policy.allowPrivateWorkers },
    { label: "Self-correction", enabled: policy.allowSelfCorrection },
    { label: "Real database writes", enabled: policy.allowRealDbWrites },
    { label: "Iterative agents", enabled: policy.allowIterativeAgents },
    { label: "AI Architect", enabled: policy.allowAiArchitect },
  ];

  return (
    <ul className="flex flex-wrap gap-1.5">
      {capabilities.map((capability) => (
        <li key={capability.label}>
          <span
            className={cn(
              "font-ui text-caption rounded-full border px-2 py-0.5",
              capability.enabled
                ? "border-status-success-border bg-status-success-subtle text-status-success"
                : "border-subtle bg-surface-sunken text-fg-muted",
            )}
          >
            {capability.label}
            <span className="sr-only">{capability.enabled ? " enabled" : " not enabled"}</span>
            <span aria-hidden="true">{capability.enabled ? " · on" : " · off"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Execution access ─────────────────────────────────────────────────────── */

/**
 * On a private beta this is the limit that surprises people.
 *
 * A workspace can be inside every quota and still be refused a real run,
 * because `workspace_beta_controls` says simulation only. That is not a usage
 * number, so it does not get a meter — but leaving it off the limits page is
 * how somebody spends an afternoon wondering why their run did nothing.
 */
function ExecutionBanner({ access }: { access: ExecutionAccess }) {
  if (access.accessStatus === "disabled" || access.executionMode === "disabled") {
    return (
      <AdminInlineState
        tone="failed"
        title="Execution is disabled for this workspace"
        body={access.disabledReason
          ?? "No runs will start, in either mode. Contact Vectorbea support to have this workspace re-enabled."}
      />
    );
  }
  if (!access.realExecutionEnabled) {
    return (
      <AdminInlineState
        tone="waiting"
        title="Simulation only"
        body="Runs execute against simulated tool and model responses. Real execution needs an administrator to enable it on this workspace; every quota below applies either way."
      />
    );
  }
  return null;
}

/* ── Loading ──────────────────────────────────────────────────────────────── */

function UsageSkeleton() {
  return (
    <div className="grid gap-5" aria-hidden="true">
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <div key={index} className="border-subtle bg-surface-raised h-[6.5rem] animate-pulse rounded-lg border" />
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="border-subtle bg-surface-raised h-[6.5rem] animate-pulse rounded-lg border" />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <div key={index} className="border-subtle bg-surface-raised h-[4.5rem] animate-pulse rounded-lg border" />
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
