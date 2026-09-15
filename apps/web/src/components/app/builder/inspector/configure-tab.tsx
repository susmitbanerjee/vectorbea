"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/choice";
import { Button } from "~/components/ui/button";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { TYPE_LABEL } from "~/mocks/io-schema";
import { nodeInputs } from "./node-inputs";
import { Section, Field } from "./fields";
import { TeamConfigPanel } from "./team-config";
import {
  useBuilderRegistry, resolveTool, resolveAgent, resolveConnection,
} from "../use-builder-registry";
import type { VersionNode } from "~/mocks/workflow-nodes";
import type { RiskLevel } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   CONFIGURE — identity, resource binding, and type-specific settings.

   THE RESOURCE PICKER SHOWS RISK AND HEALTH, not just names. Choosing a tool is
   the moment where the policy consequences are decided — a critical-risk tool
   picked here is what makes the canvas demand an approval gate upstream — so
   the risk tier belongs in the picker rather than three screens away in the
   registry.
══════════════════════════════════════════════════════════════════════════════ */

const RISK_TONE: Record<RiskLevel, string> = {
  low: "text-risk-low border-subtle",
  medium: "text-risk-medium border-status-waiting-border",
  high: "text-risk-high border-status-waiting-border",
  critical: "text-risk-critical border-status-failed-border",
};

export function ConfigureTab({
  node, onChange,
}: {
  node: VersionNode;
  onChange: (patch: { name?: string; config?: Record<string, unknown> }) => void;
}) {
  /**
   * Write SEVERAL config keys in one patch.
   *
   * `set` spreads `node.config` as captured by the current render, so two
   * `set` calls in one handler both build their patch from the same starting
   * config and the second silently discards the first. That was invisible while
   * every control wrote a single key; binding a tool writes four (`toolId`,
   * `toolName`, `toolType`, `connectionId`) and only the last one survived, so
   * the picker appeared to do nothing at all.
   */
  const setMany = (patch: Record<string, unknown>) =>
    onChange({ config: { ...node.config, ...patch } });

  const set = (key: string, value: unknown) => setMany({ [key]: value });

  return (
    <div className="grid gap-4 p-3">
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <Section title="Identity" help="How this step is named everywhere it appears — the canvas, the run timeline, and the version diff.">
        <Field label="Step label" help="A verb phrase reads best: what this step does, not what it is.">
          <Input
            value={node.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-7 text-body-sm"
          />
        </Field>
        <div className="mt-2">
          <Field label="Description" help="Why this step exists. Read by whoever reviews the next version diff.">
            <Input
              value={String(node.config.description ?? "")}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Optional"
              className="h-7 text-body-sm"
            />
          </Field>
        </div>
      </Section>

      {/* ── Resource binding ─────────────────────────────────────────────── */}
      {node.kind === "tool" ? <ToolConfig node={node} set={set} setMany={setMany} /> : null}
      {node.kind === "agent" ? <AgentConfig node={node} set={set} setMany={setMany} /> : null}
      {/* A team's whole config is a graph, so its panel owns several sections
          rather than one. It writes through `writeTeamConfig`, not `set`: the
          alias a grant names is a cross-reference, and patching single keys
          leaves grants pointing at members that no longer exist. */}
      {node.kind === "agent_team" ? <TeamConfigPanel node={node} onChange={onChange} /> : null}
      {node.kind === "llm" ? <LlmConfig node={node} set={set} /> : null}
      {node.kind === "branch" ? <BranchConfig node={node} set={set} /> : null}
      {node.kind === "parallel" ? <ParallelConfig node={node} set={set} /> : null}
      {node.kind === "merge" ? <MergeConfig node={node} set={set} /> : null}
      {node.kind === "wait" ? <WaitConfig node={node} set={set} /> : null}
      {node.kind === "approval" ? <ApprovalConfig node={node} set={set} /> : null}
      {node.kind === "trigger" ? <TriggerConfig node={node} set={set} /> : null}
      {node.kind === "output" ? <OutputConfig node={node} set={set} /> : null}
      {node.kind === "checkpoint" || node.kind === "end" ? (
        <Section title="Behaviour" help="This step type has no configuration of its own.">
          <Text variant="body-sm" tone="secondary">
            {node.kind === "checkpoint"
              ? "A checkpoint commits the run's state. Its only setting — whether the commit happens — lives on Advanced, because it is a durability decision rather than a behavioural one."
              : "An end node seals the run. Nothing downstream of it executes."}
          </Text>
        </Section>
      ) : null}
    </div>
  );
}

/* ── Tool ─────────────────────────────────────────────────────────────────── */

function ToolConfig({ node, set, setMany }: {
  node: VersionNode;
  set: (k: string, v: unknown) => void;
  setMany: (patch: Record<string, unknown>) => void;
}) {
  const [query, setQuery] = React.useState("");
  const registry = useBuilderRegistry();
  const config = node.config as Record<string, unknown>;

  const selected = resolveTool(config, registry);
  const connection = resolveConnection(config, registry)
    ?? (selected?.connectionId ? registry.byConnectionId.get(selected.connectionId) ?? null : null);
  const params = React.useMemo(() => nodeInputs(node, registry), [node, registry]);

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return registry.tools
      .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.type.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [query, registry.tools]);

  /* A node can name a tool that no longer exists — it was deleted, or the graph
     came from another workspace. Saying so is the only way the operator learns
     why the run will fail. */
  const namedButMissing = !selected && typeof config.tool === "string" && config.tool;

  /**
   * Bind by ID.
   *
   * `ToolNodeExecutor` reads `config.toolId` and fails the node without it. The
   * name is written alongside purely so a graph stays readable in a diff, and so
   * the node still labels itself while the registry is loading.
   */
  const choose = (tool: (typeof registry.tools)[number]) => {
    setMany({
      toolId: tool.id,
      toolName: tool.name,
      toolType: tool.type,
      // The legacy name key would otherwise keep resolving to the old tool and
      // win, because resolution prefers an id but falls back to a name.
      tool: tool.name,
      ...(!config.connectionId && tool.connectionId ? { connectionId: tool.connectionId } : {}),
    });
  };

  const clear = () => {
    setMany({ toolId: null, toolName: null, toolType: null, tool: null });
  };

  return (
    <>
      <Section title="Tool" help="What this step calls. The risk tier decides whether the canvas will demand an approval gate upstream.">
        {selected ? (
          <div className="border-subtle bg-surface-sunken flex flex-wrap items-center gap-2 rounded-sm border p-2">
            <ProviderLogo
              provider={(connection?.provider ?? "http") as ProviderId}
              connected={connection?.status === "active"}
              size={14}
              decorative
              className="!size-6"
            />
            <span className="min-w-0 flex-1">
              <span className="font-code text-mono-sm text-fg-primary block truncate">{selected.name}</span>
              <span className="font-ui text-caption text-fg-muted block">
                {selected.type}
                {selected.timeoutMs ? ` · ${Math.round(selected.timeoutMs / 1000)}s timeout` : ""}
                {selected.requiresApproval ? " · approval required" : ""}
              </span>
            </span>
            <span className={cn("font-ui rounded-xs border px-1 text-[10px] uppercase", RISK_TONE[selected.riskLevel as RiskLevel] ?? RISK_TONE.low)}>
              {selected.riskLevel}
            </span>
            <Button size="xs" variant="ghost" onClick={clear}>Change</Button>
          </div>
        ) : (
          <>
            {namedButMissing ? (
              <div className="border-status-failed-border bg-status-failed-subtle mb-1.5 rounded-sm border px-2 py-1">
                <Text variant="caption" tone="inherit" className="text-status-failed">
                  &ldquo;{String(config.tool)}&rdquo; is not a tool in this workspace
                </Text>
                <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
                  This step will fail when the run reaches it. Pick a registered tool below.
                </Text>
              </div>
            ) : null}

            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools"
              aria-label="Search tools"
              className="h-7 text-body-sm"
            />

            {registry.loading ? (
              <Text variant="caption" tone="muted" className="mt-1.5 block">Loading the registry…</Text>
            ) : registry.tools.length === 0 ? (
              <Text variant="caption" tone="muted" className="mt-1.5 block">
                No tools are registered in this workspace yet. Register one and it appears here.
              </Text>
            ) : matches.length === 0 ? (
              <Text variant="caption" tone="muted" className="mt-1.5 block">
                No tool matches that search.
              </Text>
            ) : (
              <ul className="mt-1.5 grid gap-px">
                {matches.map((tool) => (
                  <li key={tool.id}>
                    <button
                      type="button"
                      onClick={() => choose(tool)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
                        "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-code text-mono-sm text-fg-primary block truncate">{tool.name}</span>
                        <span className="font-ui text-caption text-fg-muted block truncate">{tool.type}</span>
                      </span>
                      {tool.status !== "active" ? (
                        <span className="font-ui text-fg-muted shrink-0 text-[9px] uppercase">{tool.status}</span>
                      ) : null}
                      <span className={cn("font-ui shrink-0 rounded-xs border px-1 text-[9px] uppercase", RISK_TONE[tool.riskLevel as RiskLevel] ?? RISK_TONE.low)}>
                        {tool.riskLevel}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="Connection" help="Which credentials the call runs under. Health is live — a failing connection means this step fails on its next run.">
        <Select
          options={[
            { value: "", label: selected?.connectionId ? "The tool's own connection" : "Workspace default" },
            ...registry.connections.map((c) => ({
              value: c.id,
              label: `${c.name} - ${c.status}`,
              description: c.provider,
            })),
          ]}
          value={connection?.id ?? ""}
          onValueChange={(v) => setMany({ connectionId: v || null, connection: null })}
          aria-label="Connection"
        />
        {connection ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                connection.status === "active" ? "bg-status-success"
                  : connection.status === "degraded" ? "bg-status-waiting" : "bg-status-failed",
              )}
              aria-hidden="true"
            />
            <Text variant="caption" tone="muted">
              {connection.provider} · {connection.status}
            </Text>
          </div>
        ) : registry.connections.length === 0 && !registry.loading ? (
          <Text variant="caption" tone="muted" className="mt-1.5 block">
            No connections exist yet. Create one under Connect, then Connections.
          </Text>
        ) : null}
      </Section>

      {params.length > 0 ? (
        <Section title="Parameters" help="Read from the tool's own input schema. Values are bound on the Inputs tab, where you can see what each one resolves to.">
          <ul className="grid gap-1">
            {params.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 truncate">{p.id}</span>
                <span className="border-subtle text-fg-muted font-code shrink-0 rounded-xs border px-1 text-[9px]">
                  {TYPE_LABEL[p.type]}
                </span>
                {p.required ? (
                  <Text variant="caption" tone="inherit" className="text-status-failed shrink-0">required</Text>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/* ── Agent ────────────────────────────────────────────────────────────────── */

/**
 * The step's own budget, written to `config.budget` — the only place the worker
 * reads a total-token ceiling from (`AgentNodeExecutor.stepBudget`). Empty fields
 * keep the defaults: 16,384 tokens, and the agent's own tool-call and cost limits.
 */
function StepLimits({ config, setMany }: {
  config: Record<string, unknown>;
  setMany: (patch: Record<string, unknown>) => void;
}) {
  const budget = (config.budget ?? {}) as Record<string, unknown>;
  const setBudget = (key: string, raw: string) => {
    const value = raw.trim() === "" ? undefined : Math.max(1, Math.round(Number(raw)));
    const next = { ...budget, [key]: Number.isFinite(value) ? value : undefined };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    setMany({ budget: Object.keys(next).length > 0 ? next : null });
  };
  const cost = typeof budget.maxCostCents === "number" ? String(budget.maxCostCents / 100) : "";

  return (
    <Section
      title="Limits for this step"
      help="The step stops when it reaches any of these. An agent that reads code or long results needs a larger token budget."
    >
      <div className="grid grid-cols-3 gap-2">
        <Field label="Total tokens" help="Across every reply and tool result. Default 16,384.">
          <Input
            type="number" min={1000} step={1000}
            value={typeof budget.maxTotalTokens === "number" ? String(budget.maxTotalTokens) : ""}
            onChange={(e) => setBudget("maxTotalTokens", e.target.value)}
            placeholder="16384"
            className="h-7 text-body-sm"
          />
        </Field>
        <Field label="Tool calls" help="Default: the agent's limit.">
          <Input
            type="number" min={1}
            value={typeof budget.maxToolCalls === "number" ? String(budget.maxToolCalls) : ""}
            onChange={(e) => setBudget("maxToolCalls", e.target.value)}
            placeholder="5"
            className="h-7 text-body-sm"
          />
        </Field>
        <Field label="Cost ($)" help="Default: the agent's limit.">
          <Input
            type="number" min={0.01} step={0.05}
            value={cost}
            onChange={(e) => setBudget("maxCostCents", e.target.value === "" ? "" : String(Number(e.target.value) * 100))}
            placeholder="0.50"
            className="h-7 text-body-sm"
          />
        </Field>
      </div>
    </Section>
  );
}

function AgentConfig({ node, set, setMany }: {
  node: VersionNode;
  set: (k: string, v: unknown) => void;
  setMany: (patch: Record<string, unknown>) => void;
}) {
  const registry = useBuilderRegistry();
  const config = node.config as Record<string, unknown>;
  const agent = resolveAgent(config, registry);
  const override = String(config.taskInstruction ?? config.taskOverride ?? "");

  /* Named an agent that is not here. Same reasoning as the tool picker: this is
     the only place the operator can learn why the step will fail. */
  const namedButMissing = !agent && typeof config.model === "string" && config.model;

  return (
    <>
      <Section title="Agent" help="The registered agent this step runs. Its model and tool grants come from the registry.">
        {registry.loading ? (
          <Text variant="caption" tone="muted" className="block">Loading the registry…</Text>
        ) : registry.agents.length === 0 ? (
          <Text variant="caption" tone="muted" className="block">
            No agents are registered in this workspace yet. Register one under Build, then Agents,
            and it appears here.
          </Text>
        ) : (
          <Select
            options={registry.agents.map((a) => ({
              value: a.id,
              label: a.name,
              description: a.modelName ?? a.type,
            }))}
            value={agent?.id ?? ""}
            onValueChange={(v) => {
              /* Bind by ID. `AgentNodeExecutor` reads `config.agentId` and fails
                 the node without it; the model name it used to write was never
                 read by anything that runs. */
              const picked = registry.byAgentId.get(v) ?? null;
              setMany({
                agentId: v || null,
                agentName: picked?.name ?? null,
                modelName: picked?.modelName ?? null,
                // The legacy key would otherwise keep resolving to whichever
                // agent happens to share the old model name.
                model: picked?.modelName ?? null,
                // Grants are per-agent; carrying them across would grant tools
                // the new agent is not allowed to call.
                toolGrants: [],
              });
            }}
            aria-label="Agent"
          />
        )}
        {namedButMissing ? (
          <div className="border-status-failed-border bg-status-failed-subtle mt-1.5 rounded-sm border px-2 py-1">
            <Text variant="caption" tone="inherit" className="text-status-failed">
              &ldquo;{String(config.model)}&rdquo; is not an agent in this workspace
            </Text>
            <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
              This step will fail when the run reaches it. Choose a registered agent.
            </Text>
          </div>
        ) : agent ? (
          <Text variant="caption" tone="muted" className="mt-1.5 block">
            {agent.modelName ?? "no model set"}
            {agent.llmConnectionId
              ? ` · ${registry.byConnectionId.get(agent.llmConnectionId)?.name ?? "connection missing"}`
              : " · no connection"}
            {` · ${agent.allowedToolIds.length} tool grant${agent.allowedToolIds.length === 1 ? "" : "s"}`}
          </Text>
        ) : null}
      </Section>

      <Section
        title="Task instruction"
        help="What this step should do. Leave empty to use the agent's own instructions."
      >
        {/* Written as `taskInstruction`, the key the worker reads. It used to be
            `taskOverride`, which nothing read — so the instruction typed here was
            ignored. Both are read back, and the old key is cleared on edit. */}
        <Textarea
          value={override}
          onChange={(e) => setMany({ taskInstruction: e.target.value, taskOverride: null })}
          placeholder="e.g. Review these changes and list the risky ones."
          minRows={2}
          maxRows={6}
          className="text-body-sm"
        />
        <Text variant="caption" tone="muted" className="mt-1 block">
          Data from earlier steps is passed with it — add that on the Inputs tab.
        </Text>
      </Section>

      <StepLimits config={config} setMany={setMany} />

      <Section title="Generation" help="How the model is sampled for this step.">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Temperature" help="0 is deterministic. Above 0.7 the same input starts producing different plans.">
            <Input
              type="number" min={0} max={2} step={0.1}
              value={Number(node.config.temperature ?? 0)}
              onChange={(e) => set("temperature", Number(e.target.value))}
              className="h-7 text-body-sm"
            />
          </Field>
          <Field label="Max tokens" help="Ceiling on the response. Reached mid-sentence, it truncates rather than failing.">
            <Input
              type="number" min={64} step={64}
              value={Number(node.config.maxTokens ?? 2048)}
              onChange={(e) => set("maxTokens", Number(e.target.value))}
              className="h-7 text-body-sm"
            />
          </Field>
        </div>
        <div className="mt-2">
          <Field label="Output schema" help="Strict rejects a response that does not match the declared shape, turning a malformed answer into a retry rather than corrupt downstream data.">
            <Select
              options={[
                { value: "strict", label: "Strict — reject non-conforming output" },
                { value: "lenient", label: "Lenient — accept and coerce" },
                { value: "none", label: "None — free text" },
              ]}
              value={String(node.config.outputSchema ?? "strict")}
              onValueChange={(v) => set("outputSchema", v)}
              aria-label="Output schema mode"
            />
          </Field>
        </div>
      </Section>

      <Section title="Tool grants" help="Which tools the agent may call from this step. Narrower than the agent's registered grants is allowed; wider is not.">
        {/* THE LIST IS THE AGENT'S OWN GRANTS, NOT THE WHOLE REGISTRY.
            The help text above has always promised that a step cannot widen
            what the agent is allowed to call, and the previous version offered
            the first six tools in the workspace regardless — so the one rule
            this section states was the one thing it did not enforce. */}
        {!agent ? (
          <Text variant="caption" tone="muted" className="block">
            Choose an agent first. Its registered grants are what this step may narrow.
          </Text>
        ) : agent.allowedToolIds.length === 0 ? (
          <Text variant="caption" tone="muted" className="block">
            {agent.name} has no tool grants, so this step cannot call any tool. Grant tools on the
            agent to change that.
          </Text>
        ) : (
          <ul className="grid gap-1">
            {agent.allowedToolIds.map((toolId) => {
              const tool = registry.byToolId.get(toolId);
              const grants = (config.toolGrants as string[] | undefined) ?? [];
              // No explicit narrowing means the agent's full grant list applies.
              const granted = grants.length === 0 || grants.includes(toolId);
              return (
                <li key={toolId} className="flex items-center gap-2">
                  <Switch
                    checked={granted}
                    onCheckedChange={(v) => {
                      const base = grants.length === 0 ? agent.allowedToolIds : grants;
                      set("toolGrants", v ? [...new Set([...base, toolId])] : base.filter((g) => g !== toolId));
                    }}
                    aria-label={tool?.name ?? toolId}
                  />
                  <span className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 truncate">
                    {tool?.name ?? toolId}
                  </span>
                  {tool ? (
                    <span className={cn("font-ui shrink-0 rounded-xs border px-1 text-[9px] uppercase", RISK_TONE[tool.riskLevel as RiskLevel] ?? RISK_TONE.low)}>
                      {tool.riskLevel}
                    </span>
                  ) : (
                    <Text variant="caption" tone="inherit" className="text-status-failed shrink-0">
                      missing
                    </Text>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

/* ── LLM ──────────────────────────────────────────────────────────────────── */

function LlmConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  return (
    <Section title="Model" help="A single model call. Unlike an agent, it makes no tool calls and takes no further decisions.">
      <Select
        options={[
          { value: "claude-haiku-4", label: "claude-haiku-4 — fastest, cheapest" },
          { value: "claude-sonnet-4", label: "claude-sonnet-4 — balanced" },
          { value: "gpt-4o", label: "gpt-4o" },
          { value: "gpt-4o-mini", label: "gpt-4o-mini" },
          { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
        ]}
        value={String(node.config.model ?? "claude-haiku-4")}
        onValueChange={(v) => set("model", v)}
        aria-label="Model"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="Temperature" help="0 is deterministic — the right default for classification and extraction.">
          <Input
            type="number" min={0} max={2} step={0.1}
            value={Number(node.config.temperature ?? 0)}
            onChange={(e) => set("temperature", Number(e.target.value))}
            className="h-7 text-body-sm"
          />
        </Field>
        <Field label="Max tokens" help="Ceiling on the response length.">
          <Input
            type="number" min={64} step={64}
            value={Number(node.config.maxTokens ?? 2048)}
            onChange={(e) => set("maxTokens", Number(e.target.value))}
            className="h-7 text-body-sm"
          />
        </Field>
      </div>
    </Section>
  );
}

/* ── Branch ───────────────────────────────────────────────────────────────── */

function BranchConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  const [mode, setMode] = React.useState<"visual" | "raw">("visual");
  const condition = String(node.config.condition ?? "");
  const parsed = /^\s*([\w.[\]]+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+?)\s*$/.exec(condition);

  const write = (field: string, operator: string, value: string) => {
    set("condition", `${field} ${operator} ${value}`);
  };

  return (
    <Section title="Condition" help="Evaluated against the subject bound on the Inputs tab. The true arm is taken when it holds.">
      <div className="mb-2 flex items-center gap-0.5">
        {(["visual", "raw"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              "font-ui text-caption rounded-xs px-2 py-0.5 transition-colors duration-fast",
              "outline-none focus-visible:focus-ring",
              mode === m ? "bg-surface-active text-fg-primary" : "text-fg-muted hover:text-fg-primary",
            )}
          >
            {m === "visual" ? "Rule" : "Expression"}
          </button>
        ))}
      </div>

      {mode === "visual" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1.5">
          <Input
            value={parsed?.[1] ?? ""}
            onChange={(e) => write(e.target.value, parsed?.[2] ?? "==", parsed?.[3] ?? "''")}
            placeholder="field"
            aria-label="Field"
            className="h-7 font-code text-mono-sm"
          />
          <Select
            options={["==", "!=", ">", ">=", "<", "<=", "contains"].map((o) => ({ value: o, label: o }))}
            value={parsed?.[2] ?? "=="}
            onValueChange={(v) => write(parsed?.[1] ?? "field", v, parsed?.[3] ?? "''")}
            aria-label="Operator"
          />
          <Input
            value={parsed?.[3] ?? ""}
            onChange={(e) => write(parsed?.[1] ?? "field", parsed?.[2] ?? "==", e.target.value)}
            placeholder="'enterprise'"
            aria-label="Value"
            className="h-7 font-code text-mono-sm"
          />
        </div>
      ) : (
        <Input
          value={condition}
          onChange={(e) => set("condition", e.target.value)}
          placeholder="tier == 'enterprise' && amount_due > 500"
          spellCheck={false}
          className="h-7 font-code text-mono-sm"
        />
      )}

      <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
        {mode === "visual"
          ? "The rule editor covers one comparison. Switch to Expression for anything with and, or, or a function call — it is the same field, written directly."
          : "Written directly. Anything the rule editor can express round-trips back to it."}
      </Text>

      <div className="mt-3 grid gap-2">
        <Field label="True arm label" help="Shown on the edge. Name the case, not the boolean.">
          <Input
            value={String(node.config.trueLabel ?? "")}
            onChange={(e) => set("trueLabel", e.target.value)}
            placeholder="Enterprise"
            className="h-7 text-body-sm"
          />
        </Field>
        <Field label="False arm label" help="Shown on the other edge.">
          <Input
            value={String(node.config.falseLabel ?? "")}
            onChange={(e) => set("falseLabel", e.target.value)}
            placeholder="Everyone else"
            className="h-7 text-body-sm"
          />
        </Field>
        <Field label="When neither matches" help="What happens if the subject is missing entirely.">
          <Select
            options={[
              { value: "skip", label: "Skip the branch and continue" },
              { value: "fail", label: "Fail the run" },
              { value: "false", label: "Take the false arm" },
            ]}
            value={String(node.config.otherwise ?? "skip")}
            onValueChange={(v) => set("otherwise", v)}
            aria-label="Fallback behaviour"
          />
        </Field>
      </div>
    </Section>
  );
}

/* ── Parallel, merge, wait, approval, trigger, output ─────────────────────── */

function ParallelConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  return (
    <Section title="Fan out" help="One branch runs per item in the bound collection.">
      <div className="grid gap-2">
        <Field label="Concurrency limit" help="How many branches run at once. Higher finishes sooner and hits downstream rate limits harder.">
          <Input
            type="number" min={1} max={64}
            value={Number(node.config.maxConcurrency ?? 8)}
            onChange={(e) => set("maxConcurrency", Number(e.target.value))}
            className="h-7 text-body-sm"
          />
        </Field>
        <Field label="Failure policy" help="What one failing branch does to the rest.">
          <Select
            options={[
              { value: "collect", label: "Collect — let every branch finish, then report" },
              { value: "fail-fast", label: "Fail fast — cancel the others on the first failure" },
            ]}
            value={String(node.config.failurePolicy ?? "collect")}
            onValueChange={(v) => set("failurePolicy", v)}
            aria-label="Failure policy"
          />
        </Field>
        <Text variant="caption" tone="muted" className="leading-snug">
          {node.config.failurePolicy === "fail-fast"
            ? "Fail fast stops work sooner but leaves the cancelled branches half-done — correct when the branches share a resource that must not be left inconsistent."
            : "Collect is the safer default: every branch reaches a committed state, so a retry knows exactly which ones still need doing."}
        </Text>
      </div>
    </Section>
  );
}

function MergeConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  return (
    <Section title="Merge" help="How the concurrent branches are joined back into one result.">
      <div className="grid gap-2">
        <Field label="Strategy" help="What the merged output looks like.">
          <Select
            options={[
              { value: "concat", label: "Concatenate — one list of every result" },
              { value: "object", label: "Keyed object — results by branch key" },
              { value: "first", label: "First to finish — discard the rest" },
              { value: "reduce", label: "Reduce — fold into a single value" },
            ]}
            value={String(node.config.strategy ?? "concat")}
            onValueChange={(v) => set("strategy", v)}
            aria-label="Merge strategy"
          />
        </Field>
        <Field label="On conflicting keys" help="Only relevant for the keyed strategy.">
          <Select
            options={[
              { value: "last", label: "Last branch wins" },
              { value: "first", label: "First branch wins" },
              { value: "error", label: "Fail on conflict" },
            ]}
            value={String(node.config.conflict ?? "last")}
            onValueChange={(v) => set("conflict", v)}
            aria-label="Conflict resolution"
          />
        </Field>
      </div>
    </Section>
  );
}

function WaitConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  const mode = String(node.config.mode ?? "duration");
  return (
    <Section title="Wait" help="The run holds here. Waiting is durable — a crash during the wait resumes the wait, it does not restart the run.">
      <Field label="Wait for" help="Which kind of wait this is.">
        <Select
          options={[
            { value: "duration", label: "A fixed duration" },
            { value: "timestamp", label: "Until a timestamp" },
            { value: "condition", label: "Until a condition holds" },
          ]}
          value={mode}
          onValueChange={(v) => set("mode", v)}
          aria-label="Wait mode"
        />
      </Field>

      <div className="mt-2">
        {mode === "duration" ? (
          <Field label="Duration" help="Seconds.">
            <Input
              type="number" min={1}
              value={Number(node.config.forMs ?? 60000) / 1000}
              onChange={(e) => set("forMs", Number(e.target.value) * 1000)}
              className="h-7 text-body-sm"
            />
          </Field>
        ) : mode === "timestamp" ? (
          <Text variant="caption" tone="muted">
            Bind the timestamp on the Inputs tab. The run resumes at that moment, or immediately if
            it has already passed.
          </Text>
        ) : (
          <Field label="Condition" help="Polled on the interval below until it holds.">
            <Input
              value={String(node.config.untilCondition ?? "")}
              onChange={(e) => set("untilCondition", e.target.value)}
              placeholder="{{ input.status }} == 'settled'"
              spellCheck={false}
              className="h-7 font-code text-mono-sm"
            />
          </Field>
        )}
      </div>
    </Section>
  );
}

/*
 * THE APPROVER GROUPS WERE INVENTED.
 *
 * This dropdown offered "billing", "platform-ops", "growth" and "support-eng" —
 * four names that exist nowhere in the product. Picking one wrote a string no
 * executor read and no page could authorise against, which is the same class of
 * bug the tool and agent pickers were fixed for: a selection that cannot be
 * honoured is worse than no selection, because the canvas looks configured.
 *
 * The real vocabulary is the workspace role, checked by `RbacGuard` on
 * `POST /api/approvals/:id/approve` (Permission.APPROVAL_DECIDE) and listed in
 * `lib/server/workspace-members.ts`. Viewer is deliberately absent: a viewer
 * cannot decide an approval, so offering it would configure a gate nobody is
 * able to clear.
 */
const APPROVER_ROLES: { value: string; label: string }[] = [
  { value: "developer", label: "Developer and above" },
  { value: "admin", label: "Admin and above" },
  { value: "owner", label: "Owner only" },
];

function ApprovalConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  const context = (node.config.contextFields as { label: string; expression: string }[] | undefined) ?? [];
  const approverGroup = String(node.config.approverGroup ?? "");
  /* A graph saved before this — or by the Architect — can name a group that is
     not a role. Kept as an option rather than silently blanked, so opening the
     node does not quietly discard what it was configured with. */
  const options = APPROVER_ROLES.some((role) => role.value === approverGroup) || !approverGroup
    ? APPROVER_ROLES
    : [...APPROVER_ROLES, { value: approverGroup, label: `${approverGroup} (not a workspace role)` }];

  return (
    <>
      <Section title="Approvers" help="Who can decide, and what happens if nobody does.">
        <div className="grid gap-2">
          <Field
            label="Approver group"
            help="A workspace role. Anyone with that role or higher may decide, and the first decision wins."
          >
            <Select
              options={options}
              value={approverGroup}
              onValueChange={(v) => set("approverGroup", v)}
              placeholder="Anyone who can decide"
              aria-label="Approver group"
            />
          </Field>
          <Field label="SLA" help="Minutes before the gate is considered breached. The Approvals page counts down against this.">
            <Input
              type="number" min={5}
              value={Number(node.config.slaMinutes ?? 240)}
              onChange={(e) => set("slaMinutes", Number(e.target.value))}
              className="h-7 text-body-sm"
            />
          </Field>
          <Field label="On timeout" help="What happens when the SLA passes with no decision.">
            <Select
              options={[
                { value: "escalate", label: "Escalate to a second group" },
                { value: "reject", label: "Reject automatically" },
                { value: "approve", label: "Approve automatically" },
                { value: "hold", label: "Keep waiting indefinitely" },
              ]}
              value={String(node.config.onTimeout ?? "escalate")}
              onValueChange={(v) => set("onTimeout", v)}
              aria-label="Timeout behaviour"
            />
          </Field>
          {node.config.onTimeout === "approve" ? (
            <div className="border-status-failed-border bg-status-failed-subtle rounded-sm border px-2 py-1.5">
              <Text variant="caption" tone="inherit" className="text-status-failed">
                Auto-approve defeats the gate
              </Text>
              <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
                A gate that approves itself when nobody looks is a delay, not a control. If the work
                is safe to do unattended, remove the gate instead.
              </Text>
            </div>
          ) : null}
        </div>
      </Section>

      {/* The template editor that produces the Approvals page's resolved context. */}
      <Section
        title="Decision context"
        help="What the approver sees. Each row is bound to an upstream field on the Inputs tab and appears on the Approvals page with its resolved value and its source."
      >
        {context.length === 0 ? (
          <Text variant="caption" tone="muted" className="block leading-snug">
            Nothing defined. An approver would see the run id and nothing else — which is how gates
            get rubber-stamped. Add the two or three facts the decision actually turns on.
          </Text>
        ) : (
          <ul className="grid gap-1.5">
            {context.map((row, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-1.5">
                <Input
                  value={row.label}
                  onChange={(e) => {
                    const next = [...context];
                    next[i] = { ...row, label: e.target.value };
                    set("contextFields", next);
                  }}
                  placeholder="Label"
                  aria-label={`Context label ${i + 1}`}
                  className="h-7 text-body-sm"
                />
                <Input
                  value={row.expression}
                  onChange={(e) => {
                    const next = [...context];
                    next[i] = { ...row, expression: e.target.value };
                    set("contextFields", next);
                  }}
                  placeholder="{{ n1001.output.renewals[0].account_name }}"
                  spellCheck={false}
                  aria-label={`Context binding ${i + 1}`}
                  className="h-7 font-code text-mono-sm"
                />
                <button
                  type="button"
                  onClick={() => set("contextFields", context.filter((_, j) => j !== i))}
                  aria-label={`Remove ${row.label || `row ${i + 1}`}`}
                  className={cn(
                    "text-fg-disabled hover:text-status-failed grid size-6 place-items-center rounded-xs",
                    "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  )}
                >
                  <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
                    <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button
          size="xs"
          variant="secondary"
          className="mt-2"
          onClick={() => set("contextFields", [...context, { label: "", expression: "" }])}
        >
          Add a context field
        </Button>
      </Section>
    </>
  );
}

function TriggerConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  return (
    <Section title="Schedule" help="When the run starts. Overlap policy matters more than it looks — it decides what happens when a run is still going as the next one is due.">
      <div className="grid gap-2">
        <Field label="Cron" help="Standard five-field cron, in the timezone below.">
          <Input
            value={String(node.config.cron ?? "")}
            onChange={(e) => set("cron", e.target.value)}
            spellCheck={false}
            className="h-7 font-code text-mono-sm"
          />
        </Field>
        <Field label="Timezone" help="Daylight saving is honoured, so 09:00 stays 09:00 local.">
          <Input
            value={String(node.config.timezone ?? "UTC")}
            onChange={(e) => set("timezone", e.target.value)}
            className="h-7 text-body-sm"
          />
        </Field>
        <Field label="Overlap policy" help="What to do when the previous run has not finished.">
          <Select
            options={[
              { value: "skip", label: "Skip this firing" },
              { value: "queue", label: "Queue it behind the running one" },
              { value: "parallel", label: "Start it anyway, in parallel" },
            ]}
            value={String(node.config.overlapPolicy ?? "skip")}
            onValueChange={(v) => set("overlapPolicy", v)}
            aria-label="Overlap policy"
          />
        </Field>
        <Field label="Jitter" help="Seconds of random delay. Spreads load when many workflows share a schedule.">
          <Input
            type="number" min={0}
            value={Number(node.config.jitterSeconds ?? 0)}
            onChange={(e) => set("jitterSeconds", Number(e.target.value))}
            className="h-7 text-body-sm"
          />
        </Field>
      </div>
    </Section>
  );
}

function OutputConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  return (
    <Section title="Output" help="Where the result goes when the run finishes.">
      <div className="grid gap-2">
        <Field label="Format" help="How the payload is serialised.">
          <Select
            options={[
              { value: "json", label: "JSON" },
              { value: "text", label: "Plain text" },
              { value: "csv", label: "CSV" },
            ]}
            value={String(node.config.format ?? "json")}
            onValueChange={(v) => set("format", v)}
            aria-label="Output format"
          />
        </Field>
        <Field label="Destination" help="A channel, address, bucket or webhook. Leave empty to keep the result on the run only.">
          <Input
            value={String(node.config.destination ?? "")}
            onChange={(e) => set("destination", e.target.value)}
            placeholder="slack:#billing-ops"
            className="h-7 text-body-sm"
          />
        </Field>
      </div>
    </Section>
  );
}

/* `Section` and `Field` moved to ./fields when the team editor became its own
   file. Shared rather than copied because `help` is required on both, and two
   copies of the wrapper is how half of those sentences quietly stop existing. */
