"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Bot, Check, ChevronDown, ChevronRight,
  Link2, Loader2, RefreshCw, Shield, Sparkles, Wrench, Zap,
  AlertTriangle, CheckCircle2, XCircle, Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  createArchitectSession, generatePlan, revisePlan, approvePlan,
  setSimulationPlaceholder, testConnection,
  generateTools, generateAgents, createWorkflowFromPlan,
  type ArchitectSession, type ArchitectPlan, type ConnectionRequirement,
  type GeneratedTool, type GeneratedAgent, type ReadinessIssue,
} from "@/lib/architect";
import { ConnectionPickerModal } from "@/components/architect/ConnectionPickerModal";

// ── Step bar ──────────────────────────────────────────────────────────────────

const STEPS = [
  { id: "goal",        label: "Goal" },
  { id: "generating",  label: "Planning" },
  { id: "plan",        label: "Review Plan" },
  { id: "connections", label: "Connections" },
  { id: "building",    label: "Building" },
  { id: "done",        label: "Ready" },
];

function StepBar({ current }: { current: string }) {
  const idx = STEPS.findIndex(s => s.id === current);
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold transition-all ${
            i < idx  ? "text-amber-700 bg-amber-50" :
            i === idx ? "text-amber-800 bg-amber-100 ring-1 ring-amber-300" :
            "text-slate-400"
          }`}>
            {i < idx ? <Check className="h-3 w-3" /> : <span className="h-4 w-4 rounded-full border border-current flex items-center justify-center text-[9px]">{i+1}</span>}
            {s.label}
          </div>
          {i < STEPS.length - 1 && <div className={`h-px w-4 ${i < idx ? "bg-amber-300" : "bg-slate-200"}`} />}
        </div>
      ))}
    </div>
  );
}

// ── Connection status badge ───────────────────────────────────────────────────

function ConnStatusBadge({ status }: { status: ConnectionRequirement["status"] }) {
  const map: Record<string, { label: string; color: string }> = {
    missing:              { label: "Missing",     color: "bg-red-50 text-red-700 border-red-200" },
    selected_existing:    { label: "Connected",   color: "bg-green-50 text-green-700 border-green-200" },
    created:              { label: "Created",     color: "bg-green-50 text-green-700 border-green-200" },
    test_passed:          { label: "Tested ✓",    color: "bg-green-50 text-green-700 border-green-200" },
    test_failed:          { label: "Test Failed", color: "bg-red-50 text-red-700 border-red-200" },
    test_pending:         { label: "Testing…",    color: "bg-blue-50 text-blue-700 border-blue-200" },
    simulation_placeholder: { label: "Sim Placeholder", color: "bg-amber-50 text-amber-700 border-amber-200" },
  };
  const { label, color } = map[status] ?? { label: status, color: "bg-slate-50 text-slate-600 border-slate-200" };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${color}`}>{label}</span>;
}

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    low:    "bg-green-50 text-green-700 border-green-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    high:   "bg-red-50 text-red-700 border-red-200",
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${map[level] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>{level}</span>;
}

// ── Generating view ───────────────────────────────────────────────────────────

const GEN_MESSAGES = [
  "Understanding your automation goal…",
  "Identifying required systems and connections…",
  "Planning tools for each integration…",
  "Designing agents with production-grade prompts…",
  "Structuring workflow steps and approval gates…",
];

function GeneratingView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-amber-100 animate-ping opacity-40" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-amber-500">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-[15px] font-semibold text-slate-800">{message}</p>
        <p className="mt-1 text-[12px] text-slate-400">Vectorbea AI is designing your workflow</p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-sm">
        {GEN_MESSAGES.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
            <span className="text-[11.5px] text-slate-500">{m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Building view ─────────────────────────────────────────────────────────────

const BUILD_MESSAGES = [
  { icon: Link2,   text: "Binding connections…" },
  { icon: Wrench,  text: "Creating tools…" },
  { icon: Bot,     text: "Creating agents with system prompts…" },
  { icon: Zap,     text: "Generating workflow graph…" },
  { icon: Shield,  text: "Validating mappings and permissions…" },
];

function BuildingView({ phase }: { phase: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-amber-100 animate-spin" style={{ borderTopColor: "#D97706", borderWidth: 3, borderStyle: "solid" }} />
        <Zap className="h-7 w-7 text-amber-600 relative" />
      </div>
      <p className="text-[15px] font-semibold text-slate-800">Vectorbea is building your workflow…</p>
      <div className="flex flex-col gap-3 w-full max-w-sm">
        {BUILD_MESSAGES.map(({ icon: Icon, text }, i) => (
          <div key={i} className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${
            i < phase  ? "border-amber-200 bg-amber-50" :
            i === phase ? "border-amber-300 bg-amber-50 shadow-sm" :
            "border-slate-100 bg-white opacity-40"
          }`}>
            {i < phase ? (
              <CheckCircle2 className="h-4 w-4 text-amber-600 shrink-0" />
            ) : i === phase ? (
              <Loader2 className="h-4 w-4 text-amber-600 shrink-0 animate-spin" />
            ) : (
              <Icon className="h-4 w-4 text-slate-400 shrink-0" />
            )}
            <span className={`text-[12.5px] font-medium ${i <= phase ? "text-amber-800" : "text-slate-400"}`}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Connection card ───────────────────────────────────────────────────────────

function ConnectionCard({
  sessionId, req, onOpenPicker, onUsePlaceholder, onTest,
}: {
  sessionId: string;
  req: ConnectionRequirement;
  onOpenPicker: (req: ConnectionRequirement) => void;
  onUsePlaceholder: (reqId: string) => void;
  onTest: (reqId: string) => void;
}) {
  const isBound = req.boundConnectionId != null;
  const isReady = ["selected_existing","created","test_passed","simulation_placeholder"].includes(req.status);
  const testPassed = req.status === "test_passed";
  return (
    <div className={`rounded-xl border p-4 transition-all ${
      testPassed ? "border-green-200 bg-green-50/30" :
      isReady    ? "border-amber-200 bg-amber-50/20" :
                   "border-slate-200 bg-white"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[13px] font-semibold text-slate-800">{req.name}</span>
            <ConnStatusBadge status={req.status} />
            {req.requiredForSimulation
              ? <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[9.5px] font-bold text-blue-700">SIM REQUIRED</span>
              : <span className="rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 text-[9.5px] font-bold text-slate-500">OPTIONAL FOR SIM</span>
            }
          </div>
          {req.description && <p className="text-[12px] text-slate-500 mb-2">{req.description}</p>}
          {req.setupInstructions && (
            <p className="text-[11.5px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mb-2">{req.setupInstructions}</p>
          )}
          {req.testError && (
            <p className="text-[11.5px] text-red-600 bg-red-50 rounded-lg px-2 py-1.5 mb-2">
              ✗ {req.testError}
            </p>
          )}
        </div>
        {testPassed && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />}
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {/* Primary: open picker */}
        <button type="button" onClick={() => onOpenPicker(req)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-600 transition-colors">
          <Link2 className="h-3 w-3" />
          {isReady ? "Change connection" : "Select connection"}
        </button>

        {/* Test if bound */}
        {isBound && !testPassed && (
          <button type="button" onClick={() => onTest(req.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors">
            <CheckCircle2 className="h-3 w-3" /> Test connection
          </button>
        )}

        {/* Re-test if failed */}
        {req.status === "test_failed" && (
          <button type="button" onClick={() => onTest(req.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-100 transition-colors">
            <RefreshCw className="h-3 w-3" /> Retry test
          </button>
        )}

        {/* Create new */}
        <Link href={`/connections/new` as never} target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          Create new ↗
        </Link>

        {/* Simulation placeholder */}
        {!req.requiredForSimulation && req.status !== "simulation_placeholder" && (
          <button type="button" onClick={() => onUsePlaceholder(req.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-700 hover:bg-amber-100 transition-colors">
            Use simulation placeholder
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const EXAMPLE_GOALS = [
  "Monitor customer renewal pipeline and send risk alerts to Slack",
  "Process new support tickets, classify them with AI, and update CRM",
  "Daily report: pull sales data, analyze with AI, email summary to team",
  "When order placed, check inventory, reserve stock, notify warehouse",
];

export default function ArchitectPage() {
  const router = useRouter();
  const [step, setStep]                 = useState<string>("goal");
  const [loading, setLoading]           = useState(false);
  const [buildPhase, setBuildPhase]     = useState(0);
  const [genMessage, setGenMessage]     = useState(GEN_MESSAGES[0]);

  const [goal, setGoal]                 = useState("");
  const [session, setSession]           = useState<ArchitectSession | null>(null);
  const [plan, setPlan]                 = useState<ArchitectPlan | null>(null);
  const [connReqs, setConnReqs]         = useState<ConnectionRequirement[]>([]);
  const [genTools, setGenTools]         = useState<GeneratedTool[]>([]);
  const [genAgents, setGenAgents]       = useState<GeneratedAgent[]>([]);
  const [readinessIssues, setReadinessIssues] = useState<ReadinessIssue[]>([]);
  const [readinessStatus, setReadinessStatus] = useState("");
  const [answers, setAnswers]           = useState<Record<string, string>>({});
  const [clarifyQ, setClarifyQ]         = useState<string[]>([]);
  const [reviseText, setReviseText]     = useState("");
  const [showRevise, setShowRevise]     = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [pickerReq, setPickerReq]           = useState<ConnectionRequirement | null>(null);
  const [testingReqId, setTestingReqId]     = useState<string | null>(null);

  // ── Step 1: Submit goal ──────────────────────────────────────────────────
  async function handleGoalSubmit() {
    if (!goal.trim()) return;
    setLoading(true);
    setStep("generating");
    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % GEN_MESSAGES.length;
      setGenMessage(GEN_MESSAGES[msgIdx]);
    }, 1800);
    try {
      const sess = await createArchitectSession(goal.trim());
      setSession(sess);
      if (sess.needsClarification && (sess.clarificationQuestions?.length ?? 0) > 0) {
        setClarifyQ(sess.clarificationQuestions!);
        setStep("clarify");
      } else {
        await doPlanGeneration(sess.id, {});
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start architect session");
      setStep("goal");
    } finally {
      clearInterval(msgInterval);
      setLoading(false);
    }
  }

  async function doPlanGeneration(sessionId: string, ans: Record<string, string>) {
    setStep("generating");
    setGenMessage(GEN_MESSAGES[0]);
    try {
      const res = await generatePlan(sessionId, ans);
      setPlan(res.plan);
      setConnReqs(res.connectionRequirements ?? []);
      setGenTools(res.generatedTools ?? []);
      setGenAgents(res.generatedAgents ?? []);
      setStep("plan");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Plan generation failed");
      setStep("goal");
    }
  }

  // ── Step 2: Clarification ────────────────────────────────────────────────
  async function handleClarifySubmit() {
    if (!session) return;
    setLoading(true);
    await doPlanGeneration(session.id, answers);
    setLoading(false);
  }

  // ── Revise plan ──────────────────────────────────────────────────────────
  async function handleRevise() {
    if (!session || !reviseText.trim()) return;
    setLoading(true);
    try {
      const res = await revisePlan(session.id, reviseText.trim());
      setPlan(res.plan);
      setConnReqs(res.connectionRequirements ?? []);
      setReviseText(""); setShowRevise(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revision failed");
    } finally { setLoading(false); }
  }

  // ── Approve plan → go to connections ────────────────────────────────────
  async function handleApprovePlan() {
    if (!session) return;
    setLoading(true);
    try {
      const res = await approvePlan(session.id);
      setConnReqs(res.connectionRequirements ?? []);
      if (res.needsConnections && res.connectionRequirements.length > 0) {
        setStep("connections");
      } else {
        await handleBuild();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed");
    } finally { setLoading(false); }
  }

  // ── Connection actions ───────────────────────────────────────────────────
  function handleOpenPicker(req: ConnectionRequirement) {
    setPickerReq(req);
  }

  function handlePickerBound(reqId: string, connId: string) {
    setConnReqs(prev => prev.map(r => r.id === reqId
      ? { ...r, status: "selected_existing" as const, boundConnectionId: connId }
      : r
    ));
    setPickerReq(null);
  }

  async function handleTestConnection(reqId: string) {
    if (!session) return;
    setTestingReqId(reqId);
    try {
      const res = await testConnection(session.id, reqId);
      setConnReqs(prev => prev.map(r => r.id === reqId
        ? { ...r, status: res.ok ? "test_passed" as const : "test_failed" as const, testError: res.ok ? undefined : res.message }
        : r
      ));
      if (res.ok) toast.success(`Test passed (${res.latencyMs}ms)`);
      else toast.error(`Test failed: ${res.message}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally { setTestingReqId(null); }
  }

  async function handleUsePlaceholder(reqId: string) {
    if (!session) return;
    try {
      await setSimulationPlaceholder(session.id, reqId);
      setConnReqs(prev => prev.map(r => r.id === reqId ? { ...r, status: "simulation_placeholder" as const } : r));
      toast.success("Simulation placeholder set");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to set placeholder");
    }
  }

  async function handleProceedFromConnections() {
    const requiredSim = connReqs.filter(r => r.requiredForSimulation);
    const allSimReady = requiredSim.every(r =>
      ["test_passed","selected_existing","created","simulation_placeholder"].includes(r.status)
    );
    if (!allSimReady && requiredSim.length > 0) {
      toast.error("Please configure or set simulation placeholders for all simulation-required connections.");
      return;
    }
    await handleBuild();
  }

  // ── Build: generate tools + agents + workflow ────────────────────────────
  async function handleBuild() {
    if (!session) return;
    setStep("building");
    setBuildPhase(0);

    const phases: Array<() => Promise<void>> = [
      async () => { setBuildPhase(1); },
      async () => {
        setBuildPhase(2);
        const toolsRes = await generateTools(session.id);
        setGenTools(toolsRes.tools);
      },
      async () => {
        setBuildPhase(3);
        const agentsRes = await generateAgents(session.id);
        setGenAgents(agentsRes.agents);
      },
      async () => {
        setBuildPhase(4);
        const result = await createWorkflowFromPlan(session.id, {});
        setReadinessStatus(result.readinessStatus);
        setReadinessIssues(result.readinessIssues ?? []);
        if (result.animationSteps?.length) {
          try { sessionStorage.setItem(`architect-anim-${result.workflowId}`, JSON.stringify(result.animationSteps)); }
          catch { /* ignore */ }
        }
        setBuildPhase(5);
        setStep("done");
        toast.success("Workflow created! Opening canvas…");
        setTimeout(() => {
          router.push(`/workflows/${result.workflowId}/builder?architectSessionId=${session.id}&animate=true` as never);
        }, 1500);
      },
    ];

    for (const phase of phases) {
      try { await phase(); await new Promise(r => setTimeout(r, 600)); }
      catch (e) {
        toast.error(e instanceof Error ? e.message : "Build step failed");
        setStep("connections"); return;
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      {/* Back */}
      <Link href={"/workflows/new" as never}
        className="mb-5 flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Link>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-[19px] font-black text-stone-900">AI Workflow Architect</h1>
        </div>
        <p className="text-[12.5px] text-slate-500">
          Describe your automation — Vectorbea creates connections, tools, agents, and the workflow graph.
        </p>
      </div>

      {/* Step bar */}
      {!["generating","building"].includes(step) && (
        <div className="mb-6 overflow-x-auto pb-1">
          <StepBar current={step === "clarify" ? "goal" : step} />
        </div>
      )}

      {/* ── Screen 1: Goal input ──────────────────────────────────────────── */}
      {step === "goal" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="block text-[13px] font-semibold text-slate-700 mb-2">
              What do you want to automate?
            </label>
            <textarea
              rows={4}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGoalSubmit(); }}
              placeholder="Describe your automation in plain English…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
            />
            <p className="mt-1 text-[11px] text-slate-400">⌘ Enter to submit</p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Example automations</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXAMPLE_GOALS.map(eg => (
                <button key={eg} type="button" onClick={() => setGoal(eg)}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-left text-[12px] text-slate-600 hover:border-amber-300 hover:bg-amber-50 transition-all">
                  {eg}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={handleGoalSubmit} disabled={!goal.trim() || loading}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
              <Sparkles className="h-4 w-4" /> Design Workflow
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 2: Clarification ───────────────────────────────────────── */}
      {step === "clarify" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-amber-600" />
            <p className="text-[13px] font-semibold text-amber-900">A few quick questions to improve your plan</p>
          </div>
          {clarifyQ.map((q, i) => (
            <div key={i}>
              <label className="block text-[12.5px] font-medium text-slate-700 mb-1">{q}</label>
              <input value={answers[q] ?? ""} onChange={e => setAnswers(a => ({ ...a, [q]: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                placeholder="Your answer…" />
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={handleClarifySubmit} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              Generate plan
            </button>
            <button type="button" onClick={() => doPlanGeneration(session!.id, {})} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50">
              Skip and generate
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 3: Generating ─────────────────────────────────────────── */}
      {step === "generating" && <GeneratingView message={genMessage} />}

      {/* ── Screen 4: Plan review ─────────────────────────────────────────── */}
      {step === "plan" && plan && (
        <div className="space-y-5">
          {/* Plan overview */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-[16px] font-bold text-slate-900">{plan.workflowName}</h2>
                <p className="text-[12.5px] text-slate-500 mt-0.5">{plan.goalSummary}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] text-slate-400 mb-0.5">Confidence</div>
                <div className={`text-[14px] font-black ${plan.confidence >= 0.8 ? "text-green-600" : plan.confidence >= 0.6 ? "text-amber-600" : "text-red-500"}`}>
                  {Math.round(plan.confidence * 100)}%
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { label: "Connections", value: plan.requiredConnections?.length ?? 0, icon: Link2 },
                { label: "Tools", value: plan.tools?.length ?? 0, icon: Wrench },
                { label: "Agents", value: plan.agents?.length ?? 0, icon: Bot },
                { label: "Steps", value: plan.workflowSteps?.length ?? 0, icon: Zap },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <Icon className="h-4 w-4 text-amber-500 mx-auto mb-1" />
                  <div className="text-[15px] font-black text-slate-800">{value}</div>
                  <div className="text-[10px] text-slate-400">{label}</div>
                </div>
              ))}
            </div>

            {/* Trigger */}
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 mb-3 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span className="text-[12px] font-medium text-slate-700">Trigger:</span>
              <span className="text-[12px] text-slate-600">{plan.trigger?.type} — {plan.trigger?.description}</span>
            </div>
          </div>

          {/* Required connections */}
          {(plan.requiredConnections?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-[13px] font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                <Link2 className="h-4 w-4 text-amber-500" /> Required Connections
              </h3>
              <div className="space-y-2">
                {plan.requiredConnections.map(c => (
                  <div key={c.tempConnectionId} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-slate-700">{c.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{c.type}</span>
                        {c.requiredForSimulation && <span className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">SIM REQUIRED</span>}
                      </div>
                      <p className="text-[11.5px] text-slate-400 mt-0.5">{c.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tools */}
          {(plan.tools?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-[13px] font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                <Wrench className="h-4 w-4 text-amber-500" /> Tools to create
              </h3>
              <div className="space-y-2">
                {plan.tools.map(t => (
                  <div key={t.tempToolId} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                    <div>
                      <span className="text-[12.5px] font-semibold text-slate-700">{t.name}</span>
                      <span className="ml-2 text-[11px] text-slate-400">{t.type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <RiskBadge level={t.riskLevel} />
                      {t.requiresApproval && <span className="rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-[9.5px] font-bold text-orange-700">APPROVAL</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agents */}
          {(plan.agents?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-[13px] font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                <Bot className="h-4 w-4 text-amber-500" /> Agents to create
              </h3>
              <div className="space-y-2">
                {plan.agents.map(a => (
                  <div key={a.tempAgentId} className="rounded-lg border border-slate-100">
                    <button type="button" onClick={() => setExpandedAgents(s => { const n = new Set(s); n.has(a.tempAgentId) ? n.delete(a.tempAgentId) : n.add(a.tempAgentId); return n; })}
                      className="w-full flex items-center justify-between p-3 text-left">
                      <div>
                        <span className="text-[12.5px] font-semibold text-slate-700">{a.name}</span>
                        <span className="ml-2 text-[11px] text-slate-400">{a.role}</span>
                      </div>
                      {expandedAgents.has(a.tempAgentId) ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                    </button>
                    {expandedAgents.has(a.tempAgentId) && (
                      <div className="border-t border-slate-100 p-3 bg-slate-50 rounded-b-lg">
                        <p className="text-[11px] text-slate-500 font-semibold mb-1">System Prompt Preview</p>
                        <pre className="text-[11px] text-slate-600 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">{a.systemPrompt?.slice(0, 500)}{(a.systemPrompt?.length ?? 0) > 500 ? "…" : ""}</pre>
                        {a.allowedTempToolIds?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {a.allowedTempToolIds.map(tid => (
                              <span key={tid} className="rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] text-amber-800">{tid}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Steps */}
          {(plan.workflowSteps?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-[13px] font-bold text-slate-800 mb-3">Workflow Steps</h3>
              <ol className="space-y-1.5">
                {plan.workflowSteps.map((s, i) => (
                  <li key={s.tempStepId} className="flex items-center gap-3 text-[12.5px] text-slate-600">
                    <span className="h-5 w-5 rounded-full bg-amber-100 text-amber-700 font-bold text-[10px] flex items-center justify-center shrink-0">{i+1}</span>
                    <span className="font-medium text-slate-700">{s.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{s.nodeType}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Safety notes */}
          {(plan.safetyNotes?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-[12px] font-semibold text-amber-800">Safety notes</span>
              </div>
              <ul className="space-y-1">
                {plan.safetyNotes.map((n, i) => <li key={i} className="text-[12px] text-amber-700">• {n}</li>)}
              </ul>
            </div>
          )}

          {/* Revise input */}
          {showRevise && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <label className="text-[12.5px] font-semibold text-amber-800">Revision instructions</label>
              <textarea rows={3} value={reviseText} onChange={e => setReviseText(e.target.value)}
                placeholder="e.g. Add a daily digest email, remove the approval gate…"
                className="w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-amber-400" />
              <div className="flex gap-2">
                <button type="button" onClick={handleRevise} disabled={!reviseText.trim() || loading}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Revise plan
                </button>
                <button type="button" onClick={() => setShowRevise(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12.5px] text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 justify-between">
            <button type="button" onClick={() => setShowRevise(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50">
              <RefreshCw className="h-3.5 w-3.5" /> Revise plan
            </button>
            <button type="button" onClick={handleApprovePlan} disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Approve &amp; Continue
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 5: Connection setup ────────────────────────────────────── */}
      {step === "connections" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-blue-900">Configure connections</p>
                <p className="text-[12px] text-blue-700 mt-0.5">
                  Vectorbea needs these connections to create tools and run your workflow.
                  Connections marked <strong>SIM REQUIRED</strong> must be configured for simulation.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {connReqs.map(req => (
              <ConnectionCard
                key={req.id}
                sessionId={session?.id ?? ""}
                req={req}
                onOpenPicker={handleOpenPicker}
                onUsePlaceholder={handleUsePlaceholder}
                onTest={handleTestConnection}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setStep("plan")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12.5px] text-slate-600 hover:bg-slate-50">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to plan
            </button>
            <button type="button" onClick={handleProceedFromConnections} disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Build Workflow
            </button>
          </div>
        </div>
      )}

      {/* ── Screen 6: Building ────────────────────────────────────────────── */}
      {step === "building" && <BuildingView phase={buildPhase} />}

      {/* ── Connection picker modal ───────────────────────────────────────── */}
      {pickerReq && session && (
        <ConnectionPickerModal
          sessionId={session.id}
          requirement={pickerReq}
          onBound={handlePickerBound}
          onClose={() => setPickerReq(null)}
        />
      )}

      {/* ── Screen 7: Done / Ready ────────────────────────────────────────── */}
      {step === "done" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-green-200 bg-green-50/40 p-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <h2 className="text-[16px] font-bold text-slate-900">Workflow Created!</h2>
            <p className="text-[12.5px] text-slate-500 mt-1">
              {genTools.filter(t => t.status === "created").length} tools and {genAgents.filter(a => a.status === "created").length} agents created. Opening canvas…
            </p>
          </div>

          {/* Readiness */}
          {readinessIssues.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[12.5px] font-semibold text-slate-700">Readiness Notes</p>
              {readinessIssues.map((issue, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] ${
                  issue.severity === "error" ? "bg-red-50 text-red-700" :
                  issue.severity === "warning" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                }`}>
                  {issue.severity === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> :
                   issue.severity === "warning" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> :
                   <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 mt-4">
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            <span className="text-[13px] text-slate-500">Opening workflow canvas…</span>
          </div>
        </div>
      )}
    </div>
  );
}
