"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Bot, CheckCircle2, ChevronRight,
  Database, GitBranch, Loader2, RefreshCw, Send, Shield,
  ShieldCheck, Sparkles, Wrench, Zap, AlertTriangle,
  Globe2, Check, X, Edit2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createArchitectSession, generatePlan, revisePlan, approvePlan,
  createWorkflowFromPlan, type ArchitectPlan, type ArchitectSession,
} from "@/lib/architect";

// ─── Step indicator ───────────────────────────────────────────────────────────
type Step = "goal" | "clarify" | "generating" | "plan" | "connections" | "creating" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "goal",        label: "Describe goal"     },
  { id: "plan",        label: "Review plan"        },
  { id: "connections", label: "Connect systems"    },
  { id: "done",        label: "Workflow ready"     },
];

function StepBar({ current }: { current: Step }) {
  const active = ["goal","clarify","generating"].includes(current) ? 0
    : current === "plan" ? 1
    : current === "connections" ? 2
    : 3;
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all ${
            i < active ? "bg-amber-500 text-white"
            : i === active ? "bg-amber-700 text-white ring-4 ring-amber-200"
            : "bg-stone-100 text-stone-400"
          }`}>
            {i < active ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </div>
          <span className={`ml-1.5 text-[12px] font-medium ${i === active ? "text-amber-800" : "text-stone-400"}`}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && <div className={`mx-3 h-px w-12 ${i < active ? "bg-amber-400" : "bg-stone-200"}`} />}
        </div>
      ))}
    </div>
  );
}

// ─── Risk badge ───────────────────────────────────────────────────────────────
function RiskBadge({ level }: { level: "low" | "medium" | "high" }) {
  const styles = {
    low:    "bg-emerald-50 text-emerald-700 border-emerald-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    high:   "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles[level]}`}>
      {level} risk
    </span>
  );
}

// ─── Plan section card ────────────────────────────────────────────────────────
function PlanCard({ title, count, icon: Icon, children }: {
  title: string; count?: number; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-stone-50 border-b border-stone-100">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-amber-600" />
          <span className="text-[13px] font-bold text-stone-800">{title}</span>
        </div>
        {count !== undefined && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{count}</span>
        )}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

// ─── Generating animation ─────────────────────────────────────────────────────
const GEN_STEPS = [
  "Understanding your workflow goal…",
  "Identifying required agents…",
  "Planning tools and connections…",
  "Adding approvals and safety checks…",
  "Preparing workflow graph…",
];

function GeneratingView() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep(s => Math.min(s + 1, GEN_STEPS.length - 1)), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-amber-100" />
        <div className="absolute inset-0 rounded-full border-4 border-t-amber-500 animate-spin" />
        <Sparkles className="h-8 w-8 text-amber-600" />
      </div>
      <div className="text-center space-y-2">
        <p className="text-[15px] font-semibold text-stone-800">{GEN_STEPS[step]}</p>
        <div className="flex items-center gap-1 justify-center">
          {GEN_STEPS.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i <= step ? "w-5 bg-amber-500" : "w-1.5 bg-stone-200"}`} />
          ))}
        </div>
      </div>
      <p className="text-[13px] text-stone-400">AI Workflow Architect is designing your automation…</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ArchitectPage() {
  const router = useRouter();
  const [step, setStep]             = useState<Step>("goal");
  const [goal, setGoal]             = useState("");
  const [session, setSession]       = useState<ArchitectSession | null>(null);
  const [plan, setPlan]             = useState<ArchitectPlan | null>(null);
  const [questions, setQuestions]   = useState<string[]>([]);
  const [answers, setAnswers]       = useState<Record<string, string>>({});
  const [reviseText, setReviseText] = useState("");
  const [revising, setRevising]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const EXAMPLES = [
    "Check customer renewal risk every morning, fetch CRM data, score with AI, get approval, update CRM",
    "Monitor failed data syncs, summarise root cause with AI, create Jira tickets automatically",
    "Fetch competitor pricing daily, generate analysis report, send to Slack with manager approval",
    "Process incoming invoices, extract key data with AI, match to PO, flag mismatches for review",
  ];

  // ── Step 1: Submit goal ───────────────────────────────────────────────────
  async function handleGoalSubmit() {
    if (!goal.trim()) return;
    setLoading(true);
    setStep("generating");
    try {
      const sess = await createArchitectSession(goal);
      setSession(sess);
      if (sess.needsClarification && sess.clarificationQuestions?.length) {
        setQuestions(sess.clarificationQuestions);
        setStep("clarify");
      } else {
        await doPlanGeneration(sess.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start architect session");
      setStep("goal");
    } finally {
      setLoading(false);
    }
  }

  async function doPlanGeneration(sessionId: string, ans: Record<string, string> = {}) {
    setStep("generating");
    try {
      const res = await generatePlan(sessionId, ans);
      setPlan(res.plan);
      setStep("plan");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Plan generation failed");
      setStep("goal");
    }
  }

  // ── Step 2: Clarification answers ─────────────────────────────────────────
  async function handleClarifySubmit() {
    if (!session) return;
    setLoading(true);
    await doPlanGeneration(session.id, answers);
    setLoading(false);
  }

  // ── Revise plan ───────────────────────────────────────────────────────────
  async function handleRevise() {
    if (!session || !reviseText.trim()) return;
    setRevising(true);
    try {
      const res = await revisePlan(session.id, reviseText);
      setPlan(res.plan);
      setReviseText("");
      toast.success("Plan revised");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revision failed");
    } finally {
      setRevising(false);
    }
  }

  // ── Approve plan ──────────────────────────────────────────────────────────
  async function handleApprove() {
    if (!session) return;
    setLoading(true);
    try {
      await approvePlan(session.id);
      // Check if any connections needed
      const needsConns = plan?.requiredConnections?.some(c => c.requiredForSimulation) ?? false;
      if (needsConns) {
        setStep("connections");
      } else {
        await handleCreateWorkflow();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setLoading(false);
    }
  }

  // ── Create workflow ───────────────────────────────────────────────────────
  async function handleCreateWorkflow(bindings: Record<string, string> = {}) {
    if (!session) return;
    setLoading(true);
    setStep("creating");
    try {
      const result = await createWorkflowFromPlan(session.id, bindings);
      // Store animation steps so builder can use server-provided timing
      if (result.animationSteps?.length) {
        try {
          sessionStorage.setItem(
            `architect-anim-${result.workflowId}`,
            JSON.stringify(result.animationSteps),
          );
        } catch { /* ignore quota errors */ }
      }
      setStep("done");
      toast.success("Workflow created from your plan!");
      setTimeout(() => {
        router.push(
          `/workflows/${result.workflowId}/builder?architectSessionId=${session.id}&animate=true` as never
        );
      }, 1200);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Workflow creation failed");
      setStep("plan");
    } finally {
      setLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "#FAFAF7" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/workflows/new" className="flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-800 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Link>
            <div className="h-4 w-px bg-stone-200" />
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100">
                <Sparkles className="h-4 w-4 text-amber-700" />
              </div>
              <span className="text-[14px] font-bold text-stone-900">AI Workflow Architect</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase tracking-wider">Beta</span>
            </div>
          </div>
          {step !== "goal" && step !== "generating" && (
            <StepBar current={step} />
          )}
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10">

        {/* ── GOAL INPUT ────────────────────────────────────────────────────── */}
        {step === "goal" && (
          <div className="space-y-8">
            <div className="text-center space-y-3">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100">
                  <Sparkles className="h-8 w-8 text-amber-600" />
                </div>
              </div>
              <h1 className="text-[28px] font-black tracking-tight text-stone-900">
                What do you want to automate?
              </h1>
              <p className="text-[15px] text-stone-500 leading-relaxed max-w-lg mx-auto">
                Describe your automation goal in plain English. Vectorbea will design the agents,
                tools, approvals, and workflow graph for you.
              </p>
            </div>

            <div className="rounded-2xl border-2 border-amber-200 bg-white overflow-hidden"
              style={{ boxShadow: "0 8px 32px rgba(217,119,6,0.12)" }}>
              <textarea
                ref={textRef}
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleGoalSubmit(); }}
                placeholder="e.g. Monitor customer renewal risk every morning — fetch CRM data, score with AI, get manager approval, then update the CRM automatically…"
                rows={5}
                className="w-full resize-none px-5 py-4 text-[15px] text-stone-800 placeholder:text-stone-300 outline-none leading-relaxed"
                style={{ fontFamily: "inherit" }}
                autoFocus
              />
              <div className="flex items-center justify-between border-t border-stone-100 px-4 py-3">
                <span className="text-[12px] text-stone-400">
                  {goal.length}/4000 · <kbd className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px]">⌘ Enter</kbd> to generate
                </span>
                <button
                  type="button"
                  onClick={() => void handleGoalSubmit()}
                  disabled={!goal.trim() || loading}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-bold text-white transition-all disabled:opacity-50 hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #D97706, #F59E0B)", boxShadow: "0 4px 16px rgba(217,119,6,0.35)" }}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Design workflow
                </button>
              </div>
            </div>

            {/* Examples */}
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-stone-400 uppercase tracking-wider">Examples</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {EXAMPLES.map((ex, i) => (
                  <button key={i} type="button" onClick={() => { setGoal(ex); textRef.current?.focus(); }}
                    className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-[12.5px] text-stone-600 hover:border-amber-300 hover:bg-amber-50/50 transition-all leading-relaxed">
                    <ChevronRight className="inline h-3 w-3 text-amber-500 mr-1" />
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── GENERATING ────────────────────────────────────────────────────── */}
        {(step === "generating" || step === "creating") && (
          <div>
            {step === "creating" ? (
              <div className="flex flex-col items-center justify-center gap-6 py-20">
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-amber-100" />
                  <div className="absolute inset-0 rounded-full border-4 border-t-amber-500 animate-spin" />
                  <GitBranch className="h-8 w-8 text-amber-600" />
                </div>
                <p className="text-[15px] font-semibold text-stone-800">Creating your workflow…</p>
                <p className="text-[13px] text-stone-400">The builder will open with your workflow animated in.</p>
              </div>
            ) : (
              <GeneratingView />
            )}
          </div>
        )}

        {/* ── CLARIFICATION ─────────────────────────────────────────────────── */}
        {step === "clarify" && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-[22px] font-black text-stone-900">A few quick questions</h2>
              <p className="text-[14px] text-stone-500">Help me plan more accurately, or skip to use assumptions.</p>
            </div>
            <div className="space-y-4">
              {questions.map((q, i) => (
                <div key={i} className="rounded-xl border border-stone-200 bg-white p-4">
                  <p className="text-[13.5px] font-semibold text-stone-800 mb-2">{q}</p>
                  <input
                    type="text"
                    placeholder="Your answer (optional)"
                    value={answers[`q${i}`] ?? ""}
                    onChange={e => setAnswers(prev => ({ ...prev, [`q${i}`]: e.target.value }))}
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-[13px] outline-none focus:border-amber-400"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => void handleClarifySubmit()} disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Generate plan
              </button>
              <button type="button" onClick={() => void doPlanGeneration(session!.id)}
                className="rounded-xl border border-stone-200 px-5 py-2.5 text-[13.5px] font-medium text-stone-600 hover:bg-stone-50">
                Skip — use assumptions
              </button>
            </div>
          </div>
        )}

        {/* ── PLAN REVIEW ───────────────────────────────────────────────────── */}
        {step === "plan" && plan && (
          <div className="space-y-5">
            {/* Plan header */}
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4 text-amber-600" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-amber-600">AI Workflow Architect Plan</span>
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                      {Math.round(plan.confidence * 100)}% confidence
                    </span>
                  </div>
                  <h2 className="text-[20px] font-black text-stone-900">{plan.workflowName}</h2>
                  <p className="text-[13.5px] text-stone-600 mt-1">{plan.goalSummary}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2 text-[12.5px] text-stone-500">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  {plan.trigger.type}
                </div>
              </div>
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2 mt-3">
                {[
                  { label: `${plan.agents.length} agent${plan.agents.length !== 1 ? "s" : ""}`, icon: Bot, color: "#7C3AED" },
                  { label: `${plan.tools.length} tool${plan.tools.length !== 1 ? "s" : ""}`, icon: Wrench, color: "#0891B2" },
                  { label: `${plan.approvalGates.length} approval${plan.approvalGates.length !== 1 ? "s" : ""}`, icon: ShieldCheck, color: "#D97706" },
                  { label: `${plan.steps.length} steps`, icon: GitBranch, color: "#059669" },
                ].map(({ label, icon: Icon, color }) => (
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-stone-200 px-3 py-1 text-[12px] font-semibold text-stone-700">
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Agents */}
            {plan.agents.length > 0 && (
              <PlanCard title="Agents" count={plan.agents.length} icon={Bot}>
                {plan.agents.map(a => (
                  <div key={a.tempId} className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13.5px] font-bold text-stone-800">{a.name}</p>
                        <p className="text-[11.5px] text-stone-500 mt-0.5">{a.role}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                        {a.type.replace(/_/g, " ")}
                      </span>
                    </div>
                    {a.modelPreference && (
                      <p className="text-[11px] text-stone-400 mt-2">Model: {a.modelPreference}</p>
                    )}
                  </div>
                ))}
              </PlanCard>
            )}

            {/* Tools */}
            {plan.tools.length > 0 && (
              <PlanCard title="Tools" count={plan.tools.length} icon={Wrench}>
                {plan.tools.map(t => (
                  <div key={t.tempId} className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-[13.5px] font-bold text-stone-800">{t.name}</p>
                        <p className="text-[11.5px] text-stone-500 mt-0.5">{t.description}</p>
                        {t.requiredConnection.type !== "none" && (
                          <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
                            <Globe2 className="h-3 w-3" />
                            Requires: {t.requiredConnection.description}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <RiskBadge level={t.riskLevel} />
                        {t.requiresApproval && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700">
                            APPROVAL GATE
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </PlanCard>
            )}

            {/* Approvals */}
            {plan.approvalGates.length > 0 && (
              <PlanCard title="Approval Gates" count={plan.approvalGates.length} icon={Shield}>
                {plan.approvalGates.map(a => (
                  <div key={a.tempId} className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13.5px] font-bold text-stone-800">{a.name}</p>
                        <p className="text-[11.5px] text-stone-600 mt-0.5">{a.reason}</p>
                        <p className="text-[11px] text-amber-700 mt-1">Approver: {a.approverRole}</p>
                      </div>
                      <RiskBadge level={a.riskLevel as "low" | "medium" | "high"} />
                    </div>
                  </div>
                ))}
              </PlanCard>
            )}

            {/* Workflow Steps — ordered list */}
            {plan.steps.length > 0 && (
              <PlanCard title="Workflow Steps" count={plan.steps.length} icon={GitBranch}>
                <div className="space-y-1.5">
                  {plan.steps.map((s, i) => (
                    <div key={s.tempId} className="flex items-start gap-3 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[10px] font-black text-stone-600">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[12.5px] font-bold text-stone-800">{s.name}</p>
                          <span className="rounded bg-stone-100 px-1.5 py-px text-[9px] font-mono uppercase tracking-wider text-stone-500">{s.type}</span>
                        </div>
                        <p className="text-[11.5px] text-stone-500 mt-0.5 line-clamp-1">{s.description}</p>
                        {s.dependsOn?.length > 0 && (
                          <p className="text-[10.5px] text-stone-400 mt-0.5">depends on: {s.dependsOn.join(", ")}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </PlanCard>
            )}

            {/* Required connections — shown in plan review with status */}
            {plan.requiredConnections?.length > 0 && (
              <PlanCard title="Required Connections" count={plan.requiredConnections.length} icon={Globe2}>
                {plan.requiredConnections.map(conn => (
                  <div key={conn.tempId} className="flex items-start justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                    <div className="flex-1">
                      <p className="text-[13px] font-bold text-stone-800">{conn.name}</p>
                      <p className="text-[11.5px] text-stone-500 mt-0.5">{conn.setupInstructions}</p>
                      <p className="text-[11px] text-stone-400 mt-1">Used by: {conn.usedBy.join(", ")}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {conn.requiredForSimulation ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9.5px] font-bold text-amber-700">SIM REQUIRED</span>
                      ) : (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] font-bold text-stone-500">OPTIONAL FOR SIM</span>
                      )}
                      <span className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[9.5px] font-bold text-red-600">NOT CONNECTED</span>
                    </div>
                  </div>
                ))}
              </PlanCard>
            )}

            {/* Safety notes */}
            {plan.safetyNotes.length > 0 && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 space-y-1.5">
                <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">Safety notes</p>
                {plan.safetyNotes.map((note, i) => (
                  <p key={i} className="text-[12.5px] text-blue-700 flex items-start gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
                    {note}
                  </p>
                ))}
              </div>
            )}

            {/* Simulation info */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-[13px] font-bold text-emerald-800">Simulation-first</p>
                <p className="text-[12px] text-emerald-700">
                  {plan.simulationPlan.canSimulateWithoutConnections
                    ? "This workflow can run in simulation mode without real connections."
                    : "Simulation requires an LLM connection. Real execution requires all connections."}
                </p>
              </div>
            </div>

            {/* Revise */}
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <Edit2 className="h-3.5 w-3.5 text-stone-400" />
                <p className="text-[12px] font-semibold text-stone-500">Request a revision</p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={reviseText}
                  onChange={e => setReviseText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && reviseText.trim()) void handleRevise(); }}
                  placeholder="e.g. Remove the DB write step, make it simpler…"
                  className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-[13px] outline-none focus:border-amber-400"
                />
                <button type="button" onClick={() => void handleRevise()} disabled={!reviseText.trim() || revising}
                  className="flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-2 text-[13px] font-semibold text-stone-700 hover:bg-stone-200 disabled:opacity-50">
                  {revising ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Revise
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button type="button" onClick={() => void handleApprove()} disabled={loading}
                className="flex items-center gap-2 rounded-xl px-6 py-3 text-[14px] font-black text-white disabled:opacity-50 hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #D97706, #F59E0B)", boxShadow: "0 4px 16px rgba(217,119,6,0.35)" }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve & create workflow
              </button>
              <button type="button" onClick={() => setStep("goal")}
                className="rounded-xl border border-stone-200 px-4 py-3 text-[13.5px] font-medium text-stone-600 hover:bg-stone-50">
                Start over
              </button>
            </div>
          </div>
        )}

        {/* ── CONNECTIONS ───────────────────────────────────────────────────── */}
        {step === "connections" && plan && (
          <div className="space-y-5">
            <div>
              <h2 className="text-[22px] font-black text-stone-900">Connect required systems</h2>
              <p className="text-[14px] text-stone-500 mt-1">
                Configure the connections your workflow needs. Secrets are stored securely — never in the AI chat.
              </p>
            </div>
            {plan.requiredConnections.map(conn => (
              <div key={conn.tempId} className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-[14px] font-bold text-stone-800">{conn.name}</p>
                      {conn.requiredForSimulation && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">REQUIRED FOR SIM</span>
                      )}
                    </div>
                    <p className="text-[12.5px] text-stone-500">{conn.setupInstructions}</p>
                    <p className="text-[11.5px] text-stone-400 mt-1">Used by: {conn.usedBy.join(", ")}</p>
                  </div>
                  <Globe2 className="h-5 w-5 text-stone-300 shrink-0" />
                </div>
                <div className="mt-3 pt-3 border-t border-stone-100">
                  <Link
                    href={`/connections?type=${conn.type}&name=${encodeURIComponent(conn.name)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-[12.5px] font-semibold text-amber-800 hover:bg-amber-200 transition-colors"
                  >
                    Configure in Connections →
                  </Link>
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => void handleCreateWorkflow()} disabled={loading}
                className="flex items-center gap-2 rounded-xl px-6 py-3 text-[14px] font-black text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #D97706, #F59E0B)" }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Create in simulation mode
              </button>
              <p className="self-center text-[12px] text-stone-400">
                You can configure real connections later
              </p>
            </div>
          </div>
        )}

        {/* ── DONE ──────────────────────────────────────────────────────────── */}
        {step === "done" && (
          <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-100">
              <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-[24px] font-black text-stone-900">Workflow created!</h2>
              <p className="text-[14px] text-stone-500 mt-2">Opening the builder with your workflow animated in…</p>
            </div>
            <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
          </div>
        )}
      </div>
    </div>
  );
}
