"use client";

/**
 * /workflows/[id]/builder — Full three-column workflow builder.
 *
 * Left   : Workflow-level configuration (name, trigger, schema, policies)
 * Middle : Visual execution flow (Start → Steps → End)
 * Right  : Selected step configuration panel (per step type)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  GitBranch,
  GripVertical,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Timer,
  Wrench,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type {
  Agent,
  ApprovalStepConfig,
  BranchStepConfig,
  BudgetPolicy,
  LlmStepConfig,
  RetryPolicy,
  StepType,
  TimerStepConfig,
  TimeoutPolicy,
  Tool,
  TriggerType,
  Workflow,
  WorkflowStep,
} from "@/types/platform";
import {
  getAgents,
  getTools,
  getWorkflow,
  saveWorkflowVersion,
  triggerWorkflow,
  updateWorkflow,
} from "@/lib/repository";

// ─── Step palette ─────────────────────────────────────────────────────────────

const STEP_PALETTE: {
  type: StepType;
  label: string;
  color: string;
  icon: React.ElementType;
}[] = [
  { type: "agent",    label: "Agent Step",    color: "#A78BFA", icon: Bot },
  { type: "tool",     label: "Tool Step",     color: "#22D3EE", icon: Wrench },
  { type: "llm",      label: "LLM Step",      color: "#C084FC", icon: Sparkles },
  { type: "approval", label: "Approval Gate", color: "#FCD34D", icon: Shield },
  { type: "branch",   label: "Branch",        color: "#38BDF8", icon: GitBranch },
  { type: "sleep",    label: "Timer",         color: "#FB923C", icon: Timer },
];

function stepMeta(type: StepType) {
  return (
    STEP_PALETTE.find((p) => p.type === type) ?? {
      type,
      label: "Step",
      color: "#94A3B8",
      icon: Zap,
    }
  );
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function parseJsonSafe(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function FieldInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary",
        mono && "font-mono",
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function FieldTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary",
        mono && "font-mono text-[11px]",
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function FieldSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

function FieldNumber({
  value,
  onChange,
  min,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <input
      type="number"
      min={min}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function FieldCheck({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded"
      />
      <span className="text-[12px] text-muted-foreground">{label}</span>
    </label>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="my-4 border-t border-border/40" />;
}

// Key-value pair editor
function KVEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, string> | undefined;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value ?? {});
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label>{label}</Label>
        <button
          type="button"
          onClick={() => onChange({ ...(value ?? {}), "": "" })}
          className="text-[11px] text-primary hover:underline"
        >
          + Add
        </button>
      </div>
      <div className="space-y-1.5">
        {entries.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              placeholder="key"
              value={k}
              onChange={(e) => {
                const updated = { ...(value ?? {}) };
                delete updated[k];
                updated[e.target.value] = v;
                onChange(updated);
              }}
              className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground/40">→</span>
            <input
              placeholder="value"
              value={v}
              onChange={(e) => {
                const updated = { ...(value ?? {}) };
                updated[k] = e.target.value;
                onChange(updated);
              }}
              className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => {
                const updated = { ...(value ?? {}) };
                delete updated[k];
                onChange(updated);
              }}
              className="text-[11px] text-muted-foreground hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground/40">
            No mappings yet
          </p>
        )}
      </div>
    </div>
  );
}

// Next-step selector (single)
function NextStepSelect({
  label,
  value,
  stepId,
  steps,
  onChange,
}: {
  label?: string;
  value: string | undefined;
  stepId: string;
  steps: WorkflowStep[];
  onChange: (id: string | undefined) => void;
}) {
  const others = steps.filter((s) => s.id !== stepId && s.type !== "end");
  return (
    <div>
      <Label>{label ?? "Next Step"}</Label>
      <FieldSelect value={value ?? ""} onChange={(v) => onChange(v || undefined)}>
        <option value="">— end of workflow —</option>
        {others.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </FieldSelect>
    </div>
  );
}

// ─── Left: Workflow config panel ─────────────────────────────────────────────

const LLM_PROVIDERS = ["openai", "anthropic", "local"] as const;
const LLM_MODELS: Record<string, string[]> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-3-5", "claude-opus-4"],
  local: ["llama-3.3-70b", "mistral-7b", "custom"],
};

const TRIGGER_OPTIONS: { value: TriggerType; label: string }[] = [
  { value: "manual",  label: "Manual" },
  { value: "cron",    label: "Schedule" },
  { value: "webhook", label: "Webhook" },
  { value: "api",     label: "API / Event" },
];

interface WorkflowConfig {
  name: string;
  description: string;
  triggerType: TriggerType;
  cronExpression: string;
  timezone: string;
  inputSchemaRaw: string;
  retryPolicy: RetryPolicy;
  timeoutPolicy: TimeoutPolicy;
  budgetPolicy: BudgetPolicy;
}

function WorkflowConfigPanel({
  config,
  onChange,
}: {
  config: WorkflowConfig;
  onChange: (c: WorkflowConfig) => void;
}) {
  function set(patch: Partial<WorkflowConfig>) {
    onChange({ ...config, ...patch });
  }

  return (
    <div className="space-y-5 p-4">
      {/* Identity */}
      <div>
        <SectionHeader>Workflow</SectionHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <FieldInput
              value={config.name}
              onChange={(v) => set({ name: v })}
              placeholder="My Workflow"
            />
          </div>
          <div>
            <Label>Description</Label>
            <FieldTextarea
              rows={2}
              value={config.description}
              onChange={(v) => set({ description: v })}
              placeholder="What does this workflow do?"
            />
          </div>
        </div>
      </div>

      <Divider />

      {/* Trigger */}
      <div>
        <SectionHeader>Trigger</SectionHeader>
        <div className="grid grid-cols-2 gap-1.5">
          {TRIGGER_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => set({ triggerType: t.value })}
              className={cn(
                "rounded-lg border px-3 py-2 text-[11px] text-center transition-all",
                config.triggerType === t.value
                  ? "border-primary/40 bg-primary/5 text-primary font-medium"
                  : "border-border/50 text-muted-foreground hover:border-border",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {config.triggerType === "cron" && (
          <div className="mt-3 space-y-2">
            <div>
              <Label>Cron expression</Label>
              <FieldInput
                mono
                value={config.cronExpression}
                onChange={(v) => set({ cronExpression: v })}
                placeholder="0 7 * * 1"
              />
            </div>
            <div>
              <Label>Timezone</Label>
              <FieldInput
                value={config.timezone}
                onChange={(v) => set({ timezone: v })}
                placeholder="America/New_York"
              />
            </div>
          </div>
        )}
      </div>

      <Divider />

      {/* Input schema */}
      <div>
        <SectionHeader>Input Schema</SectionHeader>
        <FieldTextarea
          rows={4}
          mono
          value={config.inputSchemaRaw}
          onChange={(v) => set({ inputSchemaRaw: v })}
          placeholder='{"type":"object","properties":{}}'
        />
      </div>

      <Divider />

      {/* Default retry */}
      <div>
        <SectionHeader>Default Retry</SectionHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Max attempts</Label>
              <FieldNumber
                value={config.retryPolicy.maxAttempts}
                onChange={(v) =>
                  set({ retryPolicy: { ...config.retryPolicy, maxAttempts: v } })
                }
                min={1}
              />
            </div>
            <div>
              <Label>Backoff</Label>
              <FieldSelect
                value={config.retryPolicy.backoffType}
                onChange={(v) =>
                  set({
                    retryPolicy: {
                      ...config.retryPolicy,
                      backoffType: v as "fixed" | "exponential",
                    },
                  })
                }
              >
                <option value="exponential">Exponential</option>
                <option value="fixed">Fixed</option>
              </FieldSelect>
            </div>
          </div>
          <div>
            <Label>Backoff (ms)</Label>
            <FieldNumber
              value={config.retryPolicy.backoffMs}
              onChange={(v) =>
                set({ retryPolicy: { ...config.retryPolicy, backoffMs: v } })
              }
              min={0}
            />
          </div>
        </div>
      </div>

      <Divider />

      {/* Default timeout */}
      <div>
        <SectionHeader>Default Timeout</SectionHeader>
        <div className="space-y-2">
          <div>
            <Label>Step timeout (ms)</Label>
            <FieldNumber
              value={config.timeoutPolicy.stepTimeoutMs}
              onChange={(v) =>
                set({
                  timeoutPolicy: { ...config.timeoutPolicy, stepTimeoutMs: v },
                })
              }
              min={1000}
            />
          </div>
          <div>
            <Label>Run timeout (ms)</Label>
            <FieldNumber
              value={config.timeoutPolicy.runTimeoutMs}
              onChange={(v) =>
                set({
                  timeoutPolicy: { ...config.timeoutPolicy, runTimeoutMs: v },
                })
              }
              min={1000}
            />
          </div>
        </div>
      </div>

      <Divider />

      {/* Budget */}
      <div>
        <SectionHeader>Budget Policy</SectionHeader>
        <div className="space-y-2">
          <div>
            <Label>Max tokens / run</Label>
            <FieldNumber
              value={config.budgetPolicy.maxTokensPerRun ?? 0}
              onChange={(v) =>
                set({
                  budgetPolicy: {
                    ...config.budgetPolicy,
                    maxTokensPerRun: v > 0 ? v : undefined,
                  },
                })
              }
              min={0}
            />
          </div>
          <div>
            <Label>Max cost / run ($)</Label>
            <input
              type="number"
              step="0.01"
              min={0}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
              value={config.budgetPolicy.maxCostUsdPerRun ?? ""}
              onChange={(e) =>
                set({
                  budgetPolicy: {
                    ...config.budgetPolicy,
                    maxCostUsdPerRun:
                      e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
              placeholder="No limit"
            />
          </div>
          <div>
            <Label>Max runs / day</Label>
            <FieldNumber
              value={config.budgetPolicy.maxRunsPerDay ?? 0}
              onChange={(v) =>
                set({
                  budgetPolicy: {
                    ...config.budgetPolicy,
                    maxRunsPerDay: v > 0 ? v : undefined,
                  },
                })
              }
              min={0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Middle: Flow canvas ──────────────────────────────────────────────────────

function FlowNode({
  label,
  color,
  icon: Icon,
}: {
  label: string;
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center justify-center">
      <div
        className="flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-semibold"
        style={{ borderColor: `${color}40`, background: `${color}15`, color }}
      >
        <Icon className="h-3 w-3" />
        {label}
      </div>
    </div>
  );
}

function FlowConnector({ dashed }: { dashed?: boolean }) {
  return (
    <div className="flex justify-center">
      <div
        className={cn(
          "h-6 w-px",
          dashed ? "border-l-2 border-dashed border-border/40" : "bg-border/40",
        )}
      />
    </div>
  );
}

function StepCard({
  step,
  index,
  selected,
  agents,
  tools,
  onSelect,
  onDelete,
}: {
  step: WorkflowStep;
  index: number;
  selected: boolean;
  agents: Agent[];
  tools: Tool[];
  onSelect: () => void;
  onDelete: () => void;
}) {
  const meta = stepMeta(step.type);
  const Icon = meta.icon;
  const agent = step.agentId ? agents.find((a) => a.id === step.agentId) : null;
  const tool = step.toolId ? tools.find((t) => t.id === step.toolId) : null;
  const subtitle = agent
    ? agent.name
    : tool
    ? tool.name
    : step.llmConfig?.model
    ? `${step.llmConfig.provider} / ${step.llmConfig.model}`
    : step.approvalConfig?.title
    ? step.approvalConfig.title
    : null;

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative cursor-pointer rounded-xl border px-4 py-3 transition-all select-none",
        selected
          ? "border-primary/40 shadow-[0_0_0_2px_rgba(56,189,248,0.12)]"
          : "border-border/60 hover:border-border",
      )}
      style={{
        background: selected ? "var(--surface-2)" : "var(--surface-1)",
        borderColor: selected ? `${meta.color}50` : undefined,
      }}
    >
      <div className="flex items-center gap-3">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/15" />
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: `${meta.color}15`,
            border: `1px solid ${meta.color}25`,
          }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{step.name}</span>
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
              style={{ background: `${meta.color}15`, color: meta.color }}
            >
              {meta.label}
            </span>
          </div>
          {subtitle && (
            <p className="truncate text-[11px] text-muted-foreground">
              → {subtitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {step.checkpointEnabled && (
            <span title="Checkpoint"><Shield className="h-3 w-3 text-sky-400/50" /></span>
          )}
          <span className="flex h-5 w-5 items-center justify-center rounded bg-muted/40 text-[10px] font-semibold text-muted-foreground/50">
            {index + 1}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-[13px] text-muted-foreground opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

function AddStepMenu({ onAdd }: { onAdd: (type: StepType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative flex justify-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border/60 px-4 py-2 text-[12px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Step
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className="absolute bottom-full mb-2 w-52 overflow-hidden rounded-xl border border-border/60 shadow-xl z-10"
          style={{ background: "var(--surface-2)" }}
        >
          {STEP_PALETTE.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.type}
                type="button"
                onClick={() => {
                  onAdd(p.type);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: p.color }} />
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FlowCanvas({
  steps,
  selectedId,
  agents,
  tools,
  onSelect,
  onDelete,
  onAdd,
}: {
  steps: WorkflowStep[];
  selectedId: string | null;
  agents: Agent[];
  tools: Tool[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (type: StepType) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-md space-y-0 py-6">
      <FlowNode label="START" color="#34D399" icon={Play} />

      {steps.length > 0 ? (
        <>
          {steps.map((step, idx) => (
            <div key={step.id}>
              <FlowConnector dashed={idx > 0} />
              <StepCard
                step={step}
                index={idx}
                selected={selectedId === step.id}
                agents={agents}
                tools={tools}
                onSelect={() => onSelect(step.id)}
                onDelete={() => onDelete(step.id)}
              />
            </div>
          ))}
          <FlowConnector dashed />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Zap className="h-7 w-7 text-muted-foreground/15" />
          <p className="text-[12px] text-muted-foreground">No steps yet</p>
          <p className="text-[11px] text-muted-foreground/50">
            Add an Agent, Tool, or Approval step below
          </p>
        </div>
      )}

      <AddStepMenu onAdd={onAdd} />

      {steps.length > 0 && (
        <>
          <FlowConnector />
          <FlowNode label="END" color="#94A3B8" icon={CheckCircle2} />
        </>
      )}
    </div>
  );
}

// ─── Right: Step config editors ───────────────────────────────────────────────

function AgentStepEditor({
  step,
  agents,
  steps,
  onChange,
}: {
  step: WorkflowStep;
  agents: Agent[];
  steps: WorkflowStep[];
  onChange: (s: WorkflowStep) => void;
}) {
  const retry = step.retryPolicy ?? { maxAttempts: 2, backoffType: "exponential" as const, backoffMs: 2000 };
  const timeout = step.timeoutPolicy ?? { stepTimeoutMs: 60000, runTimeoutMs: 600000 };
  const nextId = step.nextStepIds[0];

  return (
    <div className="space-y-4">
      <div>
        <Label>Step Name</Label>
        <FieldInput value={step.name} onChange={(v) => onChange({ ...step, name: v })} />
      </div>

      <div>
        <Label>Agent</Label>
        <FieldSelect
          value={step.agentId ?? ""}
          onChange={(v) => onChange({ ...step, agentId: v || undefined })}
        >
          <option value="">— select agent —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </FieldSelect>
      </div>

      <KVEditor
        label="Input Mapping"
        value={step.inputMapping}
        onChange={(v) => onChange({ ...step, inputMapping: v })}
      />

      <div>
        <Label>Expected Output (description)</Label>
        <FieldTextarea
          rows={2}
          value={(step.metadata?.expectedOutput as string) ?? ""}
          onChange={(v) =>
            onChange({ ...step, metadata: { ...step.metadata, expectedOutput: v } })
          }
          placeholder="What should this step return?"
        />
      </div>

      <Divider />
      <SectionHeader>Retry Override</SectionHeader>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Max attempts</Label>
          <FieldNumber
            value={retry.maxAttempts}
            onChange={(v) =>
              onChange({ ...step, retryPolicy: { ...retry, maxAttempts: v } })
            }
            min={1}
          />
        </div>
        <div>
          <Label>Backoff</Label>
          <FieldSelect
            value={retry.backoffType}
            onChange={(v) =>
              onChange({
                ...step,
                retryPolicy: { ...retry, backoffType: v as "fixed" | "exponential" },
              })
            }
          >
            <option value="exponential">Exponential</option>
            <option value="fixed">Fixed</option>
          </FieldSelect>
        </div>
      </div>
      <div>
        <Label>Backoff (ms)</Label>
        <FieldNumber
          value={retry.backoffMs}
          onChange={(v) =>
            onChange({ ...step, retryPolicy: { ...retry, backoffMs: v } })
          }
          min={0}
        />
      </div>

      <Divider />
      <div>
        <Label>Step timeout (ms)</Label>
        <FieldNumber
          value={timeout.stepTimeoutMs}
          onChange={(v) =>
            onChange({
              ...step,
              timeoutPolicy: { ...timeout, stepTimeoutMs: v },
            })
          }
          min={1000}
        />
      </div>

      <FieldCheck
        id={`ckpt-${step.id}`}
        checked={step.checkpointEnabled}
        onChange={(v) => onChange({ ...step, checkpointEnabled: v })}
        label="Enable checkpoint — allows replay from this step"
      />

      <NextStepSelect
        value={nextId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => onChange({ ...step, nextStepIds: id ? [id] : [] })}
      />
    </div>
  );
}

function ToolStepEditor({
  step,
  tools,
  steps,
  onChange,
}: {
  step: WorkflowStep;
  tools: Tool[];
  steps: WorkflowStep[];
  onChange: (s: WorkflowStep) => void;
}) {
  const tool = step.toolId ? tools.find((t) => t.id === step.toolId) : null;
  const nextId = step.nextStepIds[0];

  const RISK_COLORS: Record<string, string> = {
    read_only: "text-emerald-400",
    low_risk_write: "text-sky-400",
    high_risk_write: "text-amber-400",
    irreversible: "text-red-400",
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Step Name</Label>
        <FieldInput value={step.name} onChange={(v) => onChange({ ...step, name: v })} />
      </div>

      <div>
        <Label>Tool</Label>
        <FieldSelect
          value={step.toolId ?? ""}
          onChange={(v) => onChange({ ...step, toolId: v || undefined })}
        >
          <option value="">— select tool —</option>
          {tools.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </FieldSelect>
      </div>

      {tool && (
        <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
          <span className="text-[11px] text-muted-foreground">Risk:</span>
          <span
            className={cn(
              "text-[11px] font-medium capitalize",
              RISK_COLORS[tool.riskLevel],
            )}
          >
            {tool.riskLevel.replace(/_/g, " ")}
          </span>
          {!tool.idempotent && (
            <span className="ml-auto rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
              not idempotent
            </span>
          )}
        </div>
      )}

      <FieldCheck
        id={`approval-${step.id}`}
        checked={step.requireApproval ?? false}
        onChange={(v) => onChange({ ...step, requireApproval: v })}
        label="Require approval before this tool runs"
      />

      <KVEditor
        label="Input Mapping"
        value={step.inputMapping}
        onChange={(v) => onChange({ ...step, inputMapping: v })}
      />

      <KVEditor
        label="Output Mapping"
        value={step.outputMapping}
        onChange={(v) => onChange({ ...step, outputMapping: v })}
      />

      <NextStepSelect
        value={nextId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => onChange({ ...step, nextStepIds: id ? [id] : [] })}
      />
    </div>
  );
}

function LlmStepEditor({
  step,
  steps,
  onChange,
}: {
  step: WorkflowStep;
  steps: WorkflowStep[];
  onChange: (s: WorkflowStep) => void;
}) {
  const cfg: LlmStepConfig = step.llmConfig ?? {
    provider: "openai",
    model: "gpt-4.1-mini",
    prompt: "",
    validationEnabled: false,
  };
  const nextId = step.nextStepIds[0];
  const models = LLM_MODELS[cfg.provider] ?? [];

  function setCfg(patch: Partial<LlmStepConfig>) {
    onChange({ ...step, llmConfig: { ...cfg, ...patch } });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Step Name</Label>
        <FieldInput value={step.name} onChange={(v) => onChange({ ...step, name: v })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Provider</Label>
          <FieldSelect
            value={cfg.provider}
            onChange={(v) =>
              setCfg({
                provider: v,
                model: (LLM_MODELS[v] ?? [])[0] ?? "",
              })
            }
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </FieldSelect>
        </div>
        <div>
          <Label>Model</Label>
          <FieldSelect value={cfg.model} onChange={(v) => setCfg({ model: v })}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </FieldSelect>
        </div>
      </div>

      <div>
        <Label>Prompt / Instructions</Label>
        <FieldTextarea
          rows={5}
          value={cfg.prompt}
          onChange={(v) => setCfg({ prompt: v })}
          placeholder="You are a helpful assistant. Given the input, produce..."
        />
      </div>

      <div>
        <Label>Output Schema (JSON)</Label>
        <FieldTextarea
          rows={3}
          mono
          value={
            cfg.outputSchema ? JSON.stringify(cfg.outputSchema, null, 2) : ""
          }
          onChange={(v) => {
            try {
              setCfg({ outputSchema: JSON.parse(v) as Record<string, unknown> });
            } catch {
              /* ignore parse errors while typing */
            }
          }}
          placeholder='{"type":"object","properties":{}}'
        />
      </div>

      <FieldCheck
        id={`validate-${step.id}`}
        checked={cfg.validationEnabled}
        onChange={(v) => setCfg({ validationEnabled: v })}
        label="Validate output against schema"
      />

      <FieldCheck
        id={`ckpt-llm-${step.id}`}
        checked={step.checkpointEnabled}
        onChange={(v) => onChange({ ...step, checkpointEnabled: v })}
        label="Enable checkpoint"
      />

      <NextStepSelect
        value={nextId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => onChange({ ...step, nextStepIds: id ? [id] : [] })}
      />
    </div>
  );
}

function ApprovalStepEditor({
  step,
  steps,
  onChange,
}: {
  step: WorkflowStep;
  steps: WorkflowStep[];
  onChange: (s: WorkflowStep) => void;
}) {
  const cfg: ApprovalStepConfig = step.approvalConfig ?? {
    title: "Approval Required",
    message: "Please review and approve to continue.",
    riskLevel: "low_risk_write",
  };

  function setCfg(patch: Partial<ApprovalStepConfig>) {
    onChange({ ...step, approvalConfig: { ...cfg, ...patch } });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[12px] text-amber-400">
        Run will pause here and wait for human approval before continuing.
      </div>

      <div>
        <Label>Step Name</Label>
        <FieldInput value={step.name} onChange={(v) => onChange({ ...step, name: v })} />
      </div>

      <div>
        <Label>Approval Title</Label>
        <FieldInput
          value={cfg.title}
          onChange={(v) => setCfg({ title: v })}
          placeholder="Approval Required"
        />
      </div>

      <div>
        <Label>Message to Approver</Label>
        <FieldTextarea
          rows={3}
          value={cfg.message}
          onChange={(v) => setCfg({ message: v })}
          placeholder="Please review the following and approve to continue..."
        />
      </div>

      <div>
        <Label>Risk Level</Label>
        <FieldSelect
          value={cfg.riskLevel}
          onChange={(v) =>
            setCfg({ riskLevel: v as ApprovalStepConfig["riskLevel"] })
          }
        >
          <option value="read_only">Read only</option>
          <option value="low_risk_write">Low risk write</option>
          <option value="high_risk_write">High risk write</option>
          <option value="irreversible">Irreversible</option>
        </FieldSelect>
      </div>

      <div>
        <Label>Approver Role</Label>
        <FieldInput
          value={cfg.approverRole ?? ""}
          onChange={(v) => setCfg({ approverRole: v || undefined })}
          placeholder="admin, manager, …"
        />
      </div>

      <KVEditor
        label="Approval Payload Mapping"
        value={cfg.payloadMapping}
        onChange={(v) => setCfg({ payloadMapping: v })}
      />

      <div>
        <Label>Timeout (ms)</Label>
        <FieldNumber
          value={cfg.timeoutMs ?? 0}
          onChange={(v) => setCfg({ timeoutMs: v > 0 ? v : undefined })}
          min={0}
        />
      </div>

      <Divider />

      <NextStepSelect
        label="On Approve → next"
        value={cfg.onApproveNextStepId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => setCfg({ onApproveNextStepId: id })}
      />

      <NextStepSelect
        label="On Reject → next"
        value={cfg.onRejectNextStepId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => setCfg({ onRejectNextStepId: id })}
      />
    </div>
  );
}

function BranchStepEditor({
  step,
  steps,
  onChange,
}: {
  step: WorkflowStep;
  steps: WorkflowStep[];
  onChange: (s: WorkflowStep) => void;
}) {
  const cfg: BranchStepConfig = step.branchConfig ?? {
    conditionExpression: "",
  };

  function setCfg(patch: Partial<BranchStepConfig>) {
    onChange({ ...step, branchConfig: { ...cfg, ...patch } });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Step Name</Label>
        <FieldInput value={step.name} onChange={(v) => onChange({ ...step, name: v })} />
      </div>

      <div>
        <Label>Condition Expression</Label>
        <FieldTextarea
          rows={3}
          mono
          value={cfg.conditionExpression}
          onChange={(v) => setCfg({ conditionExpression: v })}
          placeholder="output.score > 0.8 || input.priority === 'high'"
        />
        <p className="mt-1 text-[10px] text-muted-foreground/50">
          Use <code className="font-mono">input</code> or{" "}
          <code className="font-mono">output</code> to reference workflow data
        </p>
      </div>

      <Divider />

      <NextStepSelect
        label="True path → next step"
        value={cfg.trueNextStepId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => setCfg({ trueNextStepId: id })}
      />

      <NextStepSelect
        label="False path → next step"
        value={cfg.falseNextStepId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => setCfg({ falseNextStepId: id })}
      />
    </div>
  );
}

function TimerStepEditor({
  step,
  steps,
  onChange,
}: {
  step: WorkflowStep;
  steps: WorkflowStep[];
  onChange: (s: WorkflowStep) => void;
}) {
  const cfg: TimerStepConfig = step.timerConfig ?? { delayMs: 5000 };
  const nextId = step.nextStepIds[0];

  return (
    <div className="space-y-4">
      <div>
        <Label>Step Name</Label>
        <FieldInput value={step.name} onChange={(v) => onChange({ ...step, name: v })} />
      </div>

      <div>
        <Label>Delay (ms)</Label>
        <FieldNumber
          value={cfg.delayMs}
          onChange={(v) =>
            onChange({ ...step, timerConfig: { delayMs: v } })
          }
          min={0}
        />
        <p className="mt-1 text-[10px] text-muted-foreground/50">
          {cfg.delayMs >= 1000
            ? `${(cfg.delayMs / 1000).toFixed(1)}s`
            : `${cfg.delayMs}ms`}
        </p>
      </div>

      <NextStepSelect
        value={nextId}
        stepId={step.id}
        steps={steps}
        onChange={(id) => onChange({ ...step, nextStepIds: id ? [id] : [] })}
      />
    </div>
  );
}

function StepConfigPanel({
  step,
  agents,
  tools,
  steps,
  onChange,
}: {
  step: WorkflowStep;
  agents: Agent[];
  tools: Tool[];
  steps: WorkflowStep[];
  onChange: (s: WorkflowStep) => void;
}) {
  const meta = stepMeta(step.type);
  const Icon = meta.icon;

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded"
          style={{ background: `${meta.color}20`, border: `1px solid ${meta.color}30` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {meta.label}
        </p>
      </div>

      {step.type === "agent" && (
        <AgentStepEditor step={step} agents={agents} steps={steps} onChange={onChange} />
      )}
      {step.type === "tool" && (
        <ToolStepEditor step={step} tools={tools} steps={steps} onChange={onChange} />
      )}
      {step.type === "llm" && (
        <LlmStepEditor step={step} steps={steps} onChange={onChange} />
      )}
      {step.type === "approval" && (
        <ApprovalStepEditor step={step} steps={steps} onChange={onChange} />
      )}
      {step.type === "branch" && (
        <BranchStepEditor step={step} steps={steps} onChange={onChange} />
      )}
      {step.type === "sleep" && (
        <TimerStepEditor step={step} steps={steps} onChange={onChange} />
      )}
      {step.type === "end" && (
        <p className="text-[12px] text-muted-foreground">
          This is the terminal step — no configuration needed.
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  // Workflow-level config
  const [config, setConfig] = useState<WorkflowConfig>({
    name: "",
    description: "",
    triggerType: "manual",
    cronExpression: "0 7 * * 1",
    timezone: "America/New_York",
    inputSchemaRaw: "{}",
    retryPolicy: { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 },
    timeoutPolicy: { stepTimeoutMs: 60000, runTimeoutMs: 600000 },
    budgetPolicy: {},
  });

  // Steps
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load
  const load = useCallback(async () => {
    const [wf, ag, tl] = await Promise.all([
      getWorkflow(id),
      getAgents(),
      getTools(),
    ]);
    if (wf) {
      setWorkflow(wf);
      setConfig({
        name: wf.name,
        description: wf.description,
        triggerType: wf.triggerType,
        cronExpression: wf.scheduleConfig?.cronExpression ?? "0 7 * * 1",
        timezone: wf.scheduleConfig?.timezone ?? "America/New_York",
        inputSchemaRaw: JSON.stringify(wf.inputSchema, null, 2),
        retryPolicy: wf.retryPolicy,
        timeoutPolicy: wf.timeoutPolicy ?? {
          stepTimeoutMs: 60000,
          runTimeoutMs: 600000,
        },
        budgetPolicy: wf.budgetPolicy,
      });
      setSteps(wf.steps);
    }
    setAgents(ag);
    setTools(tl);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Step mutations
  function addStep(type: StepType) {
    const meta = stepMeta(type);
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: `New ${meta.label}`,
      type,
      nextStepIds: [],
      checkpointEnabled: type === "agent" || type === "llm",
      ...(type === "llm"
        ? {
            llmConfig: {
              provider: "openai",
              model: "gpt-4.1-mini",
              prompt: "",
              validationEnabled: false,
            },
          }
        : {}),
      ...(type === "approval"
        ? {
            approvalConfig: {
              title: "Approval Required",
              message: "Please review and approve to continue.",
              riskLevel: "low_risk_write",
            },
          }
        : {}),
      ...(type === "branch"
        ? { branchConfig: { conditionExpression: "" } }
        : {}),
      ...(type === "sleep" ? { timerConfig: { delayMs: 5000 } } : {}),
    };
    setSteps((prev) => {
      const updated = [...prev, newStep];
      setSelectedId(newStep.id);
      return updated;
    });
  }

  function updateStep(updated: WorkflowStep) {
    setSteps((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function deleteStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
    if (selectedId === stepId) setSelectedId(null);
  }

  // Save
  async function doSave(): Promise<Workflow | null> {
    if (!workflow) return null;
    const agentIds = [...new Set(steps.filter((s) => s.agentId).map((s) => s.agentId!))];
    const toolIds = [...new Set(steps.filter((s) => s.toolId).map((s) => s.toolId!))];

    const [updated] = await Promise.all([
      updateWorkflow(workflow.id, {
        name: config.name,
        description: config.description,
        triggerType: config.triggerType,
        inputSchema: parseJsonSafe(config.inputSchemaRaw),
        scheduleConfig:
          config.triggerType === "cron"
            ? {
                cronExpression: config.cronExpression,
                timezone: config.timezone,
              }
            : undefined,
        retryPolicy: config.retryPolicy,
        timeoutPolicy: config.timeoutPolicy,
        budgetPolicy: config.budgetPolicy,
        steps,
        agentIds,
        toolIds,
        status: "active",
      }),
      saveWorkflowVersion(workflow.id, steps),
    ]);
    if (updated) setWorkflow(updated);
    return updated;
  }

  async function handleSave() {
    setSaving(true);
    try {
      await doSave();
      toast.success("Workflow saved.");
    } catch {
      toast.error("Failed to save workflow.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (!workflow) return;
    setRunning(true);
    try {
      await doSave();
      const run = await triggerWorkflow(workflow.id, {});
      toast.success("Workflow started.");
      router.push(`/runs/${run.id}` as never);
    } catch {
      toast.error("Failed to run workflow.");
    } finally {
      setRunning(false);
    }
  }

  const selectedStep = steps.find((s) => s.id === selectedId) ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24">
        <p className="text-sm text-muted-foreground">Workflow not found</p>
        <Link
          href={"/workflows" as never}
          className="text-xs text-primary hover:underline"
        >
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-2.5"
        style={{ background: "var(--surface-1)" }}
      >
        <Link
          href={`/workflows/${workflow.id}` as never}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {config.name || workflow.name}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="text-[12px] font-medium text-foreground">Builder</span>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {steps.length} step{steps.length !== 1 ? "s" : ""} · {workflow.currentVersion}
          </span>

          <Link
            href={`/workflows/${workflow.id}` as never}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Clock className="h-3 w-3" />
            History
          </Link>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || running}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </button>

          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={saving || running}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {running ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            Run Workflow
          </button>
        </div>
      </div>

      {/* ── Three columns ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: workflow config */}
        <div
          className="w-72 shrink-0 overflow-y-auto border-r border-border/60"
          style={{ background: "var(--surface-1)" }}
        >
          <WorkflowConfigPanel config={config} onChange={setConfig} />
        </div>

        {/* Middle: flow canvas */}
        <div className="flex-1 overflow-y-auto px-4">
          <FlowCanvas
            steps={steps}
            selectedId={selectedId}
            agents={agents}
            tools={tools}
            onSelect={(sid) =>
              setSelectedId((prev) => (prev === sid ? null : sid))
            }
            onDelete={deleteStep}
            onAdd={addStep}
          />
        </div>

        {/* Right: step config */}
        <div
          className="w-80 shrink-0 overflow-y-auto border-l border-border/60"
          style={{ background: "var(--surface-1)" }}
        >
          {selectedStep ? (
            <StepConfigPanel
              step={selectedStep}
              agents={agents}
              tools={tools}
              steps={steps}
              onChange={updateStep}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <GitBranch className="h-8 w-8 text-muted-foreground/15" />
              <p className="text-[13px] font-medium text-muted-foreground">
                Select a step
              </p>
              <p className="text-[12px] text-muted-foreground/60">
                Click any step in the flow to configure it
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
