"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import {
  Sparkle, PencilSimpleLine, Cards, DownloadSimple, Play, Clock, ArrowSquareIn,
  Terminal, ShieldCheck, Broadcast, LinkSimple, CheckCircle, WarningCircle,
  ArrowRight, ArrowLeft,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { CronInput } from "~/components/ui/cron-input";
import { TimezonePicker } from "~/components/ui/timezone-picker";
import { MonoId } from "~/components/ui/mono-id";
import { OptionCards } from "~/components/ui/option-card";
import {
  Modal, ModalBody, ModalDivider, ModalFooter, ModalHeader, ModalLayout,
  ModalNote, ModalRail, ModalSection, ModalStepBar, type ModalStep,
} from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useApiMutation } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { evaluateCron } from "~/lib/cron";
import { SummaryList, SummaryRow } from "~/components/app/registry/create-atoms";

/* ══════════════════════════════════════════════════════════════════════════════
   NEW WORKFLOW

   Approach → Basics → Trigger → Review.

   THE FIRST STEP IS A FORK, NOT A FORM. There are four honest ways into a
   workflow — describe it to the Architect, build it by hand, start from a
   template, or import an existing LangGraph/Temporal graph — and three of them
   leave this dialog entirely. Burying them behind the manual form is what makes
   people hand-build something the Architect would have drafted in a minute.

   IT CREATES IN TWO CALLS, AND THAT IS THE API'S SHAPE. `POST /api/workflows`
   writes the row — name, slug, description, creationMode, status — and knows
   nothing about triggers. The trigger lives on a VERSION, and
   `POST /api/workflows/:id/versions` is also what materialises the `schedules`
   row through `syncSchedule`. A workflow created without a version is a workflow
   that will never fire, however carefully its cron was typed, so the second call
   is not optional and its failure is reported separately rather than folded into
   "creation failed" — the row genuinely exists at that point, and telling
   somebody otherwise sends them to create a duplicate.

   THE GRAPH IT WRITES IS THE SUPERSET DIALECT. `graph-codec.toStoredGraph`
   writes flat `type`/`label`/`config` for `worker-kotlin` AND `position`/`data`
   for the canvas, because each half of the product ignores the other's fields.
   The seed trigger node here is written the same way, so a workflow created by
   hand and one compiled by the Architect are the same object to both readers.
══════════════════════════════════════════════════════════════════════════════ */

type Approach = "architect" | "manual" | "template" | "import";
type CreationMode = "native" | "imported" | "instrumented" | "endpoint_only";
type TriggerKind = "manual" | "cron" | "webhook" | "api";

const CREATION_MODES: { value: CreationMode; label: string; description: string; icon: typeof Play }[] = [
  { value: "native", label: "Native", description: "Vectorbea executes every step. Full replay, checkpoints, approvals and retries.", icon: ShieldCheck },
  { value: "imported", label: "Imported", description: "Normalise an existing LangGraph or Temporal graph into a native workflow.", icon: DownloadSimple },
  { value: "instrumented", label: "Instrumented", description: "Execution stays in your code. The SDK streams events in for observability.", icon: Broadcast },
  { value: "endpoint_only", label: "Endpoint", description: "Trigger an endpoint you already run. Step-level detail is limited.", icon: LinkSimple },
];

const TRIGGERS: { value: TriggerKind; label: string; description: string; icon: typeof Play; next: string }[] = [
  { value: "manual", label: "Manual", description: "Someone presses run.", icon: Play, next: "Nothing else to set up — run it from the workflow page." },
  { value: "cron", label: "Schedule", description: "A cron expression, in a timezone you pick.", icon: Clock, next: "The schedule row is created with the first version and fires once you publish." },
  { value: "webhook", label: "Webhook", description: "An inbound HTTP call starts a run.", icon: ArrowSquareIn, next: "The endpoint and its signing secret are issued after the first publish." },
  { value: "api", label: "API", description: "Started programmatically with a workspace key.", icon: Terminal, next: "Call POST /api/workflows/:id/run with an API key." },
];

const DEFAULT_CRON = "0 9 * * 1-5";

function localTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/**
 * The seed graph: one trigger node and nothing else.
 *
 * An empty `{ nodes: [], edges: [] }` would validate too, but it opens the
 * builder onto a blank canvas with no entry point — and the trigger the operator
 * just chose would exist only in `triggerConfig`, invisible on the graph it is
 * supposed to start.
 */
function seedGraph(trigger: TriggerKind, label: string, config: Record<string, unknown>) {
  return {
    nodes: [
      {
        id: "trigger_1",
        // Flat fields for `worker-kotlin`'s WorkflowNode…
        type: "trigger",
        label,
        config,
        // …and the canvas dialect alongside them.
        position: { x: 120, y: 60 },
        data: { label, nodeType: "trigger", config, description: `Workflow trigger (${trigger})` },
      },
    ],
    edges: [],
  };
}

/**
 * `triggerConfig` as `syncSchedule` reads it.
 *
 * Both `triggerType` and `type` are written, and both `cronExpression` and
 * `cron`, because the two graph generations in this repo disagree about which
 * key they use. Writing one only is how a schedule silently fails to appear.
 */
function triggerConfigFor(trigger: TriggerKind, cron: string, timezone: string): Record<string, unknown> {
  if (trigger !== "cron") return { triggerType: trigger, type: trigger };
  return {
    triggerType: "cron",
    type: "cron",
    cronExpression: cron.trim(),
    cron: cron.trim(),
    timezone,
  };
}

const STEPS: ModalStep[] = [
  { id: "approach", label: "Approach", summary: "How you want to build it" },
  { id: "basics", label: "Basics", summary: "Name and execution mode" },
  { id: "trigger", label: "Trigger", summary: "What starts a run" },
  { id: "review", label: "Review", summary: "Check, then create" },
];

export interface CreateWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (workflow: contracts.Workflow) => void;
}

export function CreateWorkflowDialog({ open, onOpenChange, onCreated }: CreateWorkflowDialogProps) {
  const api = useApi();
  const router = useRouter();
  const scope = useScope();
  const queryClient = useQueryClient();
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const [step, setStep] = React.useState(0);
  const [approach, setApproach] = React.useState<Approach>("manual");

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [mode, setMode] = React.useState<CreationMode>("native");

  const [trigger, setTrigger] = React.useState<TriggerKind>("manual");
  const [cron, setCron] = React.useState(DEFAULT_CRON);
  const [timezone, setTimezone] = React.useState<string | null>(null);

  /** Set when the row was written but its first version was not. */
  const [versionError, setVersionError] = React.useState<string | null>(null);

  // Resolved on the client only: reading Intl during render would differ between
  // the server pass and the first client one and trip a hydration warning.
  React.useEffect(() => { setTimezone(localTimezone()); }, []);
  React.useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);

  const zone = timezone ?? "UTC";
  const trimmedName = name.trim();
  const cronValid = trigger !== "cron" || evaluateCron(cron, zone, 1).valid;

  const stepErrors: (string | null)[] = [
    approach !== "manual" ? "Pick a way to start." : null,
    !trimmedName ? "Give the workflow a name. It is what you will search for in run history." : null,
    !cronValid
      ? "That is not a five-field cron expression. Use minute hour day month weekday — 0 9 * * 1-5 is 09:00 on weekdays."
      : null,
    null,
  ];

  const firstBroken = stepErrors.findIndex((entry) => entry !== null);
  const reachableIndex = firstBroken === -1 ? STEPS.length - 1 : firstBroken;
  const complete = firstBroken === -1;

  /* ── Create ─────────────────────────────────────────────────────────────── */

  /**
   * The version outcome travels back as part of the RESULT, not through state.
   *
   * A `setVersionError` inside `mutationFn` has not been committed by the time
   * `onSuccess` reads it, so the routing decision below would be made against
   * the previous render's value — and would cheerfully open a builder for a
   * workflow that has no graph. Returning it removes the race entirely.
   */
  const create = useApiMutation<{ workflow: contracts.Workflow; versionFailure: string | null }, void>({
    mutationFn: async () => {
      const writeScope = { workspaceId: scope.workspaceId, environmentId: null };

      const workflow = await api.workflows.create(
        {
          name: trimmedName,
          description: description.trim() || null,
          creationMode: mode,
          status: "draft",
        },
        writeScope,
      );

      // Separate failure, separately reported. The workflow exists by now, and
      // telling somebody "creation failed" would send them to create a second.
      let versionFailure: string | null = null;
      try {
        const label = TRIGGERS.find((entry) => entry.value === trigger)?.label ?? "Start";
        const config = triggerConfigFor(trigger, cron, zone);
        await api.workflows.createVersion(
          workflow.id,
          { graph: seedGraph(trigger, label, config), triggerConfig: config },
          writeScope,
        );
      } catch (error) {
        versionFailure =
          error instanceof Error ? error.message : "The first version could not be written.";
      }

      return { workflow, versionFailure };
    },
    onSuccess: ({ workflow, versionFailure }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.all({ workspaceId: scope.workspaceId, environmentId: null }),
      });
      onCreated?.(workflow);

      if (versionFailure) {
        // No first version means no graph for the builder to open. The detail
        // page is the honest destination, and the warning stays on screen.
        setVersionError(versionFailure);
        router.push(`/workflows/${workflow.id}` as Route);
        return;
      }

      if (mode === "imported") {
        router.push(`/workflows/import?workflowId=${workflow.id}` as Route);
      } else if (mode === "native") {
        router.push(`/workflows/${workflow.id}/builder` as Route);
      } else {
        router.push(`/workflows/${workflow.id}` as Route);
      }
      onOpenChange(false);
    },
  });

  React.useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => {
      setStep(0);
      setApproach("manual");
      setName(""); setDescription(""); setMode("native");
      setTrigger("manual"); setCron(DEFAULT_CRON);
      setVersionError(null);
      create.reset();
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Leaving for another surface. Close first so the route change is not animated over. */
  function leaveFor(route: Route) {
    onOpenChange(false);
    router.push(route);
  }

  const railSteps: ModalStep[] = STEPS.map((entry, index) => ({
    ...entry,
    value:
      index === 0 ? "Build it yourself"
        : index === 1 ? (trimmedName || undefined)
          : index === 2 ? (trigger === "cron" ? cron.trim() : TRIGGERS.find((t) => t.value === trigger)?.label)
            : undefined,
  }));

  const error = stepErrors[step];
  const busy = create.isPending;

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="xl" dismissible={!busy}>
      <ModalHeader
        eyebrow="Build · Workflows"
        title="New workflow"
        description="It starts as a draft. Nothing runs until you publish."
        closeDisabled={busy}
      />

      <ModalStepBar steps={railSteps} activeIndex={step} reachableIndex={reachableIndex} onSelect={setStep} />

      <ModalLayout
        rail={
          <ModalRail
            eyebrow="New workflow"
            steps={railSteps}
            activeIndex={step}
            reachableIndex={reachableIndex}
            onSelect={setStep}
            
          />
        }
      >
        <ModalBody ref={bodyRef}>
          {step === 0 ? (
            <div className="grid gap-4">
              <ArchitectCard onOpen={() => leaveFor("/workflows/new/architect" as Route)} />

              <ModalDivider />

              <ModalSection title="Or start another way">
                <OptionCards
                  label="Approach"
                  columns={1}
                  value={approach}
                  onValueChange={(value) => {
                    const next = value as Approach;
                    setApproach(next);
                    if (next === "template") leaveFor("/templates" as Route);
                    if (next === "import") leaveFor("/workflows/import" as Route);
                  }}
                  options={[
                    {
                      value: "manual",
                      label: "Build it yourself",
                      description: "Name it, pick a trigger, and lay out the graph on the canvas.",
                      icon: PencilSimpleLine,
                    },
                    {
                      value: "template",
                      label: "Start from a template",
                      description: "A working workflow you can adapt. Opens the template catalogue.",
                      icon: Cards,
                    },
                    {
                      value: "import",
                      label: "Import an existing graph",
                      description: "Normalise a LangGraph or Temporal definition. Opens the importer.",
                      icon: DownloadSimple,
                    },
                  ]}
                />
              </ModalSection>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <ModalSection title="Identity" >
                <Field label="Name" required characterCount={{ value: name.length, max: 255 }}>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Renewal outreach"
                    maxLength={255}
                    autoComplete="off"
                    autoFocus
                  />
                </Field>
                <Field label="Description" description="Optional.">
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Finds contracts renewing in the next 30 days and drafts outreach for each account."
                    minRows={2}
                    maxRows={5}
                  />
                </Field>
              </ModalSection>

              <ModalDivider />

              <ModalSection
                title="Execution mode"
                description="Where the steps run."
              >
                <OptionCards
                  label="Execution mode"
                  columns={2}
                  value={mode}
                  onValueChange={(value) => setMode(value as CreationMode)}
                  options={CREATION_MODES.map((entry) => ({
                    value: entry.value,
                    label: entry.label,
                    description: entry.description,
                    icon: entry.icon,
                  }))}
                />
                {mode !== "native" ? (
                  <ModalNote tone="info" title="Reduced step-level guarantees">
                    Replay, checkpoints and per-step retries only apply to steps Vectorbea executes.
                    In {CREATION_MODES.find((entry) => entry.value === mode)?.label.toLowerCase()} mode
                    it records what your code reports.
                  </ModalNote>
                ) : null}
              </ModalSection>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4">
              <ModalSection title="Trigger" description="What starts a run.">
                <OptionCards
                  label="Trigger"
                  columns={2}
                  value={trigger}
                  onValueChange={(value) => setTrigger(value as TriggerKind)}
                  options={TRIGGERS.map((entry) => ({
                    value: entry.value,
                    label: entry.label,
                    description: entry.description,
                    icon: entry.icon,
                  }))}
                />
                <Text variant="caption" tone="muted" className="block leading-snug">
                  {TRIGGERS.find((entry) => entry.value === trigger)?.next}
                </Text>
              </ModalSection>

              {trigger === "cron" ? (
                <>
                  <ModalDivider />
                  <ModalSection title="Schedule" description="Uses the time zone below.">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
                      <Field label="Cron expression" required>
                        <CronInput value={cron} onValueChange={setCron} timezone={zone} />
                      </Field>
                      <Field label="Timezone" description="Defaults to yours.">
                        <TimezonePicker value={timezone} onValueChange={setTimezone} />
                      </Field>
                    </div>
                  </ModalSection>
                </>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <ModalSection title="What will be created">
                <SummaryList>
                  <SummaryRow label="Name" onEdit={() => setStep(1)}>{trimmedName}</SummaryRow>
                  {description.trim() ? (
                    <SummaryRow label="Description" onEdit={() => setStep(1)}>{description.trim()}</SummaryRow>
                  ) : null}
                  <SummaryRow label="Execution" onEdit={() => setStep(1)}>
                    {CREATION_MODES.find((entry) => entry.value === mode)?.label}
                  </SummaryRow>
                  <SummaryRow label="Trigger" onEdit={() => setStep(2)}>
                    {TRIGGERS.find((entry) => entry.value === trigger)?.label}
                  </SummaryRow>
                  {trigger === "cron" ? (
                    <>
                      <SummaryRow label="Cron" mono onEdit={() => setStep(2)}>{cron.trim()}</SummaryRow>
                      <SummaryRow label="Timezone" onEdit={() => setStep(2)}>{zone}</SummaryRow>
                    </>
                  ) : null}
                  <SummaryRow label="Status">Draft — nothing runs until you publish</SummaryRow>
                </SummaryList>
              </ModalSection>

              <ModalNote title="Two writes, one action">
                The workflow row is created first, then its first version — which is what carries the
                trigger and, for a schedule, creates the schedule row. Both are reported here.
              </ModalNote>

              {versionError ? (
                <ModalNote tone="warning" title="The workflow exists, but its first version does not">
                  {versionError} Open it and save once on the canvas to write a version.
                </ModalNote>
              ) : null}

              {create.error ? (
                <ModalNote tone="danger" title="The workflow was not created">
                  {create.error.message}
                  {create.error.requestId ? (
                    <span className="mt-1 flex items-center gap-1.5">
                      Request <MonoId value={create.error.requestId} head={8} tail={4} />
                    </span>
                  ) : null}
                </ModalNote>
              ) : null}
            </div>
          ) : null}
        </ModalBody>

        <ModalFooter
          hint={
            error ? (
              <span className="flex items-start gap-1.5">
                <Icon icon={WarningCircle} size="sm" decorative className="text-status-waiting mt-px" />
                <Text variant="caption" tone="muted" className="leading-snug">{error}</Text>
              </span>
            ) : step === STEPS.length - 1 ? (
              <span className="flex items-center gap-1.5">
                <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />
                <Text variant="caption" tone="muted">
                  {mode === "native" ? "Creates the draft and opens the canvas." : "Creates the draft."}
                </Text>
              </span>
            ) : null
          }
        >
          {step > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setStep((current) => current - 1)}
              iconLeft={<Icon icon={ArrowLeft} size="sm" decorative />}
            >
              Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={Boolean(error)}
              onClick={() => setStep((current) => current + 1)}
              iconRight={<Icon icon={ArrowRight} size="sm" decorative />}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              loadingLabel="Creating"
              disabled={!complete}
              onClick={() => create.mutate()}
            >
              {mode === "native" ? "Create and open builder" : "Create workflow"}
            </Button>
          )}
        </ModalFooter>
      </ModalLayout>
    </Modal>
  );
}

/* ── The recommended path ─────────────────────────────────────────────────── */

const ARCHITECT_POINTS = [
  "Designs the agents, tools and connections it needs",
  "Shows you the plan before it builds anything",
  "Reveals the workflow on the canvas step by step",
  "Simulation first — no real calls until you say so",
];

/**
 * The Architect, given the room it earns.
 *
 * Deliberately NOT one of the option cards below it: it is not a peer choice,
 * it leaves this dialog, and it is the answer for most people opening this
 * screen for the first time. The dotted field is the builder canvas, quoted at
 * a glance — the only decoration on the surface, and it is doing a job.
 */
function ArchitectCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group border-subtle bg-surface-raised block w-full overflow-hidden rounded-lg border text-left",
        "transition-colors duration-fast ease-standard",
        "hover:border-accent-border hover:bg-surface-hover cursor-pointer",
        "outline-none focus-visible:focus-ring",
      )}
    >
      <div
        className="border-subtle bg-surface-sunken flex items-center gap-3 border-b px-4 py-3.5"
        style={{
          backgroundImage: "radial-gradient(var(--color-edge-subtle) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        <span
          aria-hidden="true"
          className="border-accent-border bg-surface-base text-accent flex size-9 shrink-0 items-center justify-center rounded-md border"
        >
          <Icon icon={Sparkle} size="lg" weight="bold" decorative />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Text variant="heading-sm" tone="max">AI Workflow Architect</Text>
            <span className="border-accent-border bg-accent-subtle text-accent rounded-full border px-2 py-0.5">
              <Text variant="caption">Recommended</Text>
            </span>
          </span>
          <Text variant="caption" tone="muted" className="mt-0.5 block">
            Describe the outcome in plain English. It designs the rest.
          </Text>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "text-fg-muted shrink-0 transition-transform duration-fast ease-standard",
            "motion-safe:group-hover:translate-x-0.5",
          )}
        >
          <Icon icon={ArrowRight} size="md" decorative />
        </span>
      </div>

      <div className="px-4 py-3">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {ARCHITECT_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2">
              {/* The checkpoint diamond, at 6px. Square corners rather than a
                  radius: the scale starts at 4px (§8), which on a 6px box
                  rounds the mark into a dot and loses the shape entirely. */}
              <span
                aria-hidden="true"
                className="border-accent-border mt-1 size-1.5 shrink-0 rotate-45 border-2"
              />
              <Text variant="caption" tone="secondary" className="leading-snug">{point}</Text>
            </li>
          ))}
        </ul>
      </div>
    </button>
  );
}
