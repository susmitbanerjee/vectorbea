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
import { useScope } from "~/lib/workspace/workspace-provider";
import { AdminInlineState, describeAdminFailure } from "./admin-states";
import { SettingsNav } from "./settings-nav";
import { Panel, StatusLine, type SaveState } from "./settings-chrome";

/* ══════════════════════════════════════════════════════════════════════════════
   PLAN & ACCESS

   /settings/billing redirected to /settings/usage, because there is no billing:
   no payment provider is wired, there is no subscription table, and there is no
   plan tier anywhere in the data model — `organizations.plan_tier` lived in a
   Supabase schema no deployment provisions. Rendering plan cards and an
   "Upgrade" button over that would be a shop front with no shop behind it.

   WHAT IS TRUE IS WORTH A PAGE. This workspace has an access state
   (`workspace_beta_controls`) and a set of limits that genuinely bind
   (`workspace_usage_policies`). Neither can be changed by the person reading
   this screen — both are set by Vectorbea, because real execution means
   workflows write to your systems and spend your money, and the private beta
   vets each tenant first.

   SO THE PAGE IS: what you have, what it costs you today (nothing), and the one
   action you do own — asking, on the record, through `usage_limit_requests`.
   That is a queue a reviewer can work, not an email somebody remembers.
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

interface UsageResponse {
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
  const execution = usage.data?.execution;
  const capacity = usage.data?.capacity;
  const role = requests.data?.yourRole ?? "viewer";
  const canRequest = role === "owner" || role === "admin";
  const open = requests.data?.requests.filter((request) => request.status === "open") ?? [];
  const openKinds = new Set(open.map((request) => request.kind));

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
        <Panel
          title="This workspace is on the private beta"
          help="There is no paid plan and no payment method on file. Vectorbea is invitation-only while real execution is being rolled out tenant by tenant, so what a workspace may do is set per workspace rather than bought."
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
          help="These are the numbers the runtime checks, not a marketing table. The daily run allowance is the one that returns a 429."
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
      help="Every ask for more capacity or for real execution, and what came of it. Visible to everybody in the workspace so the same request is not filed three times."
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
