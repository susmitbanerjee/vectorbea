"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, LogOut, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, withWorkspace } from "@/lib/api/client";

// Standalone page — NO sidebar, NO app navigation.
// Unapproved/waitlisted users land here after sign-up.
// They can ONLY submit an application or sign out.

export default function BetaWaitlistPage() {
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
      await apiFetch(withWorkspace("/api/beta/apply"), { method: "POST", json: form });
      setSubmitted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch {}
    window.location.href = "/signin";
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col">
      {/* Minimal header — Vectorbea logo + sign out only */}
      <header className="h-14 flex items-center justify-between px-6 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="text-[14px] font-bold text-slate-900">Vectorbea</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
            Private Beta
          </span>
        </div>
        <button type="button" onClick={handleSignOut}
          className="flex items-center gap-1.5 text-[12.5px] text-slate-500 hover:text-slate-700 transition-colors">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      <div className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          {submitted ? (
            <div className="text-center space-y-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 mx-auto">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <div>
                <h1 className="text-[22px] font-bold text-slate-900">Application received</h1>
                <p className="mt-2 text-[14px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Vectorbea is currently invite-only. We review every application manually and reach out personally.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-left space-y-2">
                <p className="text-[12.5px] font-semibold text-slate-700">What happens next</p>
                <ul className="space-y-1.5 text-[12px] text-slate-500">
                  <li className="flex items-start gap-2"><span className="text-amber-500 shrink-0">1.</span>We review your use case and team fit</li>
                  <li className="flex items-start gap-2"><span className="text-amber-500 shrink-0">2.</span>We reach out within a few business days</li>
                  <li className="flex items-start gap-2"><span className="text-amber-500 shrink-0">3.</span>Approved accounts get full workspace access</li>
                </ul>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 mx-auto mb-4">
                  <Sparkles className="h-6 w-6 text-white" />
                </div>
                <h1 className="text-[24px] font-bold text-slate-900">Request beta access</h1>
                <p className="mt-2 text-[13.5px] text-slate-500 max-w-md mx-auto leading-relaxed">
                  Vectorbea is invite-only for selected backend and AI teams. We review every application personally.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Full name <span className="text-red-400">*</span></label>
                      <input value={form.fullName} onChange={e => set("fullName", e.target.value)} required placeholder="Your name"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Company / Team</label>
                      <input value={form.company} onChange={e => set("company", e.target.value)} placeholder="Acme Inc."
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Your role</label>
                    <input value={form.role} onChange={e => set("role", e.target.value)} placeholder="Backend engineer, AI lead, founder…"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">What are you trying to automate? <span className="text-red-400">*</span></label>
                    <textarea required rows={3} value={form.useCase} onChange={e => set("useCase", e.target.value)} placeholder="Describe your automation goal…"
                      className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">What tools do you use today?</label>
                    <input value={form.currentTools} onChange={e => set("currentTools", e.target.value)} placeholder="LangGraph, n8n, Temporal, Airflow…"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">What breaks today?</label>
                    <input value={form.painPoint} onChange={e => set("painPoint", e.target.value)} placeholder="Pain points with your current setup…"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Approx. runs/week</label>
                      <input value={form.workflowsPerWeek} onChange={e => set("workflowsPerWeek", e.target.value)} placeholder="10–50, 100+…"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">Team size</label>
                      <input value={form.teamSize} onChange={e => set("teamSize", e.target.value)} placeholder="1, 2–5, 10+…"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
                    </div>
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={form.byokReady} onChange={e => set("byokReady", e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-amber-500 focus:ring-amber-400" />
                    <span className="text-[12.5px] text-slate-600">I can provide my own LLM API key (OpenAI / Anthropic) for real execution</span>
                  </label>
                  <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[14px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors shadow-sm">
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><Sparkles className="h-4 w-4" /> Request access</>}
                  </button>
                </form>
                <div className="px-6 pb-5 text-center border-t border-slate-100">
                  <p className="mt-3 text-[11.5px] text-slate-400">We review every application manually. No spam, no public free tier.</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
