"use client";

/**
 * WorkflowInspector — right panel.
 * Shows node-specific config when a node is selected,
 * or workflow-level stats + validation when nothing is selected.
 */

import { useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Info,
  Shield,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getNodeMeta } from "./NodeIcon";
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
  return <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{children}</p>;
}

function IInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      className={cn("w-full rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/30", mono && "font-mono")}
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
      className={cn("w-full resize-none rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/30", mono && "font-mono text-[11px]")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function ISelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      className="w-full rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[12px] focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

function INumber({ value, onChange, min }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <input
      type="number"
      min={min}
      className="w-full rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function ICheck({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 rounded" />
      <span className="text-[12px] text-muted-foreground">{label}</span>
    </label>
  );
}

function IDivider() { return <div className="my-4 border-t border-border/30" />; }

function ISection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground transition-colors">
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

  return (
    <div className="space-y-3">
      <ISection title="Identity">
        <div><ILabel>Step Label</ILabel><IInput value={data.label} onChange={(v) => onChange({ ...data, label: v })} /></div>
        <div><ILabel>Description</ILabel><ITextarea rows={2} value={data.description ?? ""} onChange={(v) => onChange({ ...data, description: v })} placeholder="What does this agent do?" /></div>
        <div>
          <ILabel>Registered Agent</ILabel>
          <ISelect value={cfg.agentId ?? ""} onChange={(v) => {
            const agent = agents.find((a) => a.id === v);
            set({ agentId: v || undefined, agentName: agent?.name, modelName: agent?.modelName });
          }}>
            <option value="">— select agent —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.modelName})</option>)}
          </ISelect>
        </div>
        {cfg.agentName && (
          <div className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/10 px-3 py-2">
            <Bot className="h-3.5 w-3.5 text-violet-400 shrink-0" />
            <div>
              <p className="text-[11px] font-medium text-violet-300">{cfg.agentName}</p>
              {cfg.modelName && <p className="text-[10px] text-muted-foreground/50">{cfg.modelName}</p>}
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
            // store uiToolType so node icon resolves correctly
            ...(uiToolType ? { uiToolType } : {}),
          } as Parameters<typeof set>[0]);
        }}>
          <option value="">— select tool —</option>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
        </ISelect>
      </div>
      {tool && (
        <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2 text-[11px] space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground/50">Risk</span><span className="font-medium capitalize">{tool.riskLevel.replace(/_/g, " ")}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground/50">Idempotent</span><span className={tool.idempotent ? "text-emerald-400" : "text-amber-400"}>{tool.idempotent ? "yes" : "no"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground/50">Timeout</span><span>{tool.timeoutMs}ms</span></div>
        </div>
      )}
      <ICheck id={`approval-tool-${data.label}`} checked={cfg.requireApproval ?? false} onChange={(v) => set({ requireApproval: v })} label="Require approval before executing" />
    </div>
  );
}

function ApprovalConfig({ data, onChange }: { data: WFNodeData; onChange: (d: WFNodeData) => void }) {
  const cfg: ApprovalNodeConfig = data.approvalConfig ?? { title: "Approval Required", message: "", riskLevel: "medium" };
  function set(patch: Partial<ApprovalNodeConfig>) { onChange({ ...data, approvalConfig: { ...cfg, ...patch } }); }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-400 flex items-start gap-2">
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
        <p className="mt-1 text-[10px] text-muted-foreground/40">Use <code className="font-mono">input</code> or <code className="font-mono">output</code> to reference data.</p>
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
          { label: "Issues", value: sev.length, color: sev.length > 0 ? (errors.length > 0 ? "text-red-400" : "text-amber-400") : "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border/40 bg-muted/10 p-3 text-center">
            <p className={cn("text-[18px] font-bold", color)}>{value}</p>
            <p className="text-[10px] text-muted-foreground/50">{label}</p>
          </div>
        ))}
      </div>

      {/* Replay support */}
      {validation && (
        <div className={cn("rounded-lg border px-3 py-2.5 text-[12px]",
          validation.replaySupport === "full" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" :
          validation.replaySupport === "partial" ? "border-amber-500/20 bg-amber-500/5 text-amber-400" :
          "border-border/30 bg-muted/10 text-muted-foreground")}>
          <span className="font-semibold">Replay: </span>
          {validation.replaySupport === "full" ? "Full replay available" :
           validation.replaySupport === "partial" ? "Partial replay (add checkpoints)" :
           "No replay configured"}
        </div>
      )}

      {/* Issues */}
      {sev.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <p className="text-[12px] text-emerald-400">Workflow is valid</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...errors, ...warnings, ...infos].map((issue, i) => {
            const Icon = issue.severity === "error" ? XCircle : issue.severity === "warning" ? AlertTriangle : Info;
            const color = issue.severity === "error" ? "text-red-600" : issue.severity === "warning" ? "text-amber-700" : "text-[#1D4ED8]";
            return (
              <div key={i} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2",
                issue.severity === "error" ? "border-red-500/20 bg-red-500/5" :
                issue.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" :
                "border-sky-500/20 bg-sky-500/5")}>
                <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", color)} />
                <p className={cn("text-[11px]", color)}>{issue.message}</p>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-[11px] text-muted-foreground/40">Select a node to configure it</p>
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

export function WorkflowInspector({
  selectedNode,
  nodes,
  edges,
  agents,
  tools,
  validation,
  onUpdateNode,
  onDeleteNode,
}: WorkflowInspectorProps) {
  if (!selectedNode) {
    return (
      <div className="p-4">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/40">Workflow Overview</p>
        <ValidationSummary validation={validation} nodes={nodes} edges={edges} />
      </div>
    );
  }

  const { data } = selectedNode;
  const meta = getNodeMeta(data.nodeType as WFNodeType);
  const Icon = meta.icon;

  const nodeId = selectedNode.id;
  function handleChange(updated: WFNodeData) {
    onUpdateNode(nodeId, updated);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Node header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/40 px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: meta.bgColor, border: `1px solid ${meta.borderColor}` }}>
          <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-foreground/70 truncate">{data.label}</p>
          <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</p>
        </div>
        <button type="button" onClick={() => onDeleteNode(selectedNode.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          title="Delete node">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Config */}
      <div className="flex-1 overflow-y-auto p-4">
        {data.nodeType === "trigger" && <TriggerConfig data={data} onChange={handleChange} />}
        {data.nodeType === "agent" && <AgentConfig data={data} onChange={handleChange} agents={agents} />}
        {data.nodeType === "llm" && <LlmConfig data={data} onChange={handleChange} />}
        {data.nodeType === "tool" && <ToolConfig data={data} onChange={handleChange} tools={tools} />}
        {data.nodeType === "approval" && <ApprovalConfig data={data} onChange={handleChange} />}
        {data.nodeType === "branch" && <BranchConfig data={data} onChange={handleChange} />}
        {data.nodeType === "parallel" && <ParallelConfig data={data} onChange={handleChange} />}
        {data.nodeType === "join" && <JoinConfig data={data} onChange={handleChange} />}
        {data.nodeType === "timer" && <TimerConfig data={data} onChange={handleChange} />}
        {data.nodeType === "checkpoint" && <CheckpointConfig data={data} onChange={handleChange} />}
        {data.nodeType === "end" && <EndConfig data={data} onChange={handleChange} />}
        {(data.nodeType === "artifact") && (
          <div className="space-y-3">
            <div><ILabel>Label</ILabel><IInput value={data.label} onChange={(v) => handleChange({ ...data, label: v })} /></div>
            <div><ILabel>Description</ILabel><ITextarea rows={2} value={data.description ?? ""} onChange={(v) => handleChange({ ...data, description: v })} /></div>
          </div>
        )}
      </div>

      {/* Delete button */}
      <div className="shrink-0 border-t border-border/30 px-4 py-3">
        <button type="button" onClick={() => onDeleteNode(selectedNode.id)}
          className="w-full rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] font-medium text-red-400 hover:bg-red-500/10 transition-colors">
          Delete Node
        </button>
      </div>
    </div>
  );
}
