"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, withWorkspace } from "@/lib/api/client";

export default function BetaApplyPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [form, setForm] = useState({
    fullName: "", company: "", role: "", useCase: "",
    currentTools: "", painPoint: "", workflowsPerWeek: "", teamSize: "",
    byokReady: false,
  });

  function set(key: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim() || !form.useCase.trim()) {
      toast.error("Please fill in your name and use case.");
      return;
    }
    setLoading(true);
    try {
      await apiFetch(withWorkspace("/api/beta/apply"), {
        method: "POST",
        json: form,
      });
      setSubmitted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit application");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 bg-[#FAFAF7]">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 mx-auto">
            <CheckCircle2 className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-[20px] font-bold text-slate-900">Application Received</h1>
          <p className="text-[14px] text-slate-500">
            Vectorbea is currently invite-only for selected backend and AI teams.
            We review every workspace manually. You&apos;ll hear from us soon.
          </p>
          <p className="text-[12px] text-slate-400 font-mono">Status: Under review</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-[#FAFAF7]">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 mx-auto mb-4">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-slate-900">Request Beta Access</h1>
          <p className="mt-2 text-[13.5px] text-slate-500 max-w-sm mx-auto">
            Vectorbea is currently invite-only for selected backend and AI teams
            building durable agent workflows.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">Full Name *</label>
                <input value={form.fullName} onChange={e => set("fullName", e.target.value)}
                  required placeholder="Your name"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">Company / Team</label>
                <input value={form.company} onChange={e => set("company", e.target.value)}
                  placeholder="Acme Inc."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">Your Role</label>
              <input value={form.role} onChange={e => set("role", e.target.value)}
                placeholder="Backend Engineer, AI Lead, etc."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">What are you trying to automate? *</label>
              <textarea required rows={3} value={form.useCase} onChange={e => set("useCase", e.target.value)}
                placeholder="Describe your automation goal..."
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">What tools do you use today?</label>
              <input value={form.currentTools} onChange={e => set("currentTools", e.target.value)}
                placeholder="LangGraph, n8n, Temporal, Airflow, custom scripts..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">What breaks today?</label>
              <input value={form.painPoint} onChange={e => set("painPoint", e.target.value)}
                placeholder="Pain points with your current setup..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">Approx. runs/week</label>
                <input value={form.workflowsPerWeek} onChange={e => set("workflowsPerWeek", e.target.value)}
                  placeholder="10-50, 100+..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-[11.5px] font-semibold text-slate-600 mb-1">Team size</label>
                <input value={form.teamSize} onChange={e => set("teamSize", e.target.value)}
                  placeholder="1, 2-5, 10+..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.byokReady} onChange={e => set("byokReady", e.target.checked)}
                className="rounded border-slate-300 text-amber-500 focus:ring-amber-400" />
              <span className="text-[12.5px] text-slate-600">
                I can bring my own LLM API key (OpenAI / Anthropic) for real execution
              </span>
            </label>
          </div>

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[13.5px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Request Access
          </button>
          <p className="text-center text-[11.5px] text-slate-400">
            We review every application manually. No spam, no public free tier.
          </p>
        </form>
      </div>
    </div>
  );
}
