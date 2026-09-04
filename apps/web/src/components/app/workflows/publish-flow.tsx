"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field } from "~/components/ui/field";
import { Select } from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { formatCost, formatDuration } from "~/lib/format";
import {
  currentVersion, liveVersion, draftVersion, versionsFor,
  diffVersions, summariseDiff, validateVersion, simulateVersion, publishImpact,
  type ValidationFinding, type SimulationResult,
} from "~/mocks/workflow-versions";
import type { VersionNode } from "~/mocks/workflow-nodes";
import { VersionGraph, GraphLegend, type NodePaint } from "./graph-canvas";
import { RelativeTime } from "./atoms";
import type { Environment, Workflow } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   PUBLISH FLOW — Draft → Validate → Simulate → Publish.

   Replaces a bare Save button. The distinction that matters: Save answers "is my
   work stored", and Publish answers "is it safe to point live traffic at this".
   One button cannot mean both, and in a durable-execution product the second
   question has consequences a person should have to look at.

   EACH STEP IS A GATE, NOT A TAB. You cannot reach Simulate with structural
   errors outstanding, and you cannot reach Publish without having simulated. A
   wizard whose steps are all clickable from the start is a wizard whose order
   means nothing — and the order here is the argument: know it is well-formed,
   then know what it will do, then decide.

   WARNINGS DO NOT BLOCK. Errors do. An idempotency key scoped to the run is
   worth saying and not worth stopping a deploy over, and a flow that treats
   every finding as fatal teaches people to click past all of them.
══════════════════════════════════════════════════════════════════════════════ */

type StepId = "draft" | "validate" | "simulate" | "publish";

const STEPS: { id: StepId; label: string; blurb: string }[] = [
  { id: "draft", label: "Draft", blurb: "What changed since the live version" },
  { id: "validate", label: "Validate", blurb: "Structure, bindings and credentials" },
  { id: "simulate", label: "Simulate", blurb: "A dry run with mocked tool calls" },
  { id: "publish", label: "Publish", blurb: "Summary, environment and blast radius" },
];

export function PublishFlow({ workflow }: { workflow: Workflow }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const live = liveVersion(workflow.id);
  const draft = draftVersion(workflow.id);
  const versions = versionsFor(workflow.id);
  // With no draft, the newest version IS the thing being reviewed — the flow
  // still runs, and its Publish step is honest that there is nothing to publish.
  const candidate = draft ?? currentVersion(workflow.id);

  const [simulation, setSimulation] = React.useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [target, setTarget] = React.useState<Environment>(workflow.environment);
  const [published, setPublished] = React.useState(false);
  const [focusNode, setFocusNode] = React.useState<string | null>(null);

  const nodes = React.useMemo(() => candidate?.nodes ?? [], [candidate]);
  const findings = React.useMemo(() => validateVersion(nodes), [nodes]);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  const diff = React.useMemo(
    () => (live && candidate ? diffVersions(live.nodes, candidate.nodes) : null),
    [live, candidate],
  );

  const nothingToPublish = draft === undefined;
  const reached: Record<StepId, boolean> = {
    draft: true,
    validate: true,
    simulate: errors.length === 0,
    publish: errors.length === 0 && simulation !== null,
  };

  /* The step lives in the URL, like every other view state in this product.
     A simulation result is exactly the thing somebody wants to link to — "here
     is what it costs, look before I ship it" — and a step held only in local
     state cannot be linked, bookmarked or reloaded.

     The gates still hold: a URL naming a step you have not earned falls back to
     the furthest one you have, so `?step=publish` on a workflow with structural
     errors lands on Validate rather than smuggling you past it. */
  const requested = (params.get("step") as StepId | null) ?? "draft";
  const step: StepId = STEPS.some((s) => s.id === requested) && reached[requested]
    ? requested
    : [...STEPS].reverse().find((s) => reached[s.id])!.id;

  const setStep = React.useCallback(
    (next: StepId) => {
      const search = new URLSearchParams(params.toString());
      if (next === "draft") search.delete("step");
      else search.set("step", next);
      const query = search.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}` as never, { scroll: false });
    },
    [params, pathname, router],
  );

  const runSimulation = () => {
    setSimulating(true);
    // A real dry run takes time; showing the result instantly would teach an
    // operator that Simulate does nothing. 700ms is long enough to read as work
    // and short enough not to be a wait.
    window.setTimeout(() => {
      setSimulation(simulateVersion(nodes));
      setSimulating(false);
    }, 700);
  };

  if (!candidate) {
    return (
      <PageContainer>
        <PageHeader title="Publish" description={workflow.name} />
        <Text variant="body-sm" tone="muted">This workflow has no versions to publish.</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link
            href={`/workflows/${workflow.id}` as Route}
            className="hover:text-fg-secondary rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring"
          >
            Build · Workflows · {workflow.name}
          </Link>
        }
        title={nothingToPublish ? "Review version" : `Publish v${candidate.number}`}
        description={
          nothingToPublish
            ? `There is no unpublished draft. This reviews v${candidate.number}, which is already live.`
            : "Every publish creates an immutable version record. Nothing here changes what is running until the last step."
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/workflows/${workflow.id}` as Route}>Cancel</Link>
          </Button>
        }
      />

      <StepRail current={step} reached={reached} onSelect={setStep} errorCount={errors.length} />

      <div className="mt-4 grid gap-4">
        {step === "draft" ? (
          <DraftStep
            workflow={workflow}
            candidate={candidate}
            live={live}
            diff={diff}
            versionCount={versions.length}
          />
        ) : null}

        {step === "validate" ? (
          <ValidateStep
            nodes={nodes}
            findings={findings}
            focusNode={focusNode}
            onFocusNode={setFocusNode}
            workflowId={workflow.id}
          />
        ) : null}

        {step === "simulate" ? (
          <SimulateStep
            nodes={nodes}
            simulation={simulation}
            simulating={simulating}
            onRun={runSimulation}
          />
        ) : null}

        {step === "publish" ? (
          <PublishStep
            workflow={workflow}
            candidate={candidate}
            diff={diff}
            simulation={simulation}
            warnings={warnings}
            note={note}
            onNote={setNote}
            target={target}
            onTarget={setTarget}
            published={published}
            nothingToPublish={nothingToPublish}
            onPublish={() => {
              setPublished(true);
              console.info("publish", workflow.id, candidate.number, target, note);
            }}
            onDone={() => router.push(`/workflows/${workflow.id}` as Route)}
          />
        ) : null}

        <StepFooter
          step={step}
          reached={reached}
          errors={errors.length}
          simulation={simulation}
          onBack={() => setStep(previousStep(step))}
          onNext={() => setStep(nextStep(step))}
        />
      </div>
    </PageContainer>
  );
}

function nextStep(step: StepId): StepId {
  const i = STEPS.findIndex((s) => s.id === step);
  return STEPS[Math.min(STEPS.length - 1, i + 1)].id;
}

function previousStep(step: StepId): StepId {
  const i = STEPS.findIndex((s) => s.id === step);
  return STEPS[Math.max(0, i - 1)].id;
}

/* ── Rail ─────────────────────────────────────────────────────────────────── */

function StepRail({
  current, reached, onSelect, errorCount,
}: {
  current: StepId;
  reached: Record<StepId, boolean>;
  onSelect: (step: StepId) => void;
  errorCount: number;
}) {
  return (
    <ol className="border-subtle bg-surface-raised grid gap-px rounded-lg border p-1 sm:grid-cols-4">
      {STEPS.map((step, i) => {
        const active = current === step.id;
        const open = reached[step.id];
        const currentIndex = STEPS.findIndex((s) => s.id === current);
        const done = open && i < currentIndex;

        return (
          <li key={step.id}>
            <button
              onClick={() => onSelect(step.id)}
              disabled={!open}
              aria-current={active ? "step" : undefined}
              // The gate has to say WHY, or a disabled step reads as broken.
              title={open ? undefined : step.id === "simulate"
                ? `Fix ${errorCount} validation ${errorCount === 1 ? "error" : "errors"} first`
                : "Run the simulation first"}
              className={cn(
                "grid w-full gap-0.5 rounded-md px-3 py-2 text-left",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                active ? "bg-surface-active" : open ? "hover:bg-surface-hover" : "cursor-not-allowed opacity-50",
              )}
            >
              <span className="flex items-center gap-2">
                <StepGlyph index={i} done={done} active={active} open={open} />
                {/* The glyph is aria-hidden, so without this the accessible name
                    is just "Validate" and a screen reader loses the position in
                    the sequence — which is the whole information a step rail
                    carries. */}
                <span className="sr-only">Step {i + 1}: </span>
                <span className={cn("font-ui text-body-sm", active ? "text-fg-max" : "text-fg-secondary")}>
                  {step.label}
                </span>
              </span>
              <span className="font-ui text-caption text-fg-muted">{step.blurb}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepGlyph({ index, done, active, open }: { index: number; done: boolean; active: boolean; open: boolean }) {
  return (
    <span
      className={cn(
        "font-code grid size-4 shrink-0 place-items-center rounded-full border text-[9px]",
        done ? "border-status-success text-status-success"
          : active ? "border-accent text-accent"
            : open ? "border-default text-fg-muted"
              : "border-subtle text-fg-disabled",
      )}
      aria-hidden="true"
    >
      {done ? (
        <svg viewBox="0 0 10 10" className="size-2.5">
          <path d="M2 5.2 4 7.2 8 3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : index + 1}
    </span>
  );
}

/* ── Step 1 · Draft ───────────────────────────────────────────────────────── */

function DraftStep({
  workflow, candidate, live, diff, versionCount,
}: {
  workflow: Workflow;
  candidate: NonNullable<ReturnType<typeof currentVersion>>;
  live: ReturnType<typeof liveVersion>;
  diff: ReturnType<typeof diffVersions> | null;
  versionCount: number;
}) {
  const paint = React.useCallback(
    (node: VersionNode): NodePaint => {
      if (!diff) return "default";
      if (diff.added.includes(node.id)) return "added";
      if (diff.modified.includes(node.id)) return "modified";
      return "unchanged";
    },
    [diff],
  );

  return (
    <Panel
      title="Draft"
      action={
        <Button asChild variant="ghost" size="xs">
          <Link href={`/workflows/${workflow.id}/versions` as Route}>Full version history</Link>
        </Button>
      }
    >
      <Text variant="body-sm" tone="primary" className="block">
        {live
          ? <>This is v{candidate.number}, sitting {candidate.number - live.number} version
            {candidate.number - live.number === 1 ? "" : "s"} ahead of the live v{live.number}.</>
          : <>This is v{candidate.number}. Nothing has ever been published for this workflow.</>}
      </Text>

      {diff ? (
        <>
          <Text variant="body-sm" tone="secondary" className="mt-1 block">{summariseDiff(diff)}</Text>
          <div className="mt-3">
            <GraphLegend states={["added", "modified", "unchanged"]} className="mb-1.5" />
            <VersionGraph
              nodes={candidate.nodes}
              paint={paint}
              label={`Draft v${candidate.number} graph`}
              height={230}
            />
          </div>
        </>
      ) : (
        <div className="mt-3">
          <VersionGraph nodes={candidate.nodes} label={`v${candidate.number} graph`} height={230} />
        </div>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        <Fact label="Author" value={candidate.author} />
        <Fact label="Last edited" value={<RelativeTime iso={candidate.at} />} />
        <Fact label="Steps" value={String(candidate.nodes.length)} />
        <Fact label="Versions in history" value={String(versionCount)} />
      </dl>
    </Panel>
  );
}

/* ── Step 2 · Validate ────────────────────────────────────────────────────── */

function ValidateStep({
  nodes, findings, focusNode, onFocusNode, workflowId,
}: {
  nodes: VersionNode[];
  findings: ValidationFinding[];
  focusNode: string | null;
  onFocusNode: (id: string | null) => void;
  workflowId: string;
}) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const offending = React.useMemo(
    () => new Set(findings.filter((f) => f.severity === "error").map((f) => f.nodeId)),
    [findings],
  );

  const paint = React.useCallback(
    (node: VersionNode): NodePaint => (offending.has(node.id) ? "invalid" : "default"),
    [offending],
  );

  return (
    <Panel title="Validate">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Text
          variant="body-sm"
          tone="inherit"
          className={errors.length > 0 ? "text-status-failed" : "text-status-success"}
        >
          {errors.length === 0
            ? "No structural errors."
            : `${errors.length} ${errors.length === 1 ? "error blocks" : "errors block"} publishing.`}
        </Text>
        {warnings.length > 0 ? (
          <Text variant="body-sm" tone="inherit" className="text-status-waiting">
            {warnings.length} {warnings.length === 1 ? "warning" : "warnings"} — worth reading, not blocking.
          </Text>
        ) : null}
      </div>

      {findings.length === 0 ? (
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Every node has a bound connection, the graph has one entry point and no unreachable steps,
          and every credential this workflow needs is present.
        </Text>
      ) : (
        <ul className="mt-3 grid gap-2">
          {[...errors, ...warnings].map((finding) => (
            <li key={finding.id}>
              <FindingCard
                finding={finding}
                focused={focusNode === finding.nodeId}
                onFocus={() => onFocusNode(finding.nodeId)}
                workflowId={workflowId}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <VersionGraph
          nodes={nodes}
          paint={paint}
          selectedId={focusNode}
          onSelect={(node) => onFocusNode(node.id)}
          label="Graph with validation errors marked"
          height={210}
        />
      </div>
    </Panel>
  );
}

function FindingCard({
  finding, focused, onFocus, workflowId,
}: {
  finding: ValidationFinding;
  focused: boolean;
  onFocus: () => void;
  workflowId: string;
}) {
  const isError = finding.severity === "error";

  return (
    <div
      className={cn(
        "rounded-md border p-2.5",
        isError
          ? "border-status-failed-border bg-status-failed-subtle"
          : "border-status-waiting-border bg-status-waiting-subtle",
        focused && "ring-2 ring-[var(--border-focus)]",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Text
          variant="caption"
          tone="inherit"
          className={cn("uppercase", isError ? "text-status-failed" : "text-status-waiting")}
        >
          {finding.severity}
        </Text>
        <Text variant="body-sm" tone="primary" className="font-medium">{finding.title}</Text>
      </div>

      <Text variant="body-sm" tone="secondary" className="mt-1 block">{finding.detail}</Text>
      {/* Errors state what happened AND how to fix it — never "invalid config". */}
      <Text variant="caption" tone="muted" className="mt-1 block">{finding.fix}</Text>

      {finding.nodeId ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="xs" variant="secondary" onClick={onFocus}>
            Show {finding.nodeName}
          </Button>
          <Button asChild size="xs" variant="ghost">
            <Link href={`/workflows/${workflowId}/builder?node=${finding.nodeId}` as Route}>
              Open in builder
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ── Step 3 · Simulate ────────────────────────────────────────────────────── */

function SimulateStep({
  nodes, simulation, simulating, onRun,
}: {
  nodes: VersionNode[];
  simulation: SimulationResult | null;
  simulating: boolean;
  onRun: () => void;
}) {
  const onPath = React.useMemo(
    () => new Set(simulation?.path ?? []),
    [simulation],
  );

  const paint = React.useCallback(
    (node: VersionNode): NodePaint => {
      if (!simulation) return "default";
      const step = simulation.steps.find((s) => s.nodeId === node.id);
      if (!step) return "default";
      if (step.skipped) return "skipped";
      if (step.gate) return "gate";
      return onPath.has(node.id) ? "path" : "default";
    },
    [simulation, onPath],
  );

  return (
    <Panel
      title="Simulate"
      action={
        simulation ? (
          <Button size="xs" variant="ghost" onClick={onRun} disabled={simulating}>
            Run again
          </Button>
        ) : null
      }
    >
      {!simulation ? (
        <div className="grid gap-3">
          <Text variant="body-sm" tone="secondary">
            A dry run executes the graph with every tool call mocked. Nothing is written, no message
            is sent and no money is spent — you get the path it takes, what it would cost, roughly
            how long it would take, and which gates would fire.
          </Text>
          <div>
            <Button variant="primary" size="sm" onClick={onRun} loading={simulating}>
              {simulating ? "Simulating" : "Run simulation"}
            </Button>
          </div>
          {simulating ? (
            <div className="flex items-center gap-2">
              <Spinner className="size-4" />
              <Text variant="caption" tone="muted">Walking {nodes.length} nodes with mocked tool calls…</Text>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-5 gap-y-1">
            <Fact label="Estimated cost" value={formatCost(simulation.estimatedCostUsd)} />
            <Fact label="Estimated duration" value={formatDuration(simulation.estimatedDurationMs)} />
            <Fact label="Mocked calls" value={String(simulation.mockedCalls)} />
            <Fact
              label="Gates that fire"
              value={String(simulation.gates.length)}
              tone={simulation.gates.length > 0 ? "waiting" : undefined}
            />
          </dl>

          {simulation.gates.length > 0 ? (
            <Text variant="body-sm" tone="inherit" className="text-status-waiting mt-2 block">
              {simulation.gates.length === 1 ? "One gate blocks" : `${simulation.gates.length} gates block`} this
              run on a person: {simulation.gates.map((g) => `${g.name} (${g.gate!.approverGroup}, ${g.gate!.slaMinutes}m SLA)`).join(", ")}.
              The estimated duration excludes the time they take to answer.
            </Text>
          ) : null}

          <div className="mt-3">
            <GraphLegend states={["path", "gate", "skipped"]} className="mb-1.5" />
            <VersionGraph nodes={nodes} paint={paint} label="Simulated execution path" height={210} />
          </div>

          <table className="mt-3 w-full">
            <caption className="sr-only">Simulated execution steps</caption>
            <thead>
              <tr className="border-subtle text-fg-muted font-ui text-eyebrow border-b uppercase">
                <th scope="col" className="py-1 pr-2 text-left font-normal">Step</th>
                <th scope="col" className="py-1 pr-2 text-left font-normal">Kind</th>
                <th scope="col" className="py-1 pr-2 text-right font-normal">Duration</th>
                <th scope="col" className="py-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {simulation.steps.map((step, i) => (
                <tr key={step.nodeId} className="border-subtle border-b last:border-b-0">
                  <td className="py-1 pr-2">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <Text variant="caption" tone="disabled" tabular>{i + 1}</Text>
                      <Text variant="caption" tone="secondary" className="truncate">{step.name}</Text>
                      {step.mocked ? (
                        <Text variant="caption" tone="disabled" className="text-[10px]">mocked</Text>
                      ) : null}
                    </span>
                    {step.branch ? (
                      <Text variant="caption" tone="muted" className="block">{step.branch}</Text>
                    ) : null}
                    {step.note ? (
                      <Text variant="caption" tone="muted" className="block">{step.note}</Text>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2">
                    <Text variant="mono-sm" tone="disabled">{step.kind}</Text>
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <Text variant="caption" tone="secondary" tabular>{formatDuration(step.durationMs)}</Text>
                  </td>
                  <td className="py-1 text-right">
                    <Text variant="caption" tone="secondary" tabular>{formatCost(step.costUsd)}</Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Text variant="caption" tone="muted" className="mt-2 block">
            Estimates, not measurements. Tool latency is modelled from this workspace&apos;s history and a
            real run will differ — the number worth trusting here is the shape of the path, not the
            fourth decimal place.
          </Text>
        </>
      )}
    </Panel>
  );
}

/* ── Step 4 · Publish ─────────────────────────────────────────────────────── */

function PublishStep({
  workflow, candidate, diff, simulation, warnings, note, onNote, target, onTarget,
  published, nothingToPublish, onPublish, onDone,
}: {
  workflow: Workflow;
  candidate: NonNullable<ReturnType<typeof currentVersion>>;
  diff: ReturnType<typeof diffVersions> | null;
  simulation: SimulationResult | null;
  warnings: ValidationFinding[];
  note: string;
  onNote: (value: string) => void;
  target: Environment;
  onTarget: (value: Environment) => void;
  published: boolean;
  nothingToPublish: boolean;
  onPublish: () => void;
  onDone: () => void;
}) {
  const impact = React.useMemo(
    () => publishImpact(workflow, candidate.nodes),
    [workflow, candidate.nodes],
  );

  if (published) {
    return (
      <Panel title="Published">
        <Text variant="heading-sm" tone="inherit" as="p" className="text-status-success block">
          v{candidate.number} is live in {target}
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          The version record is immutable from this moment: its nodes, its author, its change
          summary and the reliability it goes on to achieve are all attached to v{candidate.number}{" "}
          and cannot be edited. Runs already in flight finish on the version they started on.
        </Text>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={onDone}>Back to overview</Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/workflows/${workflow.id}/versions` as Route}>View version history</Link>
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Publish">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <Field
            label="Change summary"
            description="Generated from the diff so it cannot disagree with what is actually shipping."
          >
            <div className="border-subtle bg-surface-sunken rounded-md border px-2.5 py-2">
              <Text variant="body-sm" tone="primary">
                {diff ? summariseDiff(diff) : `Created with ${candidate.nodes.length} nodes.`}
              </Text>
            </div>
          </Field>

          <Field label="Target environment">
            <Select
              options={[
                { value: "production", label: "Production" },
                { value: "staging", label: "Staging" },
                { value: "development", label: "Development" },
              ]}
              value={target}
              onValueChange={(v) => onTarget(v as Environment)}
              aria-label="Target environment"
            />
          </Field>

          <Field
            label="Note (optional)"
            description="Why, not what. The what is in the summary above."
          >
            <Input
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Postgres was timing out during the month-end batch."
            />
          </Field>
        </div>

        <div className="grid gap-3">
          <ImpactPanel impact={impact} target={target} workflowEnv={workflow.environment} />

          {simulation ? (
            <div className="border-subtle rounded-md border p-3">
              <Text variant="eyebrow" tone="muted" className="block">From the simulation</Text>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                <Fact label="Cost per run" value={formatCost(simulation.estimatedCostUsd)} />
                <Fact label="Duration" value={formatDuration(simulation.estimatedDurationMs)} />
                <Fact label="Gates" value={String(simulation.gates.length)} />
              </dl>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="border-status-waiting-border bg-status-waiting-subtle rounded-md border p-3">
              <Text variant="eyebrow" tone="inherit" className="text-status-waiting block">
                Publishing with {warnings.length} unresolved {warnings.length === 1 ? "warning" : "warnings"}
              </Text>
              <ul className="mt-1.5 grid gap-1">
                {warnings.map((w) => (
                  <li key={w.id}>
                    <Text variant="caption" tone="secondary">
                      {w.nodeName ? `${w.nodeName} — ` : null}{w.title}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-subtle mt-4 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {nothingToPublish ? (
          <Text variant="caption" tone="muted">
            There is no draft ahead of the live version, so there is nothing to publish.
          </Text>
        ) : null}
        <Button variant="primary" size="sm" disabled={nothingToPublish} onClick={onPublish}>
          Publish v{candidate.number} to {target}
        </Button>
      </div>
    </Panel>
  );
}

/**
 * What starts pointing at the new version the moment you click.
 *
 * Schedules and endpoints are named individually rather than counted, because
 * "2 triggers affected" does not tell you that one of them fires in eleven
 * minutes.
 */
function ImpactPanel({
  impact, target, workflowEnv,
}: {
  impact: ReturnType<typeof publishImpact>;
  target: Environment;
  workflowEnv: Environment;
}) {
  const risky = impact.schedules.length > 0 || impact.endpoints.length > 0 || impact.liveRuns > 0;

  return (
    <div
      className={cn(
        "rounded-md border p-3",
        risky ? "border-status-waiting-border bg-status-waiting-subtle" : "border-subtle",
      )}
    >
      <Text
        variant="eyebrow"
        tone="inherit"
        className={cn("block", risky ? "text-status-waiting" : "text-fg-muted")}
      >
        What this affects
      </Text>

      <ul className="mt-2 grid gap-1.5">
        {impact.schedules.map((s) => (
          <li key={s.detail}>
            <Text variant="body-sm" tone="primary">{s.summary}</Text>
            <Text variant="caption" tone="muted" className="block">
              {s.nextFireAt ? <>Next fire <RelativeTime iso={s.nextFireAt} /> runs the new version.</> : "Runs the new version from now."}
            </Text>
          </li>
        ))}
        {impact.endpoints.map((e) => (
          <li key={e.detail}>
            <Text variant="body-sm" tone="primary">{e.summary}</Text>
            <Text variant="caption" tone="muted" className="block break-all font-code">{e.detail}</Text>
          </li>
        ))}
        {impact.liveRuns > 0 ? (
          <li>
            <Text variant="body-sm" tone="primary">
              {impact.liveRuns} {impact.liveRuns === 1 ? "run" : "runs"} in flight
            </Text>
            <Text variant="caption" tone="muted" className="block">
              They finish on the version they started on. Only runs that begin after this publish use
              the new one.
            </Text>
          </li>
        ) : null}
        {impact.unhealthyConnections.map((c) => (
          <li key={c.name}>
            <Text variant="body-sm" tone="inherit" className="text-status-failed">
              {c.name} is {c.status}
            </Text>
            <Text variant="caption" tone="muted" className="block">
              This version binds it. Publishing does not fix the connection.
            </Text>
          </li>
        ))}
        {target !== workflowEnv ? (
          <li>
            <Text variant="body-sm" tone="inherit" className="text-status-waiting">
              Publishing to {target}, not {workflowEnv}
            </Text>
            <Text variant="caption" tone="muted" className="block">
              Connections resolve against {target}, which may hold different credentials and
              different data.
            </Text>
          </li>
        ) : null}
        {!risky && impact.unhealthyConnections.length === 0 && target === workflowEnv ? (
          <li>
            <Text variant="body-sm" tone="secondary">
              Nothing is scheduled and no endpoint is exposed, so this publish changes nothing until
              somebody starts a run by hand.
            </Text>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function Panel({
  title, action, children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface-raised border-subtle rounded-lg border">
      <header className="border-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">{title}</Text>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Fact({
  label, value, tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "waiting";
}) {
  return (
    <div>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd>
        <Text
          variant="body-sm"
          tone={tone ? "inherit" : "primary"}
          tabular
          className={tone === "waiting" ? "text-status-waiting" : undefined}
        >
          {value}
        </Text>
      </dd>
    </div>
  );
}

function StepFooter({
  step, reached, errors, simulation, onBack, onNext,
}: {
  step: StepId;
  reached: Record<StepId, boolean>;
  errors: number;
  simulation: SimulationResult | null;
  onBack: () => void;
  onNext: () => void;
}) {
  if (step === "publish") return null;

  const next = nextStep(step);
  const blocked = !reached[next];
  const reason =
    next === "simulate" ? `Fix ${errors} validation ${errors === 1 ? "error" : "errors"} before simulating`
      : next === "publish" && simulation === null ? "Run the simulation before publishing"
        : undefined;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="secondary" size="sm" disabled={step === "draft"} onClick={onBack}>
        Back
      </Button>
      <div className="flex items-center gap-2">
        {blocked && reason ? <Text variant="caption" tone="muted">{reason}</Text> : null}
        <Button variant="primary" size="sm" disabled={blocked} onClick={onNext}>
          Continue to {STEPS.find((s) => s.id === next)?.label}
        </Button>
      </div>
    </div>
  );
}
