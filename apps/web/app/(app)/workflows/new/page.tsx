"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bot, CalendarClock, GitBranch, Play, RefreshCw, Save, Shield, Wrench } from "lucide-react";
import { toast } from "sonner";

import type { TriggerType, WorkflowCreationMode } from "@/types/platform";
import { createWorkflow } from "@/lib/repository";

const CREATION_MODES: { mode: WorkflowCreationMode; label: string; description: string; color: string }[] = [
  {
    mode: "native",
    label: "Native Vectorbea Workflow",
    description: "Build agents, tools, and steps inside Vectorbea. Full replay, approvals, checkpoints, and retries.",
    color: "#38BDF8",
  },
  {
    mode: "imported",
    label: "Import from LangGraph / Temporal",
    description: "Convert an existing LangGraph or Temporal workflow. Vectorbea stores the normalized graph.",
    color: "#A78BFA",
  },
  {
    mode: "instrumented",
    label: "Instrument Existing Code",
    description: "Keep execution in your code. Add the Vectorbea SDK to push events and checkpoints.",
    color: "#34D399",
  },
  {
    mode: "endpoint_only",
    label: "Endpoint Trigger Only",
    description: "Trigger an existing HTTP endpoint. Limited observability — no step-level replay.",
    color: "#94A3B8",
  },
];

const TRIGGER_TYPES: { type: TriggerType; label: string; icon: React.ElementType }[] = [
  { type: "manual",  label: "Manual",    icon: Play },
  { type: "cron",    label: "Scheduled", icon: CalendarClock },
  { type: "webhook", label: "Webhook",   icon: GitBranch },
  { type: "api",     label: "API Call",  icon: Bot },
];

export default function NewWorkflowPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<WorkflowCreationMode>("native");
  const [trigger, setTrigger] = useState<TriggerType>("manual");
  const [cron, setCron] = useState("0 7 * * 1");
  const [timezone, setTimezone] = useState("America/New_York");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { toast.error("Workflow name is required."); return; }
    setSaving(true);
    try {
      const wf = await createWorkflow({
        name: name.trim(),
        description: description.trim(),
        creationMode: mode,
        triggerType: trigger,
        scheduleConfig: trigger === "cron" ? { cronExpression: cron, timezone } : undefined,
      });
      toast.success("Workflow created.");
      if (mode === "native") {
        router.push(`/workflows/${wf.id}/builder` as never);
      } else if (mode === "imported") {
        router.push(`/workflows/import` as never);
      } else {
        router.push(`/workflows/${wf.id}` as never);
      }
    } catch {
      toast.error("Failed to create workflow.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-7 lg:p-8 max-w-[1320px]">
      {/* Back */}
      <Link href={"/workflows" as never} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" />
        Workflows
      </Link>

      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">New Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how this workflow will be created and executed.
        </p>
      </div>

      {/* ── AI Architect hero card ─────────────────────────────────────── */}
      <Link href={"/workflows/new/architect" as never}
        className="group block rounded-2xl overflow-hidden transition-all hover:scale-[1.01] hover:shadow-xl"
        style={{ background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 50%, #FDE68A 100%)", border: "2px solid #FDE68A", boxShadow: "0 4px 20px rgba(217,119,6,0.12)" }}
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-black text-stone-900">AI Workflow Architect</span>
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800 uppercase tracking-wider">New</span>
                  </div>
                  <p className="text-[11.5px] text-amber-700 font-medium">Recommended for new workflows</p>
                </div>
              </div>
              <p className="text-[13.5px] text-stone-700 leading-relaxed mb-3">
                Describe your automation goal in plain English. Vectorbea designs the agents, tools,
                approvals, and workflow graph for you — then animates it onto the canvas.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["Auto-generates workflow", "Reviews before creating", "Simulation-first", "Full canvas control"].map(tag => (
                  <span key={tag} className="rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                    ✓ {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-amber-500 group-hover:bg-amber-600 transition-colors">
              <ArrowRight className="h-5 w-5 text-white" />
            </div>
          </div>
        </div>
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border/50" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">or build manually</span>
        <div className="flex-1 h-px bg-border/50" />
      </div>

      {/* Creation mode */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Execution Mode</p>
        {CREATION_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            onClick={() => setMode(m.mode)}
            className={`w-full rounded-xl border p-4 text-left transition-all ${
              mode === m.mode
                ? "shadow-[0_0_0_2px_rgba(56,189,248,0.2)]"
                : "border-border/60 hover:border-border"
            }`}
            style={{
              background: mode === m.mode ? "var(--surface-2)" : "var(--surface-1)",
              borderColor: mode === m.mode ? `${m.color}40` : undefined,
            }}
          >
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                style={{
                  background: mode === m.mode ? `${m.color}20` : "transparent",
                  borderColor: mode === m.mode ? m.color : "var(--border)",
                }}
              >
                {mode === m.mode && (
                  <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
                )}
              </span>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: mode === m.mode ? m.color : undefined }}>
                  {m.label}
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{m.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Basic info */}
      <div className="space-y-4 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Workflow Info</p>

        <div>
          <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Name *</label>
          <input
            placeholder="e.g. Customer Renewal Intelligence"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Description</label>
          <textarea
            rows={3}
            placeholder="Describe what this workflow does…"
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Trigger */}
      <div className="space-y-4 rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Trigger</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TRIGGER_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => setTrigger(t.type)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-[12px] transition-all ${
                  trigger === t.type
                    ? "border-primary/40 bg-primary/5 text-primary"
                    : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                }`}
                style={{ background: "var(--surface-1)" }}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        {trigger === "cron" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Cron expression</label>
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 7 * * 1"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Timezone</label>
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/New_York"
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Link
          href={"/workflows" as never}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={saving || !name.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {mode === "native" ? "Create & Open Builder" : mode === "imported" ? "Continue to Import" : "Create Workflow"}
        </button>
      </div>
    </div>
  );
}
