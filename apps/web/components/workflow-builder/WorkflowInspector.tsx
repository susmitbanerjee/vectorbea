"use client";

/**
 * WorkflowInspector — right panel.
 * Shows node-specific config when a node is selected,
 * or workflow-level stats + validation when nothing is selected.
 */

import { useState, useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Code2,
  Info,
  List,
  Settings2,
  Shield,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppSelectFromChildren } from "@/components/ui/app-select";
import { getNodeMeta } from "./NodeIcon";
import { InputMappingRow } from "./mapping/InputMappingRow";
import { ConditionBuilder } from "./mapping/ConditionBuilder";
import { buildAvailableFieldsForNode, getNodeOutputFields } from "@/lib/workflows/field-discovery";
import { decompileExpression, compileMapping, compileConditionGroup } from "@/lib/workflows/mapping-compiler";
import type { VisualMapping, VisualConditionGroup, NodeInputField, FieldType } from "@/types/workflow-mapping";
import type {
  WFNodeData,
  WFEdgeData,
  WFNodeType,
  ValidationResult,
  AgentNodeConfig,
  LlmNodeConfig,
  ToolNodeConfig,
  ApprovalNodeConfig,
  BranchNodeConfig,
  ParallelNodeConfig,
  JoinNodeConfig,
  TimerNodeConfig,
  CheckpointNodeConfig,
  EndNodeConfig,
} from "@/types/workflow-graph";
import type { Agent, Tool } from "@/types/platform";

type WFNode = Node<WFNodeData>;
type WFEdge = Edge<WFEdgeData>;

// ─── Field helpers ────────────────────────────────────────────────────────────

function ILabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{children}</p>;
}

function IInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      className={cn("w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder:text-slate-400 transition-colors", mono && "font-mono")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function ITextarea({ value, onChange, placeholder, rows = 3, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <textarea
      rows={rows}
      className={cn("w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder:text-slate-400 transition-colors", mono && "font-mono text-[11px]")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function ISelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <AppSelectFromChildren value={value} onChange={onChange} className="w-full">
      {children}
    </AppSelectFromChildren>
  );
}

function INumber({ value, onChange, min }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <input
      type="number"
      min={min}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-colors"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function ICheck({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 rounded" />
      <span className="text-[12px] text-slate-600">{label}</span>
    </label>
  );
}

function IDivider() { return <div className="my-4 border-t border-slate-100" />; }

function ISection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-2 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400 hover:text-slate-600 transition-colors">
        {title}
        <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="space-y-3 pb-2">{children}</div>}
    </div>
  );
}

const LLM_PROVIDERS = ["openai", "anthropic", "local"] as const;
const LLM_MODELS: Record<string, string[]> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-3-5", "claude-opus-4"],
  local: ["llama-3.3-70b", "mistral-7b", "custom"],
};

// ─── Per-type config panels ───────────────────────────────────────────────────

function AgentConfig({ data, onChange, agents }: { data: WFNodeData; onChange: (d: WFNodeData) => void; agents: Agent[] }) {
  const cfg: AgentNodeConfig = data.agentConfig ?? {};
  function set(patch: Partial<AgentNodeConfig>) { onChange({ ...data, agentConfig: { ...cfg, ...patch } }); }
  const retry = cfg.retryPolicy ?? { maxAttempts: 2, backoffType: "exponential" as const, backoffMs: 2000 };
  const selectedAgent = agents.find(a => a.id === cfg.agentId);

  // Brain loop: enabled when agent type is iterative_agent OR explicitly toggled on at node level
  const agentIsIterative = selectedAgent?.type === "iterative_agent";
  const brainEnabled = (cfg as Record<string, unknown>).brainEnabled as boolean | undefined
    ?? agentIsIterative;

  function setBrainEnabled(v: boolean) {
    set({ brainEnabled: v } as Partial<AgentNodeConfig>);
  }

  return (
    <div className="space-y-3">
      <ISection title="Identity">
        <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
        <div><ILabel>Description</ILabel><ITextarea rows={2} value={data.description ?? ""} onChange={(v) => onChange({ ...data, description: v })} placeholder="What does this agent do?" /></div>
        <div>
          <ILabel>Registered Agent</ILabel>
          <ISelect value={cfg.agentId ?? ""} onChange={(v) => {
            const agent = agents.find((a) => a.id === v);
            const iterative = agent?.type === "iterative_agent";
            set({ agentId: v || undefined, agentName: agent?.name, modelName: agent?.modelName, brainEnabled: iterative } as Partial<AgentNodeConfig>);
          }}>
            <option value="">— select agent —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.modelName ?? a.type})</option>)}
          </ISelect>
        </div>
        {cfg.agentName && (
          <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
            <Bot className="h-3.5 w-3.5 text-violet-600 shrink-0" />
            <div>
              <p className="text-[11px] font-semibold text-violet-800">{cfg.agentName}</p>
              <p className="text-[10px] text-slate-500">
                {cfg.modelName && <span>{cfg.modelName}</span>}
                {agentIsIterative && <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-px text-[9px] font-bold text-violet-700 uppercase tracking-wide">Iterative</span>}
              </p>
            </div>
          </div>
        )}
      </ISection>

      {/* Task instruction */}
      <IDivider />
      <ISection title="Task">
        <div>
          <ILabel>Task instruction for this step</ILabel>
          <ITextarea
            rows={3}
            value={(cfg as Record<string, unknown>).taskInstruction as string ?? ""}
            onChange={(v) => set({ ...cfg, taskInstruction: v } as Partial<AgentNodeConfig>)}
            placeholder="Describe what this agent should accomplish in this workflow step…"
          />
          <p className="mt-1 text-[11px] text-slate-400">This overrides the agent&apos;s default instructions for this specific step.</p>
        </div>
      </ISection>

      {/* ── Agent Brain ─────────────────────────────────────────────────────── */}
      <IDivider />
      <ISection title="Agent Brain">
        {/* Toggle — always visible so users can discover the brain feature */}
        <div
          className="flex items-center justify-between rounded-xl border px-3 py-2.5 cursor-pointer"
          style={{
            borderColor: brainEnabled ? "#DDD6FE" : "#E2E8F0",
            background:  brainEnabled ? "#F5F3FF" : "#F8FAFC",
          }}
          onClick={() => setBrainEnabled(!brainEnabled)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setBrainEnabled(!brainEnabled)}
        >
          <div>
            <p className="text-[12px] font-semibold" style={{ color: brainEnabled ? "#5B21B6" : "#334155" }}>
              Iterative brain loop
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: brainEnabled ? "#7C3AED" : "#94A3B8" }}>
              {brainEnabled
                ? "Agent will plan → act → observe → decide across multiple iterations"
                : "Enable to let this agent iterate with tools until it produces a final answer"}
            </p>
          </div>
          <div
            className="relative ml-3 h-5 w-9 shrink-0 rounded-full transition-colors"
            style={{ background: brainEnabled ? "#7C3AED" : "#CBD5E1" }}
          >
            <span
              className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
              style={{ transform: brainEnabled ? "translateX(16px)" : "translateX(2px)" }}
            />
          </div>
        </div>

        {/* Brain limits — expanded when brain is enabled */}
        {brainEnabled && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <ILabel>Max iterations</ILabel>
                <INumber
                  value={(cfg as Record<string, unknown>).maxIterations as number ?? 5}
                  onChange={(v) => set({ maxIterations: v } as Partial<AgentNodeConfig>)}
                  min={1}
                />
              </div>
              <div>
                <ILabel>Max tool calls</ILabel>
                <INumber
                  value={(cfg as Record<string, unknown>).maxToolCalls as number ?? 10}
                  onChange={(v) => set({ maxToolCalls: v } as Partial<AgentNodeConfig>)}
                  min={0}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <ILabel>Max tokens</ILabel>
                <INumber
                  value={(cfg as Record<string, unknown>).maxTotalTokens as number ?? 16384}
                  onChange={(v) => set({ maxTotalTokens: v } as Partial<AgentNodeConfig>)}
                  min={256}
                />
              </div>
              <div>
                <ILabel>Max cost (¢)</ILabel>
                <INumber
                  value={(cfg as Record<string, unknown>).maxCostCents as number ?? 50}
                  onChange={(v) => set({ maxCostCents: v } as Partial<AgentNodeConfig>)}
                  min={1}
                />
              </div>
            </div>
            <div>
              <ILabel>Output schema (JSON)</ILabel>
              <ITextarea
                rows={3}
                mono
                value={(cfg as Record<string, unknown>).outputSchemaJson as string ?? "{}"}
                onChange={(v) => set({ outputSchemaJson: v } as Partial<AgentNodeConfig>)}
                placeholder='{ "required": ["summary", "action"] }'
              />
              <p className="mt-1 text-[10.5px] text-slate-400">
                JSON Schema the final output must satisfy. Leave <code className="font-mono">{"{}"}</code> to skip validation.
              </p>
            </div>
            <div
              className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2"
              style={{ fontSize: 11, color: "#5B21B6" }}
            >
              Budget limits are enforced by the worker — the agent cannot exceed them regardless of LLM responses.
            </div>
          </div>
        )}
      </ISection>

      <IDivider />
      <ISection title="Retry Policy">
        <div className="grid grid-cols-2 gap-2">
          <div><ILabel>Max attempts</ILabel><INumber value={retry.maxAttempts} onChange={(v) => set({ retryPolicy: { ...retry, maxAttempts: v } })} min={1} /></div>
          <div><ILabel>Backoff</ILabel>
            <ISelect value={retry.backoffType} onChange={(v) => set({ retryPolicy: { ...retry, backoffType: v as "fixed" | "exponential" } })}>
              <option value="exponential">Exponential</option>
              <option value="fixed">Fixed</option>
            </ISelect>
          </div>
        </div>
        <div><ILabel>Backoff (ms)</ILabel><INumber value={retry.backoffMs} onChange={(v) => set({ retryPolicy: { ...retry, backoffMs: v } })} min={0} /></div>
      </ISection>
      <IDivider />
      <ISection title="Input Mapping">
        <MappingEditor label="" mapping={cfg.inputMapping ?? {}} onChange={(m) => set({ inputMapping: m })} keyPlaceholder="param_name" valuePlaceholder="{{input.field}}" />
      </ISection>
      <IDivider />
      <ISection title="Output Mapping">
        <MappingEditor label="" mapping={cfg.outputMapping ?? {}} onChange={(m) => set({ outputMapping: m })} keyPlaceholder="output_key" valuePlaceholder="{{steps.N.output.field}}" />
      </ISection>
      <IDivider />
      <ICheck id={`ckpt-${data.label}`} checked={cfg.checkpointEnabled ?? false} onChange={(v) => set({ checkpointEnabled: v })} label="Enable checkpoint (allows replay from here)" />
    </div>
  );
}

function LlmConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: LlmNodeConfig = data.llmConfig ?? { provider: "openai", model: "gpt-4.1-mini", userPromptTemplate: "", prompt: "", validationEnabled: false };
  function set(patch: Partial<LlmNodeConfig>) { onChange({ ...data, llmConfig: { ...cfg, ...patch } }); }
  const models = LLM_MODELS[cfg.provider] ?? [];
  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><ILabel>Provider</ILabel>
          <ISelect value={cfg.provider} onChange={(v) => set({ provider: v, model: (LLM_MODELS[v] ?? [])[0] ?? "" })}>
            {LLM_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </ISelect>
        </div>
        <div><ILabel>Model</ILabel>
          <ISelect value={cfg.model} onChange={(v) => set({ model: v })}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </ISelect>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><ILabel>Temperature</ILabel><INumber value={cfg.temperature ?? 0.1} onChange={(v) => set({ temperature: v })} min={0} /></div>
        <div><ILabel>Max tokens</ILabel><INumber value={cfg.maxTokens ?? 2048} onChange={(v) => set({ maxTokens: v })} min={1} /></div>
      </div>
      <div><ILabel>Prompt / Instructions</ILabel>
        <ITextarea rows={5} value={cfg.prompt ?? ""} onChange={(v) => set({ prompt: v, userPromptTemplate: v })} placeholder="You are a helpful assistant…" />
      </div>
      <ICheck id={`validate-llm-${data.label}`} checked={cfg.validationEnabled ?? false} onChange={(v) => set({ validationEnabled: v })} label="Validate output against schema" />
      <ICheck id={`ckpt-llm-${data.label}`} checked={cfg.checkpointEnabled ?? false} onChange={(v) => set({ checkpointEnabled: v })} label="Enable checkpoint" />
    </div>
  );
}

// ─── Mapping editor (key → template expression pairs) ────────────────────────

function MappingEditor({
  label,
  mapping,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string;
  mapping: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const entries = Object.entries(mapping);

  function updateKey(idx: number, newKey: string) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => { next[i === idx ? newKey : k] = v; });
    onChange(next);
  }
  function updateValue(idx: number, newVal: string) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => { next[k] = i === idx ? newVal : v; });
    onChange(next);
  }
  function addRow() {
    onChange({ ...mapping, "": "" });
  }
  function removeRow(idx: number) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => { if (i !== idx) next[k] = v; });
    onChange(next);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <ILabel>{label}</ILabel>
        <button
          type="button"
          onClick={addRow}
          className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
        >
          + Add row
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-[10px] text-slate-400 italic px-1">No mappings — click &quot;Add row&quot; to start.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([k, v], idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              {/* Key */}
              <input
                className="w-[38%] shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder:text-slate-400"
                value={k}
                onChange={(e) => updateKey(idx, e.target.value)}
                placeholder={keyPlaceholder ?? "param"}
              />
              <span className="shrink-0 text-[10px] text-slate-400">←</span>
              {/* Value */}
              <input
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 placeholder:text-slate-400"
                value={v}
                onChange={(e) => updateValue(idx, e.target.value)}
                placeholder={valuePlaceholder ?? "{{input.field}}"}
              />
              {/* Remove */}
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="shrink-0 text-slate-400 hover:text-red-500 transition-colors"
                aria-label="Remove row"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tool node config ─────────────────────────────────────────────────────────

function ToolConfig({ data, onChange, tools }: { data: WFNodeData; onChange: (d: WFNodeData) => void; tools: Tool[] }) {
  const cfg: ToolNodeConfig = data.toolConfig ?? {};
  function set(patch: Partial<ToolNodeConfig>) { onChange({ ...data, toolConfig: { ...cfg, ...patch } }); }
  const tool = cfg.toolId ? tools.find((t) => t.id === cfg.toolId) : null;

  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>

      <div><ILabel>Registered Tool</ILabel>
        <ISelect value={cfg.toolId ?? ""} onChange={(v) => {
          const t = tools.find((x) => x.id === v);
          const uiToolType = (t?.config as Record<string, unknown> | undefined)?.uiToolType as string | undefined;
          set({
            toolId: v || undefined,
            toolName: t?.name,
            toolType: uiToolType ?? t?.type,
            riskLevel: t?.riskLevel,
            ...(uiToolType ? { uiToolType } : {}),
          } as Parameters<typeof set>[0]);
        }}>
          <option value="">— select tool —</option>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
        </ISelect>
      </div>

      {tool && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Risk</span><span className="font-semibold text-slate-700 capitalize">{(tool.riskLevel ?? "").replace(/_/g, " ")}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Idempotent</span><span className={tool.idempotent ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>{tool.idempotent ? "yes" : "no"}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Timeout</span><span className="text-slate-700">{tool.timeoutMs}ms</span></div>
        </div>
      )}

      {/* ── Input Mapping ── */}
      <MappingEditor
        label="Input Mapping"
        mapping={cfg.inputMapping ?? {}}
        onChange={(m) => set({ inputMapping: m })}
        keyPlaceholder="param_name"
        valuePlaceholder="{{input.field}}"
      />

      {/* ── Output Mapping ── */}
      <MappingEditor
        label="Output Mapping"
        mapping={cfg.outputMapping ?? {}}
        onChange={(m) => set({ outputMapping: m })}
        keyPlaceholder="output_key"
        valuePlaceholder="{{steps.N.output.field}}"
      />

      <ICheck id={`approval-tool-${data.label}`} checked={cfg.requireApproval ?? false} onChange={(v) => set({ requireApproval: v })} label="Require approval before executing" />
    </div>
  );
}

function ApprovalConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: ApprovalNodeConfig = data.approvalConfig ?? { title: "Approval Required", message: "", riskLevel: "medium" };
  function set(patch: Partial<ApprovalNodeConfig>) { onChange({ ...data, approvalConfig: { ...cfg, ...patch } }); }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-700 flex items-start gap-2">
        <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Run will pause here and wait for human approval before proceeding.</span>
      </div>
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div><ILabel>Approval Title</ILabel><IInput value={cfg.title} onChange={(v) => set({ title: v })} /></div>
      <div><ILabel>Message to Approver</ILabel><ITextarea rows={3} value={cfg.message} onChange={(v) => set({ message: v })} placeholder="Please review and approve to continue…" /></div>
      <div><ILabel>Risk Level</ILabel>
        <ISelect value={cfg.riskLevel} onChange={(v) => set({ riskLevel: v as ApprovalNodeConfig["riskLevel"] })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </ISelect>
      </div>
      <div><ILabel>Approver Role</ILabel><IInput value={cfg.approverRole ?? ""} onChange={(v) => set({ approverRole: v || undefined })} placeholder="admin, manager…" /></div>
      <div><ILabel>Timeout (ms, 0 = no timeout)</ILabel><INumber value={cfg.timeoutMs ?? 0} onChange={(v) => set({ timeoutMs: v > 0 ? v : undefined })} min={0} /></div>
    </div>
  );
}

function BranchConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: BranchNodeConfig = data.branchConfig ?? { conditionExpression: "", trueLabel: "True", falseLabel: "False" };
  function set(patch: Partial<BranchNodeConfig>) { onChange({ ...data, branchConfig: { ...cfg, ...patch } }); }
  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div>
        <ILabel>Condition Expression</ILabel>
        <ITextarea rows={3} mono value={cfg.conditionExpression} onChange={(v) => set({ conditionExpression: v })} placeholder="output.score >= 0.7 || input.priority === 'high'" />
        <p className="mt-1 text-[10px] text-slate-400">Use <code className="font-mono">input</code> or <code className="font-mono">output</code> to reference data.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><ILabel>True label</ILabel><IInput value={cfg.trueLabel ?? "True"} onChange={(v) => set({ trueLabel: v })} /></div>
        <div><ILabel>False label</ILabel><IInput value={cfg.falseLabel ?? "False"} onChange={(v) => set({ falseLabel: v })} /></div>
      </div>
    </div>
  );
}

function ParallelConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: ParallelNodeConfig = data.parallelConfig ?? { executionMode: "all" };
  function set(patch: Partial<ParallelNodeConfig>) { onChange({ ...data, parallelConfig: { ...cfg, ...patch } }); }
  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div><ILabel>Execution Mode</ILabel>
        <ISelect value={cfg.executionMode} onChange={(v) => set({ executionMode: v as ParallelNodeConfig["executionMode"] })}>
          <option value="all">Wait for all branches</option>
          <option value="first_success">First success wins</option>
          <option value="quorum">Quorum (N of M)</option>
        </ISelect>
      </div>
      {cfg.executionMode === "quorum" && (
        <div><ILabel>Quorum count</ILabel><INumber value={cfg.quorumCount ?? 2} onChange={(v) => set({ quorumCount: v })} min={1} /></div>
      )}
      <div><ILabel>Max concurrency (0 = unlimited)</ILabel><INumber value={cfg.maxConcurrency ?? 0} onChange={(v) => set({ maxConcurrency: v > 0 ? v : undefined })} min={0} /></div>
    </div>
  );
}

function JoinConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: JoinNodeConfig = data.joinConfig ?? { joinPolicy: "wait_all" };
  function set(patch: Partial<JoinNodeConfig>) { onChange({ ...data, joinConfig: { ...cfg, ...patch } }); }

  const outputMapping = cfg.outputMapping ?? {};
  function setOutputMapping(m: Record<string, string>) { set({ outputMapping: m }); }

  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>

      <div><ILabel>Join Policy</ILabel>
        <ISelect value={cfg.joinPolicy} onChange={(v) => set({ joinPolicy: v as JoinNodeConfig["joinPolicy"] })}>
          <option value="wait_all">Wait for all branches</option>
          <option value="wait_any">First branch wins</option>
          <option value="quorum">Quorum (N of M)</option>
        </ISelect>
      </div>

      <div>
        <ILabel>Incoming branches</ILabel>
        <INumber value={cfg.incomingBranchCount ?? 2} onChange={(v) => set({ incomingBranchCount: v })} min={2} />
        <p className="mt-1 text-[10px] text-slate-400">
          How many incoming edges to expect. Connect one edge from each parallel branch.
        </p>
      </div>

      {cfg.joinPolicy === "quorum" && (
        <div><ILabel>Quorum count</ILabel><INumber value={cfg.quorumCount ?? 2} onChange={(v) => set({ quorumCount: v })} min={1} /></div>
      )}

      <div><ILabel>Timeout (ms, 0 = no timeout)</ILabel><INumber value={cfg.timeoutMs ?? 0} onChange={(v) => set({ timeoutMs: v > 0 ? v : undefined })} min={0} /></div>
      <div><ILabel>On Timeout</ILabel>
        <ISelect value={cfg.onTimeout ?? "fail"} onChange={(v) => set({ onTimeout: v as JoinNodeConfig["onTimeout"] })}>
          <option value="fail">Fail run</option>
          <option value="continue_available">Continue with available results</option>
        </ISelect>
      </div>

      <IDivider />

      {/* Output mapping lets you name collected branch results before forwarding */}
      <MappingEditor
        label="Output Mapping (branch results → named keys)"
        mapping={outputMapping}
        onChange={setOutputMapping}
        keyPlaceholder="result_key"
        valuePlaceholder="{{steps.branch_step.output}}"
      />
      <p className="text-[10px] text-slate-400">
        Map each branch&apos;s output to a named key. The next node can reference these via <code className="font-mono">{"{{steps.<join_label>.output.<key>}}"}</code>.
      </p>
    </div>
  );
}

function TimerConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: TimerNodeConfig = data.timerConfig ?? { delayMs: 5000 };
  function set(patch: Partial<TimerNodeConfig>) { onChange({ ...data, timerConfig: { ...cfg, ...patch } }); }
  const seconds = Math.round(cfg.delayMs / 1000);
  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div>
        <ILabel>Delay (ms)</ILabel>
        <INumber value={cfg.delayMs} onChange={(v) => set({ delayMs: v })} min={0} />
        <p className="mt-1 text-[10px] text-muted-foreground/40">= {seconds >= 60 ? `${Math.round(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</p>
      </div>
      <div><ILabel>Resume policy</ILabel>
        <ISelect value={cfg.resumePolicy ?? "immediate"} onChange={(v) => set({ resumePolicy: v as TimerNodeConfig["resumePolicy"] })}>
          <option value="immediate">Immediately after delay</option>
          <option value="next_business_day">Next business day</option>
        </ISelect>
      </div>
    </div>
  );
}

function CheckpointConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: CheckpointNodeConfig = data.checkpointConfig ?? { checkpointName: "checkpoint" };
  function set(patch: Partial<CheckpointNodeConfig>) { onChange({ ...data, checkpointConfig: { ...cfg, ...patch } }); }
  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div><ILabel>Checkpoint Name</ILabel><IInput mono value={cfg.checkpointName} onChange={(v) => set({ checkpointName: v })} placeholder="post-analysis" /></div>
      <div>
        <ILabel>State Keys to Persist (comma-separated)</ILabel>
        <IInput value={(cfg.stateKeys ?? []).join(", ")} onChange={(v) => set({ stateKeys: v.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="userId, risk, score" />
      </div>
      <ICheck id={`replay-${data.label}`} checked={cfg.replayEnabled ?? true} onChange={(v) => set({ replayEnabled: v })} label="Allow replay from this checkpoint" />
    </div>
  );
}

function EndConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: EndNodeConfig = data.endConfig ?? {};
  function set(patch: Partial<EndNodeConfig>) { onChange({ ...data, endConfig: { ...cfg, ...patch } }); }
  return (
    <div className="space-y-3">
      <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div><ILabel>Terminal Status</ILabel>
        <ISelect value={cfg.terminalStatus ?? "succeeded"} onChange={(v) => set({ terminalStatus: v as EndNodeConfig["terminalStatus"] })}>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </ISelect>
      </div>
      <div><ILabel>Description</ILabel><IInput value={cfg.description ?? ""} onChange={(v) => set({ description: v })} placeholder="Why this terminal?" /></div>
    </div>
  );
}

function TriggerConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg = data.triggerConfig ?? { triggerType: "manual" as const };
  function set(patch: Partial<typeof cfg>) { onChange({ ...data, triggerConfig: { ...cfg, ...patch } }); }

  // Local draft string for the JSON textarea — lets user type freely; commits on valid JSON
  const [schemaDraft, setSchemaDraft] = useState<string>(
    cfg.inputSchema ? JSON.stringify(cfg.inputSchema, null, 2) : "",
  );
  const [schemaError, setSchemaError] = useState(false);

  function handleSchemaChange(v: string) {
    setSchemaDraft(v);
    if (v.trim() === "") {
      setSchemaError(false);
      set({ inputSchema: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(v) as Record<string, unknown>;
      setSchemaError(false);
      set({ inputSchema: parsed });
    } catch {
      setSchemaError(true);
      // don't commit invalid JSON to the graph
    }
  }

  return (
    <div className="space-y-3">
      <div><ILabel>Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
      <div><ILabel>Trigger Type</ILabel>
        <ISelect value={cfg.triggerType} onChange={(v) => set({ triggerType: v as typeof cfg.triggerType })}>
          <option value="manual">Manual</option>
          <option value="cron">Schedule (cron)</option>
          <option value="webhook">Webhook</option>
          <option value="api">API / Event</option>
          <option value="event">Event bus</option>
        </ISelect>
      </div>
      {cfg.triggerType === "cron" && <>
        <div><ILabel>Cron Expression</ILabel><IInput mono value={cfg.cronExpression ?? ""} onChange={(v) => set({ cronExpression: v })} placeholder="0 7 * * 1-5" /></div>
        <div><ILabel>Timezone</ILabel><IInput value={cfg.timezone ?? ""} onChange={(v) => set({ timezone: v })} placeholder="America/New_York" /></div>
      </>}
      {cfg.triggerType === "webhook" && (
        <div><ILabel>Webhook Path</ILabel><IInput mono value={cfg.webhookPath ?? ""} onChange={(v) => set({ webhookPath: v })} placeholder="/webhooks/my-workflow" /></div>
      )}
      <div>
        <ILabel>Input Schema (JSON)</ILabel>
        <ITextarea
          rows={6}
          mono
          value={schemaDraft}
          onChange={handleSchemaChange}
          placeholder={`{\n  "type": "object",\n  "properties": {\n    "days_ahead": { "type": "integer" },\n    "limit": { "type": "integer" }\n  }\n}`}
        />
        {schemaError && (
          <p className="mt-1 text-[10px] text-red-400">Invalid JSON — fix syntax to save.</p>
        )}
        {!schemaError && (
          <p className="mt-1 text-[10px] text-muted-foreground/50">JSON Schema for workflow inputs. Saved automatically when valid.</p>
        )}
      </div>
      <div><ILabel>Description</ILabel><ITextarea rows={2} value={data.description ?? ""} onChange={(v) => onChange({ ...data, description: v })} placeholder="When does this trigger?" /></div>
    </div>
  );
}

// ─── Validation summary ───────────────────────────────────────────────────────

function ValidationSummary({ validation, nodes, edges }: { validation: ValidationResult | null; nodes: WFNode[]; edges: WFEdge[] }) {
  const sev = validation?.issues ?? [];
  const errors = sev.filter((i) => i.severity === "error");
  const warnings = sev.filter((i) => i.severity === "warning");
  const infos = sev.filter((i) => i.severity === "info");

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Nodes", value: nodes.length },
          { label: "Edges", value: edges.length },
          { label: "Issues", value: sev.length, color: sev.length > 0 ? (errors.length > 0 ? "text-red-600" : "text-amber-600") : "text-emerald-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <p className={cn("text-[18px] font-bold", color)}>{value}</p>
            <p className="text-[10px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Replay support */}
      {validation && (
        <div className={cn("rounded-lg border px-3 py-2.5 text-[12px]",
          validation.replaySupport === "full" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
          validation.replaySupport === "partial" ? "border-amber-200 bg-amber-50 text-amber-700" :
          "border-slate-200 bg-slate-50 text-slate-600")}>
          <span className="font-semibold">Replay: </span>
          {validation.replaySupport === "full" ? "Full replay available" :
           validation.replaySupport === "partial" ? "Partial replay (add checkpoints)" :
           "No replay configured"}
        </div>
      )}

      {/* Issues */}
      {sev.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="text-[12px] font-medium text-emerald-700">Workflow is valid</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...errors, ...warnings, ...infos].map((issue, i) => {
            const Icon = issue.severity === "error" ? XCircle : issue.severity === "warning" ? AlertTriangle : Info;
            const color = issue.severity === "error" ? "text-red-700" : issue.severity === "warning" ? "text-amber-700" : "text-blue-700";
            return (
              <div key={i} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2",
                issue.severity === "error" ? "border-red-200 bg-red-50" :
                issue.severity === "warning" ? "border-amber-200 bg-amber-50" :
                "border-blue-200 bg-blue-50")}>
                <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", color)} />
                <p className={cn("text-[11px]", color)}>{issue.message}</p>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-[11px] text-slate-400">Select a node to configure it</p>
    </div>
  );
}

// ─── Main inspector ───────────────────────────────────────────────────────────

interface WorkflowInspectorProps {
  selectedNode: WFNode | null;
  nodes: WFNode[];
  edges: WFEdge[];
  agents: Agent[];
  tools: Tool[];
  validation: ValidationResult | null;
  onUpdateNode: (id: string, data: WFNodeData) => void;
  onDeleteNode: (id: string) => void;
}

export function WorkflowInspector(props: WorkflowInspectorProps) {
  if (!props.selectedNode) {
    return <EmptyInspector {...props} />;
  }
  return <NodeInspector {...props} selectedNode={props.selectedNode} />;
}

function EmptyInspector({
  nodes,
  edges,
  validation,
}: WorkflowInspectorProps) {
    const nodeCount = nodes.length;
    const edgeCount = edges.length;
    const issueCount = validation?.issues?.length ?? 0;
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Panel header */}
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-3" style={{ borderBottom: "1px solid #E2E8F0" }}>
          <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-slate-400">
            Inspector
          </span>
        </div>
        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-px" style={{ borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
          {[
            { label: "Nodes", value: nodeCount, color: "#7C3AED" },
            { label: "Edges", value: edgeCount, color: "#0891B2" },
            { label: "Issues", value: issueCount, color: issueCount > 0 ? "#DC2626" : "#16A34A" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-0.5 bg-white py-3">
              <span className="text-[18px] font-bold tabular-nums" style={{ color: s.color }}>{s.value}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ValidationSummary validation={validation} nodes={nodes} edges={edges} />
        </div>
        {/* Footer hint */}
        <div className="shrink-0 px-4 py-3" style={{ borderTop: "1px solid #E2E8F0" }}>
          <p className="text-[10px] text-slate-400 text-center">
            Click a node to configure it
          </p>
        </div>
      </div>
    );
}

// ─── NodeInspector (separate component so hooks run unconditionally) ───────────

function NodeInspector({
  selectedNode,
  nodes,
  edges,
  agents,
  tools,
  validation,
  onUpdateNode,
  onDeleteNode,
}: WorkflowInspectorProps & { selectedNode: WFNode }) {
  const { data } = selectedNode;
  const meta = getNodeMeta(data.nodeType as WFNodeType);
  const Icon = meta.icon;
  const nodeId = selectedNode.id;

  // Tab state
  type InspectorTab = "configure" | "inputs" | "conditions" | "advanced";
  const [activeTab, setActiveTab] = useState<InspectorTab>("configure");

  // Visual mappings state (keyed by input field name)
  const [visualMappings, setVisualMappings] = useState<Record<string, VisualMapping>>(() => {
    // Initialise from existing inputMapping expressions
    const existing = data.agentConfig?.inputMapping ?? data.toolConfig?.inputMapping ?? {};
    return Object.fromEntries(
      Object.entries(existing).map(([k, v]) => [k, decompileExpression(v as string)])
    );
  });

  // Visual condition for branch nodes
  const [visualCondition, setVisualCondition] = useState<VisualConditionGroup>(() => {
    const raw = data.branchConfig?.conditionExpression ?? "";
    return {
      id: "root",
      logic: "and",
      conditions: [{
        id: crypto.randomUUID(),
        left: { type: "field", sourceId: "workflow_input", path: "input" },
        operator: "equals",
        rightLiteral: "",
      }],
    };
  });

  // Discover upstream field sources
  const fieldSources = useMemo(() =>
    buildAvailableFieldsForNode(nodeId, nodes as Node<WFNodeData>[], edges),
    [nodeId, nodes, edges]
  );

  // Build input fields for the current node type
  const inputFields = useMemo((): NodeInputField[] => {
    const cfg = data;
    const nt = cfg.nodeType as WFNodeType;
    const base = (key: string, label: string, type: FieldType, required = false, desc?: string): NodeInputField => ({
      key, label, type, required, description: desc,
      mapping: visualMappings[key] ?? { type: "unset" },
    });
    switch (nt) {
      case "agent":
        return [
          base("agentId", "Agent",      "string",  true,  "The registered Vectorbea agent to run"),
          base("task",    "Task / Goal", "string",  false, "Override the default task instruction"),
        ];
      case "llm":
        return [
          base("prompt",  "Prompt",     "string",  true,  "The prompt to send to the LLM"),
          base("context", "Context",    "object",  false, "Additional context data"),
        ];
      case "tool":
        return [
          base("toolId",  "Tool",       "string",  true,  "The registered tool to call"),
          ...Object.keys(data.toolConfig?.inputMapping ?? {}).map(k =>
            base(k, k, "any", false)
          ),
        ];
      case "db_read":
        return Object.keys(data.dbReadConfig?.parameters ?? {}).map(k =>
          base(k, `Parameter: $${k}`, "string", false, "SQL parameter")
        );
      case "db_write":
        return Object.keys(data.dbWriteConfig?.parameters ?? {}).map(k =>
          base(k, `Parameter: $${k}`, "string", false, "SQL parameter")
        );
      case "http_tool":
        return [
          ...Object.keys(data.httpToolConfig?.queryParams ?? {}).map(k =>
            base(k, `Query: ${k}`, "string", false)
          ),
          ...Object.keys(data.httpToolConfig?.headers ?? {}).map(k =>
            base(k, `Header: ${k}`, "string", false)
          ),
        ];
      case "approval":
        return [
          base("title",   "Title",   "string", false, "Approval gate title shown to approver"),
          base("message", "Message", "string", false, "Explanation for the approver"),
        ];
      default:
        return [];
    }
  }, [data, visualMappings]);

  function handleChange(updated: WFNodeData) {
    onUpdateNode(nodeId, updated);
  }

  function handleMappingChange(key: string, mapping: VisualMapping) {
    const updated = { ...visualMappings, [key]: mapping };
    setVisualMappings(updated);
    // Compile visual mappings to runtime expressions and persist
    const compiled = Object.fromEntries(
      Object.entries(updated)
        .map(([k, m]) => [k, compileMapping(m)])
        .filter(([, v]) => v)
    );
    // Apply to the appropriate node config
    const cfg = data;
    if (cfg.nodeType === "agent") {
      handleChange({ ...cfg, agentConfig: { ...cfg.agentConfig, inputMapping: compiled } });
    } else if (cfg.nodeType === "tool") {
      handleChange({ ...cfg, toolConfig: { ...cfg.toolConfig, inputMapping: compiled } });
    }
  }

  function handleConditionChange(group: VisualConditionGroup) {
    setVisualCondition(group);
    const expr = compileConditionGroup(group);
    handleChange({ ...data, branchConfig: { ...data.branchConfig, conditionExpression: expr } });
  }

  const tabs: { id: InspectorTab; label: string; icon: React.ElementType }[] = [
    { id: "configure",  label: "Configure",  icon: Settings2 },
    ...(inputFields.length > 0 ? [{ id: "inputs" as InspectorTab, label: "Inputs", icon: List }] : []),
    ...(data.nodeType === "branch" ? [{ id: "conditions" as InspectorTab, label: "Conditions", icon: GitBranchIcon }] : []),
    { id: "advanced", label: "Advanced", icon: Code2 },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Node header */}
      <div className="shrink-0" style={{ borderBottom: "1px solid #E2E8F0" }}>
        <div className="h-[3px] w-full" style={{ background: meta.color }} />
        <div className="flex items-center gap-2.5 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: meta.bgColor, border: `1px solid ${meta.borderColor}` }}>
            <Icon className="h-4 w-4" style={{ color: meta.color }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-900">{data.label}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: meta.color }}>{meta.label}</p>
          </div>
          <button type="button" onClick={() => onDeleteNode(selectedNode.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-100 px-4">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-[11px] font-semibold transition-colors",
                activeTab === t.id
                  ? "border-blue-500 text-blue-700"
                  : "border-transparent text-slate-400 hover:text-slate-700",
              )}
            >
              <t.icon className="h-3 w-3" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "configure" && (
          <>
            {data.nodeType === "trigger"    && <TriggerConfig    data={data} onChange={handleChange} />}
            {data.nodeType === "agent"      && <AgentConfig      data={data} onChange={handleChange} agents={agents} />}
            {data.nodeType === "llm"        && <LlmConfig        data={data} onChange={handleChange} />}
            {data.nodeType === "tool"       && <ToolConfig       data={data} onChange={handleChange} tools={tools} />}
            {data.nodeType === "approval"   && <ApprovalConfig   data={data} onChange={handleChange} />}
            {data.nodeType === "branch"     && <BranchConfig     data={data} onChange={handleChange} />}
            {data.nodeType === "parallel"   && <ParallelConfig   data={data} onChange={handleChange} />}
            {data.nodeType === "join"       && <JoinConfig       data={data} onChange={handleChange} />}
            {data.nodeType === "timer"      && <TimerConfig      data={data} onChange={handleChange} />}
            {data.nodeType === "checkpoint" && <CheckpointConfig data={data} onChange={handleChange} />}
            {data.nodeType === "end"        && <EndConfig        data={data} onChange={handleChange} />}
            {data.nodeType === "artifact"   && (
              <div className="space-y-3">
                <div><ILabel>Label</ILabel><IInput value={data.label} onChange={(v) => handleChange({ ...data, label: v })} /></div>
                <div><ILabel>Description</ILabel><ITextarea rows={2} value={data.description ?? ""} onChange={(v) => handleChange({ ...data, description: v })} /></div>
              </div>
            )}
          </>
        )}

        {activeTab === "inputs" && (
          <div className="space-y-2">
            <p style={{ fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
              Input Mappings
            </p>
            {inputFields.length === 0 ? (
              <p style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", paddingTop: 24 }}>
                No configurable inputs for this node type.
              </p>
            ) : inputFields.map(field => (
              <InputMappingRow
                key={field.key}
                field={field}
                sources={fieldSources}
                onChange={handleMappingChange}
              />
            ))}
            <div className="pt-3" style={{ borderTop: "1px solid #F1F5F9", marginTop: 12 }}>
              <p style={{ fontSize: 11, color: "#94A3B8" }}>
                Click <strong>Map</strong> on any field to connect it to an output from a previous node or the workflow input.
              </p>
            </div>
          </div>
        )}

        {activeTab === "conditions" && data.nodeType === "branch" && (
          <ConditionBuilder
            group={visualCondition}
            sources={fieldSources}
            onChange={handleConditionChange}
          />
        )}

        {activeTab === "advanced" && (
          <div className="space-y-4">
            <div
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
              style={{ fontSize: 12, color: "#92400E" }}
            >
              Advanced expressions bypass type checking and visual mapping. Use with care.
            </div>
            <div className="space-y-2">
              <ILabel>Input Mapping JSON</ILabel>
              <ITextarea
                mono rows={6}
                value={JSON.stringify(
                  Object.fromEntries(
                    Object.entries(visualMappings).map(([k, m]) => [k, compileMapping(m)])
                  ), null, 2)}
                onChange={() => {/* read-only in this view */}}
              />
            </div>
            {data.nodeType === "branch" && (
              <div className="space-y-2">
                <ILabel>Compiled Condition Expression</ILabel>
                <ITextarea mono rows={3}
                  value={compileConditionGroup(visualCondition)}
                  onChange={() => {}}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Needed: GitBranch icon alias ─────────────────────────────────────────────
function GitBranchIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>;
}
