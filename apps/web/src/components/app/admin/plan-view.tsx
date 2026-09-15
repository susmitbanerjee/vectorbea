"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader, ModalLayout } from "~/components/ui/modal";
import { cn } from "~/lib/cn";
import { isEnabled } from "~/lib/flags/flags";
import { useScope, useWorkspaceRole } from "~/lib/workspace/workspace-provider";
import { AdminInlineState, describeAdminFailure } from "./admin-states";
import { SettingsNav } from "./settings-nav";
import { Panel, StatusLine, type SaveState, SettingsDenied } from "./settings-chrome";

/* ══════════════════════════════════════════════════════════════════════════════
   PLAN & ACCESS

   THERE IS A PLAN MODEL NOW (S3), AND STILL NO PAYMENT PROVIDER.

   This page used to say there was no plan tier anywhere in the data model, and
   that was true: `organizations.plan_tier` lived in a Supabase schema no
   deployment provisions. V060 replaced it with a real one — a billing account
   owns workspaces, subscribes to a plan, and buys seats — so the page now
   renders what the workspace is actually entitled to.

   WHAT HAS NOT ARRIVED IS CHECKOUT. S4 connects a payment provider to what S3
   built. So "Upgrade" is a request on the record, not a card form: the button
   files through `usage_limit_requests`, which is a queue a reviewer can work,
   rather than a shop front with no shop behind it.

   THE GOVERNING RULE, ON THIS SCREEN. Everything here is the WORKSPACE's plan,
   resolved through its billing account — never the reader's own. A Pro user
   looking at a Free workspace sees Free, which is the same answer every
   enforcement point will give them. A page that showed the reader's plan would
   promise limits the API then refuses, and the customer would report it as a
   bug in the API.

   AND IT RENDERS RESOLVED ENTITLEMENTS, NOT A PLAN CODE. If this page kept its
   own table of what each plan includes, that table would be wrong the moment
   somebody raises a limit in the database — which is the entire point of
   plans being data. The server hands it rows; it draws them.
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
  logRetentionDays: number;
  maxLlmProviders: number;
  maxTeamMembers: number;
  allowSchedules: boolean;
  allowWebhooks: boolean;
  allowIterativeAgents: boolean;
  allowAiArchitect: boolean;
}

interface ExecutionAccess {
  accessStatus: "pending" | "approved" | "rejected" | "disabled";
  executionMode: "simulation_only" | "real_execution_enabled" | "disabled";
  realExecutionEnabled: boolean;
  simulationEnabled: boolean;
  disabledReason: string | null;
}

interface Capacity {
  seats: number;
  workflows: number;
  llmConnections: number;
}

/** One entitlement, already resolved and paired with the count it binds. */
interface PlanEntry {
  key: string;
  label: string;
  /** Null means unlimited — rendered as a word, never as "-1". */
  limit: number | null;
  current: number | null;
  period: string | null;
  /** "plan" or "override". Shown so a negotiated limit does not read as a bug. */
  source: string;
}

interface PlanPanelData {
  plan: {
    code: string;
    name: string;
    priceCents: number | null;
    currency: string;
    billingInterval: string;
    priceModel: string;
    status: string;
    upgradeTo: string | null;
    upgradeToName: string | null;
    upgradeUrl: string;
  };
  seats: { purchased: number; used: number; max: number | null };
  period: { start: string; end: string } | null;
  quotas: PlanEntry[];
  limits: PlanEntry[];
  features: { key: string; label: string; enabled: boolean; source: string }[];
  supportTier: string | null;
  schedulingPriority: number | null;
}

interface RetentionWindowData {
  entity: string;
  label: string;
  days: number;
  source: string;
  deletesBefore: string;
  inGrace: boolean;
  graceUntil: string | null;
  planDays: number | null;
  previousDays: number | null;
  changedAt: string | null;
  afterGraceDeletesBefore: string | null;
}

interface RetentionPanelData {
  windows: RetentionWindowData[];
  storage: { entity: string; rows: number; bytes: number }[];
  downgrading: boolean;
  firstDeletionAt: string | null;
  lastExport: {
    id: string;
    status: string;
    createdAt: string;
    rowCount: number;
    expiresAt: string | null;
  } | null;
}

interface BillingPlanOption {
  planCode: string;
  planName: string;
  /** Minor units. Formatted here with Intl, never rendered from a constant. */
  unitAmountMinor: number;
  currency: string;
  interval: string;
  taxBehavior: string;
  isCurrent: boolean;
}

interface BillingPanelData {
  accountId: string;
  currency: string;
  /** False until a provider is configured. The card says so rather than lying. */
  providerLive: boolean;
  subscription: {
    planCode: string;
    status: string;
    quantity: number;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  plans: BillingPlanOption[];
  invoices: {
    id: string;
    number: string | null;
    currency: string;
    totalMinor: number;
    taxMinor: number;
    status: string;
    issuedAt: string | null;
    hostedUrl: string | null;
    pdfUrl: string | null;
  }[];
  paymentMethods: {
    id: string;
    kind: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    label: string | null;
    isDefault: boolean;
  }[];
  dunning: {
    stage: string;
    daysPastDue: number;
    nextStepAt: string | null;
    restricted: boolean;
  };
}

interface UsageResponse {
  plan: SourceResult<PlanPanelData | null>;
  retention: SourceResult<RetentionPanelData | null>;
  billing: SourceResult<BillingPanelData | null>;
  policy: SourceResult<Policy>;
  capacity: SourceResult<Capacity>;
  execution: SourceResult<ExecutionAccess>;
}

type RequestKind = "real_execution" | "capacity" | "seats";

interface AccessRequest {
  id: string;
  kind: RequestKind;
  changes: Record<string, number | string | boolean>;
  reason: string | null;
  status: "open" | "approved" | "rejected";
  requestedByEmail: string | null;
  requestedByName: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<RequestKind, string> = {
  real_execution: "Enable real execution",
  capacity: "Raise usage limits",
  seats: "Add seats",
};

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(json.error || fallback);
    (error as Error & { code?: string }).code = json.code;
    throw error;
  }
  return json;
}

export function PlanView() {
  const workspaceRole = useWorkspaceRole();

  const { workspaceId } = useScope();

  const usage = useQuery<UsageResponse, Error>({
    queryKey: ["usage-limits", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      readJson<UsageResponse>(
        await fetch(`/api/settings/usage?workspaceId=${encodeURIComponent(workspaceId!)}`, { cache: "no-store" }),
        "This workspace's access could not be read",
      ),
  });

  const requests = useQuery<{ requests: AccessRequest[]; yourRole: string }, Error>({
    queryKey: ["access-requests", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      readJson<{ requests: AccessRequest[]; yourRole: string }>(
        await fetch(`/api/settings/access-requests?workspaceId=${encodeURIComponent(workspaceId!)}`, {
          cache: "no-store",
        }),
        "Requests could not be loaded",
      ),
  });

  const [asking, setAsking] = React.useState<RequestKind | null>(null);

  const policy = usage.data?.policy;
  const plan = usage.data?.plan;
  const retention = usage.data?.retention;
  const billing = usage.data?.billing;
  /* OFF. There is no bank account, so a working checkout would take no money.
     The data path above runs in every environment regardless — a flagged feature
     whose data is only fetched once the flag is on is broken on the day it
     ships. */
  const billingEnabled = isEnabled("billing");
  const execution = usage.data?.execution;
  const capacity = usage.data?.capacity;
  const role = requests.data?.yourRole ?? "viewer";
  const canRequest = role === "owner" || role === "admin";
  const open = requests.data?.requests.filter((request) => request.status === "open") ?? [];
  const openKinds = new Set(open.map((request) => request.kind));

  /*
   * Below admin, this section is refused by the API — every settings route runs
   * `requireWorkspaceRole`. Returning early rather than rendering a disabled
   * page keeps one answer on screen instead of a form nobody can submit.
   *
   * Only once the role is KNOWN: `resolving` renders the page as normal, so an
   * owner never sees a denial flash while memberships load.
   */
  if (!workspaceRole.resolving && !workspaceRole.canAdminister) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Govern" title="Plan & access" description="What this workspace is allowed to do, who decides it, and how to ask for more." />
        <SettingsNav />
        <SettingsDenied role={workspaceRole.role} section="Plan & access" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Plan & access"
        description="What this workspace is allowed to do, who decides it, and how to ask for more."
        metadata={
          execution?.ok ? (
            <>
              <Text variant="caption" tone="muted">Access</Text>
              <Text variant="caption" tone="secondary" className="capitalize">
                {execution.value.accessStatus}
              </Text>
            </>
          ) : undefined
        }
      />

      <SettingsNav />


      {usage.error ? (() => {
        const failure = describeAdminFailure(usage.error, "plan and access");
        return (
          <AdminInlineState
            tone={failure.tone}
            title={failure.title}
            body={failure.body}
            action={failure.retryable
              ? <Button size="xs" variant="secondary" onClick={() => void usage.refetch()}>Retry</Button>
              : undefined}
          />
        );
      })() : null}

      <div className="grid gap-4">
        {plan?.ok && plan.value ? <PlanCard data={plan.value} /> : null}

        {billingEnabled && billing?.ok && billing.value ? (
          <BillingCard data={billing.value} canManage={canRequest} />
        ) : null}

        {retention?.ok && retention.value ? (
          <RetentionCard data={retention.value} canRequest={canRequest} />
        ) : null}

        <Panel
          title="This workspace is on the private beta"
          help="Access is set per workspace during early access."
        >
          {usage.isPending ? <RowSkeleton rows={2} /> : null}

          {execution?.ok ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <StateCard
                label="Workspace access"
                value={execution.value.accessStatus === "approved" ? "Approved" : execution.value.accessStatus}
                tone={execution.value.accessStatus === "approved" ? "success" : execution.value.accessStatus === "disabled" ? "failed" : "waiting"}
                note={
                  execution.value.disabledReason
                    ?? (execution.value.accessStatus === "approved"
                      ? "This workspace can build and run workflows."
                      : "Vectorbea has not yet approved this workspace.")
                }
              />
              <StateCard
                label="Execution mode"
                value={execution.value.realExecutionEnabled ? "Real execution" : "Simulation only"}
                tone={execution.value.realExecutionEnabled ? "success" : "waiting"}
                note={
                  execution.value.realExecutionEnabled
                    ? "Workflows call your real tools and models."
                    : "Workflows run against simulated tool and model responses. Nothing reaches your systems."
                }
              />
            </div>
          ) : null}

          {execution?.ok && !execution.value.realExecutionEnabled ? (
            <AdminInlineState
              tone="waiting"
              title="Real execution is switched on by Vectorbea, not by a workspace admin"
              body="It is not a permission your Owner role is missing — the switch sits on Vectorbea's side, because turning it on lets workflows write to your systems and spend against your provider keys. Ask for it here and a reviewer picks it up."
              action={
                canRequest && !openKinds.has("real_execution") ? (
                  <Button size="xs" variant="primary" onClick={() => setAsking("real_execution")}>
                    Request real execution
                  </Button>
                ) : openKinds.has("real_execution") ? (
                  <Text variant="caption" tone="muted">Requested — awaiting review</Text>
                ) : undefined
              }
            />
          ) : null}
        </Panel>

        <Panel
          title="What is included"
          help="The limits that apply to this workspace."
          action={
            <Button asChild size="xs" variant="secondary">
              <Link href={"/settings/usage" as Route}>See consumption</Link>
            </Button>
          }
          footer={
            <>
              <StatusLine
                state={null}
                resting={
                  canRequest
                    ? "Limits are set per workspace by Vectorbea. Ask for a change and it goes on the review queue with your reason attached."
                    : "Requesting a limit change needs the admin or owner role."
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canRequest || openKinds.has("seats")}
                  onClick={() => setAsking("seats")}
                >
                  {openKinds.has("seats") ? "Seats requested" : "Request seats"}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!canRequest || openKinds.has("capacity")}
                  onClick={() => setAsking("capacity")}
                >
                  {openKinds.has("capacity") ? "Capacity requested" : "Request more capacity"}
                </Button>
              </div>
            </>
          }
        >
          {usage.isPending ? <RowSkeleton rows={4} /> : null}

          {policy?.ok ? (
            <>
              {!policy.value.provisioned ? (
                <Text variant="caption" tone="muted" className="block leading-snug">
                  This workspace has no policy row of its own, so these are the platform defaults it will be
                  held to.
                </Text>
              ) : null}
              <dl className="border-subtle divide-subtle bg-surface-sunken divide-y rounded-md border">
                <IncludedRow
                  label="Workflow runs per day"
                  value={policy.value.maxRunsPerDay.toLocaleString()}
                  note="Enforced before a run is accepted."
                />
                <IncludedRow
                  label="Workflows"
                  value={policy.value.maxWorkflows.toLocaleString()}
                  used={capacity?.ok ? capacity.value.workflows : undefined}
                />
                <IncludedRow
                  label="Seats"
                  value={policy.value.maxTeamMembers.toLocaleString()}
                  used={capacity?.ok ? capacity.value.seats : undefined}
                />
                <IncludedRow
                  label="LLM connections"
                  value={policy.value.maxLlmProviders.toLocaleString()}
                  used={capacity?.ok ? capacity.value.llmConnections : undefined}
                />
                <IncludedRow
                  label="Concurrent runs"
                  value={policy.value.maxConcurrentRuns.toLocaleString()}
                  note="Beyond this, runs queue rather than fail."
                />
                <IncludedRow
                  label="Steps per workflow"
                  value={policy.value.maxStepsPerWorkflow.toLocaleString()}
                />
                <IncludedRow
                  label="Log retention"
                  value={`${policy.value.logRetentionDays} days`}
                />
              </dl>

              <div className="flex flex-wrap gap-1.5">
                <Capability on={policy.value.allowSchedules}>Schedules</Capability>
                <Capability on={policy.value.allowWebhooks}>Webhooks</Capability>
                <Capability on={policy.value.allowIterativeAgents}>Iterative agents</Capability>
                <Capability on={policy.value.allowAiArchitect}>AI Architect</Capability>
              </div>
            </>
          ) : null}
        </Panel>

        <RequestHistory query={requests} />
      </div>

      <RequestDialog
        kind={asking}
        workspaceId={workspaceId}
        policy={policy?.ok ? policy.value : null}
        onClose={() => setAsking(null)}
      />
    </PageContainer>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/**
 * The plan, its allowances, and where the workspace stands against each.
 *
 * WHY A QUOTA AND A LIMIT ARE DRAWN DIFFERENTLY. They are not the same promise.
 * A quota is consumption that RESETS — "412 of 500 runs, resets on the 1st" —
 * and the reset date is the most useful thing on the row, because it tells the
 * reader whether to wait or to upgrade. A limit is a ceiling that never resets,
 * so there is nothing to wait for and the row says so by not offering a date.
 * Drawing both as a bar with a number would flatten the one distinction that
 * decides what the reader does next.
 */
function PlanCard({ data }: { data: PlanPanelData }) {
  const price =
    data.plan.priceCents === null
      ? "Custom"
      : data.plan.priceCents === 0
        ? "Free"
        : `${formatMoney(data.plan.priceCents, data.plan.currency)}/${data.plan.billingInterval}` +
          (data.plan.priceModel === "per_seat" ? " per seat" : "");

  return (
    <Panel
      title={`${data.plan.name} plan`}
      help="What this workspace's plan includes."
      /* No "Compare plans" button here: `plan.upgradeUrl` points at THIS page -
         it exists so a refusal raised anywhere else in the product can send the
         reader somewhere real. A button linking the reader to the page they are
         already on is furniture. The action they can actually take is "Request
         more capacity", which the panel below already offers. */
      footer={
        <StatusLine
          state={null}
          resting={
            data.period
              ? `Monthly allowances reset on ${formatDay(data.period.end)}. Billing is per seat: somebody in two of this account's workspaces costs one seat, not two.`
              : "Billing is per seat: somebody in two of this account's workspaces costs one seat, not two."
          }
        />
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <StateCard
          label="Plan"
          value={data.plan.name}
          tone={data.plan.status === "active" || data.plan.status === "trialing" ? "success" : "waiting"}
          note={price}
        />
        <StateCard
          label="Seats"
          value={`${data.seats.used} of ${data.seats.max === null ? data.seats.purchased : Math.min(data.seats.max, data.seats.purchased)}`}
          tone={
            data.seats.used >= (data.seats.max === null ? data.seats.purchased : Math.min(data.seats.max, data.seats.purchased))
              ? "waiting"
              : "success"
          }
          note="One person, counted once across every workspace on this account."
        />
        <StateCard
          label="Support"
          value={data.supportTier ?? "Community"}
          tone="success"
          note={
            data.schedulingPriority && data.schedulingPriority > 1
              ? `Scheduling weight ${data.schedulingPriority}× — paid runs are served ahead of free-tier queues.`
              : "Runs are scheduled at the standard weight."
          }
        />
      </div>

      {data.quotas.length > 0 ? (
        <section className="grid gap-1.5">
          <Text variant="caption" tone="muted" className="block">
            Monthly allowances — consumption, shared across this account
          </Text>
          <dl className="border-subtle divide-subtle bg-surface-sunken divide-y rounded-md border">
            {data.quotas.map((entry) => (
              <EntitlementRow key={entry.key} entry={entry} />
            ))}
          </dl>
        </section>
      ) : null}

      {data.limits.length > 0 ? (
        <section className="grid gap-1.5">
          <Text variant="caption" tone="muted" className="block">
            Ceilings — enforced at any instant, never reset
          </Text>
          <dl className="border-subtle divide-subtle bg-surface-sunken divide-y rounded-md border">
            {data.limits.map((entry) => (
              <EntitlementRow key={entry.key} entry={entry} />
            ))}
          </dl>
        </section>
      ) : null}

      {data.features.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {data.features.map((feature) => (
            <Capability key={feature.key} on={feature.enabled}>{feature.label}</Capability>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * Plan comparison, subscription state, invoices and payment methods.
 *
 * ── EVERY PRICE COMES FROM THE SERVER, IN MINOR UNITS ───────────────────────
 * The component receives `unitAmountMinor` and a currency code and formats them
 * with `Intl`. There is no constant here a price could be read from, which is
 * what makes re-pricing an UPDATE — and what stops this screen ever disagreeing
 * with the invoice the customer receives.
 *
 * ── AND IT IS HONEST WHEN BILLING IS NOT LIVE ───────────────────────────────
 * `providerLive` is false until credentials exist. Rather than rendering a
 * subscribe button that would change our schema and take no money, the card says
 * so. A checkout that silently does nothing is worse than no checkout.
 *
 * ── NO CARD DETAILS PASS THROUGH HERE ───────────────────────────────────────
 * "Add payment method" asks the server for a hosted session and sends the browser
 * to the PROVIDER's own element. There is no card input in this file and nowhere
 * in our schema to put one — that is what keeps us out of PCI scope,
 * structurally rather than by policy.
 */
function BillingCard({ data, canManage }: { data: BillingPanelData; canManage: boolean }) {
  const sub = data.subscription;
  const dunning = data.dunning;

  return (
    <Panel
      title="Billing"
      help="Your subscription and invoices."
      footer={
        <StatusLine
          state={null}
          resting={
            data.providerLive
              ? "Payment details are entered on the provider's own secure page and never reach Vectorbea."
              : "No payment provider is connected yet, so nothing can be charged. Plans and prices below are live."
          }
        />
      }
    >
      {!data.providerLive ? (
        <AdminInlineState
          tone="neutral"
          title="Billing is not switched on yet"
          body="The plans and prices below are real and the subscription machinery is complete, but no payment provider is connected — so nothing can be charged and no plan can be bought from this screen yet."
        />
      ) : null}

      {dunning.restricted ? (
        <AdminInlineState
          tone="failed"
          title="New runs are paused because a payment failed"
          body={`Your last payment failed ${dunning.daysPastDue} days ago. Existing data and history are untouched — only new runs are paused. Update your payment method to resume.`}
        />
      ) : dunning.stage !== "current" ? (
        <AdminInlineState
          tone="waiting"
          title="A payment did not go through"
          body={
            dunning.nextStepAt
              ? `We could not take payment ${dunning.daysPastDue} days ago. Everything keeps working until ${formatDay(dunning.nextStepAt)}, when new runs will be paused. Your data is never deleted for a failed payment.`
              : `We could not take payment ${dunning.daysPastDue} days ago. Please update your payment method.`
          }
        />
      ) : null}

      {sub ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <StateCard
            label="Subscription"
            value={sub.planCode}
            tone={sub.status === "past_due" ? "failed" : sub.status === "incomplete" ? "waiting" : "success"}
            note={
              sub.cancelAtPeriodEnd && sub.currentPeriodEnd
                ? `Ends ${formatDay(sub.currentPeriodEnd)}`
                : sub.trialEnd
                  ? `Trial ends ${formatDay(sub.trialEnd)}`
                  : sub.currentPeriodEnd
                    ? `Renews ${formatDay(sub.currentPeriodEnd)}`
                    : sub.status
            }
          />
          <StateCard
            label="Seats"
            value={String(sub.quantity)}
            tone="success"
            note="Billed per seat, counted once per person across the account."
          />
          <StateCard
            label="Status"
            value={sub.status.replace("_", " ")}
            tone={sub.status === "active" || sub.status === "trialing" ? "success" : "waiting"}
            note={sub.status === "incomplete" ? "Waiting for the first payment to clear." : " "}
          />
        </div>
      ) : null}

      <section className="grid gap-1.5">
        <Text variant="caption" tone="muted" className="block">
          Plans, priced in {data.currency}
        </Text>
        <dl className="border-subtle divide-subtle bg-surface-sunken divide-y rounded-md border">
          {data.plans.map((plan) => (
            <div
              key={plan.planCode}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <dt>
                  <Text variant="body-sm" tone="primary" className="block">{plan.planName}</Text>
                </dt>
                <Text variant="caption" tone="muted" className="block leading-snug">
                  {plan.taxBehavior === "inclusive" ? "Includes tax" : "Plus tax"}
                  {plan.isCurrent ? " · Current plan" : ""}
                </Text>
              </div>
              <dd>
                <Text variant="body-sm" tone="max" tabular>
                  {formatPrice(plan.unitAmountMinor, plan.currency)}
                </Text>
              </dd>
              <dd>
                {plan.isCurrent ? (
                  <Text variant="caption" tone="muted">Current</Text>
                ) : (
                  <Button size="xs" variant="secondary" disabled={!canManage || !data.providerLive}>
                    {sub ? "Change" : "Choose"}
                  </Button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Text variant="caption" tone="muted" className="block">Payment methods</Text>
          <Button size="xs" variant="secondary" disabled={!canManage || !data.providerLive}>
            Add payment method
          </Button>
        </div>
        {data.paymentMethods.length === 0 ? (
          <Text variant="caption" tone="muted" className="block leading-snug">
            None on file. Card details are entered on the provider&rsquo;s own page and never reach us.
          </Text>
        ) : (
          <ul className="border-subtle divide-subtle bg-surface-sunken divide-y rounded-md border">
            {data.paymentMethods.map((pm) => (
              <li key={pm.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <Text variant="body-sm" tone="primary">
                  {pm.brand ?? pm.kind}
                  {pm.last4 ? ` ending ${pm.last4}` : pm.label ? ` ${pm.label}` : ""}
                </Text>
                <Text variant="caption" tone="muted" tabular>
                  {pm.expMonth && pm.expYear ? `${pm.expMonth}/${pm.expYear}` : ""}
                  {pm.isDefault ? " · Default" : ""}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-1.5">
        <Text variant="caption" tone="muted" className="block">Invoices</Text>
        {data.invoices.length === 0 ? (
          <Text variant="caption" tone="muted" className="block leading-snug">No invoices yet.</Text>
        ) : (
          <ul className="border-subtle divide-subtle bg-surface-sunken divide-y rounded-md border">
            {data.invoices.map((inv) => (
              <li
                key={inv.id}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 px-3 py-2"
              >
                <Text variant="body-sm" tone="primary" className="min-w-0 truncate">
                  {inv.number ?? inv.id.slice(0, 8)}
                </Text>
                <Text variant="body-sm" tone="max" tabular>
                  {formatPrice(inv.totalMinor, inv.currency)}
                </Text>
                {inv.hostedUrl ? (
                  <a
                    href={inv.hostedUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-ui text-caption text-fg-secondary hover:text-fg-primary underline"
                  >
                    {inv.status}
                  </a>
                ) : (
                  <Text variant="caption" tone="muted">{inv.status}</Text>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Panel>
  );
}

/**
 * Minor units to a localised price.
 *
 * `Intl` supplies the symbol, the separators AND the number of decimal places,
 * which is the part that matters: a zero-decimal currency like JPY must not be
 * divided by 100. Reading `maximumFractionDigits` back from the formatter means
 * a currency added to the catalogue later renders correctly without this file
 * learning about it.
 */
function formatPrice(minor: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / Math.pow(10, digits));
}

/**
 * How long this workspace keeps things, and — during a downgrade — the dates.
 *
 * ── WHY A DOWNGRADE GETS ITS OWN BANNER AND NOT A ROW ───────────────────────
 * "Traces: 7 days" is a setting. "On 4 October we start deleting the 83 days of
 * traces you currently have" is news, and it needs to be read before that date,
 * not discovered after it. This is customer-owned data; a warning nobody
 * noticed is the same as no warning when the support ticket arrives.
 *
 * The dates come from the server, computed by the same SQL function the
 * deletion job calls. The page never does date arithmetic of its own — a
 * browser in another timezone would otherwise show a day the job does not
 * honour, and the day on the screen is the one the customer remembers.
 */
function RetentionCard({ data, canRequest }: { data: RetentionPanelData; canRequest: boolean }) {
  const graced = data.windows.filter((w) => w.inGrace);
  const totalBytes = data.storage.reduce((sum, s) => sum + s.bytes, 0);

  return (
    <Panel
      title="Data retention"
      help="How long each kind of data is kept before it is deleted."
      footer={
        <StatusLine
          state={null}
          resting={
            data.lastExport
              ? `Last export ${formatDay(data.lastExport.createdAt)} — ${data.lastExport.rowCount.toLocaleString()} rows, ${data.lastExport.status}.`
              : "You can export your runs and traces at any time, and we export automatically before a retention deletion."
          }
        />
      }
    >
      {graced.length > 0 ? (
        <AdminInlineState
          tone="waiting"
          title={`Your retention is being reduced${data.firstDeletionAt ? ` from ${formatDay(data.firstDeletionAt)}` : ""}`}
          body={
            graced
              .map(
                (w) =>
                  `${w.label}: kept for ${w.days} days until ${formatDay(w.graceUntil ?? "")}, then ${w.planDays} days. ` +
                  `From that date, anything older than ${formatDay(w.afterGraceDeletesBefore ?? "")} is deleted.`,
              )
              .join(" ") +
            " Export what you need before then — we also export automatically before deleting anything."
          }
          action={
            canRequest ? (
              <Button asChild size="xs" variant="secondary">
                <Link href={"/settings/usage" as Route}>Export data</Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <dl className="border-subtle divide-subtle bg-surface-sunken divide-y rounded-md border">
        {data.windows.map((w) => (
          <div
            key={w.entity}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <dt>
                <Text variant="body-sm" tone="primary" className="block">{w.label}</Text>
              </dt>
              <Text variant="caption" tone="muted" className="block leading-snug">
                {w.inGrace
                  ? `Reducing to ${w.planDays} days on ${formatDay(w.graceUntil ?? "")}`
                  : `Anything before ${formatDay(w.deletesBefore)} is deleted`}
              </Text>
            </div>
            <dd>
              <Text
                variant="body-sm"
                tone={w.inGrace ? "inherit" : "max"}
                tabular
                className={cn(w.inGrace && "text-status-waiting")}
              >
                {w.days} days
              </Text>
            </dd>
          </div>
        ))}
      </dl>

      {totalBytes > 0 ? (
        <Text variant="caption" tone="muted" className="block leading-snug">
          Currently storing about {formatBytes(totalBytes)} across{" "}
          {data.storage.reduce((sum, s) => sum + s.rows, 0).toLocaleString()} rows. Estimated from a
          sample, so treat it as a size, not a bill.
        </Text>
      ) : null}
    </Panel>
  );
}

/** Bytes at one decimal place, in the unit a person would say out loud. */
function formatBytes(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function EntitlementRow({ entry }: { entry: PlanEntry }) {
  const limit = entry.limit === null ? "Unlimited" : entry.limit.toLocaleString();
  const value =
    entry.current === null || entry.limit === null
      ? limit
      : `${entry.current.toLocaleString()} / ${limit}`;
  // At or over the ceiling is the state the reader has to act on, so it is the
  // only one that takes a colour. Everything below it stays quiet.
  const spent = entry.limit !== null && entry.current !== null && entry.current >= entry.limit;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2">
      <div className="min-w-0">
        <dt>
          <Text variant="body-sm" tone="primary" className="block">{entry.label}</Text>
        </dt>
        {entry.source === "override" ? (
          <Text variant="caption" tone="muted" className="block leading-snug">
            Raised for this account, above the published plan.
          </Text>
        ) : null}
      </div>
      <dd>
        <Text
          variant="body-sm"
          tone={spent ? "inherit" : "max"}
          tabular
          className={cn(spent && "text-status-waiting")}
        >
          {value}
        </Text>
      </dd>
    </div>
  );
}

/**
 * Money from integer cents, never from a float.
 *
 * `Intl` does the rounding and the symbol, so a currency the catalogue adds
 * later renders correctly without this file learning about it.
 */
function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso.slice(0, 10)
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function StateCard({
  label, value, note, tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "success" | "waiting" | "failed";
}) {
  return (
    <section className="border-subtle bg-surface-sunken rounded-md border p-3">
      <Text variant="caption" tone="muted" className="block">{label}</Text>
      <Text
        variant="body-lg"
        tone="inherit"
        as="p"
        className={cn(
          "mt-0.5 block font-medium capitalize",
          tone === "success" && "text-status-success",
          tone === "waiting" && "text-status-waiting",
          tone === "failed" && "text-status-failed",
        )}
      >
        {value}
      </Text>
      <Text variant="caption" tone="muted" className="mt-1 block leading-snug">{note}</Text>
    </section>
  );
}

function IncludedRow({
  label, value, used, note,
}: {
  label: string;
  value: string;
  used?: number;
  note?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2">
      <div className="min-w-0">
        <dt><Text variant="body-sm" tone="primary" className="block">{label}</Text></dt>
        {note ? (
          <Text variant="caption" tone="muted" className="block leading-snug">{note}</Text>
        ) : null}
      </div>
      <dd>
        <Text variant="body-sm" tone="max" tabular>
          {used === undefined ? value : `${used.toLocaleString()} / ${value}`}
        </Text>
      </dd>
    </div>
  );
}

function Capability({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "font-ui text-caption rounded-full border px-2 py-0.5",
        on
          ? "border-status-success-border bg-status-success-subtle text-status-success"
          : "border-subtle bg-surface-sunken text-fg-muted",
      )}
    >
      {children}
      <span className="sr-only">{on ? " included" : " not included"}</span>
      <span aria-hidden="true">{on ? " · on" : " · off"}</span>
    </span>
  );
}

function RequestHistory({
  query,
}: {
  query: ReturnType<typeof useQuery<{ requests: AccessRequest[]; yourRole: string }, Error>>;
}) {
  const requests = query.data?.requests ?? [];

  return (
    <Panel
      title="Requests"
      help="Requests for more capacity and their status."
    >
      {query.isPending ? <RowSkeleton rows={2} /> : null}

      {query.error ? (() => {
        const failure = describeAdminFailure(query.error, "requests");
        return <AdminInlineState tone={failure.tone} title={failure.title} body={failure.body} />;
      })() : null}

      {query.data && requests.length === 0 ? (
        <AdminInlineState
          tone="neutral"
          title="Nothing requested yet"
          body="When an admin asks for more capacity or for real execution, it appears here with its status — so anybody can see it is already in hand."
        />
      ) : null}

      {requests.length > 0 ? (
        <ul className="border-subtle divide-subtle divide-y rounded-md border">
          {requests.map((request) => (
            <li key={request.id} className="grid gap-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text variant="body-sm" tone="primary" className="font-medium">
                  {KIND_LABEL[request.kind]}
                </Text>
                <RequestStatus status={request.status} />
              </div>
              {Object.keys(request.changes).length > 0 ? (
                <Text variant="caption" tone="secondary" className="block">
                  {Object.entries(request.changes)
                    .map(([key, value]) => `${humanise(key)}: ${value}`)
                    .join(" · ")}
                </Text>
              ) : null}
              {request.reason ? (
                <Text variant="caption" tone="muted" className="block leading-snug">
                  &ldquo;{request.reason}&rdquo;
                </Text>
              ) : null}
              <Text variant="caption" tone="muted" className="block">
                {request.requestedByName ?? request.requestedByEmail ?? "A workspace admin"} ·{" "}
                {new Date(request.createdAt).toLocaleDateString()}
                {request.decisionReason ? ` · ${request.decisionReason}` : ""}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function RequestStatus({ status }: { status: AccessRequest["status"] }) {
  return (
    <span
      className={cn(
        "font-ui text-caption shrink-0 rounded-full border px-1.5 py-0.5",
        status === "approved"
          ? "border-status-success-border bg-status-success-subtle text-status-success"
          : status === "rejected"
            ? "border-status-failed-border bg-status-failed-subtle text-status-failed"
            : "border-status-waiting-border bg-status-waiting-subtle text-status-waiting",
      )}
    >
      {status === "open" ? "Awaiting review" : status === "approved" ? "Approved" : "Declined"}
    </span>
  );
}

/* ── Asking ───────────────────────────────────────────────────────────────── */

/**
 * The reason field is required for real execution and optional otherwise.
 *
 * A reviewer deciding whether a tenant may write to production systems cannot
 * decide it from a bare "please enable". A queue of context-free requests is a
 * queue nobody works, which is how a request feature becomes theatre.
 */
function RequestDialog({
  kind, workspaceId, policy, onClose,
}: {
  kind: RequestKind | null;
  workspaceId: string | null;
  policy: Policy | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [runsPerDay, setRunsPerDay] = React.useState("");
  const [seats, setSeats] = React.useState("");
  const [status, setStatus] = React.useState<SaveState>(null);

  React.useEffect(() => {
    if (kind) {
      setReason("");
      setStatus(null);
      setRunsPerDay(policy ? String(policy.maxRunsPerDay * 2) : "");
      setSeats(policy ? String(policy.maxTeamMembers + 1) : "");
    }
  }, [kind, policy]);

  const send = useMutation({
    mutationFn: async () => {
      const changes: Record<string, number> = {};
      if (kind === "capacity" && Number(runsPerDay) > 0) changes.maxRunsPerDay = Number(runsPerDay);
      if (kind === "seats" && Number(seats) > 0) changes.maxTeamMembers = Number(seats);
      return readJson<AccessRequest>(
        await fetch(`/api/settings/access-requests?workspaceId=${encodeURIComponent(workspaceId!)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, changes, reason: reason.trim() || null }),
        }),
        "The request could not be recorded",
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["access-requests", workspaceId] });
      onClose();
    },
    onError: (error: Error) => setStatus({ tone: "error", text: error.message }),
  });

  const needsReason = kind === "real_execution";
  const ready = !needsReason || reason.trim().length > 0;

  return (
    <Modal open={kind !== null} onOpenChange={(next) => { if (!next && !send.isPending) onClose(); }} size="md">
      <ModalHeader
        eyebrow="Govern · Plan & access"
        title={kind ? KIND_LABEL[kind] : "Request"}
        description="This goes on Vectorbea's review queue as a record, not an email."
      />
      <ModalLayout>
        <ModalBody>
          <div className="grid gap-3">
            {kind === "capacity" ? (
              <Field
                label="Workflow runs per day"
                description={policy ? `Currently ${policy.maxRunsPerDay.toLocaleString()}.` : undefined}
              >
                <Input
                  mono
                  inputMode="numeric"
                  value={runsPerDay}
                  onChange={(event) => setRunsPerDay(event.target.value.replace(/[^0-9]/g, ""))}
                />
              </Field>
            ) : null}

            {kind === "seats" ? (
              <Field
                label="Seats"
                description={policy ? `Currently ${policy.maxTeamMembers.toLocaleString()}.` : undefined}
              >
                <Input
                  mono
                  inputMode="numeric"
                  value={seats}
                  onChange={(event) => setSeats(event.target.value.replace(/[^0-9]/g, ""))}
                />
              </Field>
            ) : null}

            <Field
              label={needsReason ? "What will this workspace run for real?" : "Anything the reviewer should know"}
              description={
                needsReason
                  ? "Which systems it will write to, and roughly how often. A reviewer cannot approve production access without it."
                  : "Optional, but a sentence of context is usually what moves a request."
              }
              required={needsReason}
              characterCount={{ value: reason.length, max: 1000 }}
            >
              <Input
                value={reason}
                maxLength={1000}
                onChange={(event) => { setReason(event.target.value); setStatus(null); }}
              />
            </Field>

            {status?.tone === "error" ? (
              <AdminInlineState tone="failed" title="The request was not sent" body={status.text} />
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" disabled={send.isPending} onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!ready}
            loading={send.isPending}
            loadingLabel="Sending"
            onClick={() => { setStatus(null); send.mutate(); }}
          >
            Send request
          </Button>
        </ModalFooter>
      </ModalLayout>
    </Modal>
  );
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

function RowSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="border-subtle bg-surface-sunken h-12 animate-pulse rounded-md border" />
      ))}
    </div>
  );
}
