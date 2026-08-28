"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import {
  Brain, ArrowsClockwise, Wrench, ArrowsSplit, SealCheck, Broadcast,
  MagnifyingGlass, CheckCircle, WarningCircle, ArrowRight, ArrowLeft, Plus,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import { Slider } from "~/components/ui/slider";
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
import { SummaryList, SummaryRow, ConnectionPicker } from "./create-atoms";

/* ══════════════════════════════════════════════════════════════════════════════
   REGISTER AN AGENT

   Identity → Model → Instructions → Grants → Review.

   THE MODEL STEP IS MANDATORY FOR ONE TYPE AND OPTIONAL FOR THE REST, and that
   is the API's rule rather than a preference here: `AgentRoutes.create` calls
   `requireField` on instructions, modelName AND llmConnectionId when the type is
   `native_llm_agent`, and validates the connection is an LLM connection in the
   caller's workspace. The previous editor offered "Workspace default" as a
   connection, which produced a 400 that read as a bug in the product. There is
   no workspace default. If the type needs a connection, the form says so and
   refuses to advance.

   GRANTS ARE THE POINT OF THE SCREEN. An agent is a model plus a set of things
   it is allowed to do, and the second half is the part with consequences. The
   grant step therefore shows RISK, not just names, and says out loud when a
   selection lets the agent take an irreversible action with nobody watching.
   `allowedToolIds` is enforced by the engine — a tool that is not granted cannot
   be called, whatever the instructions ask for.
══════════════════════════════════════════════════════════════════════════════ */

type AgentType =
  | "native_llm_agent" | "iterative_agent" | "tool_agent"
  | "router_agent" | "approval_agent" | "external_instrumented_agent";
type Lifecycle = "active" | "paused" | "draft";

const AGENT_TYPES: {
  value: AgentType;
  label: string;
  description: string;
  icon: typeof Brain;
  /** True when the API requires model, instructions and an LLM connection. */
  needsModel: boolean;
}[] = [
  { value: "native_llm_agent", label: "Native LLM agent", description: "Reasons with a model and calls the tools it is granted. The default.", icon: Brain, needsModel: true },
  { value: "iterative_agent", label: "Iterative agent", description: "Loops until a stop condition holds, bounded by max iterations.", icon: ArrowsClockwise, needsModel: false },
  { value: "tool_agent", label: "Tool agent", description: "Executes a fixed tool sequence. No open-ended reasoning.", icon: Wrench, needsModel: false },
  { value: "router_agent", label: "Router agent", description: "Classifies the input and hands it to the right downstream branch.", icon: ArrowsSplit, needsModel: false },
  { value: "approval_agent", label: "Approval agent", description: "Prepares a decision for a person and waits on the gate.", icon: SealCheck, needsModel: false },
  { value: "external_instrumented_agent", label: "External agent", description: "Runs in your code. Vectorbea observes it through the SDK.", icon: Broadcast, needsModel: false },
];

/**
 * Model suggestions, by the provider of the chosen connection.
 *
 * Suggestions, not a closed list — the field stays free text, because a model id
 * ships before any UI knows about it and an operator locked out of a new model
 * by a dropdown will simply stop trusting the form.
 */
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  azure_openai: ["gpt-5", "gpt-4.1"],
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  mistral: ["mistral-large-latest", "mistral-small-latest"],
  cohere: ["command-r-plus"],
};

const RISK_DOT: Record<string, string> = {
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
};

const STEPS: ModalStep[] = [
  { id: "identity", label: "Identity", summary: "Name, role and behaviour type" },
  { id: "model", label: "Model", summary: "Connection, model and limits" },
  { id: "instructions", label: "Instructions", summary: "The system prompt" },
  { id: "grants", label: "Grants", summary: "Which tools it may call" },
  { id: "review", label: "Review", summary: "Check, then register" },
];

export interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (agent: contracts.Agent) => void;
}

export function CreateAgentDialog({ open, onOpenChange, onCreated }: CreateAgentDialogProps) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const [step, setStep] = React.useState(0);
  const [connections, setConnections] = React.useState<contracts.Connection[]>([]);
  const [tools, setTools] = React.useState<contracts.Tool[]>([]);
  const [loadingRefs, setLoadingRefs] = React.useState(true);

  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [type, setType] = React.useState<AgentType>("native_llm_agent");
  const [lifecycle, setLifecycle] = React.useState<Lifecycle>("active");

  const [connectionId, setConnectionId] = React.useState<string | null>(null);
  const [modelName, setModelName] = React.useState("");
  const [temperature, setTemperature] = React.useState(0.1);
  const [maxTokens, setMaxTokens] = React.useState("4096");
  const [maxIterations, setMaxIterations] = React.useState("10");

  const [instructions, setInstructions] = React.useState("");

  const [grants, setGrants] = React.useState<string[]>([]);
  const [toolQuery, setToolQuery] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoadingRefs(true);
    const params = { workspaceId: scope.workspaceId, environmentId: null, page: 1, pageSize: 100 };
    void Promise.all([api.connections.list(params), api.tools.list(params)])
      .then(([connectionPage, toolPage]) => {
        if (!alive) return;
        setConnections(connectionPage.items.filter((connection) => connection.type === "llm"));
        setTools(toolPage.items);
      })
      .catch(() => {
        if (!alive) return;
        setConnections([]);
        setTools([]);
      })
      .finally(() => { if (alive) setLoadingRefs(false); });
    return () => { alive = false; };
  }, [api, open, scope.workspaceId]);

  React.useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);

  /* ── Derived ────────────────────────────────────────────────────────────── */
  const spec = AGENT_TYPES.find((candidate) => candidate.value === type)!;
  const trimmedName = name.trim();
  const trimmedModel = modelName.trim();
  const trimmedInstructions = instructions.trim();

  const selectedConnection = connections.find((connection) => connection.id === connectionId) ?? null;
  const suggestions = selectedConnection ? MODEL_SUGGESTIONS[selectedConnection.provider] ?? [] : [];

  const maxTokensValue = Number(maxTokens);
  const maxIterationsValue = Number(maxIterations);
  const limitsValid =
    Number.isInteger(maxTokensValue) && maxTokensValue > 0 &&
    Number.isInteger(maxIterationsValue) && maxIterationsValue > 0;

  const grantedTools = tools.filter((tool) => grants.includes(tool.id));
  const ungatedRisky = grantedTools.filter(
    (tool) => !tool.requiresApproval && (tool.riskLevel === "high" || tool.riskLevel === "critical"),
  );

  const stepErrors: (string | null)[] = [
    !trimmedName ? "Give the agent a name. It is what a workflow node refers to." : null,
    spec.needsModel && !connectionId
      ? "A native LLM agent runs on a registered LLM connection. The API refuses the create without one."
      : spec.needsModel && !trimmedModel
        ? "Name the model this agent runs on — the API requires it for this type."
        : !limitsValid
          ? "Max tokens and max iterations must be whole numbers above zero."
          : null,
    spec.needsModel && !trimmedInstructions
      ? "A native LLM agent needs system instructions. This is what it will actually do."
      : null,
    null,
    null,
  ];

  const firstBroken = stepErrors.findIndex((entry) => entry !== null);
  const reachableIndex = firstBroken === -1 ? STEPS.length - 1 : firstBroken;
  const complete = firstBroken === -1;

  const visibleTools = React.useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter((tool) =>
      `${tool.name} ${tool.description ?? ""} ${tool.type} ${tool.riskLevel}`.toLowerCase().includes(query),
    );
  }, [tools, toolQuery]);

  /* ── Create ─────────────────────────────────────────────────────────────── */
  const create = useApiMutation<contracts.Agent, void>({
    mutationFn: async () => {
      return api.agents.create(
        {
          name: trimmedName,
          role: role.trim() || null,
          type,
          status: lifecycle,
          instructions: trimmedInstructions || null,
          // Sent as null rather than omitted for the optional types: the API
          // validates it only when present, and null is what "none" means.
          llmConnectionId: connectionId,
          modelName: trimmedModel || null,
          temperature,
          maxTokens: maxTokensValue,
          maxIterations: maxIterationsValue,
          allowedToolIds: grants,
          memoryPolicy: { type: "session" },
          retryPolicy: { maxAttempts: 2 },
          timeoutPolicy: { timeoutMs: 60_000 },
          approvalPolicy: {},
          outputSchema: {},
        },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
    },
    onSuccess: (agent) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agents.all({ workspaceId: scope.workspaceId, environmentId: null }),
      });
      onCreated?.(agent);
      onOpenChange(false);
    },
  });

  React.useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => {
      setStep(0);
      setName(""); setRole(""); setType("native_llm_agent"); setLifecycle("active");
      setConnectionId(null); setModelName(""); setTemperature(0.1);
      setMaxTokens("4096"); setMaxIterations("10");
      setInstructions(""); setGrants([]); setToolQuery("");
      create.reset();
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleGrant(id: string, granted: boolean) {
    setGrants((current) => (granted ? [...new Set([...current, id])] : current.filter((item) => item !== id)));
  }

  const railSteps: ModalStep[] = STEPS.map((entry, index) => ({
    ...entry,
    value:
      index === 0 ? (trimmedName || undefined)
        : index === 1 ? (trimmedModel || (spec.needsModel ? undefined : "Not model-backed"))
          : index === 2 ? (trimmedInstructions ? `${trimmedInstructions.length} characters` : undefined)
            : index === 3 ? (grants.length > 0 ? `${grants.length} tool${grants.length === 1 ? "" : "s"}` : "No grants")
              : undefined,
  }));

  const error = stepErrors[step];
  const busy = create.isPending;

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="xl" dismissible={!busy}>
      <ModalHeader
        eyebrow="Build · Agents"
        title="Register an agent"
        description="An agent is a reusable identity: a behaviour, a model, and an explicit set of tools it is allowed to call."
        closeDisabled={busy}
      />

      <ModalStepBar steps={railSteps} activeIndex={step} reachableIndex={reachableIndex} onSelect={setStep} />

      <ModalLayout
        rail={
          <ModalRail
            eyebrow="Registration"
            steps={railSteps}
            activeIndex={step}
            reachableIndex={reachableIndex}
            onSelect={setStep}
            footnote="Grants are enforced by the engine. An ungranted tool cannot be called, whatever the prompt says."
          />
        }
      >
        <ModalBody ref={bodyRef}>
          {step === 0 ? (
            <div className="grid gap-4">
              <ModalSection title="Identity" description="How this agent is referred to in workflows, runs and audit.">
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* The description is not decoration: its neighbour has one,
                      and a field without it sits a line higher than the field
                      beside it. Same-row fields keep the same header shape. */}
                  <Field
                    label="Name"
                    required
                    description="Renaming later is safe — workflows bind by id."
                    characterCount={{ value: name.length, max: 255 }}
                  >
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Renewal analyst"
                      maxLength={255}
                      autoComplete="off"
                      autoFocus
                    />
                  </Field>
                  <Field label="Role" description="Optional. One phrase, shown in the registry list.">
                    <Input
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                      placeholder="Reviews contracts and drafts outreach"
                      autoComplete="off"
                    />
                  </Field>
                </div>
                <Field label="Lifecycle" description="Draft agents cannot be attached to a running workflow.">
                  <Select
                    value={lifecycle}
                    onValueChange={(value) => setLifecycle(value as Lifecycle)}
                    options={[
                      { value: "active", label: "Active", description: "Usable now" },
                      { value: "paused", label: "Paused", description: "Registered, refuses work" },
                      { value: "draft", label: "Draft", description: "Not yet in service" },
                    ]}
                  />
                </Field>
              </ModalSection>

              <ModalDivider />

              <ModalSection title="Behaviour" description="How the engine drives it. Fixed at registration.">
                <OptionCards
                  label="Agent type"
                  columns={3}
                  value={type}
                  onValueChange={(value) => setType(value as AgentType)}
                  options={AGENT_TYPES.map((entry) => ({
                    value: entry.value,
                    label: entry.label,
                    description: entry.description,
                    icon: entry.icon,
                    badge: entry.needsModel ? (
                      <Text variant="caption" tone="muted">needs a model</Text>
                    ) : null,
                  }))}
                />
              </ModalSection>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <ModalSection
                title="LLM connection"
                description={
                  spec.needsModel
                    ? "Required for this agent type. Model calls are billed to the credential on the connection."
                    : "Optional for this agent type. Attach one if the behaviour makes model calls."
                }
              >
                {loadingRefs ? (
                  <div className="bg-surface-raised border-subtle h-20 animate-pulse rounded-md border" />
                ) : (
                  <ConnectionPicker
                    label="LLM connection"
                    connections={connections}
                    value={connectionId}
                    onValueChange={(next) => {
                      setConnectionId(next);
                      // The suggestions belong to the provider; a model id typed
                      // for one provider is meaningless on another, but clearing
                      // it silently would be worse. Only clear a suggestion.
                      if (next === null) return;
                      const provider = connections.find((c) => c.id === next)?.provider;
                      const previous = Object.values(MODEL_SUGGESTIONS).flat();
                      if (previous.includes(trimmedModel) && !(MODEL_SUGGESTIONS[provider ?? ""] ?? []).includes(trimmedModel)) {
                        setModelName("");
                      }
                    }}
                    allowNone={!spec.needsModel}
                    noneLabel="No model connection"
                    noneDescription="This agent does not call a model directly."
                    emptyTitle="No LLM connection in this workspace"
                    emptyBody="An agent cannot be created without one. Register the provider credential first — it is reused by every agent."
                  />
                )}
              </ModalSection>

              <ModalSection title="Model" description="The exact model id sent to the provider.">
                <Field
                  label="Model"
                  required={spec.needsModel}
                  description={
                    selectedConnection
                      ? `Sent to ${selectedConnection.provider.replace(/_/g, " ")} verbatim.`
                      : "Pick a connection first to see suggestions for that provider."
                  }
                >
                  <Input
                    mono
                    value={modelName}
                    onChange={(event) => setModelName(event.target.value)}
                    placeholder="claude-sonnet-5"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field>
                {suggestions.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Text variant="caption" tone="muted">Suggested</Text>
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setModelName(suggestion)}
                        className={cn(
                          "font-code text-mono-sm rounded-xs border px-1.5 py-0.5",
                          "transition-colors duration-instant outline-none focus-visible:focus-ring cursor-pointer",
                          trimmedModel === suggestion
                            ? "bg-accent-subtle text-accent border-accent-border"
                            : "bg-surface-hover border-subtle text-fg-secondary hover:text-fg-primary",
                        )}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </ModalSection>

              <ModalDivider />

              <ModalSection title="Limits" description="Persisted with the agent and enforced per run.">
                <Field
                  label="Temperature"
                  description="Low is repeatable, high is varied. Operational agents belong near zero."
                >
                  <Slider
                    value={[temperature]}
                    onValueChange={([next]) => setTemperature(next ?? 0)}
                    min={0}
                    max={2}
                    step={0.1}
                    format={(value) => value.toFixed(1)}
                    aria-label="Temperature"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Max tokens"
                    description="Per model call."
                    error={
                      !(Number.isInteger(maxTokensValue) && maxTokensValue > 0)
                        ? "Must be a whole number above zero."
                        : undefined
                    }
                  >
                    <Input mono type="number" min={1} value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} />
                  </Field>
                  <Field
                    label="Max iterations"
                    description="How many reason-and-call cycles before the engine stops it."
                    error={
                      !(Number.isInteger(maxIterationsValue) && maxIterationsValue > 0)
                        ? "Must be a whole number above zero."
                        : undefined
                    }
                  >
                    <Input mono type="number" min={1} value={maxIterations} onChange={(event) => setMaxIterations(event.target.value)} />
                  </Field>
                </div>
              </ModalSection>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4">
              <ModalSection
                title="System instructions"
                description="The standing brief. Say what the agent does, what it must not do, and what a good answer looks like."
              >
                <Field
                  label="Instructions"
                  required={spec.needsModel}
                  labelHidden
                  characterCount={{ value: instructions.length, max: 20000 }}
                >
                  <Textarea
                    mono
                    autoGrow={false}
                    minRows={14}
                    maxLength={20000}
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder={
                      "You review renewal contracts.\n\nFor each account:\n1. Look up the contract with the customer lookup tool.\n2. Summarise the terms that changed since the last renewal.\n3. Draft outreach. Never send it — a person approves every message."
                    }
                    autoFocus
                  />
                </Field>
              </ModalSection>

              <ModalNote title="Instructions are not enforcement">
                A prompt asking the agent not to call a tool is advice. The grant list on the next step
                is the control — an ungranted tool cannot be called at all.
              </ModalNote>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <ModalSection
                title="Tool grants"
                description="Only what you grant here can be called. Everything else is refused by the engine, silently and always."
                aside={
                  grants.length > 0 ? (
                    <Button variant="ghost" size="xs" onClick={() => setGrants([])}>
                      Clear {grants.length}
                    </Button>
                  ) : null
                }
              >
                {loadingRefs ? (
                  <div className="grid gap-2">
                    {[0, 1, 2].map((row) => (
                      <div key={row} className="bg-surface-raised border-subtle h-12 animate-pulse rounded-md border" />
                    ))}
                  </div>
                ) : tools.length === 0 ? (
                  <ModalNote tone="warning" title="No tools registered yet">
                    The agent can still be created — it will simply have nothing to call. Register a
                    tool and come back to grant it.
                  </ModalNote>
                ) : (
                  <>
                    <Input
                      value={toolQuery}
                      onChange={(event) => setToolQuery(event.target.value)}
                      placeholder="Filter by name, adapter or risk"
                      prefix={<Icon icon={MagnifyingGlass} size="sm" decorative />}
                      autoComplete="off"
                    />

                    <div className="border-subtle divide-subtle max-h-80 divide-y overflow-y-auto rounded-md border">
                      {visibleTools.length === 0 ? (
                        <div className="px-3 py-6 text-center">
                          <Text variant="body-sm" tone="muted">
                            No tool matches that. Clear the filter to see all {tools.length}.
                          </Text>
                        </div>
                      ) : (
                        visibleTools.map((tool) => {
                          const granted = grants.includes(tool.id);
                          return (
                            <label
                              key={tool.id}
                              className={cn(
                                "flex cursor-pointer items-start gap-3 px-3 py-2.5",
                                "transition-colors duration-fast",
                                granted ? "bg-surface-selected" : "hover:bg-surface-hover",
                              )}
                            >
                              <Checkbox
                                checked={granted}
                                onCheckedChange={(value) => toggleGrant(tool.id, value === true)}
                                aria-label={`Grant ${tool.name}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <Text variant="body-sm" tone="primary" className="font-medium">
                                    {tool.name}
                                  </Text>
                                  <span className="inline-flex items-center gap-1">
                                    <span
                                      aria-hidden="true"
                                      className={cn("size-1.5 rounded-full", RISK_DOT[tool.riskLevel] ?? RISK_DOT.low)}
                                    />
                                    <Text variant="caption" tone="muted" className="capitalize">
                                      {tool.riskLevel}
                                    </Text>
                                  </span>
                                  {tool.requiresApproval ? (
                                    <Text variant="caption" tone="muted">· approval gated</Text>
                                  ) : null}
                                </span>
                                <Text variant="caption" tone="muted" className="mt-0.5 block truncate">
                                  {tool.description ?? `${tool.type} tool`}
                                </Text>
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </ModalSection>

              {ungatedRisky.length > 0 ? (
                <ModalNote
                  tone="warning"
                  title={`${ungatedRisky.length} granted tool${ungatedRisky.length === 1 ? " is" : "s are"} high-risk with no approval gate`}
                >
                  {ungatedRisky.map((tool) => tool.name).join(", ")} can be called unattended by this
                  agent. Turn on the approval gate on the tool if that is not what you want.
                </ModalNote>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-4">
              <ModalSection title="What will be registered">
                <SummaryList>
                  <SummaryRow label="Name" onEdit={() => setStep(0)}>{trimmedName}</SummaryRow>
                  {role.trim() ? (
                    <SummaryRow label="Role" onEdit={() => setStep(0)}>{role.trim()}</SummaryRow>
                  ) : null}
                  <SummaryRow label="Type" onEdit={() => setStep(0)}>{spec.label}</SummaryRow>
                  <SummaryRow label="Connection" onEdit={() => setStep(1)}>
                    {selectedConnection ? `${selectedConnection.name} · ${selectedConnection.provider}` : "None"}
                  </SummaryRow>
                  <SummaryRow label="Model" mono onEdit={() => setStep(1)}>
                    {trimmedModel || "Not set"}
                  </SummaryRow>
                  <SummaryRow label="Limits" mono onEdit={() => setStep(1)}>
                    temp {temperature.toFixed(1)} · {maxTokensValue.toLocaleString()} tokens ·{" "}
                    {maxIterationsValue} iterations
                  </SummaryRow>
                  <SummaryRow label="Instructions" onEdit={() => setStep(2)}>
                    {trimmedInstructions
                      ? `${trimmedInstructions.split("\n")[0]!.slice(0, 90)}${trimmedInstructions.length > 90 ? "…" : ""}`
                      : "None"}
                  </SummaryRow>
                  <SummaryRow label="Grants" onEdit={() => setStep(3)}>
                    {grantedTools.length === 0
                      ? "No tools granted"
                      : grantedTools.map((tool) => tool.name).join(", ")}
                  </SummaryRow>
                </SummaryList>
              </ModalSection>

              {ungatedRisky.length > 0 ? (
                <ModalNote tone="warning" title="Unattended high-risk capability">
                  This agent will be able to call {ungatedRisky.map((tool) => tool.name).join(", ")}{" "}
                  without a human approval.
                </ModalNote>
              ) : null}

              {create.error ? (
                <ModalNote tone="danger" title="The agent was not registered">
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
                <Text variant="caption" tone="muted">Ready to register.</Text>
              </span>
            ) : step === 3 ? (
              <Text variant="caption" tone="muted">
                {grants.length === 0
                  ? "No grants yet — the agent can be created and granted tools later."
                  : `${grants.length} of ${tools.length} tools granted.`}
              </Text>
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
              loadingLabel="Registering"
              disabled={!complete}
              onClick={() => create.mutate()}
              iconLeft={<Icon icon={Plus} size="sm" decorative />}
            >
              Register agent
            </Button>
          )}
        </ModalFooter>
      </ModalLayout>
    </Modal>
  );
}
