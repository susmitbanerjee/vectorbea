"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Bot, CalendarClock,
  GitBranch, Play, RefreshCw, Save, Check,
} from "lucide-react";
import { toast } from "sonner";

import type { TriggerType, WorkflowCreationMode } from "@/types/platform";
import { createWorkflow } from "@/lib/repository";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";

const TRIGGER_TYPES: { type: TriggerType; label: string; desc: string; icon: React.ElementType }[] = [
  { type: "manual",  label: "Manual",    desc: "On demand",           icon: Play },
  { type: "cron",    label: "Scheduled", desc: "Cron schedule",       icon: CalendarClock },
  { type: "webhook", label: "Webhook",   desc: "HTTP webhook",        icon: GitBranch },
  { type: "api",     label: "API Call",  desc: "Programmatic",        icon: Bot },
];

const ARCHITECT_FEATURES = [
  "Designs agents, tools & connections",
  "Reviews plan before building",
  "Reveals workflow on canvas step-by-step",
  "Simulation-first — no real calls until ready",
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
      <div className="max-w-6xl mx-auto px-6 py-10 lg:py-12">

        {/* Back + heading */}
        <div className="mb-8 space-y-3">
          <Link href={"/workflows" as never}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-slate-700 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
            Workflows
          </Link>
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-slate-900">New Workflow</h1>
            <p className="mt-1 text-[14px] text-slate-500">Choose how to create your workflow, then configure the basics.</p>
          </div>
        </div>

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* ── LEFT: AI Architect ──────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 px-1">Recommended</p>

            <Link href={"/workflows/new/architect" as never}
              className="group flex flex-col rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5"
              style={{
                background: "linear-gradient(145deg, #FFFBEB 0%, #FEF3C7 50%, #FDE68A 100%)",
                border: "1.5px solid #FCD34D",
                boxShadow: "0 4px 20px rgba(217,119,6,0.12)",
                minHeight: 420,
              }}
            >
              <div className="flex-1 p-7 flex flex-col">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex items-center gap-3">
                    <ArchitectLogo size={44} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[17px] font-bold tracking-tight text-stone-900">AI Workflow Architect</span>
                        <span className="rounded-full bg-amber-400/25 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 uppercase tracking-wider">
                          Recommended
                        </span>
                      </div>
                      <p className="text-[12.5px] text-amber-700 font-medium mt-0.5">Best for teams new to Vectorbea</p>
                    </div>
                  </div>
                  <div className="shrink-0 h-9 w-9 flex items-center justify-center rounded-xl bg-amber-500 group-hover:bg-[#007F4E] transition-colors shadow-sm mt-0.5">
                    <ArrowRight className="h-4.5 w-4.5 text-white" />
                  </div>
                </div>

                {/* Description */}
                <p className="text-[14px] text-stone-700 leading-relaxed mb-6">
                  Describe what you want to automate in plain English. Vectorbea designs the full workflow — agents, tools, connections, and approvals — then reveals it step by step on the canvas.
                </p>

                {/* Features list */}
                <ul className="space-y-2.5 mb-6">
                  {ARCHITECT_FEATURES.map(f => (
                    <li key={f} className="flex items-start gap-2.5">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/30 shrink-0 mt-0.5">
                        <Check className="h-3 w-3 text-amber-700" strokeWidth={2.5} />
                      </div>
                      <span className="text-[13px] text-stone-700 leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-auto">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500 group-hover:bg-[#007F4E] transition-colors px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-sm">
                    Start with AI Architect
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
            </Link>
          </div>

          {/* ── RIGHT: Manual build form ────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 px-1">Build manually</p>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">

              {/* Workflow info */}
              <div className="px-6 py-5 space-y-4 border-b border-slate-100">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Name <span className="text-amber-500 normal-case tracking-normal font-black text-[13px]">*</span>
                  </label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Customer Renewal Intelligence"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
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

              {/* Trigger */}
              <div className="px-6 py-5">
                <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                  Trigger
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {TRIGGER_TYPES.map(({ type, label, desc, icon: Icon }) => {
                    const active = trigger === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setTrigger(type)}
                        className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
                          active
                            ? "border-amber-400 bg-amber-50"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${
                          active ? "bg-amber-100" : "bg-slate-100"
                        }`}>
                          <Icon className={`h-4 w-4 ${active ? "text-amber-600" : "text-slate-500"}`} />
                        </div>
                        <div>
                          <p className={`text-[13px] font-semibold leading-none ${active ? "text-amber-800" : "text-slate-700"}`}>{label}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {trigger === "cron" && (
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Cron expression</label>
                      <input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 7 * * 1"
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Timezone</label>
                      <input value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="America/New_York" className={inputCls} />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/60">
                <Link href={"/workflows" as never}
                  className="text-[13px] font-medium text-slate-400 hover:text-slate-700 transition-colors">
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={saving || !name.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-5 text-[13.5px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shadow-sm"
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Create &amp; Open Builder
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
