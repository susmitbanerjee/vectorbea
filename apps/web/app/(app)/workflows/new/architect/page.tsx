"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bot, Check, CheckCircle2,
  ChevronDown, ChevronRight, Info, Link2, Loader2, Play,
  RefreshCw, Shield, Sparkles, Wrench, X, XCircle, Zap,
  Eye, EyeOff, LayoutGrid, Network, FlaskConical,
} from "lucide-react";
import { toast } from "sonner";
import {
  createArchitectSession, generatePlan, revisePlan, approvePlan,
  setSimulationPlaceholder, generateTools, generateAgents, createWorkflowFromPlan,
  type ArchitectPlan, type ConnectionRequirement,
  type GeneratedTool, type GeneratedAgent, type ReadinessIssue,
} from "@/lib/architect";
import { ConnectionPickerModal } from "@/components/architect/ConnectionPickerModal";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepId = "goal" | "clarify" | "generating" | "plan" | "connections" | "confirm" | "building" | "done";

const RAIL_STEPS: { id: StepId; label: string; desc: string }[] = [
  { id: "goal",        label: "Describe",    desc: "Automation goal"       },
  { id: "generating",  label: "Understand",  desc: "AI analysis"           },
  { id: "plan",        label: "Plan",        desc: "Review blueprint"      },
  { id: "connections", label: "Connections", desc: "Connect systems"       },
  { id: "confirm",     label: "Confirm",     desc: "Tools & agents"        },
  { id: "building",    label: "Build",       desc: "Workflow generation"   },
  { id: "done",        label: "Ready",       desc: "Run simulation"        },
];

const STEP_ORDER = RAIL_STEPS.map(s => s.id);

const GEN_MESSAGES = [
  "Reading your automation goal…",
  "Detecting systems and data sources…",
  "Identifying required tools and integrations…",
  "Designing agent responsibilities…",
  "Adding approval gates and safety checks…",
  "Preparing workflow blueprint…",
];

const BUILD_PHASES = [
  { label: "Binding connections",         desc: "Linking your configured systems" },
  { label: "Creating tools",              desc: "Building API and data connectors" },
  { label: "Creating agents",             desc: "Configuring AI workers with prompts" },
  { label: "Generating workflow graph",   desc: "Compiling node/edge structure" },
  { label: "Validating mappings",         desc: "Checking data flow correctness" },
];

const EXAMPLE_GOALS = [
  "Monitor customer renewal pipeline and send risk alerts to Slack when score drops below 70",
  "Every morning pull overnight support tickets, classify them with AI, update CRM priority, alert team",
  "Daily pull sales data, analyze trends with AI, draft email summary, send to team at 9am",
  "When order placed, check inventory, reserve stock, notify warehouse, send customer confirmation",
  "Monitor competitor pricing weekly, summarize changes with AI, post to internal channel",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ step }: { step: StepId }) {
  const labels: Record<string, { label: string; color: string }> = {
    goal:        { label: "Draft",              color: "bg-slate-100 text-slate-600" },
    clarify:     { label: "Clarifying",         color: "bg-blue-50 text-blue-700" },
    generating:  { label: "Analyzing…",         color: "bg-indigo-50 text-indigo-700" },
    plan:        { label: "Plan ready",         color: "bg-green-50 text-green-700" },
    connections: { label: "Connections needed", color: "bg-amber-50 text-amber-700" },
    confirm:     { label: "Review tools",       color: "bg-purple-50 text-purple-700" },
    building:    { label: "Building…",          color: "bg-blue-50 text-blue-700" },
    done:        { label: "Simulation ready",   color: "bg-green-50 text-green-700" },
  };
  const { label, color } = labels[step] ?? labels.goal;
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${color}`}>{label}</span>
  );
}

function RailStep({
  step, idx, currentIdx, onClick,
}: { step: typeof RAIL_STEPS[0]; idx: number; currentIdx: number; onClick?: () => void }) {
  const done    = idx < currentIdx;
  const active  = idx === currentIdx;
  const locked  = idx > currentIdx;
  return (
    <button
      type="button"
      onClick={done || active ? onClick : undefined}
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3 text-left transition-all rounded-xl",
        active  && "bg-blue-50 border border-blue-200",
        done    && "hover:bg-slate-50 cursor-pointer",
        locked  && "opacity-40 cursor-default",
      )}
    >
      <div className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold mt-0.5",
        done   && "bg-green-500 text-white",
        active && "bg-blue-600 text-white",
        locked && "bg-slate-200 text-slate-400",
      )}>
        {done ? <Check className="h-3.5 w-3.5" /> : idx + 1}
      </div>
      <div className="min-w-0">
        <p className={cn("text-[13px] font-semibold leading-snug",
          active ? "text-blue-700" : done ? "text-slate-700" : "text-slate-400"
        )}>{step.label}</p>
        <p className="text-[11px] text-slate-400 mt-0.5 leading-none">{step.desc}</p>
      </div>
    </button>
  );
}

function ConnStatusBadge({ status }: { status: ConnectionRequirement["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    missing:               { label: "Missing",      cls: "bg-red-50 text-red-700 border-red-200" },
    selected_existing:     { label: "Connected",    cls: "bg-green-50 text-green-700 border-green-200" },
    created:               { label: "Created",      cls: "bg-green-50 text-green-700 border-green-200" },
    test_passed:           { label: "✓ Tested",     cls: "bg-green-50 text-green-700 border-green-200" },
    test_failed:           { label: "Test failed",  cls: "bg-red-50 text-red-700 border-red-200" },
    test_pending:          { label: "Testing…",     cls: "bg-blue-50 text-blue-700 border-blue-200" },
    simulation_placeholder:{ label: "Sim mode",     cls: "bg-amber-50 text-amber-700 border-amber-200" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-slate-50 text-slate-600 border-slate-200" };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function RiskBadge({ level }: { level: string }) {
  const cls = level === "high" ? "bg-red-50 text-red-700 border-red-200"
    : level === "medium"       ? "bg-amber-50 text-amber-700 border-amber-200"
    :                            "bg-green-50 text-green-700 border-green-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{level}</span>;
}

// ── WorkflowStepList — responsive steps with parallel/branch treatment ────────

const STEP_TYPE_STYLES: Record<string, { cls: string; dot: string }> = {
  trigger:  { cls: "bg-green-50 text-green-700 border-green-200",   dot: "bg-green-500" },
  tool:     { cls: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  agent:    { cls: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  approval: { cls: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  branch:   { cls: "bg-amber-50 text-amber-700 border-amber-200",   dot: "bg-amber-500" },
  parallel: { cls: "bg-cyan-50 text-cyan-700 border-cyan-200",      dot: "bg-cyan-500" },
  join:     { cls: "bg-slate-50 text-slate-600 border-slate-200",   dot: "bg-slate-400" },
  end:      { cls: "bg-slate-50 text-slate-500 border-slate-200",   dot: "bg-slate-300" },
};

function WorkflowStepList({
  steps, edges,
}: {
  steps: import("@/lib/architect").PlanStep[];
  edges: import("@/lib/architect").PlanEdge[];
}) {
  // Build dependency map: tempStepId → dependsOn tempStepIds
  const inbound: Record<string, string[]> = {};
  for (const e of edges ?? []) {
    if (!inbound[e.to]) inbound[e.to] = [];
    inbound[e.to].push(e.from);
  }

  // Detect parallel groups: steps that share the same single predecessor
  const parallelGroups: Record<string, string[]> = {};
  for (const [to, froms] of Object.entries(inbound)) {
    if (froms.length === 1) {
      const src = froms[0];
      if (!parallelGroups[src]) parallelGroups[src] = [];
      parallelGroups[src].push(to);
    }
  }
  const parallelStepIds = new Set<string>();
  const usedParallelSources = new Set<string>();
  Object.values(parallelGroups).forEach(grp => {
    if (grp.length >= 2) grp.forEach(id => parallelStepIds.add(id));
  });

  const rendered = new Set<string>();

  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        if (rendered.has(s.tempStepId)) return null;

        const style = STEP_TYPE_STYLES[s.nodeType] ?? STEP_TYPE_STYLES.tool;
        const isLast = i === steps.length - 1;

        // ── Branch step: show if/else preview ──────────────────────────
        if (s.nodeType === "branch") {
          const outgoing = (edges ?? []).filter(e => e.from === s.tempStepId);
          const trueEdge = outgoing.find(e => e.type === "condition_true" || e.label?.toLowerCase().includes("true") || e.label?.toLowerCase().includes("yes"));
          const falseEdge = outgoing.find(e => e.type === "condition_false" || e.label?.toLowerCase().includes("false") || e.label?.toLowerCase().includes("no"));
          rendered.add(s.tempStepId);
          return (
            <div key={s.tempStepId} className="flex items-start gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700">{i+1}</div>
                {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1 min-h-[16px]" />}
              </div>
              <Card className="flex-1 p-3.5 mb-1.5 border-amber-200 bg-amber-50/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.cls}`}>branch</span>
                  <p className="text-[13px] font-semibold text-slate-700">{s.name}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {trueEdge && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-green-50 border border-green-200 px-2.5 py-1.5 text-[11.5px]">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      <span className="font-semibold text-green-700">IF TRUE</span>
                      {trueEdge.label && <span className="text-green-600">→ {trueEdge.label}</span>}
                    </div>
                  )}
                  {falseEdge && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-[11.5px]">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      <span className="font-semibold text-red-700">IF FALSE</span>
                      {falseEdge.label && <span className="text-red-600">→ {falseEdge.label}</span>}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          );
        }

        // ── Parallel group: show grouped lane cards ─────────────────────
        const parallelSrc = Object.entries(parallelGroups).find(([src, grp]) =>
          grp.includes(s.tempStepId) && grp.length >= 2 && !usedParallelSources.has(src)
        );
        if (parallelSrc) {
          const [src, grpIds] = parallelSrc;
          usedParallelSources.add(src);
          grpIds.forEach(id => rendered.add(id));
          rendered.add(s.tempStepId);
          const grpSteps = grpIds.map(id => steps.find(st => st.tempStepId === id)).filter(Boolean) as import("@/lib/architect").PlanStep[];
          return (
            <div key={`parallel-${src}`} className="flex items-start gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-100 text-[11px] font-bold text-cyan-700">{i+1}</div>
                {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1 min-h-[16px]" />}
              </div>
              <div className="flex-1 mb-1.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-px flex-1 bg-cyan-200" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 bg-cyan-50 border border-cyan-200 rounded-full px-2 py-0.5">Parallel group</span>
                  <div className="h-px flex-1 bg-cyan-200" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {grpSteps.map(gs => {
                    const gs_style = STEP_TYPE_STYLES[gs.nodeType] ?? STEP_TYPE_STYLES.tool;
                    return (
                      <Card key={gs.tempStepId} className="flex items-center gap-2.5 px-3 py-2.5 border-cyan-100">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${gs_style.dot}`} />
                        <div className="min-w-0">
                          <span className={`rounded border text-[9.5px] font-bold px-1.5 py-0.5 ${gs_style.cls}`}>{gs.nodeType}</span>
                          <p className="text-[12px] font-medium text-slate-700 mt-0.5 truncate">{gs.name}</p>
                        </div>
                      </Card>
                    );
                  })}
                </div>
                <div className="flex justify-center mt-2">
                  <div className="h-px w-1/2 bg-cyan-200" />
                </div>
              </div>
            </div>
          );
        }

        // ── Normal step ─────────────────────────────────────────────────
        rendered.add(s.tempStepId);
        return (
          <div key={s.tempStepId} className="flex items-start gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white`}
                style={{ background: style.dot.replace("bg-","#").length > 4 ? undefined : undefined }}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${style.dot} text-white`}>{i+1}</div>
              </div>
              {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1 min-h-[16px]" />}
            </div>
            <Card className="flex-1 flex items-center gap-3 px-3.5 py-2.5 mb-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0 ${style.cls}`}>{s.nodeType}</span>
              <p className="text-[13px] font-medium text-slate-700 truncate">{s.name}</p>
              {s.toolTempId && <span className="ml-auto text-[10.5px] text-purple-500 shrink-0 truncate hidden sm:block">{s.toolTempId}</span>}
              {s.agentTempId && <span className="ml-auto text-[10.5px] text-indigo-500 shrink-0 truncate hidden sm:block">{s.agentTempId}</span>}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-2">{children}</p>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white", className)}>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ArchitectPage() {
  const router = useRouter();
  const [step, setStep]         = useState<StepId>("goal");
  const [loading, setLoading]   = useState(false);
  const [buildPhase, setBuildPhase] = useState(0);
  const [genMsgIdx, setGenMsgIdx]   = useState(0);

  // Data
  const [goal, setGoal]             = useState("");
  const [answers, setAnswers]       = useState<Record<string, string>>({});
  const [clarifyQ, setClarifyQ]     = useState<string[]>([]);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [plan, setPlan]             = useState<ArchitectPlan | null>(null);
  const [connReqs, setConnReqs]     = useState<ConnectionRequirement[]>([]);
  const [genTools, setGenTools]     = useState<GeneratedTool[]>([]);
  const [genAgents, setGenAgents]   = useState<GeneratedAgent[]>([]);
  const [readiness, setReadiness]   = useState<{ status: string; issues: ReadinessIssue[] } | null>(null);

  // UI state
  const [reviseText, setReviseText]     = useState("");
  const [showRevise, setShowRevise]     = useState(false);
  const [pickerReq, setPickerReq]       = useState<ConnectionRequirement | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [rightOpen, setRightOpen]       = useState(true);

  const goalRef = useRef<HTMLTextAreaElement>(null);

  const currentStepIdx = STEP_ORDER.indexOf(step === "clarify" ? "goal" : step);

  // ── Step 1: Submit goal ──────────────────────────────────────────────────
  async function handleGoalSubmit() {
    if (!goal.trim()) return;
    setLoading(true);
    setStep("generating");
    let idx = 0;
    const t = setInterval(() => { idx = (idx + 1) % GEN_MESSAGES.length; setGenMsgIdx(idx); }, 1800);
    try {
      const sess = await createArchitectSession(goal.trim());
      setSessionId(sess.id);
      if (sess.needsClarification && sess.clarificationQuestions?.length) {
        setClarifyQ(sess.clarificationQuestions!);
        clearInterval(t);
        setLoading(false);
        setStep("clarify");
        return;
      }
      await doPlanGeneration(sess.id, {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start session");
      setStep("goal");
    } finally { clearInterval(t); setLoading(false); }
  }

  async function doPlanGeneration(sid: string, ans: Record<string, string>) {
    setStep("generating");
    setGenMsgIdx(0);
    try {
      const res = await generatePlan(sid, ans);
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

  async function handleClarifySubmit() {
    if (!sessionId) return;
    setLoading(true);
    await doPlanGeneration(sessionId, answers);
    setLoading(false);
  }

  async function handleRevise() {
    if (!sessionId || !reviseText.trim()) return;
    setLoading(true);
    try {
      const res = await revisePlan(sessionId, reviseText.trim());
      setPlan(res.plan);
      setConnReqs(res.connectionRequirements ?? []);
      setReviseText(""); setShowRevise(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Revision failed"); }
    finally { setLoading(false); }
  }

  async function handleApprovePlan() {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await approvePlan(sessionId);
      setConnReqs(res.connectionRequirements ?? []);
      if (res.needsConnections && res.connectionRequirements.length > 0) {
        setStep("connections");
      } else {
        setStep("confirm");
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Approval failed"); }
    finally { setLoading(false); }
  }

  async function handleUsePlaceholder(reqId: string) {
    if (!sessionId) return;
    try {
      await setSimulationPlaceholder(sessionId, reqId);
      setConnReqs(prev => prev.map(r => r.id === reqId ? { ...r, status: "simulation_placeholder" as const } : r));
      toast.success("Simulation placeholder set");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  function handlePickerBound(reqId: string, connId: string) {
    setConnReqs(prev => prev.map(r => r.id === reqId ? { ...r, status: "selected_existing" as const, boundConnectionId: connId } : r));
    setPickerReq(null);
  }

  async function handleBuild() {
    if (!sessionId) return;
    setStep("building");
    setBuildPhase(0);
    for (let i = 0; i < BUILD_PHASES.length; i++) {
      setBuildPhase(i);
      try {
        // Only call API if not already created (avoid duplicate records on retry)
        if (i === 1) {
          if (!genTools.some(t => t.status === "created")) {
            const r = await generateTools(sessionId); setGenTools(r.tools);
          }
        }
        if (i === 2) {
          if (!genAgents.some(a => a.status === "created")) {
            const r = await generateAgents(sessionId); setGenAgents(r.agents);
          }
        }
        if (i === 3) {
          const result = await createWorkflowFromPlan(sessionId, {});
          setReadiness({ status: result.readinessStatus, issues: result.readinessIssues ?? [] });
          try { sessionStorage.setItem(`architect-anim-${result.workflowId}`, JSON.stringify(result.animationSteps)); } catch {}
          setBuildPhase(BUILD_PHASES.length - 1);
          await new Promise(r => setTimeout(r, 600));
          setStep("done");
          toast.success("Workflow created!");
          setTimeout(() => router.push(`/workflows/${result.workflowId}/builder?architectSessionId=${sessionId}&animate=true` as never), 1200);
          return;
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Build step failed");
        setStep("connections"); return;
      }
      await new Promise(r => setTimeout(r, 700));
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F7F8FA]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6 z-20">
        <div className="flex items-center gap-4">
          <Link href={"/workflows/new" as never}
            className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-slate-700 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <ArchitectLogo size={30} />
          <div className="hidden sm:block">
            <p className="text-[14px] font-bold text-slate-900 leading-none">AI Workflow Architect</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Describe → Plan → Build → Run</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill step={step} />
          <button type="button" onClick={() => setRightOpen(v => !v)}
            className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
            <LayoutGrid className="h-3.5 w-3.5 text-slate-500" />
          </button>
        </div>
      </header>

      {/* ── Body: rail + main + insight ────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left step rail (desktop) ─────────────────────────────────────── */}
        <aside className="hidden lg:flex w-[240px] shrink-0 flex-col border-r border-slate-200 bg-white overflow-y-auto">
          <div className="p-3 space-y-0.5 flex-1">
            {RAIL_STEPS.map((s, i) => (
              <RailStep key={s.id} step={s} idx={i} currentIdx={currentStepIdx} />
            ))}
          </div>
          <div className="border-t border-slate-100 p-4">
            <p className="text-[10.5px] text-slate-400 font-medium">
              AI plans your automation end-to-end. No workflow expertise needed.
            </p>
          </div>
        </aside>

        {/* ── Mobile stepper ───────────────────────────────────────────────── */}
        <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto px-4 py-2.5 border-b border-slate-200 bg-white shrink-0">
          {RAIL_STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5 shrink-0">
              <div className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold",
                i < currentStepIdx  ? "bg-green-50 text-green-700" :
                i === currentStepIdx ? "bg-blue-100 text-blue-700" : "text-slate-400"
              )}>
                {i < currentStepIdx && <Check className="h-3 w-3" />}
                {s.label}
              </div>
              {i < RAIL_STEPS.length - 1 && <div className={`h-px w-3 ${i < currentStepIdx ? "bg-green-300" : "bg-slate-200"}`} />}
            </div>
          ))}
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[840px] mx-auto px-4 lg:px-8 py-6 lg:py-8 space-y-6">

            {/* ── Screen 1: Goal ──────────────────────────────────────────── */}
            {step === "goal" && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">What are you trying to automate?</h1>
                  <p className="mt-2 text-[14px] text-slate-500 max-w-xl">
                    Describe your automation in plain English. Vectorbea will design the agents, tools, connections, approvals, and workflow graph.
                  </p>
                </div>

                <Card className="p-5">
                  <textarea
                    ref={goalRef}
                    rows={6}
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGoalSubmit(); }}
                    placeholder="e.g. Every morning, pull sales data, analyze performance with AI, draft a summary email, and send it to the team at 9am…"
                    className="w-full resize-none bg-transparent text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <span className="text-[11px] text-slate-400">{goal.length} chars · ⌘↵ to submit</span>
                    <button type="button" onClick={handleGoalSubmit}
                      disabled={!goal.trim() || loading}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-sm">
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Architect my workflow
                    </button>
                  </div>
                </Card>

                <div>
                  <SectionLabel>Example automations</SectionLabel>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {EXAMPLE_GOALS.map(eg => (
                      <button key={eg} type="button" onClick={() => { setGoal(eg); goalRef.current?.focus(); }}
                        className="rounded-xl border border-slate-200 bg-white p-3.5 text-left text-[12.5px] text-slate-600 hover:border-blue-300 hover:bg-blue-50/40 transition-all">
                        {eg}
                      </button>
                    ))}
                  </div>
                </div>

                {/* What Vectorbea does */}
                <Card className="p-5">
                  <SectionLabel>What Vectorbea does for you</SectionLabel>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { icon: Sparkles, label: "Understand goal",      desc: "Extract systems, triggers, outputs" },
                      { icon: Network,  label: "Design agents",         desc: "AI workers with real system prompts" },
                      { icon: Wrench,   label: "Create tools",          desc: "API, DB, email connectors" },
                      { icon: Link2,    label: "Ask for connections",   desc: "Secure BYOK setup" },
                      { icon: Zap,      label: "Build workflow",        desc: "Visual step-by-step animation" },
                      { icon: Play,     label: "Run simulation",        desc: "Safe test with no real calls" },
                    ].map(({ icon: Icon, label, desc }) => (
                      <div key={label} className="flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100">
                          <Icon className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                        <p className="text-[12px] font-semibold text-slate-700">{label}</p>
                        <p className="text-[11px] text-slate-400">{desc}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* ── Screen 2: Clarify ───────────────────────────────────────── */}
            {step === "clarify" && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[22px] font-bold text-slate-900">A few quick questions</h1>
                  <p className="mt-1 text-[13.5px] text-slate-500">These help Vectorbea design a more precise workflow plan.</p>
                </div>
                <Card className="p-5 space-y-4">
                  {clarifyQ.map((q, i) => (
                    <div key={i}>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">{q}</label>
                      <input value={answers[q] ?? ""} onChange={e => setAnswers(a => ({ ...a, [q]: e.target.value }))}
                        placeholder="Your answer…"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent" />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={handleClarifySubmit} disabled={loading}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      Generate plan
                    </button>
                    <button type="button" onClick={() => doPlanGeneration(sessionId!, {})} disabled={loading}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] text-slate-600 hover:bg-slate-50">
                      Skip & generate
                    </button>
                  </div>
                </Card>
              </div>
            )}

            {/* ── Screen 3: Generating ────────────────────────────────────── */}
            {step === "generating" && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[22px] font-bold text-slate-900">Analyzing your automation…</h1>
                  <p className="mt-1 text-[13.5px] text-slate-500">Vectorbea is designing the complete workflow blueprint.</p>
                </div>
                <Card className="overflow-hidden">
                  {/* Blueprint grid background */}
                  <div className="relative p-8" style={{
                    background: "linear-gradient(135deg, #F0F4FF 0%, #F7F8FA 100%)",
                    backgroundImage: "radial-gradient(circle, #CBD5E1 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}>
                    <div className="relative z-10 flex flex-col items-center gap-6 py-4">
                      <div className="relative flex h-16 w-16 items-center justify-center">
                        <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
                        <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin" />
                        <ArchitectLogo size={32} />
                      </div>
                      <p className="text-[15px] font-semibold text-slate-800 text-center">{GEN_MESSAGES[genMsgIdx]}</p>
                    </div>
                  </div>
                  {/* Progress checklist */}
                  <div className="p-5 border-t border-slate-100 space-y-2">
                    {GEN_MESSAGES.map((msg, i) => (
                      <div key={i} className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px] transition-all",
                        i < genMsgIdx  ? "text-green-700" :
                        i === genMsgIdx ? "text-blue-700 bg-blue-50 font-medium" : "text-slate-400"
                      )}>
                        {i < genMsgIdx
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          : i === genMsgIdx
                            ? <Loader2 className="h-3.5 w-3.5 text-blue-500 shrink-0 animate-spin" />
                            : <div className="h-3.5 w-3.5 rounded-full border border-slate-300 shrink-0" />
                        }
                        {msg}
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* ── Screen 4: Plan review ────────────────────────────────────── */}
            {step === "plan" && plan && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-[22px] font-bold text-slate-900">{plan.workflowName}</h1>
                    <p className="mt-1 text-[13.5px] text-slate-500">{plan.goalSummary}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Confidence</p>
                      <p className={`text-[20px] font-black ${plan.confidence >= 0.8 ? "text-green-600" : plan.confidence >= 0.6 ? "text-amber-600" : "text-red-500"}`}>
                        {Math.round(plan.confidence * 100)}%
                      </p>
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-2.5">
                  {[
                    { label: "Connections", value: plan.requiredConnections?.length ?? 0, icon: Link2, color: "text-blue-600 bg-blue-50" },
                    { label: "Tools",       value: plan.tools?.length ?? 0,               icon: Wrench, color: "text-purple-600 bg-purple-50" },
                    { label: "Agents",      value: plan.agents?.length ?? 0,              icon: Bot,    color: "text-indigo-600 bg-indigo-50" },
                    { label: "Steps",       value: plan.workflowSteps?.length ?? 0,       icon: Zap,    color: "text-amber-600 bg-amber-50" },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <Card key={label} className="p-3.5 text-center">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color} mx-auto mb-2`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="text-[20px] font-black text-slate-900">{value}</p>
                      <p className="text-[10.5px] text-slate-400 font-medium">{label}</p>
                    </Card>
                  ))}
                </div>

                {/* Trigger */}
                <Card className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 shrink-0">
                    <Zap className="h-3.5 w-3.5 text-slate-600" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Trigger</span>
                    <p className="text-[13px] text-slate-700 font-medium capitalize">{plan.trigger?.type} — {plan.trigger?.description}</p>
                  </div>
                </Card>

                {/* Connections */}
                {(plan.requiredConnections?.length ?? 0) > 0 && (
                  <div>
                    <SectionLabel>Required Connections</SectionLabel>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {plan.requiredConnections.map(c => (
                        <Card key={c.tempConnectionId} className="p-3.5 flex items-start gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 shrink-0">
                            <Link2 className="h-4 w-4 text-blue-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-[13px] font-semibold text-slate-700">{c.name}</p>
                              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{c.type}</span>
                              {c.requiredForSimulation && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9.5px] font-bold text-blue-700">SIM REQUIRED</span>}
                            </div>
                            <p className="text-[11.5px] text-slate-400 mt-0.5 truncate">{c.description}</p>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tools */}
                {(plan.tools?.length ?? 0) > 0 && (
                  <div>
                    <SectionLabel>Tools to create</SectionLabel>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {plan.tools.map(t => (
                        <Card key={t.tempToolId} className="p-3.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 shrink-0">
                              <Wrench className="h-3.5 w-3.5 text-purple-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-slate-700 truncate">{t.name}</p>
                              <p className="text-[11px] text-slate-400">{t.type}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <RiskBadge level={t.riskLevel} />
                            {t.requiresApproval && <span className="rounded-full bg-orange-50 border border-orange-200 px-1.5 py-0.5 text-[9.5px] font-bold text-orange-700">APPROVAL</span>}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agents */}
                {(plan.agents?.length ?? 0) > 0 && (
                  <div>
                    <SectionLabel>Agents to create</SectionLabel>
                    <div className="space-y-2">
                      {plan.agents.map(a => {
                        const expanded = expandedAgents.has(a.tempAgentId);
                        const promptExpanded = expandedPrompts.has(a.tempAgentId);
                        return (
                          <Card key={a.tempAgentId} className="overflow-hidden">
                            <button type="button" onClick={() => setExpandedAgents(s => { const n = new Set(s); n.has(a.tempAgentId) ? n.delete(a.tempAgentId) : n.add(a.tempAgentId); return n; })}
                              className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-slate-50 transition-colors">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 shrink-0">
                                <Bot className="h-4 w-4 text-indigo-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold text-slate-700">{a.name}</p>
                                <p className="text-[11.5px] text-slate-400 truncate">{a.role}</p>
                              </div>
                              {expanded ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                            </button>
                            {expanded && (
                              <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
                                {a.allowedTempToolIds?.length > 0 && (
                                  <div>
                                    <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Allowed Tools</p>
                                    <div className="flex flex-wrap gap-1">
                                      {a.allowedTempToolIds.map(tid => (
                                        <span key={tid} className="rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] text-amber-800">{tid}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {a.systemPrompt && (
                                  <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">System Prompt</p>
                                      <button type="button" onClick={() => setExpandedPrompts(s => { const n = new Set(s); n.has(a.tempAgentId) ? n.delete(a.tempAgentId) : n.add(a.tempAgentId); return n; })}
                                        className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700">
                                        {promptExpanded ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> View</>}
                                      </button>
                                    </div>
                                    {promptExpanded ? (
                                      <pre className="text-[11px] text-slate-600 whitespace-pre-wrap font-mono leading-relaxed bg-white rounded-lg p-3 border border-slate-200 max-h-48 overflow-y-auto">
                                        {a.systemPrompt}
                                      </pre>
                                    ) : (
                                      <p className="text-[11.5px] text-slate-500 italic">{a.systemPrompt.slice(0, 120)}…</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Workflow steps — with parallel/branch visual treatment */}
                {(plan.workflowSteps?.length ?? 0) > 0 && (
                  <div>
                    <SectionLabel>Workflow Steps</SectionLabel>
                    <WorkflowStepList steps={plan.workflowSteps} edges={plan.edges} />
                  </div>
                )}

                {/* Safety notes */}
                {(plan.safetyNotes?.length ?? 0) > 0 && (
                  <Card className="p-4 border-amber-200 bg-amber-50/40">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="h-4 w-4 text-amber-600" />
                      <p className="text-[12.5px] font-bold text-amber-800">Safety Notes</p>
                    </div>
                    <ul className="space-y-1">
                      {plan.safetyNotes.map((n, i) => <li key={i} className="text-[12px] text-amber-700">• {n}</li>)}
                    </ul>
                  </Card>
                )}

                {/* Revise */}
                {showRevise && (
                  <Card className="p-4 border-blue-200 bg-blue-50/30 space-y-3">
                    <p className="text-[13px] font-semibold text-blue-900">Revise the plan</p>
                    <textarea rows={2} value={reviseText} onChange={e => setReviseText(e.target.value)}
                      placeholder='e.g. "Add approval before CRM update", "Remove database write", "Use webhook trigger"'
                      className="w-full resize-none rounded-xl border border-blue-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <div className="flex gap-2">
                      <button type="button" onClick={handleRevise} disabled={!reviseText.trim() || loading}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Revise
                      </button>
                      <button type="button" onClick={() => setShowRevise(false)}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12.5px] text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </Card>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 justify-between pt-1">
                  <button type="button" onClick={() => setShowRevise(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
                    <RefreshCw className="h-3.5 w-3.5" /> Revise plan
                  </button>
                  <button type="button" onClick={handleApprovePlan} disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40 shadow-sm">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Approve &amp; Continue
                  </button>
                </div>
              </div>
            )}

            {/* ── Screen 5: Connections ────────────────────────────────────── */}
            {step === "connections" && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[22px] font-bold text-slate-900">Configure Connections</h1>
                  <p className="mt-1 text-[13.5px] text-slate-500">
                    Vectorbea needs these integrations to build and run your workflow. Secrets are encrypted end-to-end.
                  </p>
                </div>

                <Card className="p-3.5 border-blue-200 bg-blue-50/40 flex items-start gap-3">
                  <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[12.5px] font-semibold text-blue-800">
                      {connReqs.filter(r => ["test_passed","selected_existing","created","simulation_placeholder"].includes(r.status)).length} of {connReqs.length} connections ready
                    </p>
                    <p className="text-[11.5px] text-blue-600 mt-0.5">SIM REQUIRED connections must be configured for simulation. Others can use placeholders.</p>
                  </div>
                </Card>

                <div className="grid gap-3 sm:grid-cols-2">
                  {connReqs.map(req => {
                    const isReady = ["selected_existing","created","test_passed","simulation_placeholder"].includes(req.status);
                    return (
                      <Card key={req.id} className={`p-4 transition-all ${isReady ? "border-green-200 bg-green-50/20" : ""}`}>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="text-[13px] font-semibold text-slate-800">{req.name}</p>
                              <ConnStatusBadge status={req.status} />
                              {req.requiredForSimulation && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">SIM REQUIRED</span>}
                            </div>
                            {req.description && <p className="text-[11.5px] text-slate-400">{req.description}</p>}
                            {req.setupInstructions && <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-1.5">{req.setupInstructions}</p>}
                            {req.testError && <p className="text-[11px] text-red-600 bg-red-50 rounded-lg px-2 py-1 mt-1.5">✗ {req.testError}</p>}
                          </div>
                          {isReady && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />}
                        </div>
                        {!isReady && (
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={() => setPickerReq(req)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-blue-700">
                              <Link2 className="h-3 w-3" /> Select connection
                            </button>
                            <Link href="/connections/new" target="_blank"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11.5px] font-medium text-slate-600 hover:bg-slate-50">
                              Create new ↗
                            </Link>
                            {!req.requiredForSimulation && (
                              <button type="button" onClick={() => handleUsePlaceholder(req.id)}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11.5px] font-medium text-amber-700 hover:bg-amber-100">
                                Sim placeholder
                              </button>
                            )}
                          </div>
                        )}
                        {isReady && req.status !== "simulation_placeholder" && req.status !== "test_passed" && (
                          <button type="button" onClick={() => setPickerReq(req)}
                            className="text-[11px] text-slate-400 hover:text-slate-600 mt-1">
                            Change →
                          </button>
                        )}
                      </Card>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button type="button" onClick={() => setStep("plan")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-600 hover:bg-slate-50">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button type="button" onClick={() => setStep("confirm")} disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40 shadow-sm">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* ── Screen 6: Confirm tools/agents ──────────────────────────── */}
            {step === "confirm" && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[22px] font-bold text-slate-900">Confirm Building Blocks</h1>
                  <p className="mt-1 text-[13.5px] text-slate-500">
                    Review what Vectorbea will create in your workspace, then click Build to start.
                  </p>
                </div>

                {/* Fallback: show plan-level summary when materialized items not yet generated */}
                {genTools.length === 0 && genAgents.length === 0 && plan && (
                  <Card className="p-5 border-blue-100 bg-blue-50/30">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="h-4 w-4 text-blue-500" />
                      <p className="text-[13.5px] font-semibold text-blue-900">Plan ready to build</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { label: "Tools",       value: plan.tools?.length ?? 0,               icon: Wrench },
                        { label: "Agents",      value: plan.agents?.length ?? 0,              icon: Bot },
                        { label: "Steps",       value: plan.workflowSteps?.length ?? 0,       icon: Zap },
                      ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="flex flex-col items-center gap-1 rounded-xl bg-white border border-blue-100 p-3">
                          <Icon className="h-4 w-4 text-blue-500" />
                          <span className="text-[16px] font-black text-slate-900">{value}</span>
                          <span className="text-[10.5px] text-slate-400">{label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[12px] text-blue-700">Click <strong>Build Workflow</strong> to create tools and agents, then open the animated canvas.</p>
                  </Card>
                )}

                {/* Tools */}
                {genTools.length > 0 && (
                  <div>
                    <SectionLabel>Tools ({genTools.length})</SectionLabel>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {genTools.map(t => (
                        <Card key={t.id} className="p-3.5">
                          <div className="flex items-center gap-2.5 mb-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-50 shrink-0">
                              <Wrench className="h-3.5 w-3.5 text-purple-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-semibold text-slate-700 truncate">{t.name}</p>
                              <p className="text-[11px] text-slate-400">{t.type}</p>
                            </div>
                            <RiskBadge level={t.riskLevel} />
                          </div>
                          <div className={`rounded-lg px-2 py-1 text-[10.5px] font-semibold ${
                            t.status === "created" ? "bg-green-50 text-green-700" :
                            t.status === "blocked_missing_connection" ? "bg-red-50 text-red-700" :
                            "bg-slate-50 text-slate-500"}`}>
                            {t.status === "created" ? "✓ Created" : t.status === "blocked_missing_connection" ? "⚠ Missing connection" : t.status}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agents */}
                {genAgents.length > 0 && (
                  <div>
                    <SectionLabel>Agents ({genAgents.length})</SectionLabel>
                    <div className="space-y-2">
                      {genAgents.map(a => {
                        const promptExpanded = expandedPrompts.has(`confirm-${a.id}`);
                        return (
                          <Card key={a.id} className="p-3.5">
                            <div className="flex items-start gap-2.5 mb-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 shrink-0 mt-0.5">
                                <Bot className="h-3.5 w-3.5 text-indigo-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-[13px] font-semibold text-slate-700">{a.name}</p>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    a.status === "created" ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-500"}`}>
                                    {a.status === "created" ? "✓ Created" : a.status}
                                  </span>
                                </div>
                                {a.role && <p className="text-[11.5px] text-slate-400 mt-0.5">{a.role}</p>}
                              </div>
                              {a.systemPromptPreview && (
                                <button type="button" onClick={() => setExpandedPrompts(s => { const n = new Set(s); const k = `confirm-${a.id}`; n.has(k) ? n.delete(k) : n.add(k); return n; })}
                                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 shrink-0">
                                  {promptExpanded ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Prompt</>}
                                </button>
                              )}
                            </div>
                            {promptExpanded && a.systemPromptPreview && (
                              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 mt-2">
                                <p className="text-[11px] font-mono text-slate-600 leading-relaxed whitespace-pre-wrap">
                                  {a.systemPromptPreview}
                                </p>
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 justify-between pt-1">
                  <button type="button" onClick={() => setStep("connections")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-600 hover:bg-slate-50">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                  <button type="button" onClick={handleBuild} disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40 shadow-sm">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    Build Workflow
                  </button>
                </div>
              </div>
            )}

            {/* ── Screen 7: Building ───────────────────────────────────────── */}
            {step === "building" && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[22px] font-bold text-slate-900">Building your workflow…</h1>
                  <p className="mt-1 text-[13.5px] text-slate-500">Vectorbea is creating tools, agents, and the workflow graph.</p>
                </div>
                <Card className="overflow-hidden">
                  <div className="relative p-6" style={{
                    background: "linear-gradient(135deg, #EEF2FF 0%, #F7F8FA 100%)",
                    backgroundImage: "radial-gradient(circle, #C7D2FE 1px, transparent 1px)",
                    backgroundSize: "20px 20px",
                  }}>
                    <div className="flex items-center justify-center py-4">
                      <div className="relative flex h-14 w-14 items-center justify-center">
                        <div className="absolute inset-0 rounded-full bg-indigo-100 animate-ping opacity-40" />
                        <div className="absolute inset-0 rounded-full border-4 border-t-indigo-500 animate-spin" />
                        <ArchitectLogo size={28} />
                      </div>
                    </div>
                  </div>
                  <div className="p-5 space-y-2.5">
                    {BUILD_PHASES.map((phase, i) => (
                      <div key={i} className={cn(
                        "flex items-center gap-3 rounded-xl px-4 py-3 transition-all",
                        i < buildPhase  ? "bg-green-50 border border-green-200" :
                        i === buildPhase ? "bg-blue-50 border border-blue-200 shadow-sm" :
                        "opacity-40"
                      )}>
                        {i < buildPhase
                          ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                          : i === buildPhase
                            ? <Loader2 className="h-5 w-5 text-blue-500 shrink-0 animate-spin" />
                            : <div className="h-5 w-5 rounded-full border-2 border-slate-300 shrink-0" />
                        }
                        <div>
                          <p className={cn("text-[13px] font-semibold",
                            i < buildPhase ? "text-green-800" : i === buildPhase ? "text-blue-800" : "text-slate-400"
                          )}>{phase.label}</p>
                          <p className="text-[11.5px] text-slate-400">{phase.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* ── Screen 8: Done ───────────────────────────────────────────── */}
            {step === "done" && (
              <div className="space-y-5">
                <div className="flex flex-col items-center text-center py-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                  </div>
                  <h1 className="text-[24px] font-bold text-slate-900">Workflow Created!</h1>
                  <p className="mt-2 text-[14px] text-slate-500">
                    {genTools.filter(t => t.status === "created").length} tools and {genAgents.filter(a => a.status === "created").length} agents created. Opening canvas…
                  </p>
                </div>

                {readiness?.issues && readiness.issues.length > 0 && (
                  <Card className="p-4 space-y-2">
                    <p className="text-[13px] font-semibold text-slate-700">Readiness Notes</p>
                    {readiness.issues.map((issue, i) => (
                      <div key={i} className={cn(
                        "flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]",
                        issue.severity === "error" ? "bg-red-50 text-red-700" :
                        issue.severity === "warning" ? "bg-amber-50 text-amber-700" :
                        "bg-blue-50 text-blue-700"
                      )}>
                        {issue.severity === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> :
                         issue.severity === "warning" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> :
                         <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                        {issue.message}
                      </div>
                    ))}
                  </Card>
                )}

                <div className="flex items-center justify-center gap-2 animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span className="text-[13px] text-slate-500">Opening workflow canvas with animation…</span>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ── Right insight panel ──────────────────────────────────────────── */}
        {rightOpen && (
          <aside className="hidden lg:flex w-[300px] shrink-0 flex-col border-l border-slate-200 bg-white overflow-y-auto">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400">Workflow Blueprint</p>
              <button type="button" onClick={() => setRightOpen(false)}
                className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            </div>

            {plan ? (
              <div className="p-4 space-y-4 flex-1">
                {/* Summary */}
                <div>
                  <p className="text-[13px] font-semibold text-slate-900">{plan.workflowName}</p>
                  <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">{plan.goalSummary}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 font-medium capitalize">{plan.trigger?.type}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${plan.confidence >= 0.8 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {Math.round(plan.confidence * 100)}% confident
                    </span>
                  </div>
                </div>

                {/* Ingredients */}
                <div className="border-t border-slate-100 pt-3">
                  <SectionLabel>Build Ingredients</SectionLabel>
                  <div className="space-y-2">
                    {[
                      { label: "Agents",      value: plan.agents?.length ?? 0,              icon: Bot,    color: "text-indigo-600" },
                      { label: "Tools",       value: plan.tools?.length ?? 0,               icon: Wrench, color: "text-purple-600" },
                      { label: "Connections", value: plan.requiredConnections?.length ?? 0, icon: Link2,  color: "text-blue-600" },
                      { label: "Steps",       value: plan.workflowSteps?.length ?? 0,       icon: Zap,    color: "text-amber-600" },
                    ].map(({ label, value, icon: Icon, color }) => (
                      <div key={label} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-3.5 w-3.5 ${color}`} />
                          <span className="text-[12px] text-slate-600">{label}</span>
                        </div>
                        <span className="text-[12px] font-bold text-slate-800">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Connections readiness */}
                {connReqs.length > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <SectionLabel>Connections</SectionLabel>
                    <div className="space-y-1.5">
                      {connReqs.map(req => (
                        <div key={req.id} className="flex items-center justify-between gap-2">
                          <p className="text-[11.5px] text-slate-600 truncate">{req.name}</p>
                          <ConnStatusBadge status={req.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Readiness */}
                {readiness && (
                  <div className="border-t border-slate-100 pt-3">
                    <SectionLabel>Readiness</SectionLabel>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-3.5 w-3.5 text-green-500" />
                        <span className="text-[12px] text-slate-600">Simulation</span>
                        <span className={`ml-auto text-[10.5px] font-bold ${["simulation_ready","real_ready"].includes(readiness.status) ? "text-green-600" : "text-red-500"}`}>
                          {["simulation_ready","real_ready"].includes(readiness.status) ? "Ready" : "Not ready"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Play className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-[12px] text-slate-600">Real execution</span>
                        <span className={`ml-auto text-[10.5px] font-bold ${readiness.status === "real_ready" ? "text-green-600" : "text-slate-400"}`}>
                          {readiness.status === "real_ready" ? "Ready" : "Admin required"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Safety */}
                {(plan.safetyNotes?.length ?? 0) > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <SectionLabel>Safety</SectionLabel>
                    <div className="space-y-1">
                      {plan.safetyNotes.slice(0, 3).map((n, i) => (
                        <p key={i} className="text-[11px] text-amber-700 flex items-start gap-1">
                          <Shield className="h-3 w-3 mt-0.5 shrink-0" />{n}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 p-6 text-center gap-4">
                <div style={{
                  width: 80, height: 80,
                  backgroundImage: "radial-gradient(circle, #CBD5E1 1px, transparent 1px)",
                  backgroundSize: "12px 12px", borderRadius: 16, opacity: 0.6,
                }} />
                <div>
                  <p className="text-[13px] font-semibold text-slate-600">Blueprint appears here</p>
                  <p className="text-[11.5px] text-slate-400 mt-1">Describe your automation to get started.</p>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ── Connection picker modal ────────────────────────────────────────── */}
      {pickerReq && sessionId && (
        <ConnectionPickerModal
          sessionId={sessionId}
          requirement={pickerReq}
          onBound={handlePickerBound}
          onClose={() => setPickerReq(null)}
        />
      )}
    </div>
  );
}
