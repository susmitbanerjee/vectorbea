"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { contracts } from "@vectorbea/shared";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import { useApi } from "~/lib/api/api-provider";
import { useScope } from "~/lib/workspace/workspace-provider";

type Tool = contracts.Tool;
type Agent = contracts.Agent;
type Connection = contracts.Connection;

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="border-subtle bg-surface-raised rounded-lg border p-4">
      <div className="mb-4 border-b border-subtle pb-3">
        <Text variant="heading-sm" tone="max" as="h2">{title}</Text>
        <Text variant="caption" tone="muted" className="mt-1 block">{description}</Text>
      </div>
      <div className="grid gap-4">{children}</div>
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

export function ToolEditorPage() {
  const router = useRouter();
  return (
    <PageContainer>
      <PageHeader eyebrow="Build / Tools" title="Register tool" description="Declare capability, schema, credentials, and policy in one governed registry entry." />
      <ToolEditor onCancel={() => router.push("/tools")} onSaved={(tool) => router.push(`/tools?tool=${tool.id}`)} />
    </PageContainer>
  );
}

export function AgentEditorPage() {
  const router = useRouter();
  return (
    <PageContainer>
      <PageHeader eyebrow="Build / Agents" title="Register agent" description="Define model behaviour, tool grants, limits, and approval policy as a reusable agent." />
      <AgentEditor onCancel={() => router.push("/agents")} onSaved={(agent) => router.push(`/agents?agent=${agent.id}`)} />
    </PageContainer>
  );
}

export function ToolEditor({ id, onSaved, onCancel }: { id?: string; onSaved: (tool: Tool) => void | Promise<void>; onCancel: () => void }) {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [loading, setLoading] = React.useState(Boolean(id));
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState("http");
  const [connectionId, setConnectionId] = React.useState("none");
  const [riskLevel, setRiskLevel] = React.useState("low");
  const [status, setStatus] = React.useState("active");
  const [requiresApproval, setRequiresApproval] = React.useState(false);
  const [timeoutMs, setTimeoutMs] = React.useState("10000");
  const [config, setConfig] = React.useState('{\n  "method": "GET",\n  "url": "https://api.example.com/resource"\n}');
  const [inputSchema, setInputSchema] = React.useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [outputSchema, setOutputSchema] = React.useState('{\n  "type": "object",\n  "properties": {}\n}');

  React.useEffect(() => {
    let alive = true;
    void api.connections.list({ ...scope, page: 1, pageSize: 100 }).then((page) => { if (alive) setConnections(page.items); });
    if (id) {
      void api.tools.get(id, scope).then((tool) => {
        if (!alive) return;
        setName(tool.name); setDescription(tool.description ?? ""); setType(tool.type);
        setConnectionId(tool.connectionId ?? "none"); setRiskLevel(tool.riskLevel); setStatus(tool.status);
        setRequiresApproval(tool.requiresApproval); setTimeoutMs(String(tool.timeoutMs ?? 10000));
        setConfig(json(tool.config)); setInputSchema(json(tool.inputSchema)); setOutputSchema(json(tool.outputSchema));
      }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load tool."))
        .finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; };
  }, [api, id, scope]);

  async function save() {
    if (!name.trim()) { toast.error("Tool name is required."); return; }
    if (["http", "database", "llm_generate"].includes(type) && connectionId === "none") {
      toast.error("This adapter type requires a compatible connection."); return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(), description: description.trim() || null, type,
        connectionId: connectionId === "none" ? null : connectionId,
        riskLevel, status, requiresApproval, timeoutMs: Number(timeoutMs) || 10000,
        config: parseObject(config, "Configuration"),
        inputSchema: parseObject(inputSchema, "Input schema"),
        outputSchema: parseObject(outputSchema, "Output schema"),
        retryPolicy: {}, idempotencyStrategy: "input_hash",
      };
      const result = id ? await api.tools.update(id, body, scope) : await api.tools.create(body, scope);
      toast.success(id ? "Tool updated." : "Tool registered.");
      await onSaved(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save tool.");
    } finally { setSaving(false); }
  }

  if (loading) return <div className="border-subtle bg-surface-raised h-48 animate-pulse rounded-lg border" />;
  return (
    <div className="grid gap-3">
      <Panel title="Identity and execution" description="The stable registry identity and runtime adapter.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer lookup" /></Field>
          <Field label="Adapter type" required><Select disabled={Boolean(id)} value={type} onValueChange={(value) => { setType(value); setConnectionId("none"); }} options={[
            { value: "http", label: "HTTP API" }, { value: "database", label: "Database" }, { value: "code", label: "Code" },
            { value: "builtin", label: "Built-in" }, { value: "llm_generate", label: "LLM generation" }, { value: "custom", label: "Custom / MCP" },
          ]} /></Field>
        </div>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} minRows={2} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Connection"><Select value={connectionId} onValueChange={setConnectionId} options={[{ value: "none", label: "No connection" }, ...connections.filter((connection) => type === "custom" || (type === "http" && connection.type === "http") || (type === "database" && connection.type === "database") || (type === "llm_generate" && connection.type === "llm")).map((c) => ({ value: c.id, label: `${c.name} · ${c.provider}` }))]} /></Field>
          <Field label="Timeout (ms)"><Input mono type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} /></Field>
        </div>
      </Panel>
      <Panel title="Risk and control" description="Controls are persisted with the tool and enforced independently of the UI.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Risk tier"><Select value={riskLevel} onValueChange={setRiskLevel} options={["low", "medium", "high", "critical"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} /></Field>
          <Field label="Lifecycle"><Select value={status} onValueChange={setStatus} options={["active", "paused", "draft"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} /></Field>
        </div>
        <Checkbox checked={requiresApproval} onCheckedChange={(v) => setRequiresApproval(v === true)} description="Require a human approval before execution.">Approval gate</Checkbox>
      </Panel>
      <Panel title="Configuration and schemas" description="JSON is validated before the API mutation is sent.">
        <Field label="Runtime configuration"><Textarea mono autoGrow={false} minRows={7} value={config} onChange={(e) => setConfig(e.target.value)} /></Field>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Input schema"><Textarea mono autoGrow={false} minRows={9} value={inputSchema} onChange={(e) => setInputSchema(e.target.value)} /></Field>
          <Field label="Output schema"><Textarea mono autoGrow={false} minRows={9} value={outputSchema} onChange={(e) => setOutputSchema(e.target.value)} /></Field>
        </div>
      </Panel>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="primary" loading={saving} onClick={() => void save()}>{id ? "Save changes" : "Register tool"}</Button></div>
    </div>
  );
}

export function AgentEditor({ id, onSaved, onCancel }: { id?: string; onSaved: (agent: Agent) => void | Promise<void>; onCancel: () => void }) {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [tools, setTools] = React.useState<Tool[]>([]);
  const [loading, setLoading] = React.useState(Boolean(id));
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState(""); const [role, setRole] = React.useState("");
  const [type, setType] = React.useState("native_llm_agent"); const [status, setStatus] = React.useState("active");
  const [instructions, setInstructions] = React.useState(""); const [connectionId, setConnectionId] = React.useState("none");
  const [modelName, setModelName] = React.useState(""); const [temperature, setTemperature] = React.useState("0.1");
  const [maxTokens, setMaxTokens] = React.useState("4096"); const [maxIterations, setMaxIterations] = React.useState("10");
  const [allowedToolIds, setAllowedToolIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    void Promise.all([api.connections.list({ ...scope, page: 1, pageSize: 100 }), api.tools.list({ ...scope, page: 1, pageSize: 100 })]).then(([c, t]) => {
      if (alive) { setConnections(c.items.filter((item) => item.type === "llm")); setTools(t.items); }
    });
    if (id) void api.agents.get(id, scope).then((agent) => {
      if (!alive) return;
      setName(agent.name); setRole(agent.role ?? ""); setType(agent.type); setStatus(agent.status); setInstructions(agent.instructions ?? "");
      setConnectionId(agent.llmConnectionId ?? "none"); setModelName(agent.modelName ?? ""); setTemperature(String(agent.temperature ?? 0.1));
      setMaxTokens(String(agent.maxTokens ?? 4096)); setMaxIterations(String(agent.maxIterations ?? 10)); setAllowedToolIds(agent.allowedToolIds);
    }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load agent."))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, id, scope]);

  async function save() {
    if (!name.trim()) { toast.error("Agent name is required."); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(), role: role.trim() || null, type, status, instructions: instructions.trim(),
        llmConnectionId: connectionId === "none" ? null : connectionId, modelName: modelName.trim() || null,
        temperature: Number(temperature), maxTokens: Number(maxTokens) || 4096, maxIterations: Number(maxIterations) || 10,
        allowedToolIds, memoryPolicy: { type: "session" }, retryPolicy: { maxAttempts: 2 },
        timeoutPolicy: { timeoutMs: 60000 }, approvalPolicy: {}, outputSchema: {},
      };
      const result = id ? await api.agents.update(id, body, scope) : await api.agents.create(body, scope);
      toast.success(id ? "Agent updated." : "Agent registered."); await onSaved(result);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save agent."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="border-subtle bg-surface-raised h-48 animate-pulse rounded-lg border" />;
  return (
    <div className="grid gap-3">
      <Panel title="Identity and behaviour" description="Reusable identity and the instructions that define agent behaviour.">
        <div className="grid gap-4 md:grid-cols-2"><Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Role"><Input value={role} onChange={(e) => setRole(e.target.value)} /></Field></div>
        <div className="grid gap-4 md:grid-cols-2"><Field label="Agent type"><Select disabled={Boolean(id)} value={type} onValueChange={setType} options={[
          ["native_llm_agent", "Native LLM agent"], ["iterative_agent", "Iterative agent"], ["tool_agent", "Tool agent"], ["router_agent", "Router agent"], ["approval_agent", "Approval agent"], ["external_instrumented_agent", "External instrumented agent"],
        ].map(([value, label]) => ({ value: value!, label: label! }))} /></Field><Field label="Lifecycle"><Select value={status} onValueChange={setStatus} options={["active", "paused", "draft"].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))} /></Field></div>
        <Field label="System instructions" required><Textarea mono minRows={8} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
      </Panel>
      <Panel title="Model and limits" description="Model selection is bound to a registered LLM connection; limits are persisted with the agent.">
        <div className="grid gap-4 md:grid-cols-2"><Field label="LLM connection"><Select value={connectionId} onValueChange={setConnectionId} options={[{ value: "none", label: "Workspace default" }, ...connections.map((c) => ({ value: c.id, label: `${c.name} · ${c.provider}` }))]} /></Field><Field label="Model"><Input mono value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="gpt-5" /></Field></div>
        <div className="grid gap-4 md:grid-cols-3"><Field label="Temperature"><Input mono type="number" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} /></Field><Field label="Max tokens"><Input mono type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} /></Field><Field label="Max iterations"><Input mono type="number" value={maxIterations} onChange={(e) => setMaxIterations(e.target.value)} /></Field></div>
      </Panel>
      <Panel title="Tool grants" description="Only explicitly granted tools can be called by this agent.">
        {tools.length === 0 ? <Text variant="body-sm" tone="muted">No tools are registered yet.</Text> : <div className="grid gap-2 md:grid-cols-2">{tools.map((tool) => <Checkbox key={tool.id} checked={allowedToolIds.includes(tool.id)} onCheckedChange={(v) => setAllowedToolIds((current) => v === true ? [...new Set([...current, tool.id])] : current.filter((item) => item !== tool.id))} description={`${tool.riskLevel} risk`}>{tool.name}</Checkbox>)}</div>}
      </Panel>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="primary" loading={saving} onClick={() => void save()}>{id ? "Save changes" : "Register agent"}</Button></div>
    </div>
  );
}
