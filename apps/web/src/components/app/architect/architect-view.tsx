"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { formatCost, formatDuration } from "~/lib/format";
import { CONNECTIONS } from "~/mocks/fixtures";
import {
  STAGES, QUOTA, EXAMPLE_PROMPTS, EMPTY_HINTS, ANALYSIS, BLUEPRINT,
  manifestFor, buildStepsFor, requiredProviders, ERRORS,
  type StageId, type StructuredHints, type Blueprint, type BlueprintNode,
} from "~/mocks/architect";
import { useBlueprintStream, BlueprintCanvas, RationaleList } from "./blueprint-stream";
import { RelativeTime } from "~/components/app/workflows/atoms";

/* ══════════════════════════════════════════════════════════════════════════════
   AI WORKFLOW ARCHITECT

   The rail existed and did nothing. This makes each of its seven stages real,
   and the state lives in ONE reducer rather than seven pieces of local state —
   because the flow is cancellable at every stage and resumable after a
   navigation, and both of those are impossible when the state is scattered
   across the components that happen to be mounted.
══════════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = "vectorbea-architect-session";

interface Session {
  stage: StageId;
  prompt: string;
  hints: StructuredHints;
  /** Findings revealed so far in Analyze. */
  analysed: number;
  blueprint: Blueprint | null;
  /** Nodes the user removed before building. */
  removed: string[];
  name: string;
  environment: string;
  /** Build steps completed. -1 while not building. */
  built: number;
  failedAt: number | null;
  error: string | null;
}

const EMPTY_SESSION: Session = {
  stage: "describe",
  prompt: "",
  hints: EMPTY_HINTS,
  analysed: 0,
  blueprint: null,
  removed: [],
  name: "",
  environment: "staging",
  built: -1,
  failedAt: null,
  error: null,
};

export function ArchitectView({ quota = QUOTA }: { quota?: typeof QUOTA }) {
  const [session, setSession] = React.useState<Session>(EMPTY_SESSION);
  const [selectedNode, setSelectedNode] = React.useState<string | null>(null);

  const patch = React.useCallback((next: Partial<Session>) => {
    setSession((current) => ({ ...current, ...next }));
  }, []);

  /* ── Resume ─────────────────────────────────────────────────────────────
     Written on every change and read once after mount. Somebody who wrote a
     paragraph, navigated away to create a connection and came back should find
     their paragraph — and on a one-build-per-month quota, losing it is worse
     than an inconvenience. */
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSession({ ...EMPTY_SESSION, ...JSON.parse(raw) });
    } catch {}
  }, []);

  React.useEffect(() => {
    try {
      if (session.stage === "describe" && session.prompt === "") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      }
    } catch {}
  }, [session]);

  const exhausted = quota.used >= quota.limit;
  const stageIndex = STAGES.findIndex((s) => s.id === session.stage);

  const cancel = () => {
    setSession(EMPTY_SESSION);
    setSelectedNode(null);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href={"/workflows/new" as Route} className="hover:text-fg-secondary rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring">
            Build · New workflow
          </Link>
        }
        title="AI Architect"
        description="Describe what you want to happen. The Architect proposes a durable workflow, explains every decision, and builds it once you approve."
        actions={
          session.stage !== "describe" ? (
            <Button variant="secondary" size="sm" onClick={cancel}>Start over</Button>
          ) : null
        }
      />

      <StageRail current={session.stage} index={stageIndex} />

      <div className="mt-4">
        {session.error ? <ErrorPanel code={session.error} onDismiss={() => patch({ error: null })} onReturn={(stage) => patch({ error: null, stage })} /> : null}

        {session.stage === "describe" ? (
          <Describe
            session={session}
            patch={patch}
            quota={quota}
            exhausted={exhausted}
            onStart={() => patch({ stage: "analyze", analysed: 0 })}
          />
        ) : null}

        {session.stage === "analyze" ? (
          <Analyze session={session} patch={patch} onCancel={cancel} />
        ) : null}

        {session.stage === "blueprint" ? (
          <BlueprintStage
            session={session}
            patch={patch}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onCancel={cancel}
          />
        ) : null}

        {session.stage === "connect" ? <Connect session={session} patch={patch} /> : null}
        {session.stage === "review" ? <Review session={session} patch={patch} /> : null}
        {session.stage === "build" ? <Build session={session} patch={patch} /> : null}
        {session.stage === "ready" ? <Ready session={session} /> : null}
      </div>
    </PageContainer>
  );
}

/* ── Rail ─────────────────────────────────────────────────────────────────── */

function StageRail({ current, index }: { current: StageId; index: number }) {
  return (
    <ol className="border-subtle bg-surface-raised grid gap-px overflow-x-auto rounded-lg border p-1 sm:grid-cols-7">
      {STAGES.map((stage, i) => {
        const active = stage.id === current;
        const done = i < index;
        return (
          <li key={stage.id}>
            <div
              aria-current={active ? "step" : undefined}
              className={cn(
                "grid gap-0.5 rounded-md px-2.5 py-2",
                active ? "bg-surface-active" : done ? "opacity-90" : "opacity-50",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "font-code grid size-4 shrink-0 place-items-center rounded-full border text-[9px]",
                    done ? "border-status-success text-status-success"
                      : active ? "border-accent text-accent"
                        : "border-subtle text-fg-disabled",
                  )}
                  aria-hidden="true"
                >
                  {done ? (
                    <svg viewBox="0 0 10 10" className="size-2.5">
                      <path d="M2 5.2 4 7.2 8 3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : i + 1}
                </span>
                <Text variant="caption" tone={active ? "max" : "secondary"}>{stage.label}</Text>
              </span>
              <Text variant="caption" tone="muted" className="text-[10px] leading-snug">{stage.blurb}</Text>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── 1 · Describe ─────────────────────────────────────────────────────────── */

function Describe({
  session, patch, quota, exhausted, onStart,
}: {
  session: Session;
  patch: (next: Partial<Session>) => void;
  quota: typeof QUOTA;
  exhausted: boolean;
  onStart: () => void;
}) {
  const tooShort = session.prompt.trim().length < 24;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid gap-3">
        {/* Quota BEFORE the prompt box, not after the effort. */}
        <QuotaBanner quota={quota} exhausted={exhausted} />

        <Panel title="Describe the workflow" help="Plain English. Say what starts it, what should happen, and where a person needs to decide.">
          <textarea
            value={session.prompt}
            onChange={(e) => patch({ prompt: e.target.value })}
            disabled={exhausted}
            rows={6}
            placeholder="Every morning, find contracts renewing in the next 30 days…"
            aria-label="Describe the workflow"
            className={cn(
              "font-ui text-body-sm bg-surface-sunken border-subtle w-full rounded-md border p-2.5",
              "text-fg-primary placeholder:text-fg-disabled resize-y",
              "outline-none focus-visible:focus-ring disabled:opacity-50",
            )}
          />

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Text variant="caption" tone="muted" className="mr-1">Start from:</Text>
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example.id}
                type="button"
                disabled={exhausted}
                // Populates the box. Navigating away from a half-written prompt
                // to look at an example is how the current version loses work.
                onClick={() => patch({ prompt: example.text })}
                className={cn(
                  "font-ui text-caption border-subtle text-fg-secondary rounded-full border px-2.5 py-1",
                  "hover:border-accent-border hover:text-accent transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring disabled:opacity-50",
                )}
              >
                {example.label}
              </button>
            ))}
          </div>
        </Panel>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {tooShort && !exhausted ? (
            <Text variant="caption" tone="muted">
              A sentence or two works better than a phrase — the plan is only as specific as the description.
            </Text>
          ) : null}
          <Button variant="primary" size="sm" disabled={exhausted || tooShort} onClick={onStart}>
            Analyse the description
          </Button>
        </div>
      </div>

      <Panel
        title="Hints (optional)"
        help="Anything you already know. Supplying a hint removes a guess rather than adding a constraint."
      >
        <div className="grid gap-2">
          <Field label="Trigger" help="How the workflow starts.">
            <Select
              options={[
                { value: "unspecified", label: "Let the Architect decide" },
                { value: "schedule", label: "On a schedule" },
                { value: "webhook", label: "On a webhook" },
                { value: "manual", label: "By hand" },
                { value: "api", label: "Through the API" },
              ]}
              value={session.hints.trigger}
              onValueChange={(v) => patch({ hints: { ...session.hints, trigger: v as StructuredHints["trigger"] } })}
              aria-label="Trigger hint"
            />
          </Field>

          <Field label="Schedule" help="If it runs on a clock, when?">
            <Input
              value={session.hints.schedule}
              onChange={(e) => patch({ hints: { ...session.hints, schedule: e.target.value } })}
              placeholder="Daily at 06:00 UTC"
              className="h-7 text-body-sm"
            />
          </Field>

          <Field label="Approvals" help="Whether a person must decide before anything leaves the workspace.">
            <Select
              options={[
                { value: "unspecified", label: "Let the Architect decide" },
                { value: "required", label: "Require an approval gate" },
                { value: "none", label: "No approvals" },
              ]}
              value={session.hints.approval}
              onValueChange={(v) => patch({ hints: { ...session.hints, approval: v as StructuredHints["approval"] } })}
              aria-label="Approval hint"
            />
          </Field>

          <Field label="Systems" help="Comma separated. Only systems you have connected can be used.">
            <Input
              value={session.hints.systems.join(", ")}
              onChange={(e) => patch({ hints: { ...session.hints, systems: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })}
              placeholder="Postgres, Slack"
              className="h-7 text-body-sm"
            />
          </Field>
        </div>
      </Panel>
    </div>
  );
}

function QuotaBanner({ quota, exhausted }: { quota: typeof QUOTA; exhausted: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        exhausted ? "border-status-waiting-border bg-status-waiting-subtle" : "border-subtle bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="body-sm" tone="primary">
          {exhausted
            ? `You have used your Architect build for this period.`
            : `${quota.limit - quota.used} of ${quota.limit} Architect ${quota.limit === 1 ? "build" : "builds"} left on ${quota.plan}.`}
        </Text>
        {exhausted ? (
          <Button asChild size="sm" variant="primary">
            <Link href={"/settings/billing" as Route}>Upgrade</Link>
          </Button>
        ) : null}
      </div>
      <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
        {exhausted
          ? <>The next one is available <RelativeTime iso={quota.resetsAt} />. You can still build workflows by hand or from a template — the quota applies only to generated plans.</>
          : <>Only a completed build counts. Describing, analysing and discarding a blueprint costs nothing, so it is worth iterating before you build.</>}
      </Text>
    </div>
  );
}

/* ── 2 · Analyze ──────────────────────────────────────────────────────────── */

function Analyze({
  session, patch, onCancel,
}: {
  session: Session;
  patch: (next: Partial<Session>) => void;
  onCancel: () => void;
}) {
  /* Findings arrive one at a time. The rail's sub-steps are these findings, so
     "analysing" is a sequence of results rather than a spinner with a label. */
  React.useEffect(() => {
    if (session.analysed >= ANALYSIS.length) {
      const done = window.setTimeout(() => patch({ stage: "blueprint", blueprint: BLUEPRINT }), 700);
      return () => window.clearTimeout(done);
    }
    const next = window.setTimeout(() => patch({ analysed: session.analysed + 1 }), 620);
    return () => window.clearTimeout(next);
  }, [session.analysed, patch]);

  return (
    <Panel
      title="Reading the description"
      help="What the Architect has understood so far. Anything wrong here will be wrong in the plan, so it is worth reading before the blueprint arrives."
      action={<Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>}
    >
      <ol className="grid gap-2">
        {ANALYSIS.slice(0, session.analysed).map((finding) => (
          <li
            key={finding.id}
            data-motion="decorative"
            className="border-subtle motion-safe:animate-[ink-fade-in_240ms_var(--ease-standard)_both] rounded-md border p-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Text variant="caption" tone="muted">{finding.label}</Text>
              <Text variant="body-sm" tone="primary" className="font-medium">{finding.value}</Text>
            </div>
            <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">{finding.detail}</Text>
          </li>
        ))}

        {session.analysed < ANALYSIS.length ? (
          <li className="flex items-center gap-2 px-1 py-2">
            <Spinner className="size-4" />
            <Text variant="caption" tone="muted">
              {["Finding the trigger…", "Identifying systems…", "Looking for decision points…", "Looking for human checkpoints…"][session.analysed]}
            </Text>
          </li>
        ) : null}
      </ol>
    </Panel>
  );
}

/* ── 3 · Blueprint ────────────────────────────────────────────────────────── */

function BlueprintStage({
  session, patch, selectedNode, onSelectNode, onCancel,
}: {
  session: Session;
  patch: (next: Partial<Session>) => void;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  onCancel: () => void;
}) {
  const blueprint = React.useMemo(() => {
    if (!session.blueprint) return null;
    return {
      ...session.blueprint,
      nodes: session.blueprint.nodes.filter((n) => !session.removed.includes(n.id)),
      edges: session.blueprint.edges.filter(
        (e) => !session.removed.includes(e.from) && !session.removed.includes(e.to),
      ),
    };
  }, [session.blueprint, session.removed]);

  const { landed, phase, skip, total } = useBlueprintStream(blueprint, blueprint !== null);

  if (!blueprint) return null;

  const manifest = manifestFor(blueprint);
  const selected = blueprint.nodes.find((n) => n.id === selectedNode) ?? null;
  const streaming = phase !== "done";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid min-w-0 gap-3">
        <Panel
          title="Blueprint"
          help={streaming
            ? "Assembling the plan. Steps land in execution order; approval gates land last."
            : "Every step, with why it is there. Edit anything before building — this is a proposal, not a commitment."}
          action={
            streaming
              ? <Button size="xs" variant="ghost" onClick={skip}>Skip animation</Button>
              : <Text variant="caption" tone="muted">{total} steps</Text>
          }
        >
          <BlueprintCanvas
            blueprint={blueprint}
            landed={landed}
            phase={phase}
            selectedId={selectedNode}
            onSelect={onSelectNode}
          />
        </Panel>

        {!streaming ? (
          <Panel title="What will be created" help="The exact resource manifest. Nothing outside this list is touched.">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Count label="Agents" value={manifest.agents} />
              <Count label="Tools" value={manifest.tools} />
              <Count label="Connections needed" value={manifest.connections} />
              <Count label="Approval gates" value={manifest.gates} />
              <Count label="Cost per run" value={formatCost(manifest.costPerRunUsd)} />
              <Count label="Estimated duration" value={formatDuration(manifest.durationMs)} />
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3">
        <Panel
          title="Why each step"
          help="Each one names the part of your description it came from."
        >
          <RationaleList
            blueprint={blueprint}
            landed={landed}
            selectedId={selectedNode}
            onSelect={onSelectNode}
          />
        </Panel>

        {selected && !streaming ? (
          <NodeEditor
            node={selected}
            onRename={(name) => patch({
              blueprint: session.blueprint
                ? { ...session.blueprint, nodes: session.blueprint.nodes.map((n) => (n.id === selected.id ? { ...n, name } : n)) }
                : null,
            })}
            onConfig={(key, value) => patch({
              blueprint: session.blueprint
                ? { ...session.blueprint, nodes: session.blueprint.nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [key]: value } } : n)) }
                : null,
            })}
            onRemove={() => {
              patch({ removed: [...session.removed, selected.id] });
              onSelectNode(null);
            }}
          />
        ) : null}

        {!streaming ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>Discard</Button>
            <Button variant="primary" size="sm" onClick={() => patch({ stage: "connect" })}>
              Continue to connections
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NodeEditor({
  node, onRename, onConfig, onRemove,
}: {
  node: BlueprintNode;
  onRename: (name: string) => void;
  onConfig: (key: string, value: unknown) => void;
  onRemove: () => void;
}) {
  return (
    <Panel title={`Edit — ${node.kind}`} help="Changes apply to the plan before it is built.">
      <div className="grid gap-2">
        <Field label="Step name" help="What it is called on the canvas and in run history.">
          <Input value={node.name} onChange={(e) => onRename(e.target.value)} className="h-7 text-body-sm" />
        </Field>

        {node.kind === "llm" || node.kind === "agent" ? (
          <Field label="Model" help="A cheaper model costs less per run and is usually enough for internal steps.">
            <Select
              options={[
                { value: "claude-haiku-4", label: "claude-haiku-4 — cheapest" },
                { value: "claude-sonnet-4", label: "claude-sonnet-4 — balanced" },
                { value: "gpt-4o", label: "gpt-4o" },
              ]}
              value={String(node.config.model ?? "claude-sonnet-4")}
              onValueChange={(v) => onConfig("model", v)}
              aria-label="Model"
            />
          </Field>
        ) : null}

        {node.kind === "approval" ? (
          <>
            <Field label="Approver group" help="Anyone in the group may decide.">
              <Select
                options={["billing", "platform-ops", "growth", "support-eng"].map((g) => ({ value: g, label: g }))}
                value={String(node.config.approverGroup ?? "billing")}
                onValueChange={(v) => onConfig("approverGroup", v)}
                aria-label="Approver group"
              />
            </Field>
            <Field label="SLA (minutes)" help="How long before the gate is considered breached.">
              <Input
                type="number"
                value={Number(node.config.slaMinutes ?? 240)}
                onChange={(e) => onConfig("slaMinutes", Number(e.target.value))}
                className="h-7 text-body-sm"
              />
            </Field>
          </>
        ) : null}

        {node.kind === "trigger" ? (
          <Field label="Cron" help="Five-field cron in the workflow's timezone.">
            <Input
              value={String(node.config.cron ?? "")}
              onChange={(e) => onConfig("cron", e.target.value)}
              className="h-7 font-code text-mono-sm"
            />
          </Field>
        ) : null}

        <div className="mt-1">
          <Button size="xs" variant="ghost" onClick={onRemove} className="text-status-failed">
            Remove this step
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/* ── 4 · Connect ──────────────────────────────────────────────────────────── */

function Connect({ session, patch }: { session: Session; patch: (next: Partial<Session>) => void }) {
  const providers = session.blueprint ? requiredProviders(session.blueprint) : [];
  const [tested, setTested] = React.useState<Record<string, "idle" | "testing" | "ok">>({});

  const missing = providers.filter((p) => !CONNECTIONS.some((c) => c.provider === p));
  const canContinue = missing.length === 0;

  return (
    <div className="grid gap-3">
      <Panel
        title="Connections this workflow needs"
        help="Credentials cannot be generated. Anything missing has to be connected before the workflow can run — you can do it here without losing the plan."
      >
        <ul className="grid gap-2">
          {providers.map((provider) => {
            const connection = CONNECTIONS.find((c) => c.provider === provider);
            const state = tested[provider] ?? "idle";

            return (
              <li key={provider} className="border-subtle flex flex-wrap items-center gap-2 rounded-md border p-2.5">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    !connection ? "bg-fg-disabled"
                      : connection.status === "healthy" ? "bg-status-success"
                        : connection.status === "degraded" ? "bg-status-waiting" : "bg-status-failed",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <Text variant="body-sm" tone="primary" className="block capitalize">{provider}</Text>
                  <Text variant="caption" tone="muted" className="block">
                    {connection
                      ? connection.status === "healthy"
                        ? `${connection.name} — connected, ${connection.latencyMs}ms`
                        : `${connection.name} — ${connection.status}. The workflow will install but its first run fails here.`
                      : "Not connected. The workflow cannot run until it is."}
                  </Text>
                </span>

                {connection ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    loading={state === "testing"}
                    onClick={() => {
                      setTested((t) => ({ ...t, [provider]: "testing" }));
                      window.setTimeout(() => setTested((t) => ({ ...t, [provider]: "ok" })), 700);
                    }}
                  >
                    {state === "ok" ? "Tested" : "Test"}
                  </Button>
                ) : (
                  <Button asChild size="xs" variant="primary">
                    <Link href={"/connections" as Route}>Connect</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => patch({ stage: "blueprint" })}>Back</Button>
        <span className="flex items-center gap-2">
          {!canContinue ? (
            <Text variant="caption" tone="muted">
              {missing.length} connection{missing.length === 1 ? "" : "s"} still missing
            </Text>
          ) : null}
          <Button variant="primary" size="sm" disabled={!canContinue} onClick={() => patch({ stage: "review" })}>
            Continue to review
          </Button>
        </span>
      </div>
    </div>
  );
}

/* ── 5 · Review ───────────────────────────────────────────────────────────── */

function Review({ session, patch }: { session: Session; patch: (next: Partial<Session>) => void }) {
  const blueprint = session.blueprint;
  if (!blueprint) return null;
  const manifest = manifestFor(blueprint);
  const runsPerMonth = 30;

  return (
    <div className="grid gap-3">
      <Panel title="Name it" help="Lowercase with hyphens reads best in run history and in the CLI.">
        <Input
          value={session.name || blueprint.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="h-8 text-body-sm"
        />
        <div className="mt-2">
          <Field label="Environment" help="Where it is created. Staging first is the safe default for a generated plan.">
            <Select
              options={[
                { value: "staging", label: "Staging" },
                { value: "development", label: "Development" },
                { value: "production", label: "Production" },
              ]}
              value={session.environment}
              onValueChange={(v) => patch({ environment: v })}
              aria-label="Environment"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Resource manifest" help="Everything the build will touch.">
        <ul className="grid gap-1.5">
          {manifest.entries.map((entry) => (
            <li key={`${entry.kind}-${entry.name}`} className="flex flex-wrap items-baseline gap-2">
              <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[10px] uppercase">
                {entry.kind}
              </span>
              <Text variant="body-sm" tone="primary" className="min-w-0 truncate">{entry.name}</Text>
              <Text variant="caption" tone="muted" className="min-w-0 flex-1 truncate">{entry.detail}</Text>
              {entry.existing ? (
                <Text variant="caption" tone="disabled" className="shrink-0">exists</Text>
              ) : (
                <Text variant="caption" tone="inherit" className="text-status-success shrink-0">new</Text>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Cost" help="At the schedule in the plan. The monthly figure is what shows up on a bill.">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Count label="Per run" value={formatCost(manifest.costPerRunUsd)} />
          <Count label="Per month" value={formatCost(manifest.costPerRunUsd * runsPerMonth)} />
          <Count label="Runs per month" value={runsPerMonth} />
          <Count label="Duration" value={formatDuration(manifest.durationMs)} />
        </div>
      </Panel>

      <Panel
        title="Permissions and risk"
        help="What this workflow will be able to do once it runs."
        tone={manifest.gates > 0 ? undefined : "warning"}
      >
        <Text variant="body-sm" tone="secondary" className="block">
          {manifest.gates > 0
            ? `${manifest.gates} approval ${manifest.gates === 1 ? "gate" : "gates"} — nothing leaves the workspace without a person deciding.`
            : "No approval gates. Every step runs unattended, including anything with an external effect."}
        </Text>
        <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
          Created in {session.environment} as a draft. Nothing runs until you publish it.
        </Text>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => patch({ stage: "connect" })}>Back</Button>
        <Button variant="primary" size="sm" onClick={() => patch({ stage: "build", built: 0, failedAt: null })}>
          Build it
        </Button>
      </div>
    </div>
  );
}

/* ── 6 · Build ────────────────────────────────────────────────────────────── */

function Build({ session, patch }: { session: Session; patch: (next: Partial<Session>) => void }) {
  const blueprint = session.blueprint;
  const steps = React.useMemo(
    () => (blueprint ? buildStepsFor(blueprint, manifestFor(blueprint)) : []),
    [blueprint],
  );

  React.useEffect(() => {
    if (session.built < 0 || session.built >= steps.length) {
      if (session.built >= steps.length && steps.length > 0) {
        const done = window.setTimeout(() => patch({ stage: "ready" }), 500);
        return () => window.clearTimeout(done);
      }
      return;
    }
    const next = window.setTimeout(() => patch({ built: session.built + 1 }), 520);
    return () => window.clearTimeout(next);
  }, [session.built, steps.length, patch]);

  return (
    <Panel
      title="Building"
      help="Each resource is created in order. If any one fails, everything already created is rolled back — a half-built workflow is worse than none."
    >
      <ol className="grid gap-1.5">
        {steps.map((step, i) => {
          const done = i < session.built;
          const running = i === session.built;
          return (
            <li key={step.id} className="flex items-center gap-2">
              <span className="shrink-0">
                {done ? (
                  <svg viewBox="0 0 12 12" className="text-status-success size-3.5" aria-hidden="true">
                    <path d="M2.5 6.4 5 8.8 9.5 3.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : running ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <span className="border-subtle block size-3 rounded-full border" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <Text variant="body-sm" tone={done || running ? "primary" : "disabled"} className="block">
                  {step.label}
                </Text>
                <Text variant="caption" tone="muted" className="block truncate">{step.detail}</Text>
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ── 7 · Ready ────────────────────────────────────────────────────────────── */

function Ready({ session }: { session: Session }) {
  const blueprint = session.blueprint;
  if (!blueprint) return null;
  const manifest = manifestFor(blueprint);
  const name = session.name || blueprint.name;

  return (
    <div className="grid gap-3">
      <Panel title="Created">
        <Text variant="heading-sm" tone="inherit" as="p" className="text-status-success block">
          {name} exists as a draft in {session.environment}
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Nothing is running yet. It has version 1 recorded, its graph written, and its connections
          bound — publishing is what starts it.
        </Text>

        <ul className="mt-3 grid gap-1">
          {manifest.entries.filter((e) => !e.existing).map((entry) => (
            <li key={`${entry.kind}-${entry.name}`} className="flex items-baseline gap-2">
              <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[10px] uppercase">
                {entry.kind}
              </span>
              <Text variant="body-sm" tone="secondary">{entry.name}</Text>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary" size="sm">
          <Link href={"/workflows" as Route}>Open in builder</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={"/workflows" as Route}>Run a simulation</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={"/workflows" as Route}>Review and publish</Link>
        </Button>
      </div>
    </div>
  );
}

/* ── Errors ───────────────────────────────────────────────────────────────── */

function ErrorPanel({
  code, onDismiss, onReturn,
}: {
  code: string;
  onDismiss: () => void;
  onReturn: (stage: StageId) => void;
}) {
  const error = ERRORS[code];
  if (!error) return null;

  return (
    <div className="border-status-failed-border bg-status-failed-subtle mb-4 rounded-md border p-3">
      <Text variant="body-sm" tone="inherit" className="text-status-failed block font-medium">
        {error.title}
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1 block">{error.detail}</Text>
      <Text variant="caption" tone="muted" className="mt-1 block">{error.fix}</Text>
      <div className="mt-2 flex gap-2">
        <Button size="xs" variant="secondary" onClick={() => onReturn(error.stage)}>
          Back to {STAGES.find((s) => s.id === error.stage)?.label}
        </Button>
        <Button size="xs" variant="ghost" onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function Panel({
  title, help, action, children, tone,
}: {
  title: string;
  help?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <section
      className={cn(
        "rounded-lg border",
        tone === "warning" ? "border-status-waiting-border bg-status-waiting-subtle" : "border-subtle bg-surface-raised",
      )}
    >
      <header className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <Text variant="eyebrow" tone="muted">{title}</Text>
          {help ? <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{help}</Text> : null}
        </div>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1">
      <Text variant="caption" tone="secondary">{label}</Text>
      {children}
      <Text variant="caption" tone="muted" className="leading-snug">{help}</Text>
    </label>
  );
}

function Count({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Text variant="caption" tone="muted" className="block">{label}</Text>
      <Text variant="body" tone="max" tabular className="block">{value}</Text>
    </div>
  );
}
