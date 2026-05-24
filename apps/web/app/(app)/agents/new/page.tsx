"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Agent, AgentType, ApprovalPolicy, MemoryPolicy, RetryPolicy, TimeoutPolicy, Tool } from "@/types/platform";
import type { Connection } from "@/types/connections";
import { LLM_PROVIDER_MODELS } from "@/types/connections";
import { createAgent, getTools, getConnectionsByType } from "@/lib/repository";

// ─── Constants ────────────────────────────────────────────────────────────────

const LLM_AGENT_TYPES = new Set<AgentType>(["native_llm_agent", "router_agent", "imported_langgraph_node"]);

const AGENT_TYPES: { type: AgentType; label: string; description: string }[] = [
  { type: "native_llm_agent",            label: "Native LLM Agent",           description: "Direct LLM calls with tool use. Vectorbee owns execution, replay, and checkpoints." },
  { type: "tool_agent",                  label: "Tool Agent",                  description: "Primarily orchestrates tool calls in sequence or parallel." },
  { type: "router_agent",               label: "Router Agent",                description: "Delegates tasks to sub-agents based on input or context." },
  { type: "approval_agent",             label: "Approval Agent",              description: "Pauses workflow execution and waits for a human decision." },
  { type: "imported_langgraph_node",    label: "LangGraph Node",              description: "Imported from a LangGraph graph. Events are observed, not owned." },
  { type: "external_instrumented_agent", label: "External Instrumented Agent", description: "External code with the Vectorbee SDK. Events pushed from the outside." },
];


const MEMORY_TYPES: { type: MemoryPolicy["type"]; label: string; description: string }[] = [
  { type: "none",       label: "None",            description: "No memory between calls." },
  { type: "session",    label: "Run only",         description: "Memory lives within a single run." },
  { type: "persistent", label: "Workflow scoped",  description: "Shared across runs in the same workflow." },
  { type: "vector",     label: "Vector store",     description: "Long-term semantic memory via vector store." },
];

// ─── Field helpers ─────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
      {label}
    </p>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary";
const selectCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewAgentPage() {
  const router = useRouter();
  const [tools, setTools] = useState<Tool[]>([]);
  const [llmConnections, setLlmConnections] = useState<Connection[]>([]);
  const [saving, setSaving] = useState(false);

  // Identity
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("");
  const [type, setType] = useState<AgentType>("native_llm_agent");
  const [status, setStatus] = useState<Agent["status"]>("active");

  // LLM Connection
  const [llmConnectionId, setLlmConnectionId] = useState<string>("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("0.1");
  const [maxIter, setMaxIter] = useState("10");

  // Instructions
  const [instructions, setInstructions] = useState("");

  // Tools
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  // Policies
  const [memoryType, setMemoryType] = useState<MemoryPolicy["type"]>("session");
  const [retryAttempts, setRetryAttempts] = useState("2");
  const [retryBackoff, setRetryBackoff] = useState<RetryPolicy["backoffType"]>("exponential");
  const [retryBackoffMs, setRetryBackoffMs] = useState("2000");
  const [stepTimeoutMs, setStepTimeoutMs] = useState("60000");
  const [runTimeoutMs, setRunTimeoutMs] = useState("600000");
  const [requireApproval, setRequireApproval] = useState(false);
  const [onTimeout, setOnTimeout] = useState<ApprovalPolicy["onTimeout"]>("pause");

  useEffect(() => {
    void getTools().then(setTools);
    void getConnectionsByType("llm_provider").then((conns) => {
      setLlmConnections(conns);
      if (conns.length > 0 && conns[0]) {
        setLlmConnectionId(conns[0].id);
        const cfg = conns[0].config as import("@/types/connections").LlmConnectionConfig;
        setModel(cfg.defaultModel);
      }
    });
  }, []);

  function handleLlmConnectionChange(connId: string) {
    setLlmConnectionId(connId);
    const conn = llmConnections.find(c => c.id === connId);
    if (conn) {
      const cfg = conn.config as import("@/types/connections").LlmConnectionConfig;
      setModel(cfg.defaultModel);
    }
  }

  const selectedLlmConn = llmConnections.find(c => c.id === llmConnectionId);
  const availableModels: string[] = selectedLlmConn
    ? (selectedLlmConn.config as import("@/types/connections").LlmConnectionConfig).allowedModels
    : [];

  function toggleTool(id: string) {
    setSelectedTools((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleCreate() {
    if (!name.trim()) { toast.error("Agent name is required."); return; }
    setSaving(true);
    try {
      const retryPolicy: RetryPolicy = {
        maxAttempts: parseInt(retryAttempts) || 2,
        backoffType: retryBackoff,
        backoffMs: parseInt(retryBackoffMs) || 2000,
      };
      const timeoutPolicy: TimeoutPolicy = {
        stepTimeoutMs: parseInt(stepTimeoutMs) || 60000,
        runTimeoutMs: parseInt(runTimeoutMs) || 600000,
      };
      const memoryPolicy: MemoryPolicy = { type: memoryType };
      const approvalPolicy: ApprovalPolicy = {
        requireApproval,
        onTimeout: requireApproval ? onTimeout : undefined,
      };

      const agent = await createAgent({
        name: name.trim(),
        description: description.trim(),
        role: role.trim(),
        type,
        status,
        instructions: instructions.trim(),
        modelProvider: selectedLlmConn ? (selectedLlmConn.config as import("@/types/connections").LlmConnectionConfig).provider : "",
        modelName: model,
        temperature: parseFloat(temperature) || 0.1,
        maxIterations: parseInt(maxIter) || 10,
        allowedToolIds: selectedTools,
        llmConnectionId: llmConnectionId || null,
        memoryPolicy,
        retryPolicy,
        timeoutPolicy,
        approvalPolicy,
      });
      toast.success("Agent created.");
      router.push(`/agents/${agent.id}` as never);
    } catch {
      toast.error("Failed to create agent.");
    } finally {
      setSaving(false);
    }
  }

  const needsLlmConnection = LLM_AGENT_TYPES.has(type);

  return (
    <div className="mx-auto max-w-2xl p-7 lg:p-8 max-w-[1320px]">
      {/* Breadcrumb */}
      <Link href={"/agents" as never} className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Agent Registry
      </Link>

      <div>
        <h1 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          New Agent
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register a reusable agent definition. Workflows reference agents by ID.
        </p>
      </div>

      {/* ── Identity ─────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <SectionHeader label="Identity" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Risk Analysis Agent" />
          </Field>
          <Field label="Role">
            <input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Analysis" />
          </Field>
          <div className="col-span-2">
            <Field label="Description">
              <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Analyzes customer renewal risk using CRM and support data." />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Status">
              <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as Agent["status"])}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="deprecated">Deprecated</option>
              </select>
            </Field>
          </div>
        </div>
      </section>

      {/* ── Agent Type ───────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <SectionHeader label="Agent Type" />
        <div className="grid grid-cols-2 gap-2">
          {AGENT_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => setType(t.type)}
              className={`rounded-lg border p-3 text-left transition-all ${
                type === t.type
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/60 hover:border-border"
              }`}
              style={{ background: type === t.type ? undefined : "var(--surface-2)" }}
            >
              <p className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{t.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── LLM Connection ───────────────────────────────────────────── */}
      {needsLlmConnection && (
        <section className="space-y-4 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
          <SectionHeader label="LLM Connection" />

          {llmConnections.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 rounded-lg border border-border/40" style={{ background: "var(--surface-2)" }}>
              <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>No LLM provider configured</p>
              <p className="text-[11px] text-muted-foreground">Add an LLM Provider connection before creating a native LLM agent.</p>
              <Link
                href={"/connections/new" as never}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{ background: "rgba(56,189,248,0.1)", color: "#38BDF8", border: "1px solid rgba(56,189,248,0.2)" }}
              >
                Add LLM Provider Connection
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="LLM Provider Connection" required>
                <select
                  className={selectCls}
                  value={llmConnectionId}
                  onChange={(e) => handleLlmConnectionChange(e.target.value)}
                >
                  {llmConnections.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>
                  ))}
                </select>
              </Field>
              <Field label="Model" required>
                <select className={selectCls} value={model} onChange={(e) => setModel(e.target.value)}>
                  {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Temperature">
                <input type="number" min="0" max="2" step="0.05" className={inputCls} value={temperature} onChange={(e) => setTemperature(e.target.value)} />
              </Field>
              <Field label="Max Iterations">
                <input type="number" min="1" max="100" className={inputCls} value={maxIter} onChange={(e) => setMaxIter(e.target.value)} />
              </Field>
            </div>
          )}
        </section>
      )}

      {/* ── Instructions ─────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <SectionHeader label="System Prompt / Instructions" />
        <textarea
          rows={9}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] leading-5 focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={`You are a ${role || "specialized"} agent. Your goal is to...\n\nWhen given a task, you should:\n1. ...`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </section>

      {/* ── Allowed Tools ────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <div className="flex items-center justify-between">
          <SectionHeader label="Allowed Tools" />
          <span className="text-[11px] text-muted-foreground">{selectedTools.length} selected</span>
        </div>
        {tools.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            No tools registered yet.{" "}
            <Link href={"/tools/new" as never} className="text-primary hover:underline">Register a tool →</Link>
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {tools.map((t) => (
              <label
                key={t.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                  selectedTools.includes(t.id)
                    ? "border-primary/30 bg-primary/5"
                    : "border-border/40 hover:border-border",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded accent-primary"
                  checked={selectedTools.includes(t.id)}
                  onChange={() => toggleTool(t.id)}
                />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{t.type.replace(/_/g, " ")} · {t.riskLevel.replace(/_/g, " ")}</p>
                </div>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* ── Memory Policy ────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <SectionHeader label="Memory Policy" />
        <div className="grid grid-cols-2 gap-2">
          {MEMORY_TYPES.map((m) => (
            <button
              key={m.type}
              type="button"
              onClick={() => setMemoryType(m.type)}
              className={`rounded-lg border p-3 text-left transition-all ${
                memoryType === m.type ? "border-primary/40 bg-primary/5" : "border-border/60 hover:border-border"
              }`}
              style={{ background: memoryType === m.type ? undefined : "var(--surface-2)" }}
            >
              <p className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{m.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{m.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Retry & Timeout ──────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <SectionHeader label="Retry & Timeout" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max retry attempts">
            <input type="number" min="0" max="10" className={inputCls} value={retryAttempts} onChange={(e) => setRetryAttempts(e.target.value)} />
          </Field>
          <Field label="Backoff type">
            <select className={selectCls} value={retryBackoff} onChange={(e) => setRetryBackoff(e.target.value as RetryPolicy["backoffType"])}>
              <option value="exponential">Exponential</option>
              <option value="fixed">Fixed</option>
            </select>
          </Field>
          <Field label="Backoff base (ms)">
            <input type="number" min="0" className={inputCls} value={retryBackoffMs} onChange={(e) => setRetryBackoffMs(e.target.value)} />
          </Field>
          <Field label="Step timeout (ms)">
            <input type="number" min="0" className={inputCls} value={stepTimeoutMs} onChange={(e) => setStepTimeoutMs(e.target.value)} />
          </Field>
          <div className="col-span-2">
            <Field label="Run timeout (ms)">
              <input type="number" min="0" className={inputCls} value={runTimeoutMs} onChange={(e) => setRunTimeoutMs(e.target.value)} />
            </Field>
          </div>
        </div>
      </section>

      {/* ── Approval Policy ──────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <SectionHeader label="Approval Policy" />
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded accent-primary"
            checked={requireApproval}
            onChange={(e) => setRequireApproval(e.target.checked)}
          />
          <div>
            <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
              Require approval before this agent executes
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Run will pause at this agent and wait for a human decision.
            </p>
          </div>
        </label>
        {requireApproval && (
          <div className="mt-2">
            <Field label="On approval timeout">
              <select className={selectCls} value={onTimeout} onChange={(e) => setOnTimeout(e.target.value as ApprovalPolicy["onTimeout"])}>
                <option value="pause">Keep paused</option>
                <option value="auto_approve">Auto-approve</option>
                <option value="auto_reject">Auto-reject</option>
              </select>
            </Field>
          </div>
        )}
      </section>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pb-8">
        <Link
          href={"/agents" as never}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={saving || !name.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Create Agent
        </button>
      </div>
    </div>
  );
}
