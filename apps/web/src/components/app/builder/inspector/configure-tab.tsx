"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/choice";
import { Button } from "~/components/ui/button";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { AGENTS, TOOLS, CONNECTIONS } from "~/mocks/fixtures";
import { inputsFor, TYPE_LABEL } from "~/mocks/io-schema";
import { boundResource } from "~/mocks/builder";
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
  const set = (key: string, value: unknown) => onChange({ config: { ...node.config, [key]: value } });

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
      {node.kind === "tool" ? <ToolConfig node={node} set={set} /> : null}
      {node.kind === "agent" ? <AgentConfig node={node} set={set} /> : null}
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

function ToolConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  const [query, setQuery] = React.useState("");
  const selected = TOOLS.find((t) => t.name === node.config.tool);
  const connection = CONNECTIONS.find((c) => c.name === node.config.connection);
  const params = React.useMemo(() => inputsFor(node), [node]);

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TOOLS.filter((t) => !needle || t.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [query]);

  return (
    <>
      <Section title="Tool" help="What this step calls. The risk tier decides whether the canvas will demand an approval gate upstream.">
        {selected ? (
          <div className="border-subtle bg-surface-sunken flex flex-wrap items-center gap-2 rounded-sm border p-2">
            <ProviderLogo
              provider={selected.provider as ProviderId}
              connected={connection?.status === "healthy"}
              size={14}
              decorative
              className="!size-6"
            />
            <span className="min-w-0 flex-1">
              <span className="font-code text-mono-sm text-fg-primary block truncate">{selected.name}</span>
              <span className="font-ui text-caption text-fg-muted block">
                {Math.round(selected.timeoutMs / 1000)}s default timeout · used by {selected.usedByCount} workflows
              </span>
            </span>
            <span className={cn("font-ui rounded-xs border px-1 text-[10px] uppercase", RISK_TONE[selected.risk])}>
              {selected.risk}
            </span>
            <Button size="xs" variant="ghost" onClick={() => set("tool", "")}>Change</Button>
          </div>
        ) : (
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools"
              aria-label="Search tools"
              className="h-7 text-body-sm"
            />
            <ul className="mt-1.5 grid gap-px">
              {matches.map((tool) => (
                <li key={tool.id}>
                  <button
                    type="button"
                    onClick={() => set("tool", tool.name)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
                      "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
                    )}
                  >
                    <span className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 truncate">{tool.name}</span>
                    {tool.lastError ? (
                      <span className="bg-status-failed size-1.5 shrink-0 rounded-full" title={tool.lastError} />
                    ) : null}
                    <span className={cn("font-ui shrink-0 rounded-xs border px-1 text-[9px] uppercase", RISK_TONE[tool.risk])}>
                      {tool.risk}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button size="xs" variant="ghost" className="mt-1.5">Create a new tool</Button>
          </>
        )}
      </Section>

      <Section title="Connection" help="Which credentials the call runs under. Health is live — a failing connection means this step fails on its next run.">
        <Select
          options={[
            { value: "", label: "Workspace default" },
            ...CONNECTIONS.map((c) => ({ value: c.name, label: `${c.name} — ${c.status}` })),
          ]}
          value={String(node.config.connection ?? "")}
          onValueChange={(v) => set("connection", v || null)}
          aria-label="Connection"
        />
        {connection ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                connection.status === "healthy" ? "bg-status-success"
                  : connection.status === "degraded" ? "bg-status-waiting" : "bg-status-failed",
              )}
              aria-hidden="true"
            />
            <Text variant="caption" tone="muted">
              {connection.status === "healthy"
                ? `Responding in ${connection.latencyMs}ms.`
                : `${connection.status}. ${connection.blastRadius.workflows} workflows and ${connection.blastRadius.tools} tools depend on it.`}
            </Text>
          </div>
        ) : (
          <Text variant="caption" tone="muted" className="mt-1.5 block">
            The workspace default is used. Bind one explicitly if this step should run under a
            specific account.
          </Text>
        )}
      </Section>

      {params.length > 0 ? (
        <Section title="Parameters" help="Generated from the tool's schema. Values are bound on the Inputs tab, where you can see what each one resolves to.">
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

function AgentConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  const agent = AGENTS.find((a) => a.model === node.config.model);
  const override = String(node.config.taskOverride ?? "");

  return (
    <>
      <Section title="Agent" help="The registered agent this step runs. Its model, cost and tool grants come from the registry.">
        <Select
          options={AGENTS.map((a) => ({ value: a.model, label: `${a.name} — ${a.model}` }))}
          value={String(node.config.model ?? "")}
          onValueChange={(v) => set("model", v)}
          aria-label="Agent"
        />
        {agent ? (
          <Text variant="caption" tone="muted" className="mt-1.5 block">
            {agent.provider} · about ${agent.costPerRunUsd.toFixed(4)} per run · {agent.toolGrants} tool
            grants · prompt v{agent.promptVersion}
          </Text>
        ) : null}
        <Button size="xs" variant="ghost" className="mt-1.5">Register a new agent</Button>
      </Section>

      <Section
        title="Task instruction"
        help="Leave empty to use the agent's registered task. Anything written here applies to THIS STEP ONLY and does not change the agent."
      >
        <Input
          value={override}
          onChange={(e) => set("taskOverride", e.target.value)}
          placeholder="Uses the agent's default task"
          className="h-7 text-body-sm"
        />
        {override ? (
          <div className="border-status-waiting-border bg-status-waiting-subtle mt-1.5 rounded-sm border px-2 py-1">
            <Text variant="caption" tone="inherit" className="text-status-waiting">
              Overriding the agent&apos;s default task
            </Text>
            <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
              Other workflows using {agent?.name ?? "this agent"} are unaffected. The override lives
              on this node and travels with the version.
            </Text>
          </div>
        ) : null}
      </Section>

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
        <ul className="grid gap-1">
          {TOOLS.slice(0, 6).map((tool) => {
            const grants = (node.config.toolGrants as string[] | undefined) ?? [];
            const granted = grants.includes(tool.name);
            return (
              <li key={tool.id} className="flex items-center gap-2">
                <Switch
                  checked={granted}
                  onCheckedChange={(v) => set("toolGrants", v ? [...grants, tool.name] : grants.filter((g) => g !== tool.name))}
                />
                <span className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 truncate">{tool.name}</span>
                <span className={cn("font-ui shrink-0 rounded-xs border px-1 text-[9px] uppercase", RISK_TONE[tool.risk])}>
                  {tool.risk}
                </span>
              </li>
            );
          })}
        </ul>
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

function ApprovalConfig({ node, set }: { node: VersionNode; set: (k: string, v: unknown) => void }) {
  const context = (node.config.contextFields as { label: string; expression: string }[] | undefined) ?? [];

  return (
    <>
      <Section title="Approvers" help="Who can decide, and what happens if nobody does.">
        <div className="grid gap-2">
          <Field label="Approver group" help="Anyone in the group may decide. The first decision wins.">
            <Select
              options={["billing", "platform-ops", "growth", "support-eng"].map((g) => ({ value: g, label: g }))}
              value={String(node.config.approverGroup ?? "")}
              onValueChange={(v) => set("approverGroup", v)}
              placeholder="Choose a group"
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

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function Section({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
      <Text variant="label" tone="primary" className="block">{title}</Text>
      <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">{help}</Text>
      {children}
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
