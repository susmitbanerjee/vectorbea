"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Bot, CalendarClock,
  GitBranch, Play, RefreshCw, Save,
} from "lucide-react";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";
import { toast } from "sonner";

import type { TriggerType, WorkflowCreationMode } from "@/types/platform";
import { createWorkflow } from "@/lib/repository";

const TRIGGER_TYPES: { type: TriggerType; label: string; desc: string; icon: React.ElementType }[] = [
  { type: "manual",  label: "Manual",    desc: "Triggered on demand",        icon: Play },
  { type: "cron",    label: "Scheduled", desc: "Runs on a cron schedule",    icon: CalendarClock },
  { type: "webhook", label: "Webhook",   desc: "Triggered via HTTP webhook", icon: GitBranch },
  { type: "api",     label: "API Call",  desc: "Triggered programmatically", icon: Bot },
];

export default function NewWorkflowPage() {
  const router = useRouter();
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger]         = useState<TriggerType>("manual");
  const [cron, setCron]               = useState("0 7 * * 1");
  const [timezone, setTimezone]       = useState("America/New_York");
  const [saving, setSaving]           = useState(false);

  async function handleCreate() {
    if (!name.trim()) { toast.error("Workflow name is required."); return; }
    setSaving(true);
    try {
      const wf = await createWorkflow({
        name: name.trim(),
        description: description.trim(),
        creationMode: "native" as WorkflowCreationMode,
        triggerType: trigger,
        scheduleConfig: trigger === "cron" ? { cronExpression: cron, timezone } : undefined,
      });
      toast.success("Workflow created.");
      router.push(`/workflows/${wf.id}/builder` as never);
    } catch {
      toast.error("Failed to create workflow.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all";

  return (
    <div className="min-h-full bg-[#F7F8FA]">
      <div className="max-w-2xl mx-auto px-6 py-10 lg:py-14 space-y-8">

        {/* Back */}
        <Link href={"/workflows" as never}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-slate-700 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Workflows
        </Link>

        {/* Page heading */}
        <div className="space-y-1">
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900">New Workflow</h1>
          <p className="text-[14.5px] text-slate-500">
            Choose how to create your workflow, then configure the basics.
          </p>
        </div>

        {/* ── AI Architect hero card ────────────────────────────────────── */}
        <Link href={"/workflows/new/architect" as never}
          className="group block rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
          style={{
            background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 60%, #FDE68A 100%)",
            border: "1.5px solid #FCD34D",
            boxShadow: "0 2px 16px rgba(217,119,6,0.10)",
          }}
        >
          <div className="p-7">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1 space-y-3">
                {/* Title row */}
                <div className="flex items-center gap-3">
                  <ArchitectLogo size={40} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] font-bold tracking-tight text-stone-900">AI Workflow Architect</span>
                      <span className="rounded-full bg-amber-400/30 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 uppercase tracking-wider">
                        Recommended
                      </span>
                    </div>
                    <p className="text-[12px] text-amber-700 font-medium mt-0.5">Best for teams new to Vectorbea</p>
                  </div>
                </div>

                {/* Description */}
                <p className="text-[14px] text-stone-700 leading-relaxed">
                  Describe what you want to automate. Vectorbea designs the full workflow — agents, tools, connections, and approvals — then reveals it step by step on the canvas.
                </p>

                {/* Feature chips */}
                <div className="flex flex-wrap gap-2">
                  {["Auto-generates workflow", "Reviews before creating", "Simulation-first", "Full canvas control"].map(tag => (
                    <span key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-white/60 border border-amber-200 px-2.5 py-1 text-[11.5px] font-medium text-amber-800">
                      <span className="text-amber-500">✓</span> {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Arrow */}
              <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 group-hover:bg-amber-600 transition-colors shadow-sm mt-0.5">
                <ArrowRight className="h-5 w-5 text-white" />
              </div>
            </div>
          </div>
        </Link>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">or build manually</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {/* Manual form */}
        <div className="space-y-5">

          {/* Workflow info */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Workflow Info</p>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Name <span className="text-amber-500 normal-case tracking-normal font-bold">*</span>
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Customer Renewal Intelligence"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what this workflow does…"
                  className={inputCls + " resize-none leading-relaxed"}
                />
              </div>
            </div>
          </div>

          {/* Trigger */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Trigger</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {TRIGGER_TYPES.map(({ type, label, desc, icon: Icon }) => {
                  const active = trigger === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTrigger(type)}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                        active
                          ? "border-amber-400 bg-amber-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className={`h-4.5 w-4.5 ${active ? "text-amber-600" : "text-slate-400"}`} />
                      <div>
                        <p className={`text-[13px] font-semibold ${active ? "text-amber-800" : "text-slate-700"}`}>
                          {label}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug hidden sm:block">{desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {trigger === "cron" && (
                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                      Cron expression
                    </label>
                    <input
                      value={cron}
                      onChange={e => setCron(e.target.value)}
                      placeholder="0 7 * * 1"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                      Timezone
                    </label>
                    <input
                      value={timezone}
                      onChange={e => setTimezone(e.target.value)}
                      placeholder="America/New_York"
                      className={inputCls}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <Link href={"/workflows" as never}
            className="text-[13.5px] font-medium text-slate-400 hover:text-slate-700 transition-colors">
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving || !name.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-900 px-6 text-[14px] font-semibold text-white hover:bg-slate-800 active:bg-black disabled:opacity-40 transition-colors shadow-sm"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Create &amp; Open Builder
          </button>
        </div>

      </div>
    </div>
  );
}
