"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Bot, CalendarClock, Download,
  GitBranch, LayoutTemplate, Play, RefreshCw, Save,
} from "lucide-react";
import { toast } from "sonner";

import type { TriggerType, WorkflowCreationMode } from "@/types/platform";
import { createWorkflow } from "@/lib/repository";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";

const TRIGGER_TYPES: { type: TriggerType; label: string; desc: string; icon: React.ElementType }[] = [
  { type: "manual",  label: "Manual",    desc: "On demand",     icon: Play },
  { type: "cron",    label: "Scheduled", desc: "Cron schedule", icon: CalendarClock },
  { type: "webhook", label: "Webhook",   desc: "HTTP webhook",  icon: GitBranch },
  { type: "api",     label: "API Call",  desc: "Programmatic",  icon: Bot },
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

  const inputCls = "w-full rounded-[9px] border border-[#E0E3E6] bg-white px-3.5 py-2.5 text-[13.5px] text-[#0B0D0F] placeholder:text-[#9CA3AF] focus:border-[#9CCFBB] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15 transition-shadow";
  const labelCls = "block font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF] mb-2";

  return (
    <div className="min-h-full bg-[#F7F8F9]">
      <div className="mx-auto max-w-6xl px-6 py-10 lg:py-12">

        {/* Back + heading */}
        <div className="mb-8 space-y-3">
          <Link
            href={"/workflows" as never}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-[#9CA3AF] transition-colors hover:text-[#0B0D0F]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Workflows
          </Link>
          <div>
            <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[#0B0D0F]">New workflow</h1>
            <p className="mt-1 text-[14px] text-[#6B7280]">Start from a template, describe it with AI, build from scratch, or import an existing flow.</p>
          </div>
          {/* Secondary entry points — template & import */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Link
              href={"/templates" as never}
              className="group inline-flex items-center gap-2 rounded-[9px] border border-[#E0E3E6] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#4B5563] transition-colors hover:border-[#C9CED4] hover:bg-[#FAFBFB] hover:text-[#0B0D0F]"
            >
              <LayoutTemplate className="h-4 w-4 text-[#7C3AED]" />
              Start from a template
              <ArrowRight className="h-3.5 w-3.5 text-[#C9CED4] transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={"/workflows/import" as never}
              className="group inline-flex items-center gap-2 rounded-[9px] border border-[#E0E3E6] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#4B5563] transition-colors hover:border-[#C9CED4] hover:bg-[#FAFBFB] hover:text-[#0B0D0F]"
            >
              <Download className="h-4 w-4 text-[#2563EB]" />
              Import workflow
              <ArrowRight className="h-3.5 w-3.5 text-[#C9CED4] transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">

          {/* ── LEFT: AI Architect ──────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="px-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[#007F4E]">Recommended</p>

            <Link
              href={"/workflows/new/architect" as never}
              className="group flex flex-col overflow-hidden rounded-[14px] border border-[#E0E3E6] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#9CCFBB] hover:shadow-[0_18px_44px_rgba(11,13,15,0.10)]"
              style={{ minHeight: 420 }}
            >
              {/* Dotted canvas banner */}
              <div
                className="flex items-center justify-between border-b border-[#ECEEEF] px-7 py-6"
                style={{
                  background: "#FAFBFB",
                  backgroundImage: "radial-gradient(#D2D6DB 1px, transparent 1px)",
                  backgroundSize: "20px 20px",
                }}
              >
                <div className="flex items-center gap-3.5">
                  <ArchitectLogo size={44} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-bold tracking-[-0.01em] text-[#0B0D0F]">AI Workflow Architect</span>
                      <span className="rounded-full border border-[#9CCFBB] bg-[#E6F4EF] px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#006B45]">
                        Recommended
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] font-medium text-[#6B7280]">Best for teams new to Vectorbea</p>
                  </div>
                </div>
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#0B0D0F] shadow-sm transition-colors group-hover:bg-[#007F4E]">
                  <ArrowRight className="h-4 w-4 text-white" />
                </div>
              </div>

              <div className="flex flex-1 flex-col p-7">
                {/* Description */}
                <p className="mb-6 text-[14px] leading-relaxed text-[#4B5563]">
                  Describe what you want to automate in plain English. Vectorbea designs the full workflow — agents, tools, connections, and approvals — then reveals it step by step on the canvas.
                </p>

                {/* Features list — checkpoint diamonds */}
                <ul className="mb-6 space-y-3">
                  {ARCHITECT_FEATURES.map(f => (
                    <li key={f} className="flex items-start gap-3">
                      <span
                        className="mt-[5px] inline-block h-[9px] w-[9px] shrink-0 rotate-45 rounded-[2px]"
                        style={{ background: "#FFFFFF", border: "2px solid #007F4E" }}
                      />
                      <span className="text-[13px] leading-snug text-[#4B5563]">{f}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-auto">
                  <div className="inline-flex items-center gap-2 rounded-[9px] bg-[#007F4E] px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition-colors group-hover:bg-[#006B45]">
                    Start with AI Architect
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
            </Link>
          </div>

          {/* ── RIGHT: Manual build form ────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="px-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">Build manually</p>

            <div className="overflow-hidden rounded-[14px] border border-[#E0E3E6] bg-white">

              {/* Workflow info */}
              <div className="space-y-4 border-b border-[#ECEEEF] px-6 py-5">
                <div>
                  <label className={labelCls}>
                    Name <span className="text-[#007F4E]">*</span>
                  </label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Customer Renewal Intelligence"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Description</label>
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
                <label className={labelCls}>Trigger</label>
                <div className="grid grid-cols-2 gap-2">
                  {TRIGGER_TYPES.map(({ type, label, desc, icon: Icon }) => {
                    const active = trigger === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setTrigger(type)}
                        className={`flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors ${
                          active
                            ? "border-[#9CCFBB] bg-[#E6F4EF]/50"
                            : "border-[#E0E3E6] hover:border-[#C9CED4] hover:bg-[#FAFBFB]"
                        }`}
                      >
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] ${
                          active ? "bg-[#007F4E]" : "bg-[#F3F4F5]"
                        }`}>
                          <Icon className={`h-4 w-4 ${active ? "text-white" : "text-[#6B7280]"}`} />
                        </div>
                        <div>
                          <p className={`text-[13px] font-semibold leading-none ${active ? "text-[#006B45]" : "text-[#0B0D0F]"}`}>{label}</p>
                          <p className="mt-1 text-[11px] text-[#9CA3AF]">{desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {trigger === "cron" && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Cron expression</label>
                      <input
                        value={cron}
                        onChange={e => setCron(e.target.value)}
                        placeholder="0 7 * * 1"
                        className={inputCls + " font-mono text-[13px]"}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Timezone</label>
                      <input value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="America/New_York" className={inputCls} />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-6 py-4">
                <Link
                  href={"/workflows" as never}
                  className="text-[13px] font-medium text-[#9CA3AF] transition-colors hover:text-[#0B0D0F]"
                >
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={saving || !name.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-[#0B0D0F] px-5 text-[13.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1F2428] disabled:opacity-40"
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
