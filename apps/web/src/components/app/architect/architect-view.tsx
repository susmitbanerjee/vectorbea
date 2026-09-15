"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { MonoId } from "~/components/ui/mono-id";
import { formatPercent } from "~/lib/format";
import { planToBlueprint, manifestForPlan, type Manifest } from "~/lib/architect/blueprint";
import type {
  ArchitectPlan, ClarifyQuestion, ConnectionRequirement,
  ReadinessIssue, WorkspaceConnectionOption,
} from "~/lib/architect/types";
import type { ArchitectFailure } from "~/lib/architect/errors";
import { useBlueprintStream, BlueprintCanvas, RationaleList } from "./blueprint-stream";
import {
  useArchitectSession, STAGES,
  type ArchitectSessionApi, type StageId,
} from "./use-architect-session";

/* ══════════════════════════════════════════════════════════════════════════════
   AI WORKFLOW ARCHITECT

   Seven stages against the real `/api/architect/*` pipeline: a session is
   created from the description, the model asks only the questions it genuinely
   needs, the plan comes back and is drawn as it assembles, connections are
   bound to real workspace credentials, and the build creates real tools, real
   agents, a real workflow and its first version.

   TWO THINGS DECIDE WHETHER A GENERATED PLAN IS TRUSTED, and both are on screen
   rather than implied:

   · RATIONALE PER DECISION. Every node says why it is there. A generated graph
     is a claim; a generated graph that names the part of your description each
     step came from is something you can check.
   · WHAT WILL BE CREATED, BEFORE IT IS. The manifest in Review is the exact
     resource list the build touches. Nothing outside it is written.

   THE QUOTA IS SHOWN BEFORE THE PROMPT BOX, not after three paragraphs of
   effort — one build per rolling window per workspace is a limit that has to be
   discovered before the work, not at submission.
══════════════════════════════════════════════════════════════════════════════ */

const EXAMPLE_PROMPTS = [
  {
    id: "renewals",
    label: "Renewal outreach",
    text: "Every morning, find contracts renewing in the next 30 days, draft outreach for each account, and post the batch to #billing-ops for a human to approve before anything is sent.",
  },
  {
    id: "refunds",
    label: "Refund approvals",
    text: "When a refund over £500 is requested, pull the invoice and the account history, then ask billing to approve it before issuing the refund.",
  },
  {
    id: "triage",
    label: "Ticket triage",
    text: "Classify every inbound support ticket by urgency and route anything urgent to the on-call rota in Slack.",
  },
  {
    id: "digest",
    label: "Failure digest",
    text: "At the end of each day, collect failed runs, group them by root cause, and post the top three to the engineering channel.",
  },
];

/** Below this, the description is too thin for the model to design against. */
const MIN_PROMPT = 24;
const MAX_PROMPT = 2000;

/**
 * An instant, rendered deterministically in UTC.
 *
 * NOT `<RelativeTime>` from `~/components/app/workflows/atoms`: that one is
 * pinned to a FROZEN clock (`NOW = 2026-08-11T14:20:00Z`) so the fixture
 * screens produce identical screenshots on every capture run. Pointing it at a
 * real quota reset date would render a confidently wrong "in 26d".
 *
 * A live relative time cannot be rendered here either — `Date.now()` differs
 * between the server render and the client one, which React reports as a
 * hydration mismatch. UTC is the honest middle: the same string on both sides,
 * and unambiguous about which clock it is in.
 */
function InstantUtc({ iso }: { iso: string }) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  });
  return <time dateTime={iso}>{date} at {time} UTC</time>;
}

export function ArchitectView() {
  const session = useArchitectSession();
  const { state } = session;
  const [selectedNode, setSelectedNode] = React.useState<string | null>(null);

  const stageIndex = STAGES.findIndex((s) => s.id === state.stage);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link
            href={"/workflows/new" as Route}
            className="rounded-xs outline-none transition-colors duration-fast hover:text-fg-secondary focus-visible:focus-ring"
          >
            Build · New workflow
          </Link>
        }
        title="AI Architect"
        description="Describe what you want to automate. The Architect proposes a workflow and builds it when you approve."
        actions={
          state.stage !== "describe" ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={state.busy !== null}
              onClick={() => { session.reset(); setSelectedNode(null); }}
            >
              Start over
            </Button>
          ) : null
        }
      />

      <StageRail current={state.stage} index={stageIndex} />

      <div className="mt-4 grid gap-3">
        {state.failure ? (
          <FailurePanel failure={state.failure} onDismiss={session.dismissFailure} />
        ) : null}

        {state.busy === "resuming" ? (
          <Panel title="Restoring your session">
            <span className="flex items-center gap-2">
              <Spinner className="size-4" />
              <Text variant="body-sm" tone="secondary">
                Reading the plan back from the server, so nothing you approved is lost.
              </Text>
            </span>
          </Panel>
        ) : null}

        {state.stage === "describe" ? <Describe session={session} /> : null}
        {state.stage === "analyze" ? <Analyze session={session} /> : null}
        {state.stage === "blueprint" ? (
          <BlueprintStage session={session} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
        ) : null}
        {state.stage === "connect" ? <Connect session={session} /> : null}
        {state.stage === "review" ? <Review session={session} /> : null}
        {state.stage === "build" ? <Build session={session} /> : null}
        {state.stage === "ready" ? <Ready session={session} /> : null}
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

function Describe({ session }: { session: ArchitectSessionApi }) {
  const { state, usage } = session;
  const exhausted = usage ? usage.remaining <= 0 : false;
  const tooShort = state.prompt.trim().length < MIN_PROMPT;
  const tooLong = state.prompt.length > MAX_PROMPT;
  const blocked = exhausted;

  return (
    <div className="grid gap-3">
      {/* Quota BEFORE the prompt box, never after the effort. */}
      <QuotaBanner session={session} exhausted={exhausted} />

      <Panel
        title="Describe the workflow"
        help="Plain English. Say what starts it, what should happen, and where a person needs to decide."
      >
        <Textarea
          value={state.prompt}
          onChange={(e) => session.setPrompt(e.target.value)}
          disabled={blocked}
          minRows={6}
          maxRows={14}
          maxLength={MAX_PROMPT}
          placeholder="Every morning, find contracts renewing in the next 30 days…"
          aria-label="Describe the workflow"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Text variant="caption" tone="muted" className="mr-1">Start from:</Text>
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example.id}
              type="button"
              disabled={blocked}
              // Populates the box rather than navigating. Sending somebody away
              // from a half-written prompt to look at an example is how the
              // work gets lost.
              onClick={() => session.setPrompt(example.text)}
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
        {tooShort && !blocked ? (
          <Text variant="caption" tone="muted">
            A sentence or two works better than a phrase — the plan is only as specific as the description.
          </Text>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          loading={state.busy === "starting" || state.busy === "planning"}
          disabled={blocked || tooShort || tooLong}
          onClick={() => void session.start()}
        >
          Analyse the description
        </Button>
      </div>
    </div>
  );
}

function QuotaBanner({ session, exhausted }: { session: ArchitectSessionApi; exhausted: boolean }) {
  const { usage, usageLoading } = session;

  // No allowance figure is better than a made-up one: the endpoint is the only
  // authority on it, and showing "1 of 1 left" while the real answer is unknown
  // is how somebody spends effort against a quota they had already used.
  if (usageLoading) {
    return (
      <div className="border-subtle bg-surface-raised rounded-md border px-3 py-2">
        <span className="flex items-center gap-2">
          <Spinner className="size-3.5" />
          <Text variant="body-sm" tone="secondary">Checking this workspace&rsquo;s build allowance…</Text>
        </span>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="border-subtle bg-surface-raised rounded-md border px-3 py-2">
        <Text variant="body-sm" tone="secondary">
          The build allowance could not be read. You can still describe a workflow — the limit is
          enforced when you build, and a spent allowance is reported then rather than guessed now.
        </Text>
      </div>
    );
  }

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
            ? "You have used this workspace's Architect build for the period."
            : `${usage.remaining} of ${usage.limit} Architect ${usage.limit === 1 ? "build" : "builds"} left.`}
        </Text>
        {exhausted ? (
          <Button asChild size="sm" variant="primary">
            <Link href={"/settings/billing" as Route}>Upgrade</Link>
          </Button>
        ) : null}
      </div>
      <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
        {exhausted ? (
          <>
            {usage.resetAt ? <>The next one is available <InstantUtc iso={usage.resetAt} />. </> : null}
            You can still build workflows by hand or from a template — the quota applies only to
            generated plans.
          </>
        ) : (
          <>
            Only a completed build counts against it. Describing, planning, revising and discarding
            cost nothing, so it is worth iterating before you build.
          </>
        )}
      </Text>
    </div>
  );
}

/* ── 2 · Analyze ──────────────────────────────────────────────────────────── */

/**
 * What the model needs to know before it can design.
 *
 * The API asks zero questions for a clear goal and up to five for a vague one,
 * so this stage is either a form or a progress panel — never a fake list of
 * findings scrolling past while a request is in flight.
 */
function Analyze({ session }: { session: ArchitectSessionApi }) {
  const { state } = session;
  const planning = state.busy === "planning";

  if (state.questions.length === 0) {
    return (
      <Panel
        title="Designing the workflow"
        help="The description was specific enough to design against, so the Architect went straight to the plan."
      >
        <WorkingRow
          label={planning ? "Designing the graph, its agents and the connections it needs…" : "Waiting to start."}
          busy={planning}
        />
        {!planning ? (
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={() => void session.generatePlan()}>
              Generate the plan
            </Button>
          </div>
        ) : null}
      </Panel>
    );
  }

  const unanswered = state.questions.filter((q) => !(state.answers[q.question] ?? "").trim()).length;

  return (
    <div className="grid gap-3">
      <Panel
        title={`${state.questions.length} question${state.questions.length === 1 ? "" : "s"} before designing`}
        help="Answer what you can. Anything you skip becomes an assumption."
      >
        <ol className="grid gap-3">
          {state.questions.map((question, index) => (
            <QuestionRow
              key={question.question}
              index={index}
              question={question}
              value={state.answers[question.question] ?? ""}
              disabled={planning}
              onChange={(value) => session.setAnswer(question.question, value)}
            />
          ))}
        </ol>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={planning}
          onClick={() => session.goToStage("describe")}
        >
          Back to the description
        </Button>
        <span className="flex flex-wrap items-center gap-2">
          {unanswered > 0 && !planning ? (
            <Text variant="caption" tone="muted">
              {unanswered} unanswered — the Architect will assume a sensible default and say so in the plan.
            </Text>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            loading={planning}
            onClick={() => void session.generatePlan()}
          >
            Generate the plan
          </Button>
        </span>
      </div>
    </div>
  );
}

function QuestionRow({
  index, question, value, disabled, onChange,
}: {
  index: number;
  question: ClarifyQuestion;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <li className="border-subtle grid gap-1.5 rounded-md border p-2.5">
      <div className="flex gap-2">
        <Text variant="caption" tone="muted" className="font-code mt-0.5 shrink-0">{index + 1}</Text>
        <div className="min-w-0">
          <Text variant="body-sm" tone="primary" className="block">{question.question}</Text>
          {question.why ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{question.why}</Text>
          ) : null}
        </div>
      </div>

      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your answer (optional)"
        aria-label={question.question}
      />

      {question.suggestions && question.suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {question.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => onChange(suggestion)}
              className={cn(
                "font-ui text-caption border-subtle text-fg-secondary rounded-full border px-2 py-0.5",
                "hover:border-accent-border hover:text-accent transition-colors duration-fast",
                "outline-none focus-visible:focus-ring disabled:opacity-50",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/* ── 3 · Blueprint ────────────────────────────────────────────────────────── */

function BlueprintStage({
  session, selectedNode, onSelectNode,
}: {
  session: ArchitectSessionApi;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const { state } = session;
  const blueprint = React.useMemo(() => planToBlueprint(state.plan), [state.plan]);
  const { landed, phase, skip, total } = useBlueprintStream(blueprint, blueprint !== null);
  const [instruction, setInstruction] = React.useState("");

  if (!state.plan) {
    return (
      <Panel title="No plan yet">
        <Text variant="body-sm" tone="secondary" className="block">
          The session has no plan on it. Go back and generate one.
        </Text>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => session.goToStage("analyze")}>
            Back
          </Button>
        </div>
      </Panel>
    );
  }

  if (!blueprint) {
    return (
      <Panel title="The plan has no steps">
        <Text variant="body-sm" tone="secondary" className="block max-w-[68ch]">
          The Architect returned a plan with no workflow steps in it. That is a generation failure
          rather than a real design — revise it below, or start over with a description that names
          the actions you want taken.
        </Text>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => session.goToStage("describe")}>
            Rewrite the description
          </Button>
        </div>
      </Panel>
    );
  }

  const selected = blueprint.nodes.find((n) => n.id === selectedNode) ?? null;
  const streaming = phase !== "done";
  const busy = state.busy === "revising" || state.busy === "approving";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid min-w-0 gap-3">
        <Panel
          title={blueprint.name}
          help={streaming
            ? "Assembling the plan. Steps land in execution order; approval gates land last."
            : "Every step, with why it is there. Nothing here has been created yet — this is a proposal."}
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

        {!streaming ? <PlanSummary plan={state.plan} /> : null}
      </div>

      <div className="grid min-w-0 gap-3">
        <Panel title="Why each step" help="Each one names the part of your description it came from.">
          <RationaleList
            blueprint={blueprint}
            landed={landed}
            selectedId={selectedNode}
            onSelect={onSelectNode}
          />
        </Panel>

        {selected && !streaming ? (
          <Panel title={`Step — ${selected.kind}`}>
            <Text variant="body-sm" tone="primary" className="block">{selected.name}</Text>
            <Text variant="caption" tone="muted" className="mt-1 block leading-snug">{selected.rationale}</Text>
            {Object.keys(selected.config).length > 0 ? (
              <dl className="mt-2 grid gap-1">
                {Object.entries(selected.config).map(([key, value]) => (
                  <div key={key} className="flex flex-wrap items-baseline gap-2">
                    <dt><Text variant="caption" tone="muted">{key}</Text></dt>
                    <dd className="min-w-0">
                      <Text variant="caption" tone="secondary" className="font-code truncate">
                        {typeof value === "object" ? JSON.stringify(value) : String(value)}
                      </Text>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </Panel>
        ) : null}

        {!streaming ? (
          <Panel
            title="Change something"
            help="Say what to change in plain English. The Architect rewrites the plan — it does not start over."
          >
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={busy}
              minRows={2}
              maxRows={5}
              placeholder="Add an approval before the Slack post."
              aria-label="Revision instruction"
            />
            <div className="mt-2">
              <Button
                size="xs"
                variant="secondary"
                loading={state.busy === "revising"}
                disabled={busy || !instruction.trim()}
                onClick={async () => { await session.revise(instruction); setInstruction(""); }}
              >
                Revise the plan
              </Button>
            </div>
          </Panel>
        ) : null}

        {!streaming ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => session.reset()}>
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={state.busy === "approving"}
              disabled={busy}
              onClick={() => void session.approve()}
            >
              Approve and continue
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlanSummary({ plan }: { plan: ArchitectPlan }) {
  const notes = plan.safetyNotes ?? [];
  return (
    <Panel title="What the Architect understood" help="Check this against what you asked for.">
      {plan.goalSummary ? (
        <Text variant="body-sm" tone="secondary" className="block max-w-[80ch]">{plan.goalSummary}</Text>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {plan.trigger ? (
          <Count label="Trigger" value={plan.trigger.description || plan.trigger.type} />
        ) : null}
        {typeof plan.confidence === "number" ? (
          <Count label="Confidence" value={formatPercent(plan.confidence * 100, 0)} />
        ) : null}
        <Count label="Steps" value={(plan.workflowSteps ?? []).length} />
      </div>

      {notes.length > 0 ? (
        <div className="mt-3">
          <Text variant="caption" tone="muted" className="mb-1 block">Safety notes</Text>
          <ul className="grid gap-1">
            {notes.map((note) => (
              <li key={note} className="flex items-start gap-2">
                <span className="bg-status-waiting mt-[7px] size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                <Text variant="caption" tone="secondary" className="leading-snug">{note}</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

/* ── 4 · Connect ──────────────────────────────────────────────────────────── */

/**
 * Credentials cannot be generated, so this is the one stage the Architect
 * cannot do for you. It is also the stage most likely to send somebody away to
 * create a connection — which is exactly why the session is resumable.
 */
function Connect({ session }: { session: ArchitectSessionApi }) {
  const { state } = session;
  const [options, setOptions] = React.useState<WorkspaceConnectionOption[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void session.connectionOptions().then((result) => {
      if (!cancelled) setOptions(result);
    });
    return () => { cancelled = true; };
    // Loaded once per stage entry: the list is the workspace's connections, not
    // per-requirement, and refetching it per row would be N identical requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requirements = state.requirements;
  const blocking = requirements.filter(
    (r) => r.requiredForSimulation && !isSatisfied(r),
  );

  if (requirements.length === 0) {
    return (
      <div className="grid gap-3">
        <Panel title="No connections needed">
          <Text variant="body-sm" tone="secondary" className="block max-w-[68ch]">
            Nothing in this plan reaches outside the workspace, so there are no credentials to
            supply. It can be built and simulated straight away.
          </Text>
        </Panel>
        <StageNav
          session={session}
          back="blueprint"
          next="review"
          nextLabel="Continue to review"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <Panel
        title="Connections this workflow needs"
        help="Pick an existing connection, or simulate one and connect it later."
      >
        <ul className="grid gap-2">
          {requirements.map((requirement) => (
            <RequirementRow
              key={requirement.id}
              requirement={requirement}
              options={options}
              session={session}
            />
          ))}
        </ul>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={state.busy !== null}
          onClick={() => session.goToStage("blueprint")}
        >
          Back
        </Button>
        <span className="flex flex-wrap items-center gap-2">
          {blocking.length > 0 ? (
            <Text variant="caption" tone="muted">
              {blocking.length} still needed before this can even be simulated
            </Text>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            disabled={state.busy !== null || blocking.length > 0}
            onClick={() => session.goToStage("review")}
          >
            Continue to review
          </Button>
        </span>
      </div>
    </div>
  );
}

function isSatisfied(requirement: ConnectionRequirement): boolean {
  return ["selected_existing", "created", "test_passed", "simulation_placeholder"].includes(
    requirement.status,
  );
}

const REQUIREMENT_STATE: Record<
  ConnectionRequirement["status"],
  { tone: "success" | "waiting" | "failed" | "idle"; label: string }
> = {
  missing: { tone: "idle", label: "Not connected" },
  selected_existing: { tone: "success", label: "Bound" },
  created: { tone: "success", label: "Created" },
  test_pending: { tone: "waiting", label: "Testing" },
  test_failed: { tone: "failed", label: "Test failed" },
  test_passed: { tone: "success", label: "Tested" },
  simulation_placeholder: { tone: "waiting", label: "Simulated" },
};

function RequirementRow({
  requirement, options, session,
}: {
  requirement: ConnectionRequirement;
  options: WorkspaceConnectionOption[] | null;
  session: ArchitectSessionApi;
}) {
  const { state } = session;
  const rowBusy = state.busyRequirementId === requirement.id;
  const status = REQUIREMENT_STATE[requirement.status] ?? REQUIREMENT_STATE.missing;

  /* Preferred-type matches first: the API returns every connection and ranks
     rather than filters, because the model's type names ("http_api") and the
     stored ones ("http") do not always agree, and filtering on that mismatch is
     how a workspace with the right connection is told it has none. */
  const ranked = React.useMemo(() => {
    if (!options) return null;
    const type = (requirement.type ?? "").toLowerCase();
    const matches = (option: WorkspaceConnectionOption) => {
      const stored = (option.type ?? "").toLowerCase();
      return option.typeMatches ?? (stored === type || stored.includes(type) || type.includes(stored));
    };
    return [...options].sort((a, b) => Number(matches(b)) - Number(matches(a)));
  }, [options, requirement.type]);

  return (
    <li className="border-subtle grid gap-2 rounded-md border p-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <StatusDot tone={status.tone} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <Text variant="body-sm" tone="primary">{requirement.name}</Text>
            <Text variant="caption" tone="muted" className="font-code">{requirement.type}</Text>
            <Text
              variant="caption"
              tone="inherit"
              className={cn(
                status.tone === "success" ? "text-status-success"
                  : status.tone === "failed" ? "text-status-failed"
                    : status.tone === "waiting" ? "text-status-waiting" : "text-fg-muted",
              )}
            >
              {status.label}
            </Text>
          </span>
          {requirement.description ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
              {requirement.description}
            </Text>
          ) : null}
          {requirement.testError ? (
            <Text variant="caption" tone="inherit" className="text-status-failed mt-0.5 block leading-snug">
              {requirement.testError}
            </Text>
          ) : null}
          {!requirement.requiredForSimulation ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
              Only needed for real runs — the workflow can be simulated without it.
            </Text>
          ) : null}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ranked === null ? (
          <Text variant="caption" tone="muted">Loading connections…</Text>
        ) : ranked.length === 0 ? (
          <Button asChild size="xs" variant="primary">
            <Link href={"/connections/new" as Route}>Create a connection</Link>
          </Button>
        ) : (
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <Select
              size="sm"
              options={ranked.map((option) => ({
                value: option.id,
                label: option.name,
                description: [option.type, option.status].filter(Boolean).join(" · "),
              }))}
              value={requirement.boundConnectionId ?? undefined}
              disabled={rowBusy}
              placeholder="Bind a connection…"
              aria-label={`Connection for ${requirement.name}`}
              onValueChange={(value) => void session.bind(requirement.id, value)}
            />
          </div>
        )}

        {requirement.boundConnectionId ? (
          <Button
            size="xs"
            variant="secondary"
            loading={rowBusy && state.busy === "testing"}
            disabled={rowBusy}
            onClick={() => void session.test(requirement.id)}
          >
            Test
          </Button>
        ) : null}

        <Button
          size="xs"
          variant="ghost"
          disabled={rowBusy || requirement.status === "simulation_placeholder"}
          onClick={() => void session.useSimulation(requirement.id)}
        >
          {requirement.status === "simulation_placeholder" ? "Simulated" : "Simulate instead"}
        </Button>

        {rowBusy ? <Spinner className="size-3.5" /> : null}
      </div>
    </li>
  );
}

function StatusDot({ tone }: { tone: "success" | "waiting" | "failed" | "idle" }) {
  return (
    <span
      className={cn(
        "mt-[6px] size-2 shrink-0 rounded-full",
        tone === "success" ? "bg-status-success"
          : tone === "failed" ? "bg-status-failed"
            : tone === "waiting" ? "bg-status-waiting" : "bg-fg-disabled",
      )}
      aria-hidden="true"
    />
  );
}

/* ── 5 · Review ───────────────────────────────────────────────────────────── */

function Review({ session }: { session: ArchitectSessionApi }) {
  const { state } = session;
  const bound = React.useMemo(
    () => new Set(state.requirements.filter(isSatisfied).map((r) => r.tempConnectionId)),
    [state.requirements],
  );
  const manifest = React.useMemo(() => manifestForPlan(state.plan, bound), [state.plan, bound]);

  if (!state.plan) return null;

  const gates = manifest.gates;
  const simulatedOnly = state.requirements.filter((r) => r.status === "simulation_placeholder");

  return (
    <div className="grid gap-3">
      <Panel title="Name" help="What it is called in the list, in run history and in alerts.">
        <Text variant="heading-sm" tone="max" as="p" className="block">{state.plan.workflowName}</Text>
        {state.plan.workflowDescription ? (
          <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[80ch]">
            {state.plan.workflowDescription}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
          The Architect names the workflow from the plan. Rename it on the canvas afterwards — a
          rename here would not match the graph it is about to compile.
        </Text>
      </Panel>

      <Panel title="What will be created" help="The exact resource list. Nothing outside it is touched.">
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
          <Count label="Agents" value={manifest.agents} />
          <Count label="Tools" value={manifest.tools} />
          <Count label="Connections" value={manifest.connections} />
          <Count label="Approval gates" value={manifest.gates} />
        </div>
        <ManifestList manifest={manifest} />
      </Panel>

      <Panel
        title="Permissions and risk"
        help="What this workflow will be able to do once it runs."
        tone={gates > 0 ? undefined : "warning"}
      >
        <Text variant="body-sm" tone="secondary" className="block max-w-[80ch]">
          {gates > 0
            ? `${gates} approval ${gates === 1 ? "gate" : "gates"} — nothing past ${gates === 1 ? "it" : "them"} runs without a person deciding.`
            : "No approval gates. Every step runs unattended, including anything with an effect outside the workspace."}
        </Text>
        {simulatedOnly.length > 0 ? (
          <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
            {simulatedOnly.length} connection{simulatedOnly.length === 1 ? " is" : "s are"} simulated,
            so {simulatedOnly.length === 1 ? "that step" : "those steps"} cannot make a real call until
            you bind real credentials.
          </Text>
        ) : null}
        <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
          Created as a draft. Nothing runs until you publish it.
        </Text>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={state.busy !== null}
          onClick={() => session.goToStage("connect")}
        >
          Back
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={state.busy === "building"}
          disabled={state.busy !== null}
          onClick={() => void session.build()}
        >
          Build it
        </Button>
      </div>
    </div>
  );
}

function ManifestList({ manifest }: { manifest: Manifest }) {
  if (manifest.entries.length === 0) {
    return (
      <Text variant="body-sm" tone="secondary" className="block">
        The plan creates no resources of its own — every step binds to something that already exists.
      </Text>
    );
  }

  return (
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
          ) : entry.blocking ? (
            <Text variant="caption" tone="inherit" className="text-status-waiting shrink-0">needed</Text>
          ) : (
            <Text variant="caption" tone="inherit" className="text-status-success shrink-0">new</Text>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── 6 · Build ────────────────────────────────────────────────────────────── */

/**
 * One request does the whole build server-side — tools, agents, the graph, the
 * workflow row and its first version, under a per-workspace advisory lock. So
 * this is honest about being a single long operation rather than pretending to
 * tick through steps it is not actually observing.
 */
function Build({ session }: { session: ArchitectSessionApi }) {
  const { state } = session;
  const building = state.busy === "building";

  return (
    <div className="grid gap-3">
      <Panel
        title="Building"
        help="Everything is created together. If any part fails, nothing is created."
      >
        <WorkingRow
          label={building
            ? "Creating tools and agents, compiling the graph, recording version 1…"
            : "The build did not complete."}
          busy={building}
        />

        {state.buildSteps.length > 0 ? (
          <ol className="mt-3 grid gap-1.5">
            {state.buildSteps.map((step, index) => (
              <li key={`${step.sequence ?? index}-${step.title}`} className="flex items-start gap-2">
                <svg viewBox="0 0 12 12" className="text-status-success mt-[3px] size-3.5 shrink-0" aria-hidden="true">
                  <path d="M2.5 6.4 5 8.8 9.5 3.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="min-w-0">
                  <Text variant="body-sm" tone="primary" className="block">{step.title}</Text>
                  {step.description ? (
                    <Text variant="caption" tone="muted" className="block leading-snug">{step.description}</Text>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </Panel>

      {!building ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => session.goToStage("review")}>
            Back to review
          </Button>
          <Button variant="primary" size="sm" onClick={() => void session.build()}>
            Try the build again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ── 7 · Ready ────────────────────────────────────────────────────────────── */

function Ready({ session }: { session: ArchitectSessionApi }) {
  const { state } = session;
  const created = state.created;
  if (!created) return null;

  const errors = state.readinessIssues.filter((i) => i.severity === "error");
  const warnings = state.readinessIssues.filter((i) => i.severity === "warning");
  const infos = state.readinessIssues.filter((i) => i.severity === "info");

  return (
    <div className="grid gap-3">
      <Panel title="Created">
        <Text variant="heading-sm" tone="inherit" as="p" className="text-status-success block">
          {created.workflowName} exists as a draft
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block max-w-[80ch]">
          {created.toolsCreated ?? 0} tool{created.toolsCreated === 1 ? "" : "s"} and{" "}
          {created.agentsCreated ?? 0} agent{created.agentsCreated === 1 ? "" : "s"} were registered,
          the graph was compiled and version 1 is recorded. Nothing is running — publishing is what
          starts it.
        </Text>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Text variant="caption" tone="muted">Workflow id</Text>
          <MonoId value={created.workflowId} srLabel="Workflow id" />
        </div>

        {created.readinessStatus ? (
          <div className="mt-2">
            <Text variant="caption" tone="muted">
              Readiness:{" "}
              <Text
                variant="caption"
                tone="inherit"
                as="span"
                className={created.readinessStatus === "real_ready" ? "text-status-success" : "text-status-waiting"}
              >
                {created.readinessStatus === "real_ready" ? "ready for real runs"
                  : created.readinessStatus === "simulation_ready" ? "ready to simulate"
                    : "needs connections"}
              </Text>
            </Text>
          </div>
        ) : null}
      </Panel>

      {errors.length + warnings.length + infos.length > 0 ? (
        <Panel
          title="Before it can run for real"
          help="Reported by the server after the build, against the graph it actually compiled."
          tone={errors.length > 0 ? "warning" : undefined}
        >
          <ul className="grid gap-1.5">
            {[...errors, ...warnings, ...infos].map((issue) => (
              <IssueRow key={`${issue.code}-${issue.message}`} issue={issue} />
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary" size="sm">
          <Link href={"/workflows" as Route}>Back to workflows</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={"/connections" as Route}>Manage connections</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => session.reset()}>
          Start another
        </Button>
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: ReadinessIssue }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-[7px] size-1.5 shrink-0 rounded-full",
          issue.severity === "error" ? "bg-status-failed"
            : issue.severity === "warning" ? "bg-status-waiting" : "bg-fg-disabled",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <Text variant="body-sm" tone="secondary" className="block leading-snug">{issue.message}</Text>
        <Text variant="caption" tone="disabled" className="font-code block">{issue.code}</Text>
      </span>
    </li>
  );
}

/* ── Failures ─────────────────────────────────────────────────────────────── */

function FailurePanel({ failure, onDismiss }: { failure: ArchitectFailure; onDismiss: () => void }) {
  return (
    <div role="alert" className="border-status-failed-border bg-status-failed-subtle rounded-md border p-3">
      <Text variant="body-sm" tone="inherit" className="text-status-failed block font-medium">
        {failure.title}
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[80ch]">{failure.detail}</Text>
      <Text variant="caption" tone="muted" className="mt-1 block leading-snug">{failure.fix}</Text>

      {failure.usage?.resetAt ? (
        <Text variant="caption" tone="muted" className="mt-1 block">
          Next build <InstantUtc iso={failure.usage.resetAt} />.
        </Text>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="xs" variant="ghost" onClick={onDismiss}>Dismiss</Button>
        {failure.reference ? (
          <Text variant="caption" tone="disabled" className="font-code">{failure.reference}</Text>
        ) : null}
      </div>
    </div>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function StageNav({
  session, back, next, nextLabel,
}: {
  session: ArchitectSessionApi;
  back: StageId;
  next: StageId;
  nextLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="secondary" size="sm" onClick={() => session.goToStage(back)}>Back</Button>
      <Button variant="primary" size="sm" onClick={() => session.goToStage(next)}>{nextLabel}</Button>
    </div>
  );
}

function WorkingRow({ label, busy }: { label: string; busy: boolean }) {
  return (
    <span className="flex items-center gap-2">
      {busy ? <Spinner className="size-4" /> : null}
      <Text variant="body-sm" tone={busy ? "secondary" : "muted"}>{label}</Text>
    </span>
  );
}

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
        tone === "warning"
          ? "border-status-waiting-border bg-status-waiting-subtle"
          : "border-subtle bg-surface-raised",
      )}
    >
      <header className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <Text variant="eyebrow" tone="muted">{title}</Text>
          {help ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{help}</Text>
          ) : null}
        </div>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Notice({
  tone, title, children,
}: {
  tone: "failed" | "waiting";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border p-2.5",
        tone === "failed"
          ? "border-status-failed-border bg-status-failed-subtle"
          : "border-status-waiting-border bg-status-waiting-subtle",
      )}
    >
      <Text
        variant="body-sm"
        tone="inherit"
        className={cn("block font-medium", tone === "failed" ? "text-status-failed" : "text-status-waiting")}
      >
        {title}
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-0.5 block leading-snug">{children}</Text>
    </div>
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
