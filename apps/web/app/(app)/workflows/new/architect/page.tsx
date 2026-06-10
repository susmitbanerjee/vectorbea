"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Check, CheckCircle2,
  ChevronDown, ChevronRight, Database, ExternalLink, Eye, EyeOff,
  FlaskConical, Globe, Hammer, Inbox, Info, Link2, Loader2, Mail,
  MessageSquare, Network, Package, PanelRight, PenLine, Play, Radar,
  RefreshCw, Shield, Sparkles, TrendingUp, Webhook, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  createArchitectSession, generatePlan, revisePlan, approvePlan,
  setSimulationPlaceholder, generateTools, generateAgents, createWorkflowFromPlan,
  normalizeClarifyQuestions,
  type ArchitectPlan, type ClarifyQuestion, type ConnectionRequirement,
  type GeneratedTool, type GeneratedAgent, type PlanStep, type PlanEdge,
  type ReadinessIssue,
} from "@/lib/architect";
import { ConnectionPickerModal } from "@/components/architect/ConnectionPickerModal";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";
import { NODE_META } from "@/components/workflow-builder/NodeIcon";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Chip, Console } from "@/components/ui/page-kit";
import { track } from "@/lib/telemetry/client";
import { cn } from "@/lib/utils";

/* ── Motion: entrance + drawing keyframes (respects reduced-motion) ─────────── */

const ARCH_CSS = `
@keyframes archRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes archFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes archPing { 0% { transform: scale(1); opacity: .5; } 80%, 100% { transform: scale(2.2); opacity: 0; } }
@keyframes archDash { to { stroke-dashoffset: 0; } }
@keyframes archFlow { to { stroke-dashoffset: -20; } }
@keyframes archSpin { to { transform: rotate(360deg); } }
.arch-screen { animation: archRise .45s cubic-bezier(.22,1,.36,1) both; }
.arch-in     { animation: archRise .5s  cubic-bezier(.22,1,.36,1) both; }
.arch-fade   { animation: archFade .45s ease both; }
.arch-lift   { transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.arch-lift:hover { transform: translateY(-1px); border-color: #C9CED4; box-shadow: 0 6px 18px rgba(11,13,15,.06); }
@media (prefers-reduced-motion: reduce) {
  .arch-screen, .arch-in, .arch-fade { animation: none; }
  .arch-lift, .arch-lift:hover { transition: none; transform: none; }
}
`;

/** Staggered entrance delay for list items. */
const stag = (i: number) => ({ animationDelay: `${Math.min(i * 60, 480)}ms` });

// ── Types & constants ─────────────────────────────────────────────────────────

type StepId = "goal" | "clarify" | "generating" | "plan" | "connections" | "confirm" | "building" | "done";

const RAIL_STEPS: { id: StepId; label: string; desc: string }[] = [
  { id: "goal",        label: "Describe",  desc: "State the goal"     },
  { id: "generating",  label: "Analyze",   desc: "AI reads the goal"  },
  { id: "plan",        label: "Blueprint", desc: "Review the plan"    },
  { id: "connections", label: "Connect",   desc: "Bind your systems"  },
  { id: "confirm",     label: "Review",    desc: "Tools & agents"     },
  { id: "building",    label: "Build",     desc: "Materialize graph"  },
  { id: "done",        label: "Ready",     desc: "Open the canvas"    },
];

const STEP_ORDER = RAIL_STEPS.map(s => s.id);

const GEN_MESSAGES = [
  "Reading your automation goal",
  "Identifying systems and data sources",
  "Selecting tools and integrations",
  "Designing agent responsibilities",
  "Placing approval gates and safety checks",
  "Assembling the workflow blueprint",
];

const BUILD_PHASES = [
  { label: "Binding connections",      desc: "Linking your configured systems" },
  { label: "Creating tools",           desc: "API, data and messaging connectors" },
  { label: "Creating agents",          desc: "AI workers with production prompts" },
  { label: "Compiling workflow graph", desc: "Nodes, edges and data mappings" },
  { label: "Validating readiness",     desc: "Connections, mappings, simulation" },
];

const EXAMPLE_GOALS: { icon: React.ElementType; title: string; text: string }[] = [
  { icon: TrendingUp, title: "Renewal risk alerts",
    text: "Monitor customer renewal pipeline and send risk alerts to Slack when score drops below 70" },
  { icon: Inbox, title: "Support ticket triage",
    text: "Every morning pull overnight support tickets, classify them with AI, update CRM priority, alert team" },
  { icon: BarChart3, title: "Daily sales digest",
    text: "Daily pull sales data, analyze trends with AI, draft email summary, send to team at 9am" },
  { icon: Package, title: "Order fulfillment",
    text: "When order placed, check inventory, reserve stock, notify warehouse, send customer confirmation" },
  { icon: Radar, title: "Competitor price watch",
    text: "Monitor competitor pricing weekly, summarize changes with AI, post to internal channel" },
];

const PIPELINE: { icon: React.ElementType; label: string; desc: string }[] = [
  { icon: PenLine,      label: "Describe", desc: "Plain English goal" },
  { icon: Network,      label: "Plan",     desc: "Agents, tools, gates" },
  { icon: Link2,        label: "Connect",  desc: "Secure BYOK setup" },
  { icon: Hammer,       label: "Build",    desc: "Graph on the canvas" },
  { icon: FlaskConical, label: "Simulate", desc: "Safe test run" },
];

const STATUS_CHIP: Record<StepId, { label: string; tone: "green" | "teal" | "amber" | "red" | "gray" | "violet"; pulse?: boolean }> = {
  goal:        { label: "Draft",        tone: "gray" },
  clarify:     { label: "Clarifying",   tone: "amber" },
  generating:  { label: "Analyzing",    tone: "teal", pulse: true },
  plan:        { label: "Plan ready",   tone: "green" },
  connections: { label: "Connections",  tone: "amber" },
  confirm:     { label: "Review",       tone: "violet" },
  building:    { label: "Building",     tone: "teal", pulse: true },
  done:        { label: "Ready",        tone: "green" },
};

const CONN_STATUS: Record<ConnectionRequirement["status"], { label: string; tone: "green" | "teal" | "amber" | "red" | "gray"; pulse?: boolean }> = {
  missing:                { label: "Missing",     tone: "red" },
  selected_existing:      { label: "Connected",   tone: "green" },
  created:                { label: "Created",     tone: "green" },
  test_passed:            { label: "Tested",      tone: "green" },
  test_failed:            { label: "Test failed", tone: "red" },
  test_pending:           { label: "Testing",     tone: "teal", pulse: true },
  simulation_placeholder: { label: "Simulated",   tone: "amber" },
};

const RISK_TONE: Record<string, "green" | "amber" | "red"> = { low: "green", medium: "amber", high: "red" };

const READY_STATUSES = ["selected_existing", "created", "test_passed", "simulation_placeholder"];

// ── Shared primitives ─────────────────────────────────────────────────────────

function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("rounded-[12px] border border-[#E0E3E6] bg-white", className)} style={style}>
      {children}
    </div>
  );
}

function MonoLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]", className)}>
      {children}
    </p>
  );
}

function ScreenHead({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <MonoLabel className="mb-2 text-[#007F4E]">{eyebrow}</MonoLabel>
      <h1 className="text-[24px] font-bold tracking-[-0.02em] text-[#0B0D0F]">{title}</h1>
      {sub && <p className="mt-1.5 max-w-xl text-[13.5px] leading-[1.6] text-[#6B7280]">{sub}</p>}
    </div>
  );
}

function PrimaryBtn({
  onClick, disabled, children, className,
}: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-[9px] bg-[#007F4E] px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#006B45] disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

function GhostBtn({
  onClick, disabled, children, className,
}: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[9px] border border-[#E0E3E6] bg-white px-4 py-2.5 text-[13px] font-medium text-[#4B5563] transition-colors hover:bg-[#F7F8F9] disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Checkpoint diamond marker — done / active / locked. */
function DiamondMark({ state, size = 11 }: { state: "done" | "active" | "locked"; size?: number }) {
  if (state === "done") {
    return (
      <span className="inline-block rotate-45 rounded-[2px]" style={{ width: size, height: size, background: "#007F4E" }} />
    );
  }
  if (state === "active") {
    return (
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        <span
          className="absolute inset-0 rotate-45 rounded-[2px]"
          style={{ border: "2px solid #007F4E", background: "#FFFFFF", animation: "archPing 1.8s cubic-bezier(0,0,.2,1) infinite" }}
        />
        <span className="absolute inset-0 rotate-45 rounded-[2px]" style={{ border: "2px solid #007F4E", background: "#FFFFFF" }} />
      </span>
    );
  }
  return (
    <span
      className="inline-block rotate-45 rounded-[2px]"
      style={{ width: size - 2, height: size - 2, border: "2px solid #D7DBE0", background: "#FFFFFF" }}
    />
  );
}

/** Solid identity tile for a workflow node type — same colors as the canvas. */
function NodeTile({ type, size = 30 }: { type: string; size?: number }) {
  const meta = NODE_META[type as keyof typeof NODE_META] ?? NODE_META.tool;
  const Icon = meta.icon;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[8px]"
      style={{ width: size, height: size, background: meta.color }}
    >
      <Icon className="h-[15px] w-[15px] text-white" />
    </span>
  );
}

/** Glyph tile for a connection requirement — provider logo when known. */
function ConnGlyph({ type, providerHint, size = 32 }: { type: string; providerHint?: string | null; size?: number }) {
  const t = `${type} ${providerHint ?? ""}`.toLowerCase();
  const isLLM = /llm|openai|anthropic|claude|gemini|qwen|\bai\b/.test(t);
  let Icon: React.ElementType = Globe;
  if (/database|postgres|mysql|\bdb\b/.test(t)) Icon = Database;
  else if (/email|smtp|resend|sendgrid|mail/.test(t)) Icon = Mail;
  else if (/slack|chat|message/.test(t)) Icon = MessageSquare;
  else if (/webhook/.test(t)) Icon = Webhook;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white text-[#0B0D0F]"
      style={{ width: size, height: size }}
    >
      {isLLM
        ? <ProviderIcon providerType={providerHint ?? type} className="h-4 w-4" />
        : <Icon className="h-4 w-4" strokeWidth={1.8} />}
    </span>
  );
}

/** Segmented confidence meter. */
function ConfidenceMeter({ value }: { value: number }) {
  const filled = Math.round(value * 10);
  const color  = value >= 0.8 ? "#007F4E" : value >= 0.6 ? "#CA8A04" : "#DC2626";
  return (
    <div className="text-right">
      <MonoLabel>Confidence</MonoLabel>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex gap-[3px]">
          {Array.from({ length: 10 }).map((_, i) => (
            <span
              key={i}
              className="h-[14px] w-[5px] rounded-[1.5px]"
              style={{ background: i < filled ? color : "#E8EAEC" }}
            />
          ))}
        </div>
        <span className="font-mono text-[15px] font-semibold tabular-nums" style={{ color }}>
          {Math.round(value * 100)}%
        </span>
      </div>
    </div>
  );
}

/** Dark mono block for agent system prompts. */
function PromptBlock({ text, maxH = 224 }: { text: string; maxH?: number }) {
  return (
    <div className="overflow-hidden rounded-[10px]" style={{ background: "#0B0D0F" }}>
      <div className="flex items-center gap-2 border-b px-3.5 py-2" style={{ borderColor: "#1c1f22" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-[#34D399]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6B7280]">System prompt</span>
      </div>
      <pre
        className="overflow-y-auto whitespace-pre-wrap px-3.5 py-3 font-mono text-[11px] leading-[1.7] text-[#D1D5DB]"
        style={{ maxHeight: maxH }}
      >
        {text}
      </pre>
    </div>
  );
}

// ── Stage rail (desktop) ──────────────────────────────────────────────────────

function StageRail({ currentIdx, clarifying }: { currentIdx: number; clarifying: boolean }) {
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col overflow-y-auto border-r border-[#E0E3E6] bg-white lg:flex">
      <div className="flex-1 px-5 py-6">
        <MonoLabel className="mb-5">Pipeline</MonoLabel>
        {RAIL_STEPS.map((s, i) => {
          const state: "done" | "active" | "locked" = i < currentIdx ? "done" : i === currentIdx ? "active" : "locked";
          const last = i === RAIL_STEPS.length - 1;
          return (
            <div key={s.id} className="flex gap-3">
              <div className="flex w-[14px] flex-col items-center pt-[3px]">
                <DiamondMark state={state} />
                {!last && (
                  <span
                    className="my-1.5 w-px flex-1 transition-colors duration-500"
                    style={{ background: i < currentIdx ? "#9CCFBB" : "#E8EAEC", minHeight: 22 }}
                  />
                )}
              </div>
              <div className={cn("min-w-0 pb-5", state === "locked" && "opacity-45")}>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] tabular-nums text-[#C9CED4]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className={cn(
                    "text-[13px] font-semibold leading-none",
                    state === "active" ? "text-[#006B45]" : "text-[#0B0D0F]",
                  )}>
                    {s.label}
                  </p>
                </div>
                <p className="mt-1 text-[11px] leading-none text-[#9CA3AF]">
                  {s.id === "goal" && clarifying ? "Answering questions" : s.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-[#ECEEEF] p-4">
        <p className="text-[11px] leading-[1.6] text-[#9CA3AF]">
          The architect designs agents, tools, connections and approval gates end-to-end. No workflow expertise needed.
        </p>
      </div>
    </aside>
  );
}

// ── Workflow step list — parallel/branch aware, canvas identity colors ────────

function WorkflowStepList({ steps, edges }: { steps: PlanStep[]; edges: PlanEdge[] }) {
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
  const usedParallelSources = new Set<string>();
  const rendered = new Set<string>();

  return (
    <div>
      {steps.map((s, i) => {
        if (rendered.has(s.tempStepId)) return null;
        const isLast = i === steps.length - 1;

        // ── Branch step: if/else preview ─────────────────────────────────
        if (s.nodeType === "branch") {
          const outgoing  = (edges ?? []).filter(e => e.from === s.tempStepId);
          const trueEdge  = outgoing.find(e => e.type === "condition_true"  || e.label?.toLowerCase().includes("true")  || e.label?.toLowerCase().includes("yes"));
          const falseEdge = outgoing.find(e => e.type === "condition_false" || e.label?.toLowerCase().includes("false") || e.label?.toLowerCase().includes("no"));
          rendered.add(s.tempStepId);
          return (
            <div key={s.tempStepId} className="arch-in flex items-stretch gap-3" style={stag(i)}>
              <RailCol idx={i} last={isLast} />
              <Card className="arch-lift mb-2 flex-1 p-3.5">
                <div className="flex items-center gap-2.5">
                  <NodeTile type="branch" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[#0B0D0F]">{s.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9CA3AF]">Branch</p>
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {trueEdge && (
                    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#9CCFBB] bg-[#E6F4EF] px-2.5 py-1 text-[11.5px] font-medium text-[#006B45]">
                      <span className="font-mono text-[10px] font-semibold">TRUE</span>
                      {trueEdge.label && <span>→ {trueEdge.label}</span>}
                    </span>
                  )}
                  {falseEdge && (
                    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 text-[11.5px] font-medium text-[#B91C1C]">
                      <span className="font-mono text-[10px] font-semibold">FALSE</span>
                      {falseEdge.label && <span>→ {falseEdge.label}</span>}
                    </span>
                  )}
                </div>
              </Card>
            </div>
          );
        }

        // ── Parallel group: grouped lane cards ───────────────────────────
        const parallelSrc = Object.entries(parallelGroups).find(([src, grp]) =>
          grp.includes(s.tempStepId) && grp.length >= 2 && !usedParallelSources.has(src)
        );
        if (parallelSrc) {
          const [src, grpIds] = parallelSrc;
          usedParallelSources.add(src);
          grpIds.forEach(id => rendered.add(id));
          rendered.add(s.tempStepId);
          const grpSteps = grpIds.map(id => steps.find(st => st.tempStepId === id)).filter(Boolean) as PlanStep[];
          return (
            <div key={`parallel-${src}`} className="arch-in flex items-stretch gap-3" style={stag(i)}>
              <RailCol idx={i} last={isLast} />
              <div className="mb-2 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-px flex-1 bg-[#C7D2FE]" />
                  <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#4F46E5]">
                    Parallel × {grpSteps.length}
                  </span>
                  <span className="h-px flex-1 bg-[#C7D2FE]" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {grpSteps.map(gs => (
                    <Card key={gs.tempStepId} className="arch-lift flex items-center gap-2.5 px-3 py-2.5">
                      <NodeTile type={gs.nodeType} size={26} />
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium text-[#0B0D0F]">{gs.name}</p>
                        <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#9CA3AF]">{gs.nodeType}</p>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        // ── Normal step ──────────────────────────────────────────────────
        rendered.add(s.tempStepId);
        return (
          <div key={s.tempStepId} className="arch-in flex items-stretch gap-3" style={stag(i)}>
            <RailCol idx={i} last={isLast} />
            <Card className="arch-lift mb-2 flex flex-1 items-center gap-2.5 px-3.5 py-2.5">
              <NodeTile type={s.nodeType} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[#0B0D0F]">{s.name}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9CA3AF]">{s.nodeType}</p>
              </div>
              {(s.toolTempId || s.agentTempId) && (
                <span className="hidden shrink-0 truncate font-mono text-[10.5px] text-[#9CA3AF] sm:block">
                  {s.toolTempId ?? s.agentTempId}
                </span>
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}

function RailCol({ idx, last }: { idx: number; last: boolean }) {
  return (
    <div className="flex w-[22px] shrink-0 flex-col items-center pt-[10px]">
      <span className="font-mono text-[10px] tabular-nums text-[#C9CED4]">{String(idx + 1).padStart(2, "0")}</span>
      {!last && <span className="mt-1.5 w-px flex-1 bg-[#E8EAEC]" />}
    </div>
  );
}

// ── Blueprint sketch — animated mini graph for the analyzing screen ───────────

function BlueprintSketch() {
  const edge = (d: string, delay: number) => (
    <path
      d={d}
      stroke="#9CCFBB"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeDasharray="64"
      strokeDashoffset="64"
      style={{ animation: `archDash .7s ease forwards ${delay}s` }}
    />
  );
  const node = (x: number, y: number, fill: string, delay: number, diamond = false) => (
    <rect
      x={x} y={y} width="16" height="16" rx="4"
      fill={fill}
      transform={diamond ? `rotate(45 ${x + 8} ${y + 8})` : undefined}
      style={{ animation: `archFade .4s ease forwards ${delay}s`, opacity: 0 }}
    />
  );
  return (
    <svg viewBox="0 0 320 96" className="w-full max-w-[340px]" aria-hidden>
      {edge("M48 48 H104", 0.3)}
      {edge("M128 48 H184", 0.9)}
      {edge("M208 42 L256 20", 1.5)}
      {edge("M208 54 L256 76", 1.7)}
      {node(28, 40, "#2563EB", 0.1)}
      {node(106, 40, "#7C3AED", 0.7)}
      {node(186, 40, "#007F4E", 1.3, true)}
      {node(254, 12, "#0891B2", 1.9)}
      {node(254, 68, "#D97706", 2.1)}
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ArchitectPage() {
  const router = useRouter();
  useEffect(() => { track("architect_opened"); }, []);
  const [step, setStep]             = useState<StepId>("goal");
  const [loading, setLoading]       = useState(false);
  const [buildPhase, setBuildPhase] = useState(0);
  const [genMsgIdx, setGenMsgIdx]   = useState(0);

  // Data
  const [goal, setGoal]             = useState("");
  const [answers, setAnswers]       = useState<Record<string, string>>({});
  const [clarifyQ, setClarifyQ]     = useState<ClarifyQuestion[]>([]);
  const [sessionId, setSessionId]   = useState<string | null>(null);
  const [plan, setPlan]             = useState<ArchitectPlan | null>(null);
  const [connReqs, setConnReqs]     = useState<ConnectionRequirement[]>([]);
  const [genTools, setGenTools]     = useState<GeneratedTool[]>([]);
  const [genAgents, setGenAgents]   = useState<GeneratedAgent[]>([]);
  const [readiness, setReadiness]   = useState<{ status: string; issues: ReadinessIssue[] } | null>(null);

  // UI state
  const [reviseText, setReviseText]           = useState("");
  const [showRevise, setShowRevise]           = useState(false);
  const [pickerReq, setPickerReq]             = useState<ConnectionRequirement | null>(null);
  const [expandedAgents, setExpandedAgents]   = useState<Set<string>>(new Set());
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [rightOpen, setRightOpen]             = useState(true);

  const goalRef = useRef<HTMLTextAreaElement>(null);

  const currentStepIdx = STEP_ORDER.indexOf(step === "clarify" ? "goal" : step);

  // ── Step 1: Submit goal ──────────────────────────────────────────────────
  async function handleGoalSubmit() {
    if (!goal.trim()) return;
    track("architect_goal_submitted");
    setLoading(true);
    setStep("generating");
    setGenMsgIdx(0);
    try {
      const sess = await createArchitectSession(goal.trim());
      setSessionId(sess.id);
      const questions = normalizeClarifyQuestions(sess.clarificationQuestions);
      if (sess.needsClarification && questions.length > 0) {
        setClarifyQ(questions);
        setLoading(false);
        setStep("clarify");
        return;
      }
      await doPlanGeneration(sess.id, {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start session");
      setStep("goal");
    } finally { setLoading(false); }
  }

  /**
   * Runs the plan generation API call and the checklist animation in parallel.
   * The plan is only revealed after BOTH the API resolves AND all checklist
   * steps have visually completed — so the user always sees every step animate.
   *
   * Step timing: GEN_MESSAGES.length × MS_PER_STEP ms minimum animation time.
   * If the API returns early, we wait for the animation; if it takes longer,
   * the last step stays spinning until it resolves.
   */
  async function doPlanGeneration(sid: string, ans: Record<string, string>) {
    setStep("generating");
    setGenMsgIdx(0);

    const MS_PER_STEP = 950; // ms each checklist step stays visible
    const TOTAL_STEPS = GEN_MESSAGES.length;

    // Run animation and API call in parallel
    type PlanResult = Awaited<ReturnType<typeof generatePlan>>;
    let apiResult: PlanResult | null = null;
    let apiError: unknown = null;

    const apiPromise = generatePlan(sid, ans)
      .then(r  => { apiResult = r; })
      .catch(e => { apiError  = e; });

    // Advance through checklist steps one by one
    for (let i = 1; i < TOTAL_STEPS; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, MS_PER_STEP));
      setGenMsgIdx(i);
    }

    // All steps animated — wait for API if still pending
    await apiPromise;

    // Brief pause on the last completed step so it feels resolved
    await new Promise<void>(resolve => setTimeout(resolve, 400));

    if (apiError) {
      toast.error(apiError instanceof Error ? apiError.message : "Plan generation failed");
      setStep("goal");
      return;
    }

    if (apiResult) {
      const r = apiResult as PlanResult;
      setPlan(r.plan);
      setConnReqs(r.connectionRequirements ?? []);
      setGenTools(r.generatedTools ?? []);
      setGenAgents(r.generatedAgents ?? []);
      setStep("plan");
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
          track("architect_workflow_created", { architectSessionId: sessionId ?? undefined, workflowId: result.workflowId });
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const answeredCount = clarifyQ.filter(q => (answers[q.question] ?? "").trim().length > 0).length;
  const readyConnCount = connReqs.filter(r => READY_STATUSES.includes(r.status)).length;
  const statusChip = STATUS_CHIP[step];

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F7F8F9]">
      <style dangerouslySetInnerHTML={{ __html: ARCH_CSS }} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="z-20 flex h-[58px] shrink-0 items-center justify-between border-b border-[#E0E3E6] bg-white px-4 lg:px-6">
        <div className="flex items-center gap-4">
          <Link
            href={"/workflows/new" as never}
            className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] transition-colors hover:text-[#0B0D0F]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
          <div className="h-4 w-px bg-[#E0E3E6]" />
          <ArchitectLogo size={30} />
          <div className="hidden sm:block">
            <p className="font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.18em] text-[#007F4E]">
              Vectorbea
            </p>
            <p className="mt-1 text-[14px] font-bold leading-none tracking-[-0.01em] text-[#0B0D0F]">
              AI Workflow Architect
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Chip tone={statusChip.tone} pulse={statusChip.pulse}>{statusChip.label}</Chip>
          <button
            type="button"
            onClick={() => setRightOpen(v => !v)}
            title="Toggle blueprint panel"
            className="hidden h-8 w-8 items-center justify-center rounded-[8px] border border-[#E0E3E6] transition-colors hover:bg-[#F7F8F9] lg:flex"
          >
            <PanelRight className="h-3.5 w-3.5 text-[#6B7280]" />
          </button>
        </div>
      </header>

      {/* ── Body: rail + main + blueprint ──────────────────────────────────── */}
      <div className="relative flex flex-1 overflow-hidden">

        <StageRail currentIdx={currentStepIdx} clarifying={step === "clarify"} />

        {/* ── Mobile stepper ───────────────────────────────────────────────── */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 overflow-x-auto border-b border-[#E0E3E6] bg-white px-4 py-2.5 lg:hidden">
          {RAIL_STEPS.map((s, i) => (
            <div key={s.id} className="flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-1.5">
                <DiamondMark state={i < currentStepIdx ? "done" : i === currentStepIdx ? "active" : "locked"} size={9} />
                <span className={cn(
                  "text-[11.5px] font-semibold",
                  i === currentStepIdx ? "text-[#006B45]" : i < currentStepIdx ? "text-[#4B5563]" : "text-[#C9CED4]",
                )}>
                  {s.label}
                </span>
              </div>
              {i < RAIL_STEPS.length - 1 && (
                <span className={cn("h-px w-3", i < currentStepIdx ? "bg-[#9CCFBB]" : "bg-[#E8EAEC]")} />
              )}
            </div>
          ))}
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto pt-12 lg:pt-0">
          <div className="mx-auto max-w-[840px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">

            {/* ── Screen 1: Goal ──────────────────────────────────────────── */}
            {step === "goal" && (
              <div className="arch-screen space-y-6">
                <ScreenHead
                  eyebrow="01 · Describe"
                  title="What should Vectorbea build for you?"
                  sub="Describe the automation in plain English. The architect designs the agents, tools, connections, approval gates and workflow graph — then builds it on the canvas."
                />

                <Card className="arch-in overflow-hidden transition-shadow focus-within:border-[#9CCFBB] focus-within:shadow-[0_0_0_3px_rgba(0,127,78,0.10)]" style={stag(1)}>
                  <textarea
                    ref={goalRef}
                    rows={6}
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGoalSubmit(); }}
                    placeholder="e.g. Every morning, pull sales data, analyze performance with AI, draft a summary email, and send it to the team at 9am…"
                    className="w-full resize-none bg-transparent p-5 text-[14px] leading-relaxed text-[#0B0D0F] placeholder:text-[#9CA3AF] focus:outline-none"
                  />
                  <div className="flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-5 py-3">
                    <span className="font-mono text-[10.5px] text-[#9CA3AF]">
                      {goal.length} chars · ⌘↵ to submit
                    </span>
                    <PrimaryBtn onClick={handleGoalSubmit} disabled={!goal.trim() || loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Architect my workflow
                    </PrimaryBtn>
                  </div>
                </Card>

                <div className="arch-in" style={stag(2)}>
                  <MonoLabel className="mb-2.5">Start from an example</MonoLabel>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {EXAMPLE_GOALS.map(({ icon: Icon, title, text }) => (
                      <button
                        key={title}
                        type="button"
                        onClick={() => { setGoal(text); goalRef.current?.focus(); }}
                        className="arch-lift group flex items-start gap-3 rounded-[12px] border border-[#E0E3E6] bg-white p-3.5 text-left"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#9CCFBB] bg-[#E6F4EF] text-[#007F4E]">
                          <Icon className="h-4 w-4" strokeWidth={1.8} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-semibold text-[#0B0D0F]">{title}</span>
                          <span className="mt-0.5 block text-[11.5px] leading-[1.5] text-[#6B7280]">{text}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* How it works pipeline */}
                <Card className="arch-in p-5" style={stag(3)}>
                  <MonoLabel className="mb-4">How it works</MonoLabel>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-0">
                    {PIPELINE.map(({ icon: Icon, label, desc }, i) => (
                      <div key={label} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:gap-0 sm:text-center">
                        <div className="flex items-center sm:w-full">
                          <span className={cn("hidden h-px flex-1 sm:block", i === 0 ? "bg-transparent" : "bg-[#E8EAEC]")} />
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[#E0E3E6] bg-white text-[#0B0D0F]">
                            <Icon className="h-4 w-4" strokeWidth={1.8} />
                          </span>
                          <span className={cn("hidden h-px flex-1 sm:block", i === PIPELINE.length - 1 ? "bg-transparent" : "bg-[#E8EAEC]")} />
                        </div>
                        <div className="sm:mt-2.5">
                          <p className="text-[12px] font-semibold text-[#0B0D0F]">{label}</p>
                          <p className="mt-0.5 text-[10.5px] text-[#9CA3AF]">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* ── Screen 2: Clarify (adaptive 1–5 questions) ──────────────── */}
            {step === "clarify" && (
              <div className="arch-screen space-y-5">
                <ScreenHead
                  eyebrow={`Clarify · ${clarifyQ.length} question${clarifyQ.length === 1 ? "" : "s"}`}
                  title={clarifyQ.length === 1 ? "One detail will sharpen the plan" : "A few details will sharpen the plan"}
                  sub="The architect only asks what changes the design. Answer what you can, or skip — sensible defaults are used for the rest."
                />

                <div className="space-y-3">
                  {clarifyQ.map((q, i) => {
                    const answered = (answers[q.question] ?? "").trim().length > 0;
                    return (
                      <Card key={i} className="arch-in p-4" style={stag(i)}>
                        <div className="flex items-start gap-3">
                          <span className={cn(
                            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] font-mono text-[10.5px] font-semibold",
                            answered ? "bg-[#007F4E] text-white" : "border border-[#E0E3E6] bg-[#FAFBFB] text-[#9CA3AF]",
                          )}>
                            {answered ? <Check className="h-3.5 w-3.5" /> : String(i + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] font-semibold leading-snug text-[#0B0D0F]">{q.question}</p>
                            {q.why && (
                              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-[1.5] text-[#6B7280]">
                                <Info className="mt-[1px] h-3 w-3 shrink-0 text-[#007F4E]" />
                                {q.why}
                              </p>
                            )}
                            <input
                              value={answers[q.question] ?? ""}
                              onChange={e => setAnswers(a => ({ ...a, [q.question]: e.target.value }))}
                              placeholder="Your answer…"
                              className="mt-2.5 w-full rounded-[9px] border border-[#E0E3E6] bg-[#FAFBFB] px-3.5 py-2.5 text-[13px] text-[#0B0D0F] placeholder:text-[#9CA3AF] focus:border-[#9CCFBB] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
                            />
                            {(q.suggestions?.length ?? 0) > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {q.suggestions!.map(s => (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={() => setAnswers(a => ({ ...a, [q.question]: s }))}
                                    className={cn(
                                      "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                                      (answers[q.question] ?? "") === s
                                        ? "border-[#9CCFBB] bg-[#E6F4EF] font-medium text-[#006B45]"
                                        : "border-[#E0E3E6] bg-white text-[#4B5563] hover:border-[#9CCFBB] hover:text-[#006B45]",
                                    )}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>

                <div className="arch-in flex flex-wrap items-center justify-between gap-3 pt-1" style={stag(clarifyQ.length)}>
                  <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">
                    {answeredCount} of {clarifyQ.length} answered
                  </span>
                  <div className="flex items-center gap-2">
                    <GhostBtn onClick={() => doPlanGeneration(sessionId!, {})} disabled={loading}>
                      Skip — use defaults
                    </GhostBtn>
                    <PrimaryBtn onClick={handleClarifySubmit} disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                      Generate plan
                    </PrimaryBtn>
                  </div>
                </div>
              </div>
            )}

            {/* ── Screen 3: Generating ────────────────────────────────────── */}
            {step === "generating" && (
              <div className="arch-screen space-y-5">
                <ScreenHead
                  eyebrow="02 · Analyze"
                  title="Designing your blueprint"
                  sub="The architect is reading the goal and assembling the complete workflow plan."
                />
                <Card className="overflow-hidden">
                  <div
                    className="relative px-8 pb-6 pt-10"
                    style={{
                      background: "#FAFBFB",
                      backgroundImage: "radial-gradient(#D2D6DB 1px, transparent 1px)",
                      backgroundSize: "22px 22px",
                    }}
                  >
                    <div className="relative z-10 flex flex-col items-center gap-5">
                      <div className="relative flex h-16 w-16 items-center justify-center">
                        <svg className="absolute inset-0" viewBox="0 0 64 64" style={{ animation: "archSpin 2.4s linear infinite" }}>
                          <circle cx="32" cy="32" r="29" fill="none" stroke="#E0E3E6" strokeWidth="2.5" />
                          <circle
                            cx="32" cy="32" r="29" fill="none" stroke="#007F4E" strokeWidth="2.5"
                            strokeLinecap="round" strokeDasharray="50 132"
                          />
                        </svg>
                        <ArchitectLogo size={34} />
                      </div>
                      <p key={genMsgIdx} className="arch-fade text-[14.5px] font-semibold text-[#0B0D0F]">
                        {GEN_MESSAGES[genMsgIdx]}…
                      </p>
                      <BlueprintSketch />
                    </div>
                  </div>

                  {/* Progress as a checkpoint timeline */}
                  <div className="border-t border-[#ECEEEF] px-6 py-5">
                    {GEN_MESSAGES.map((msg, i) => {
                      const state: "done" | "active" | "locked" = i < genMsgIdx ? "done" : i === genMsgIdx ? "active" : "locked";
                      const last = i === GEN_MESSAGES.length - 1;
                      return (
                        <div key={i} className="flex gap-3">
                          <div className="flex w-[14px] flex-col items-center pt-[4px]">
                            <DiamondMark state={state} size={10} />
                            {!last && (
                              <span
                                className="my-1 w-px flex-1 transition-colors duration-500"
                                style={{ background: i < genMsgIdx ? "#9CCFBB" : "#E8EAEC", minHeight: 10 }}
                              />
                            )}
                          </div>
                          <div className={cn("flex items-center gap-2 pb-3.5", state === "locked" && "opacity-40")}>
                            <span className={cn(
                              "text-[12.5px] leading-tight",
                              state === "active" ? "font-semibold text-[#006B45]" : state === "done" ? "text-[#4B5563]" : "text-[#9CA3AF]",
                            )}>
                              {msg}
                            </span>
                            {state === "active" && <Loader2 className="h-3 w-3 animate-spin text-[#007F4E]" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {/* ── Screen 4: Plan review ────────────────────────────────────── */}
            {step === "plan" && plan && (
              <div className="arch-screen space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <MonoLabel className="mb-2 text-[#007F4E]">03 · Blueprint ready</MonoLabel>
                    <h1 className="text-[24px] font-bold tracking-[-0.02em] text-[#0B0D0F]">{plan.workflowName}</h1>
                    <p className="mt-1.5 max-w-xl text-[13.5px] leading-[1.6] text-[#6B7280]">{plan.goalSummary}</p>
                  </div>
                  <ConfidenceMeter value={plan.confidence} />
                </div>

                {/* Composition tiles */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {[
                    { label: "Connections", value: plan.requiredConnections?.length ?? 0, type: "tool",    icon: Link2 },
                    { label: "Tools",       value: plan.tools?.length ?? 0,               type: "tool",    icon: null },
                    { label: "Agents",      value: plan.agents?.length ?? 0,              type: "agent",   icon: null },
                    { label: "Steps",       value: plan.workflowSteps?.length ?? 0,       type: "trigger", icon: null },
                  ].map(({ label, value, type, icon: FallbackIcon }, i) => {
                    const meta = NODE_META[type as keyof typeof NODE_META] ?? NODE_META.tool;
                    const Icon = FallbackIcon ?? meta.icon;
                    const color = label === "Connections" ? "#0B0D0F" : meta.color;
                    return (
                      <Card key={label} className="arch-in p-3.5" style={stag(i)}>
                        <div className="flex items-center justify-between">
                          <MonoLabel>{label}</MonoLabel>
                          <span className="flex h-6 w-6 items-center justify-center rounded-[6px]" style={{ background: `${color}14`, color }}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                        </div>
                        <p className="mt-2 text-[24px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-[#0B0D0F]">
                          {value}
                        </p>
                      </Card>
                    );
                  })}
                </div>

                {/* Trigger */}
                <Card className="arch-in flex items-center gap-3 px-4 py-3.5" style={stag(2)}>
                  <NodeTile type="trigger" size={32} />
                  <div className="min-w-0 flex-1">
                    <MonoLabel>Trigger</MonoLabel>
                    <p className="mt-0.5 truncate text-[13px] font-medium capitalize text-[#0B0D0F]">
                      {plan.trigger?.type} — <span className="normal-case">{plan.trigger?.description}</span>
                    </p>
                  </div>
                  {plan.trigger?.scheduleSuggestion && (
                    <span className="hidden shrink-0 rounded-[6px] border border-[#E0E3E6] bg-[#FAFBFB] px-2 py-1 font-mono text-[10.5px] text-[#4B5563] sm:block">
                      {plan.trigger.scheduleSuggestion}
                    </span>
                  )}
                </Card>

                {/* Required connections */}
                {(plan.requiredConnections?.length ?? 0) > 0 && (
                  <div className="arch-in" style={stag(3)}>
                    <MonoLabel className="mb-2.5">Required connections</MonoLabel>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {plan.requiredConnections.map(c => (
                        <Card key={c.tempConnectionId} className="arch-lift flex items-start gap-3 p-3.5">
                          <ConnGlyph type={c.type} providerHint={c.providerHint} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-[13px] font-semibold text-[#0B0D0F]">{c.name}</p>
                              <span className="rounded-[5px] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[9.5px] text-[#6B7280]">{c.type}</span>
                              {c.requiredForSimulation && <Chip tone="teal" dot={false}>sim required</Chip>}
                            </div>
                            <p className="mt-0.5 truncate text-[11.5px] text-[#9CA3AF]">{c.description}</p>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tools */}
                {(plan.tools?.length ?? 0) > 0 && (
                  <div className="arch-in" style={stag(4)}>
                    <MonoLabel className="mb-2.5">Tools to create</MonoLabel>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {plan.tools.map(t => (
                        <Card key={t.tempToolId} className="arch-lift flex items-center justify-between gap-3 p-3.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <NodeTile type="tool" size={28} />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-[#0B0D0F]">{t.name}</p>
                              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#9CA3AF]">{t.type}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Chip tone={RISK_TONE[t.riskLevel] ?? "gray"} dot={false}>{t.riskLevel}</Chip>
                            {t.requiresApproval && <Chip tone="amber" dot={false}>approval</Chip>}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agents */}
                {(plan.agents?.length ?? 0) > 0 && (
                  <div className="arch-in" style={stag(5)}>
                    <MonoLabel className="mb-2.5">Agents to create</MonoLabel>
                    <div className="space-y-2">
                      {plan.agents.map(a => {
                        const expanded = expandedAgents.has(a.tempAgentId);
                        const promptExpanded = expandedPrompts.has(a.tempAgentId);
                        return (
                          <Card key={a.tempAgentId} className="overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setExpandedAgents(s => { const n = new Set(s); if (n.has(a.tempAgentId)) { n.delete(a.tempAgentId); } else { n.add(a.tempAgentId); } return n; })}
                              className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-[#FAFBFB]"
                            >
                              <NodeTile type="agent" size={32} />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-semibold text-[#0B0D0F]">{a.name}</p>
                                <p className="truncate text-[11.5px] text-[#6B7280]">{a.role}</p>
                              </div>
                              {expanded
                                ? <ChevronDown className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
                                : <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF]" />}
                            </button>
                            {expanded && (
                              <div className="space-y-3 border-t border-[#ECEEEF] bg-[#FAFBFB] p-4">
                                {a.allowedTempToolIds?.length > 0 && (
                                  <div>
                                    <MonoLabel className="mb-1.5">Allowed tools</MonoLabel>
                                    <div className="flex flex-wrap gap-1">
                                      {a.allowedTempToolIds.map(tid => (
                                        <span key={tid} className="rounded-[6px] border border-[#A5F3FC] bg-[#ECFEFF] px-2 py-0.5 font-mono text-[10px] text-[#0E7490]">
                                          {tid}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {a.systemPrompt && (
                                  <div>
                                    <div className="mb-1.5 flex items-center justify-between">
                                      <MonoLabel>System prompt</MonoLabel>
                                      <button
                                        type="button"
                                        onClick={() => setExpandedPrompts(s => { const n = new Set(s); if (n.has(a.tempAgentId)) { n.delete(a.tempAgentId); } else { n.add(a.tempAgentId); } return n; })}
                                        className="flex items-center gap-1 text-[11px] font-medium text-[#007F4E] hover:text-[#006B45]"
                                      >
                                        {promptExpanded ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> View</>}
                                      </button>
                                    </div>
                                    {promptExpanded ? (
                                      <PromptBlock text={a.systemPrompt} />
                                    ) : (
                                      <p className="text-[11.5px] italic text-[#6B7280]">{a.systemPrompt.slice(0, 120)}…</p>
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

                {/* Workflow steps */}
                {(plan.workflowSteps?.length ?? 0) > 0 && (
                  <div className="arch-in" style={stag(6)}>
                    <MonoLabel className="mb-2.5">Workflow steps</MonoLabel>
                    <WorkflowStepList steps={plan.workflowSteps} edges={plan.edges} />
                  </div>
                )}

                {/* Safety notes */}
                {(plan.safetyNotes?.length ?? 0) > 0 && (
                  <Card className="arch-in border-[#FDE68A] bg-[#FFFBEB] p-4" style={stag(7)}>
                    <div className="mb-2 flex items-center gap-2">
                      <Shield className="h-4 w-4 text-[#CA8A04]" />
                      <p className="text-[12.5px] font-bold text-[#92400E]">Safety notes</p>
                    </div>
                    <ul className="space-y-1.5">
                      {plan.safetyNotes.map((n, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px] leading-[1.55] text-[#92400E]">
                          <span className="mt-[5px] inline-block h-[6px] w-[6px] shrink-0 rotate-45 rounded-[1px] border border-[#CA8A04]" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {/* Revise */}
                {showRevise && (
                  <Card className="arch-in space-y-3 p-4">
                    <MonoLabel>Revise the plan</MonoLabel>
                    <textarea
                      rows={2}
                      value={reviseText}
                      onChange={e => setReviseText(e.target.value)}
                      placeholder='e.g. "Add approval before CRM update", "Remove database write", "Use webhook trigger"'
                      className="w-full resize-none rounded-[9px] border border-[#E0E3E6] bg-[#FAFBFB] px-3.5 py-2.5 text-[13px] text-[#0B0D0F] placeholder:text-[#9CA3AF] focus:border-[#9CCFBB] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
                    />
                    <div className="flex gap-2">
                      <PrimaryBtn onClick={handleRevise} disabled={!reviseText.trim() || loading} className="px-4 py-2 text-[12.5px]">
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Apply revision
                      </PrimaryBtn>
                      <GhostBtn onClick={() => setShowRevise(false)} className="px-4 py-2 text-[12.5px]">Cancel</GhostBtn>
                    </div>
                  </Card>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <GhostBtn onClick={() => setShowRevise(true)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Revise plan
                  </GhostBtn>
                  <PrimaryBtn onClick={handleApprovePlan} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Approve &amp; continue
                  </PrimaryBtn>
                </div>
              </div>
            )}

            {/* ── Screen 5: Connections ────────────────────────────────────── */}
            {step === "connections" && (
              <div className="arch-screen space-y-5">
                <ScreenHead
                  eyebrow="04 · Connect"
                  title="Bind your systems"
                  sub="The architect needs these integrations to build and run your workflow. Secrets stay encrypted end-to-end — BYOK."
                />

                {/* Readiness summary */}
                <Card className="arch-in p-4" style={stag(0)}>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-[#0B0D0F]">
                      {readyConnCount} of {connReqs.length} connections ready
                    </p>
                    <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">
                      {connReqs.length ? Math.round((readyConnCount / connReqs.length) * 100) : 0}%
                    </span>
                  </div>
                  <div className="mt-2.5 flex gap-1">
                    {connReqs.map(r => (
                      <span
                        key={r.id}
                        className="h-[6px] flex-1 rounded-full transition-colors duration-300"
                        style={{ background: READY_STATUSES.includes(r.status) ? "#007F4E" : "#E8EAEC" }}
                      />
                    ))}
                  </div>
                  <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-[1.5] text-[#6B7280]">
                    <Info className="mt-[1px] h-3 w-3 shrink-0 text-[#007F4E]" />
                    Connections marked “sim required” must be configured before simulation. Others can run on simulated placeholders.
                  </p>
                </Card>

                <div className="grid gap-3 sm:grid-cols-2">
                  {connReqs.map((req, i) => {
                    const isReady = READY_STATUSES.includes(req.status);
                    const sc = CONN_STATUS[req.status] ?? { label: req.status, tone: "gray" as const };
                    return (
                      <Card
                        key={req.id}
                        className={cn("arch-in p-4 transition-colors", isReady && "border-[#9CCFBB]")}
                        style={stag(i + 1)}
                      >
                        <div className="flex items-start gap-3">
                          <ConnGlyph type={req.type} providerHint={req.providerHint} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-[13px] font-semibold text-[#0B0D0F]">{req.name}</p>
                              <Chip tone={sc.tone} pulse={sc.pulse}>{sc.label}</Chip>
                              {req.requiredForSimulation && <Chip tone="teal" dot={false}>sim required</Chip>}
                            </div>
                            {req.description && <p className="mt-0.5 text-[11.5px] leading-[1.5] text-[#9CA3AF]">{req.description}</p>}
                          </div>
                          {isReady && <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#007F4E]" />}
                        </div>

                        {req.setupInstructions && !isReady && (
                          <p className="mt-2.5 rounded-[8px] border border-[#ECEEEF] bg-[#FAFBFB] px-2.5 py-1.5 text-[11px] leading-[1.5] text-[#6B7280]">
                            {req.setupInstructions}
                          </p>
                        )}
                        {req.testError && (
                          <p className="mt-2.5 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1.5 text-[11px] leading-[1.5] text-[#B91C1C]">
                            {req.testError}
                          </p>
                        )}

                        {!isReady && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPickerReq(req)}
                              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#007F4E] px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#006B45]"
                            >
                              <Link2 className="h-3 w-3" /> Select connection
                            </button>
                            <Link
                              href="/connections/new"
                              target="_blank"
                              className="inline-flex items-center gap-1 rounded-[8px] border border-[#E0E3E6] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#F7F8F9]"
                            >
                              Create new <ExternalLink className="h-3 w-3" />
                            </Link>
                            {!req.requiredForSimulation && (
                              <button
                                type="button"
                                onClick={() => handleUsePlaceholder(req.id)}
                                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-1.5 text-[11.5px] font-medium text-[#92400E] transition-colors hover:bg-[#FEF3C7]"
                              >
                                <FlaskConical className="h-3 w-3" /> Simulate instead
                              </button>
                            )}
                          </div>
                        )}
                        {isReady && req.status !== "simulation_placeholder" && req.status !== "test_passed" && (
                          <button
                            type="button"
                            onClick={() => setPickerReq(req)}
                            className="mt-2 text-[11px] text-[#9CA3AF] transition-colors hover:text-[#0B0D0F]"
                          >
                            Change →
                          </button>
                        )}
                      </Card>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <GhostBtn onClick={() => setStep("plan")}>
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </GhostBtn>
                  <PrimaryBtn onClick={() => setStep("confirm")} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Continue to review
                  </PrimaryBtn>
                </div>
              </div>
            )}

            {/* ── Screen 6: Confirm tools/agents ──────────────────────────── */}
            {step === "confirm" && (
              <div className="arch-screen space-y-5">
                <ScreenHead
                  eyebrow="05 · Review"
                  title="Confirm the building blocks"
                  sub="This is exactly what will be created in your workspace. Review, then build."
                />

                {/* Fallback: plan-level summary when items not yet materialized */}
                {genTools.length === 0 && genAgents.length === 0 && plan && (
                  <Card className="arch-in p-5" style={stag(0)}>
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-[#007F4E]" />
                      <p className="text-[13.5px] font-semibold text-[#0B0D0F]">Plan ready to build</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { label: "Tools",  value: plan.tools?.length ?? 0,         type: "tool" },
                        { label: "Agents", value: plan.agents?.length ?? 0,        type: "agent" },
                        { label: "Steps",  value: plan.workflowSteps?.length ?? 0, type: "trigger" },
                      ].map(({ label, value, type }) => (
                        <div key={label} className="flex flex-col items-center gap-1.5 rounded-[10px] border border-[#ECEEEF] bg-[#FAFBFB] p-3.5">
                          <NodeTile type={type} size={26} />
                          <span className="text-[18px] font-semibold tabular-nums leading-none text-[#0B0D0F]">{value}</span>
                          <MonoLabel>{label}</MonoLabel>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3.5 text-[12px] leading-[1.55] text-[#6B7280]">
                      <strong className="font-semibold text-[#0B0D0F]">Build workflow</strong> creates the tools and agents, compiles the graph, then opens the animated canvas.
                    </p>
                  </Card>
                )}

                {/* Tools */}
                {genTools.length > 0 && (
                  <div className="arch-in" style={stag(1)}>
                    <MonoLabel className="mb-2.5">Tools ({genTools.length})</MonoLabel>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {genTools.map((t, i) => (
                        <Card key={t.id} className="arch-in p-3.5" style={stag(i)}>
                          <div className="flex items-center gap-2.5">
                            <NodeTile type="tool" size={28} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold text-[#0B0D0F]">{t.name}</p>
                              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#9CA3AF]">{t.type}</p>
                            </div>
                            <Chip tone={RISK_TONE[t.riskLevel] ?? "gray"} dot={false}>{t.riskLevel}</Chip>
                          </div>
                          <div className="mt-2.5">
                            {t.status === "created" ? (
                              <Chip tone="green">Created</Chip>
                            ) : t.status === "blocked_missing_connection" ? (
                              <Chip tone="red">Missing connection</Chip>
                            ) : (
                              <Chip tone="gray">{t.status}</Chip>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agents */}
                {genAgents.length > 0 && (
                  <div className="arch-in" style={stag(2)}>
                    <MonoLabel className="mb-2.5">Agents ({genAgents.length})</MonoLabel>
                    <div className="space-y-2">
                      {genAgents.map(a => {
                        const promptExpanded = expandedPrompts.has(`confirm-${a.id}`);
                        return (
                          <Card key={a.id} className="p-3.5">
                            <div className="flex items-start gap-2.5">
                              <NodeTile type="agent" size={30} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-[13px] font-semibold text-[#0B0D0F]">{a.name}</p>
                                  {a.status === "created"
                                    ? <Chip tone="green">Created</Chip>
                                    : <Chip tone="gray">{a.status}</Chip>}
                                </div>
                                {a.role && <p className="mt-0.5 text-[11.5px] text-[#6B7280]">{a.role}</p>}
                              </div>
                              {a.systemPromptPreview && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedPrompts(s => { const n = new Set(s); const k = `confirm-${a.id}`; if (n.has(k)) { n.delete(k); } else { n.add(k); } return n; })}
                                  className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#007F4E] hover:text-[#006B45]"
                                >
                                  {promptExpanded ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Prompt</>}
                                </button>
                              )}
                            </div>
                            {promptExpanded && a.systemPromptPreview && (
                              <div className="mt-2.5">
                                <PromptBlock text={a.systemPromptPreview} maxH={160} />
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <GhostBtn onClick={() => setStep("connections")}>
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </GhostBtn>
                  <PrimaryBtn onClick={handleBuild} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
                    Build workflow
                  </PrimaryBtn>
                </div>
              </div>
            )}

            {/* ── Screen 7: Building ───────────────────────────────────────── */}
            {step === "building" && (
              <div className="arch-screen space-y-5">
                <ScreenHead
                  eyebrow="06 · Build"
                  title="Materializing your workflow"
                  sub="Creating tools, agents and the workflow graph. Every phase is checkpointed."
                />

                <Card className="overflow-hidden">
                  <div
                    className="px-6 py-5"
                    style={{
                      background: "#FAFBFB",
                      backgroundImage: "radial-gradient(#D2D6DB 1px, transparent 1px)",
                      backgroundSize: "22px 22px",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <MonoLabel className="text-[#007F4E]">
                        Phase {String(buildPhase + 1).padStart(2, "0")} / {String(BUILD_PHASES.length).padStart(2, "0")}
                      </MonoLabel>
                      <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">
                        {Math.round(((buildPhase + 1) / BUILD_PHASES.length) * 100)}%
                      </span>
                    </div>
                    <div className="mt-2.5 h-[6px] overflow-hidden rounded-full bg-[#E8EAEC]">
                      <div
                        className="h-full rounded-full bg-[#007F4E] transition-all duration-700 ease-out"
                        style={{ width: `${((buildPhase + 1) / BUILD_PHASES.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="border-t border-[#ECEEEF] px-6 py-5">
                    {BUILD_PHASES.map((phase, i) => {
                      const state: "done" | "active" | "locked" = i < buildPhase ? "done" : i === buildPhase ? "active" : "locked";
                      const last = i === BUILD_PHASES.length - 1;
                      return (
                        <div key={i} className="flex gap-3.5">
                          <div className="flex w-[14px] flex-col items-center pt-[5px]">
                            <DiamondMark state={state} size={11} />
                            {!last && (
                              <span
                                className="my-1 w-px flex-1 transition-colors duration-500"
                                style={{ background: i < buildPhase ? "#9CCFBB" : "#E8EAEC", minHeight: 18 }}
                              />
                            )}
                          </div>
                          <div className={cn("flex-1 pb-5", state === "locked" && "opacity-40")}>
                            <div className="flex items-center gap-2">
                              <p className={cn(
                                "text-[13px] font-semibold leading-none",
                                state === "active" ? "text-[#006B45]" : "text-[#0B0D0F]",
                              )}>
                                {phase.label}
                              </p>
                              {state === "active" && <Loader2 className="h-3 w-3 animate-spin text-[#007F4E]" />}
                              {state === "done" && <Check className="h-3 w-3 text-[#007F4E]" />}
                            </div>
                            <p className="mt-1 text-[11.5px] text-[#9CA3AF]">{phase.desc}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Runtime console — real phase log, the engineering signature */}
                <Console
                  title="architect · build"
                  badge="durable"
                  lines={[
                    ...BUILD_PHASES.slice(0, buildPhase).map(p => ({
                      lvl: "done", color: "#34D399", msg: p.label.toLowerCase(),
                    })),
                    { lvl: "run", color: "#5EEAD4", msg: `${BUILD_PHASES[buildPhase].label.toLowerCase()}…` },
                  ]}
                />
              </div>
            )}

            {/* ── Screen 8: Done ───────────────────────────────────────────── */}
            {step === "done" && (
              <div className="arch-screen space-y-5">
                <div className="flex flex-col items-center py-8 text-center">
                  <span className="relative mb-6 inline-flex h-12 w-12 items-center justify-center">
                    <span
                      className="absolute inset-0 rotate-45 rounded-[8px]"
                      style={{ border: "3px solid #007F4E", animation: "archPing 2s cubic-bezier(0,0,.2,1) infinite" }}
                    />
                    <span className="absolute inset-0 flex rotate-45 items-center justify-center rounded-[8px] border-[3px] border-[#007F4E] bg-white" />
                    <Check className="relative h-5 w-5 text-[#007F4E]" strokeWidth={3} />
                  </span>
                  <MonoLabel className="mb-2 text-[#007F4E]">07 · Ready</MonoLabel>
                  <h1 className="text-[24px] font-bold tracking-[-0.02em] text-[#0B0D0F]">Workflow created</h1>
                  <p className="mt-2 text-[13.5px] text-[#6B7280]">
                    {genTools.filter(t => t.status === "created").length} tools and {genAgents.filter(a => a.status === "created").length} agents created. Opening the canvas…
                  </p>
                  {readiness && (
                    <div className="mt-4 flex items-center gap-2">
                      <Chip tone={["simulation_ready", "real_ready"].includes(readiness.status) ? "green" : "amber"}>
                        Simulation {["simulation_ready", "real_ready"].includes(readiness.status) ? "ready" : "pending"}
                      </Chip>
                      <Chip tone={readiness.status === "real_ready" ? "green" : "gray"}>
                        Real execution {readiness.status === "real_ready" ? "ready" : "locked"}
                      </Chip>
                    </div>
                  )}
                </div>

                {readiness?.issues && readiness.issues.length > 0 && (
                  <Card className="arch-in space-y-2 p-4">
                    <MonoLabel className="mb-1">Readiness notes</MonoLabel>
                    {readiness.issues.map((issue, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[12px] leading-[1.5]",
                          issue.severity === "error"   ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]" :
                          issue.severity === "warning" ? "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]" :
                                                          "border-[#ECEEEF] bg-[#FAFBFB] text-[#4B5563]",
                        )}
                      >
                        {issue.severity === "error" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> :
                         issue.severity === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> :
                         <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        {issue.message}
                      </div>
                    ))}
                  </Card>
                )}

                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#007F4E]" />
                  <span className="text-[13px] text-[#6B7280]">Opening workflow canvas with build animation…</span>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ── Right blueprint panel ─────────────────────────────────────────── */}
        {rightOpen && (
          <aside className="hidden w-[300px] shrink-0 flex-col overflow-y-auto border-l border-[#E0E3E6] bg-white lg:flex">
            <div className="flex items-center justify-between border-b border-[#ECEEEF] p-4">
              <MonoLabel>Blueprint</MonoLabel>
              <button type="button" onClick={() => setRightOpen(false)} className="text-[#9CA3AF] transition-colors hover:text-[#0B0D0F]">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {plan ? (
              <div className="flex-1 space-y-4 p-4">
                {/* Summary */}
                <div>
                  <p className="text-[13px] font-semibold text-[#0B0D0F]">{plan.workflowName}</p>
                  <p className="mt-1 text-[11.5px] leading-[1.55] text-[#6B7280]">{plan.goalSummary}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="rounded-[5px] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[10px] capitalize text-[#6B7280]">
                      {plan.trigger?.type}
                    </span>
                    <Chip tone={plan.confidence >= 0.8 ? "green" : "amber"} dot={false}>
                      {Math.round(plan.confidence * 100)}% confident
                    </Chip>
                  </div>
                </div>

                {/* Composition */}
                <div className="border-t border-[#ECEEEF] pt-3.5">
                  <MonoLabel className="mb-2">Composition</MonoLabel>
                  <div className="space-y-0.5">
                    {[
                      { label: "Agents",      value: plan.agents?.length ?? 0,              color: NODE_META.agent.color },
                      { label: "Tools",       value: plan.tools?.length ?? 0,               color: NODE_META.tool.color },
                      { label: "Connections", value: plan.requiredConnections?.length ?? 0, color: "#0B0D0F" },
                      { label: "Steps",       value: plan.workflowSteps?.length ?? 0,       color: NODE_META.trigger.color },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="flex items-center justify-between rounded-[7px] px-2 py-1.5 transition-colors hover:bg-[#FAFBFB]">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
                          <span className="text-[12px] text-[#4B5563]">{label}</span>
                        </div>
                        <span className="font-mono text-[12px] font-semibold tabular-nums text-[#0B0D0F]">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Connection readiness */}
                {connReqs.length > 0 && (
                  <div className="border-t border-[#ECEEEF] pt-3.5">
                    <MonoLabel className="mb-2">Connections</MonoLabel>
                    <div className="space-y-1.5">
                      {connReqs.map(req => {
                        const sc = CONN_STATUS[req.status] ?? { label: req.status, tone: "gray" as const };
                        return (
                          <div key={req.id} className="flex items-center justify-between gap-2">
                            <p className="truncate text-[11.5px] text-[#4B5563]">{req.name}</p>
                            <Chip tone={sc.tone} pulse={sc.pulse}>{sc.label}</Chip>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Readiness */}
                {readiness && (
                  <div className="border-t border-[#ECEEEF] pt-3.5">
                    <MonoLabel className="mb-2">Readiness</MonoLabel>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-3.5 w-3.5 text-[#007F4E]" />
                        <span className="text-[12px] text-[#4B5563]">Simulation</span>
                        <span className={cn(
                          "ml-auto font-mono text-[10.5px] font-semibold",
                          ["simulation_ready", "real_ready"].includes(readiness.status) ? "text-[#006B45]" : "text-[#DC2626]",
                        )}>
                          {["simulation_ready", "real_ready"].includes(readiness.status) ? "READY" : "NOT READY"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Play className="h-3.5 w-3.5 text-[#0F766E]" />
                        <span className="text-[12px] text-[#4B5563]">Real execution</span>
                        <span className={cn(
                          "ml-auto font-mono text-[10.5px] font-semibold",
                          readiness.status === "real_ready" ? "text-[#006B45]" : "text-[#9CA3AF]",
                        )}>
                          {readiness.status === "real_ready" ? "READY" : "LOCKED"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Safety */}
                {(plan.safetyNotes?.length ?? 0) > 0 && (
                  <div className="border-t border-[#ECEEEF] pt-3.5">
                    <MonoLabel className="mb-2">Safety</MonoLabel>
                    <div className="space-y-1.5">
                      {plan.safetyNotes.slice(0, 3).map((n, i) => (
                        <p key={i} className="flex items-start gap-1.5 text-[11px] leading-[1.5] text-[#92400E]">
                          <Shield className="mt-0.5 h-3 w-3 shrink-0 text-[#CA8A04]" />{n}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <div
                  className="rounded-[14px]"
                  style={{
                    width: 84, height: 84, opacity: 0.7,
                    backgroundImage: "radial-gradient(#D2D6DB 1px, transparent 1px)",
                    backgroundSize: "11px 11px",
                  }}
                />
                <div>
                  <p className="text-[13px] font-semibold text-[#4B5563]">Blueprint appears here</p>
                  <p className="mt-1 text-[11.5px] text-[#9CA3AF]">Describe your automation to get started.</p>
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
