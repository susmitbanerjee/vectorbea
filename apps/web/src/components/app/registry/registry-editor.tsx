"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import { Slider } from "~/components/ui/slider";
import { CodeEditor } from "~/components/ui/code-editor";
import { Segmented } from "~/components/ui/option-card";
import { useApi } from "~/lib/api/api-provider";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { emptySpec, specProblems as problemsIn, type SpecDocument } from "~/lib/tools/http-spec";
import { HttpSpecEditor } from "./http-spec-editor";

/* ══════════════════════════════════════════════════════════════════════════════
   THE INLINE EDITORS

   These are the EDIT surfaces, opened inside the registry detail sheet. Creation
   is a different act on a different surface — see `create-agent-dialog.tsx` and
   `create-tool-dialog.tsx` — because creating means choosing an adapter and a
   behaviour type that can never be changed afterwards, and editing means
   adjusting the things that can.

   THE WIRING BUG THIS FIXES. The agent editor used to offer "Workspace default"
   as an LLM connection. There is no workspace default: `AgentRoutes` calls
   `requireField` on `llmConnectionId` for a `native_llm_agent`, so saving with
   that option selected returned a 400 that read as a product defect. The
   connection is required when the type requires it, the form says so, and the
   save button is unavailable until it is satisfied.
══════════════════════════════════════════════════════════════════════════════ */

type Tool = contracts.Tool;
type Agent = contracts.Agent;
type Connection = contracts.Connection;

const RISK_DOT: Record<string, string> = {
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
};

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border">
      <header className="border-subtle border-b px-4 py-3">
        <Text variant="heading-sm" tone="max" as="h2" className="block">{title}</Text>
        <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{description}</Text>
      </header>
      <div className="grid gap-4 p-4">{children}</div>
    </section>
  );
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be a valid JSON object.`);
  }
}

function json(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function EditorSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="border-subtle bg-surface-raised h-40 animate-pulse rounded-lg border" />
      ))}
    </div>
  );
}

/* ── Tools ────────────────────────────────────────────────────────────────── */

export function ToolEditor({
  id,
  onSaved,
  onCancel,
}: {
  id: string;
  onSaved: (tool: Tool) => void | Promise<void>;
  onCancel: () => void;
}) {
  const api = useApi();
  const { workspaceId } = useScope();
  const queryClient = useQueryClient();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);

  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  /** Immutable after registration — the adapter decides the whole config shape. */
  const [type, setType] = React.useState("http");
  const [connectionId, setConnectionId] = React.useState("none");
  const [riskLevel, setRiskLevel] = React.useState("low");
  const [status, setStatus] = React.useState("active");
  const [requiresApproval, setRequiresApproval] = React.useState(false);
  const [timeoutMs, setTimeoutMs] = React.useState("10000");
  const [config, setConfig] = React.useState("{}");
  const [inputSchema, setInputSchema] = React.useState("{}");
  const [outputSchema, setOutputSchema] = React.useState("{}");
  /**
   * The declarative HTTP call (V064).
   *
   * Null for a tool written before this existed, and for every non-HTTP
   * adapter. That is the migration: such a tool keeps its legacy `config` keys
   * and behaves exactly as it did, and the form below offers to adopt a
   * definition rather than silently writing one.
   */
  const [httpSpec, setHttpSpec] = React.useState<SpecDocument | null>(null);

  React.useEffect(() => {
    let alive = true;
    void api.connections.list({ ...scope, page: 1, pageSize: 100 })
      .then((page) => { if (alive) setConnections(page.items); })
      .catch(() => { if (alive) setConnections([]); });

    void api.tools.get(id, scope)
      .then((tool) => {
        if (!alive) return;
        setName(tool.name);
        setDescription(tool.description ?? "");
        setType(tool.type);
        setConnectionId(tool.connectionId ?? "none");
        setRiskLevel(tool.riskLevel);
        setStatus(tool.status);
        setRequiresApproval(tool.requiresApproval);
        setTimeoutMs(String(tool.timeoutMs ?? 10000));
        setConfig(json(tool.config));
        setInputSchema(json(tool.inputSchema));
        setOutputSchema(json(tool.outputSchema));
        setHttpSpec((tool.httpSpec as SpecDocument | null | undefined) ?? null);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load tool."))
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [api, id, scope]);

  const requiresConnection = ["http", "database", "llm_generate"].includes(type);
  const compatible = connections.filter((connection) =>
    type === "custom"
      || (type === "http" && connection.type === "http")
      || (type === "database" && connection.type === "database")
      || (type === "llm_generate" && connection.type === "llm"),
  );

  const timeoutValue = Number(timeoutMs);
  const timeoutValid = Number.isInteger(timeoutValue) && timeoutValue > 0;
  /*
   * A definition with problems cannot be saved.
   *
   * Mirrored server-side by `ToolRoutes.validateHttpSpec` and enforced again by
   * the request assembler — this copy exists so the answer arrives beside the
   * field rather than after a round trip, not because it is the one that counts.
   */
  const specProblems = httpSpec ? problemsIn(httpSpec) : [];
  const blocked = !name.trim() || !timeoutValid
    || (requiresConnection && connectionId === "none")
    || specProblems.length > 0;

  async function save() {
    if (blocked) return;
    setSaving(true);
    try {
      const result = await api.tools.update(
        id,
        {
          name: name.trim(),
          description: description.trim() || null,
          connectionId: connectionId === "none" ? null : connectionId,
          riskLevel,
          status,
          requiresApproval,
          timeoutMs: timeoutValue,
          config: parseObject(config, "Configuration"),
          inputSchema: parseObject(inputSchema, "Input schema"),
          outputSchema: parseObject(outputSchema, "Output schema"),
          /* Omitted entirely when there is none, rather than sent as null: the
             API treats an absent field as "leave it alone", and a null would
             read as "remove the definition" on a tool that has one. */
          ...(httpSpec ? { httpSpec } : {}),
        },
        scope,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools.all({ workspaceId, environmentId: null }) });
      toast.success("Tool updated.");
      await onSaved(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save tool.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <EditorSkeleton />;

  return (
    <div className="grid gap-3">
      <Panel title="Identity" description="The adapter is fixed at registration — it decides the shape of everything below.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} />
          </Field>
          <Field label="Adapter" description="Cannot be changed. Register a new tool to switch adapter.">
            <Select
              disabled
              value={type}
              onValueChange={setType}
              options={[
                { value: "http", label: "HTTP API" },
                { value: "database", label: "Database" },
                { value: "code", label: "Code" },
                { value: "builtin", label: "Built-in" },
                { value: "llm_generate", label: "LLM generation" },
                { value: "custom", label: "Custom / MCP" },
              ]}
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} minRows={2} maxRows={5} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Connection"
            required={requiresConnection}
            description={requiresConnection ? "Required for this adapter." : "Optional for this adapter."}
            error={requiresConnection && connectionId === "none" ? "This adapter cannot run without a connection." : undefined}
          >
            <Select
              value={connectionId}
              onValueChange={setConnectionId}
              options={[
                ...(requiresConnection ? [] : [{ value: "none", label: "No connection" }]),
                ...compatible.map((connection) => ({
                  value: connection.id,
                  label: connection.name,
                  description: connection.provider,
                })),
              ]}
            />
          </Field>
          <Field
            label="Timeout"
            description="Milliseconds."
            error={!timeoutValid ? "Must be a whole number above zero." : undefined}
          >
            <Input
              mono
              type="number"
              min={1}
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
              suffix={<Text variant="caption" tone="muted">ms</Text>}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Risk and control" description="Persisted with the tool and enforced by the engine, independently of this UI.">
        <Field label="Risk tier">
          <Segmented
            label="Risk tier"
            value={riskLevel}
            onValueChange={setRiskLevel}
            options={(["low", "medium", "high", "critical"] as const).map((value) => ({
              value,
              label: value[0]!.toUpperCase() + value.slice(1),
              markerClassName: RISK_DOT[value]!,
            }))}
          />
        </Field>
        <Field label="Lifecycle">
          <Select
            value={status}
            onValueChange={setStatus}
            options={["active", "paused", "draft"].map((value) => ({
              value,
              label: value[0]!.toUpperCase() + value.slice(1),
            }))}
          />
        </Field>
        <Checkbox
          checked={requiresApproval}
          onCheckedChange={(value) => setRequiresApproval(value === true)}
          description="A run reaching this tool pauses until a person approves it."
        >
          Require human approval
        </Checkbox>
      </Panel>

      {type === "http" ? (
        <Panel
          title="What this tool sends"
          description="The whole call, declared: where each input lands on the wire, how the body is encoded, how it authenticates, and what the agent is shown of the response."
        >
          {httpSpec ? (
            <HttpSpecEditor
              value={httpSpec}
              onChange={setHttpSpec}
              connectionBaseUrl={
                compatible.find((c) => c.id === connectionId)?.config?.baseUrl as string | undefined
              }
              disabled={saving}
            />
          ) : (
            <div className="border-subtle rounded-md border border-dashed p-5">
              <Text variant="body-sm" tone="primary" className="block font-medium">
                This tool still uses the legacy configuration
              </Text>
              <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[68ch]">
                It reads loose keys from Runtime configuration below, and works exactly as it
                always has. Adopting a definition lets you map each input to a path, query,
                header or body field, choose the body encoding, name the auth header the
                service actually reads, and extract the part of the response the agent needs.
              </Text>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={saving}
                onClick={() => setHttpSpec(emptySpec())}
              >
                Adopt a definition
              </Button>
            </div>
          )}
        </Panel>
      ) : null}

      <Panel title="Configuration and schemas" description="JSON is validated here before the mutation is sent.">
        <Field label="Runtime configuration">
          <CodeEditor value={config} onValueChange={setConfig} minRows={6} aria-label="Runtime configuration" />
        </Field>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Input schema">
            <CodeEditor value={inputSchema} onValueChange={setInputSchema} minRows={8} aria-label="Input schema" />
          </Field>
          <Field label="Output schema">
            <CodeEditor value={outputSchema} onValueChange={setOutputSchema} minRows={8} aria-label="Output schema" />
          </Field>
        </div>
      </Panel>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" loading={saving} loadingLabel="Saving" disabled={blocked} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

/* ── Agents ───────────────────────────────────────────────────────────────── */

export function AgentEditor({
  id,
  onSaved,
  onCancel,
}: {
  id: string;
  onSaved: (agent: Agent) => void | Promise<void>;
  onCancel: () => void;
}) {
  const api = useApi();
  const { workspaceId } = useScope();
  const queryClient = useQueryClient();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);

  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [tools, setTools] = React.useState<Tool[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [type, setType] = React.useState("native_llm_agent");
  const [status, setStatus] = React.useState("active");
  const [instructions, setInstructions] = React.useState("");
  const [connectionId, setConnectionId] = React.useState("none");
  const [modelName, setModelName] = React.useState("");
  const [temperature, setTemperature] = React.useState(0.1);
  const [maxTokens, setMaxTokens] = React.useState("4096");
  const [maxIterations, setMaxIterations] = React.useState("10");
  const [allowedToolIds, setAllowedToolIds] = React.useState<string[]>([]);
  const [toolQuery, setToolQuery] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    void Promise.all([
      api.connections.list({ ...scope, page: 1, pageSize: 100 }),
      api.tools.list({ ...scope, page: 1, pageSize: 100 }),
    ])
      .then(([connectionPage, toolPage]) => {
        if (!alive) return;
        setConnections(connectionPage.items.filter((item) => item.type === "llm"));
        setTools(toolPage.items);
      })
      .catch(() => { if (alive) { setConnections([]); setTools([]); } });

    void api.agents.get(id, scope)
      .then((agent) => {
        if (!alive) return;
        setName(agent.name);
        setRole(agent.role ?? "");
        setType(agent.type);
        setStatus(agent.status);
        setInstructions(agent.instructions ?? "");
        setConnectionId(agent.llmConnectionId ?? "none");
        setModelName(agent.modelName ?? "");
        setTemperature(agent.temperature ?? 0.1);
        setMaxTokens(String(agent.maxTokens ?? 4096));
        setMaxIterations(String(agent.maxIterations ?? 10));
        setAllowedToolIds(agent.allowedToolIds);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load agent."))
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [api, id, scope]);

  /**
   * `native_llm_agent` is the one type the API validates hard: instructions,
   * modelName and llmConnectionId are all `requireField`ed. Anything else may
   * leave them empty.
   */
  const needsModel = type === "native_llm_agent";
  const maxTokensValue = Number(maxTokens);
  const maxIterationsValue = Number(maxIterations);
  const limitsValid =
    Number.isInteger(maxTokensValue) && maxTokensValue > 0 &&
    Number.isInteger(maxIterationsValue) && maxIterationsValue > 0;

  const blocked =
    !name.trim()
    || !limitsValid
    || (needsModel && (connectionId === "none" || !modelName.trim() || !instructions.trim()));

  const visibleTools = React.useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter((tool) => `${tool.name} ${tool.riskLevel} ${tool.type}`.toLowerCase().includes(query));
  }, [tools, toolQuery]);

  async function save() {
    if (blocked) return;
    setSaving(true);
    try {
      const result = await api.agents.update(
        id,
        {
          name: name.trim(),
          role: role.trim() || null,
          status,
          instructions: instructions.trim() || null,
          llmConnectionId: connectionId === "none" ? null : connectionId,
          modelName: modelName.trim() || null,
          temperature,
          maxTokens: maxTokensValue,
          maxIterations: maxIterationsValue,
          allowedToolIds,
        },
        scope,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all({ workspaceId, environmentId: null }) });
      toast.success("Agent updated.");
      await onSaved(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save agent.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <EditorSkeleton />;

  return (
    <div className="grid gap-3">
      <Panel title="Identity" description="The behaviour type is fixed at registration.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} />
          </Field>
          <Field label="Role">
            <Input value={role} onChange={(event) => setRole(event.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Agent type" description="Cannot be changed. Register a new agent to switch behaviour.">
            <Select
              disabled
              value={type}
              onValueChange={setType}
              options={[
                { value: "native_llm_agent", label: "Native LLM agent" },
                { value: "iterative_agent", label: "Iterative agent" },
                { value: "tool_agent", label: "Tool agent" },
                { value: "router_agent", label: "Router agent" },
                { value: "approval_agent", label: "Approval agent" },
                { value: "external_instrumented_agent", label: "External agent" },
              ]}
            />
          </Field>
          <Field label="Lifecycle">
            <Select
              value={status}
              onValueChange={setStatus}
              options={["active", "paused", "draft"].map((value) => ({
                value,
                label: value[0]!.toUpperCase() + value.slice(1),
              }))}
            />
          </Field>
        </div>
        <Field
          label="System instructions"
          required={needsModel}
          characterCount={{ value: instructions.length, max: 20000 }}
          error={needsModel && !instructions.trim() ? "Required for a native LLM agent." : undefined}
        >
          <Textarea
            mono
            autoGrow={false}
            minRows={10}
            maxLength={20000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
      </Panel>

      <Panel title="Model and limits" description="Model calls are billed to the credential on the connection.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="LLM connection"
            required={needsModel}
            description={needsModel ? "Required for a native LLM agent — there is no workspace default." : "Optional for this agent type."}
            error={needsModel && connectionId === "none" ? "Pick the connection this agent runs on." : undefined}
          >
            <Select
              value={connectionId}
              onValueChange={setConnectionId}
              options={[
                ...(needsModel ? [] : [{ value: "none", label: "No model connection" }]),
                ...connections.map((connection) => ({
                  value: connection.id,
                  label: connection.name,
                  description: connection.provider,
                })),
              ]}
            />
          </Field>
          <Field
            label="Model"
            required={needsModel}
            error={needsModel && !modelName.trim() ? "Name the model this agent runs on." : undefined}
          >
            <Input mono value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="claude-sonnet-5" />
          </Field>
        </div>
        <Field label="Temperature" description="Low is repeatable, high is varied.">
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
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Max reply length"
            description="Tokens in one model reply, not the whole run. Keep it within the model's limit (gpt-4o: 16,000) or the call is refused. The run's total is set per step in the workflow."
            error={!(Number.isInteger(maxTokensValue) && maxTokensValue > 0) ? "Must be a whole number above zero." : undefined}
          >
            <Input mono type="number" min={1} value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} />
          </Field>
          <Field
            label="Max iterations"
            error={!(Number.isInteger(maxIterationsValue) && maxIterationsValue > 0) ? "Must be a whole number above zero." : undefined}
          >
            <Input mono type="number" min={1} value={maxIterations} onChange={(event) => setMaxIterations(event.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Tool grants" description="Only what is granted here can be called. Everything else is refused by the engine.">
        {tools.length === 0 ? (
          <Text variant="body-sm" tone="muted">No tools are registered yet.</Text>
        ) : (
          <>
            <Input
              value={toolQuery}
              onChange={(event) => setToolQuery(event.target.value)}
              placeholder="Filter by name, adapter or risk"
              prefix={<Icon icon={MagnifyingGlass} size="sm" decorative />}
            />
            <div className="border-subtle divide-subtle max-h-72 divide-y overflow-y-auto rounded-md border">
              {visibleTools.map((tool) => {
                const granted = allowedToolIds.includes(tool.id);
                return (
                  <label
                    key={tool.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors duration-fast",
                      granted ? "bg-surface-selected" : "hover:bg-surface-hover",
                    )}
                  >
                    <Checkbox
                      checked={granted}
                      aria-label={`Grant ${tool.name}`}
                      onCheckedChange={(value) =>
                        setAllowedToolIds((current) =>
                          value === true
                            ? [...new Set([...current, tool.id])]
                            : current.filter((item) => item !== tool.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <Text variant="body-sm" tone="primary" className="font-medium">{tool.name}</Text>
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden="true" className={cn("size-1.5 rounded-full", RISK_DOT[tool.riskLevel] ?? RISK_DOT.low)} />
                          <Text variant="caption" tone="muted" className="capitalize">{tool.riskLevel}</Text>
                        </span>
                        {tool.requiresApproval ? <Text variant="caption" tone="muted">· approval gated</Text> : null}
                      </span>
                      <Text variant="caption" tone="muted" className="mt-0.5 block truncate">
                        {tool.description ?? `${tool.type} tool`}
                      </Text>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" loading={saving} loadingLabel="Saving" disabled={blocked} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
