"use client";

/**
 * /workflows/import
 *
 * Unified import / instrumentation hub for bringing external workflows into
 * Vectorbee. Supports four modes:
 *  1. LangGraph — parse graph JSON, convert nodes/edges, create native workflow
 *  2. Temporal   — register namespace + workflow type, ingest history events
 *  3. SDK        — instrumentation guide + code snippets
 *  4. Endpoint   — limited trigger-only mode
 */

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  FileJson,
  GitBranch,
  Info,
  Loader2,
  Plus,
  Shield,
  Terminal,
  Upload,
  Wrench,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { createWorkflow, createAgent, createTool } from "@/lib/repository";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportMode = "langgraph" | "temporal" | "sdk" | "endpoint";

interface LangGraphNode {
  id: string;
  type?: string;
  func?: string;
  config?: Record<string, unknown>;
  label?: string;
}

interface LangGraphEdge {
  from: string;
  to: string;
  condition?: string;
  label?: string;
}

interface LangGraphTool {
  name: string;
  description?: string;
}

interface LangGraphSpec {
  nodes?: LangGraphNode[];
  edges?: LangGraphEdge[];
  state?: Record<string, unknown>;
  tools?: LangGraphTool[];
  channels?: Record<string, unknown>;
  // LangGraph Python dict style
  graph?: { nodes?: LangGraphNode[]; edges?: LangGraphEdge[] };
}

interface ConvertedNode {
  nodeId: string;
  agentName: string;
  stepType: "agent" | "tool" | "branch" | "approval" | "sleep";
  modelName?: string;
  isExternal: boolean;
  reason?: string;
}

interface ConversionReport {
  convertedNodes: ConvertedNode[];
  externalNodes: ConvertedNode[];
  edges: LangGraphEdge[];
  tools: { name: string; status: "converted" | "manual" }[];
  stateFields: string[];
  replayLevel: "full" | "partial" | "observability_only";
}

// ─── Mode metadata ────────────────────────────────────────────────────────────

const MODES: {
  mode: ImportMode;
  label: string;
  sublabel: string;
  icon: React.ElementType;
  color: string;
  replayBadge: string;
  replayColor: string;
}[] = [
  {
    mode: "langgraph",
    label: "LangGraph",
    sublabel: "Convert graph to native workflow",
    icon: GitBranch,
    color: "#A78BFA",
    replayBadge: "Full or Partial Replay",
    replayColor: "text-violet-400",
  },
  {
    mode: "temporal",
    label: "Temporal",
    sublabel: "Ingest history + timeline",
    icon: Zap,
    color: "#38BDF8",
    replayBadge: "External Temporal Replay",
    replayColor: "text-sky-400",
  },
  {
    mode: "sdk",
    label: "Vectorbee SDK",
    sublabel: "Instrument existing code",
    icon: Code2,
    color: "#34D399",
    replayBadge: "Partial Replay",
    replayColor: "text-emerald-400",
  },
  {
    mode: "endpoint",
    label: "HTTP Endpoint",
    sublabel: "Limited — trigger only",
    icon: Terminal,
    color: "#94A3B8",
    replayBadge: "No Replay",
    replayColor: "text-slate-400",
  },
];

// ─── LangGraph parser ─────────────────────────────────────────────────────────

function parseLangGraph(raw: string): { spec: LangGraphSpec; error?: string } {
  try {
    const parsed = JSON.parse(raw) as LangGraphSpec;
    const spec: LangGraphSpec = {
      nodes: parsed.nodes ?? parsed.graph?.nodes ?? [],
      edges: parsed.edges ?? parsed.graph?.edges ?? [],
      state: parsed.state ?? parsed.channels,
      tools: parsed.tools ?? [],
    };
    return { spec };
  } catch {
    return { spec: {}, error: "Invalid JSON — paste a valid LangGraph graph definition." };
  }
}

const KNOWN_AGENT_TYPES = ["function", "agent", "llm", "openai", "anthropic", "chat"];
const KNOWN_TOOL_TYPES = ["tool", "retriever", "search", "api", "http", "sql", "database"];
const KNOWN_BRANCH_TYPES = ["conditional", "router", "branch", "switch", "if"];
const KNOWN_APPROVAL_TYPES = ["human", "approval", "human_in_the_loop", "hitl", "review"];
const KNOWN_TIMER_TYPES = ["sleep", "wait", "delay", "timer"];

function classifyNode(node: LangGraphNode): ConvertedNode["stepType"] | "external" {
  const t = (node.type ?? "").toLowerCase();
  const f = (node.func ?? "").toLowerCase();
  const combined = `${t} ${f}`;
  if (KNOWN_APPROVAL_TYPES.some((k) => combined.includes(k))) return "approval";
  if (KNOWN_BRANCH_TYPES.some((k) => combined.includes(k))) return "branch";
  if (KNOWN_TOOL_TYPES.some((k) => combined.includes(k))) return "tool";
  if (KNOWN_TIMER_TYPES.some((k) => combined.includes(k))) return "sleep";
  if (KNOWN_AGENT_TYPES.some((k) => combined.includes(k))) return "agent";
  return "external";
}

function buildConversionReport(spec: LangGraphSpec): ConversionReport {
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  const tools = spec.tools ?? [];

  const convertedNodes: ConvertedNode[] = [];
  const externalNodes: ConvertedNode[] = [];

  for (const node of nodes) {
    const classification = classifyNode(node);
    const display: ConvertedNode = {
      nodeId: node.id,
      agentName: (node.label ?? node.id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      stepType: classification === "external" ? "agent" : classification,
      isExternal: classification === "external",
      reason: classification === "external" ? "Unknown node type — will be registered as an external step." : undefined,
    };
    if (classification === "external") {
      externalNodes.push(display);
    } else {
      convertedNodes.push(display);
    }
  }

  const convertedTools = tools.map((t) => ({
    name: t.name,
    status: "converted" as const,
  }));

  const stateFields = Object.keys(spec.state ?? {});

  const replayLevel: ConversionReport["replayLevel"] =
    externalNodes.length === 0 && nodes.length > 0
      ? "full"
      : convertedNodes.length > 0
      ? "partial"
      : "observability_only";

  return {
    convertedNodes,
    externalNodes,
    edges,
    tools: convertedTools,
    stateFields,
    replayLevel,
  };
}

const REPLAY_LABEL: Record<ConversionReport["replayLevel"], { label: string; color: string; desc: string }> = {
  full: {
    label: "Full Replay",
    color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
    desc: "All nodes converted to native Vectorbee steps. Full checkpoint replay is available.",
  },
  partial: {
    label: "Partial Replay",
    color: "text-amber-400 border-amber-500/20 bg-amber-500/5",
    desc: "Some nodes remain as external steps. Replay works up to the first external node.",
  },
  observability_only: {
    label: "Observability Only",
    color: "text-slate-400 border-slate-500/20 bg-slate-500/5",
    desc: "No nodes could be converted. Vectorbee will observe events only — no step replay.",
  },
};

// ─── Shared field components ──────────────────────────────────────────────────

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary";

const monoInputCls = `${inputCls} font-mono`;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
      {children}
    </p>
  );
}

// ─── Capability comparison table ──────────────────────────────────────────────

type CapRow = {
  capability: string;
  native: string;
  langgraph: string;
  sdk: string;
  endpoint: string;
};

const CAPABILITY_ROWS: CapRow[] = [
  { capability: "Step timeline", native: "✓", langgraph: "✓", sdk: "✓", endpoint: "✗" },
  { capability: "Full replay", native: "✓", langgraph: "✓ if fully converted", sdk: "✗", endpoint: "✗" },
  { capability: "Partial replay", native: "✓", langgraph: "✓ from last checkpoint", sdk: "✓ if checkpoints submitted", endpoint: "✗" },
  { capability: "Checkpoint support", native: "✓", langgraph: "✓", sdk: "✓", endpoint: "✗" },
  { capability: "Approval gates", native: "✓", langgraph: "✓ if converted", sdk: "✓ via SDK event", endpoint: "✗" },
  { capability: "Retry individual step", native: "✓", langgraph: "✓ if native", sdk: "✗", endpoint: "✗" },
  { capability: "Retry whole run", native: "✓", langgraph: "✓", sdk: "✓", endpoint: "✓ only" },
  { capability: "Agent cost tracking", native: "✓", langgraph: "✓", sdk: "✓", endpoint: "✗" },
  { capability: "LLM call timeline", native: "✓", langgraph: "✓ if native agents", sdk: "✓ via SDK", endpoint: "✗" },
];

function CapabilityTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border/60 bg-muted/20">
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Capability
            </th>
            {[
              { label: "Native", color: "text-sky-400" },
              { label: "LangGraph", color: "text-violet-400" },
              { label: "SDK", color: "text-emerald-400" },
              { label: "Endpoint", color: "text-slate-400" },
            ].map(({ label, color }) => (
              <th key={label} className={cn("px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-wider", color)}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {CAPABILITY_ROWS.map((row) => (
            <tr key={row.capability} className="hover:bg-muted/10 transition-colors">
              <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{row.capability}</td>
              {[row.native, row.langgraph, row.sdk, row.endpoint].map((val, i) => (
                <td key={i} className="px-4 py-2.5 text-center">
                  {val === "✓" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mx-auto" />
                  ) : val === "✗" ? (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground/30 mx-auto" />
                  ) : (
                    <span className="text-[11px] text-amber-400/80">{val}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── LANGGRAPH SECTION ────────────────────────────────────────────────────────

const EXAMPLE_LG = `{
  "nodes": [
    { "id": "fetch_data",   "type": "function", "func": "fetch_customer_data" },
    { "id": "analyze_risk", "type": "llm",      "func": "analyze_risk_agent"  },
    { "id": "route",        "type": "conditional"                              },
    { "id": "approve",      "type": "human"                                   },
    { "id": "notify",       "type": "tool",     "func": "send_slack_message"  }
  ],
  "edges": [
    { "from": "fetch_data",   "to": "analyze_risk" },
    { "from": "analyze_risk", "to": "route"         },
    { "from": "route",        "to": "approve",       "condition": "risk > 0.7" },
    { "from": "route",        "to": "notify",        "condition": "risk <= 0.7"},
    { "from": "approve",      "to": "notify"         }
  ],
  "state": { "customerId": "string", "risk": "float", "approved": "bool" },
  "tools": [
    { "name": "send_slack_message", "description": "Sends a Slack notification" },
    { "name": "fetch_customer_data", "description": "Fetches CRM data" }
  ]
}`;

function stepTypeColor(type: string) {
  const m: Record<string, string> = {
    agent: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    tool: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    branch: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    approval: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    sleep: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  };
  return m[type] ?? m.agent;
}

function LangGraphSection({ onCreated }: { onCreated: (workflowId: string) => void }) {
  const [rawInput, setRawInput] = useState("");
  const [parsed, setParsed] = useState<ConversionReport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [step, setStep] = useState<"input" | "preview">("input");
  const [creating, setCreating] = useState(false);

  function handleParse() {
    const { spec, error } = parseLangGraph(rawInput.trim() || EXAMPLE_LG);
    if (error) {
      setParseError(error);
      setParsed(null);
      return;
    }
    setParseError(null);
    const report = buildConversionReport(spec);
    if (report.convertedNodes.length === 0 && report.externalNodes.length === 0) {
      setParseError("No nodes found in the graph spec. Check the format.");
      return;
    }
    setParsed(report);
    setStep("preview");
  }

  async function handleCreate() {
    if (!parsed) return;
    setCreating(true);
    try {
      // Create agents for converted nodes
      const agentIds: string[] = [];
      for (const node of parsed.convertedNodes) {
        if (node.stepType === "agent") {
          const agent = await createAgent({
            name: node.agentName,
            description: `Imported from LangGraph node: ${node.nodeId}`,
            type: "native_llm_agent",
          });
          agentIds.push(agent.id);
        }
      }
      // Create tools
      const toolIds: string[] = [];
      for (const tool of parsed.tools) {
        const t = await createTool({
          name: tool.name,
          type: "custom_function",
          description: `Imported from LangGraph tool: ${tool.name}`,
        });
        toolIds.push(t.id);
      }
      // Create workflow
      const replayMap: Record<ConversionReport["replayLevel"], import("@/types/platform").WorkflowCreationMode> = {
        full: "imported",
        partial: "imported",
        observability_only: "instrumented",
      };
      const wf = await createWorkflow({
        name: "Imported LangGraph Workflow",
        description: `Converted from LangGraph. ${parsed.convertedNodes.length} nodes converted, ${parsed.externalNodes.length} remain external.`,
        creationMode: replayMap[parsed.replayLevel],
        agentIds,
        toolIds,
        status: "draft",
      });
      toast.success("Workflow created from LangGraph graph.");
      onCreated(wf.id);
    } catch {
      toast.error("Failed to create workflow. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  const replayMeta = parsed ? REPLAY_LABEL[parsed.replayLevel] : null;

  if (step === "preview" && parsed) {
    return (
      <div className="space-y-6">
        {/* Replay level badge */}
        {replayMeta && (
          <div className={cn("rounded-xl border px-5 py-3.5 flex items-start gap-3", replayMeta.color)}>
            <Shield className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold">{replayMeta.label}</p>
              <p className="mt-0.5 text-[12px] opacity-80">{replayMeta.desc}</p>
            </div>
          </div>
        )}

        {/* Converted nodes */}
        <div className="space-y-2">
          <SectionLabel>Converted nodes ({parsed.convertedNodes.length})</SectionLabel>
          <div className="space-y-2">
            {parsed.convertedNodes.map((node) => (
              <div key={node.nodeId} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-[12px] font-medium">{node.agentName}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{node.nodeId}</p>
                  </div>
                </div>
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", stepTypeColor(node.stepType))}>
                  {node.stepType}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Unsupported nodes */}
        {parsed.externalNodes.length > 0 && (
          <div className="space-y-2">
            <SectionLabel>Unsupported nodes — registered as external ({parsed.externalNodes.length})</SectionLabel>
            <div className="space-y-2">
              {parsed.externalNodes.map((node) => (
                <div key={node.nodeId} className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Info className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-[12px] font-medium">{node.agentName}</p>
                      <p className="text-[11px] text-amber-400/60">{node.reason}</p>
                    </div>
                  </div>
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">external</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Edges */}
        <div className="space-y-2">
          <SectionLabel>Edges / handoffs ({parsed.edges.length})</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {parsed.edges.map((e, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/10 px-3 py-1 text-[11px] text-muted-foreground">
                <span className="font-mono">{e.from}</span>
                <ArrowRight className="h-3 w-3" />
                <span className="font-mono">{e.to}</span>
                {e.condition && <span className="text-amber-400/70 ml-1">if {e.condition}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Tools */}
        {parsed.tools.length > 0 && (
          <div className="space-y-2">
            <SectionLabel>Tools ({parsed.tools.length})</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {parsed.tools.map((t) => (
                <span key={t.name} className="flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-3 py-1 text-[11px] text-cyan-400">
                  <Wrench className="h-3 w-3" />
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* State fields */}
        {parsed.stateFields.length > 0 && (
          <div className="space-y-2">
            <SectionLabel>State schema ({parsed.stateFields.length} fields)</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {parsed.stateFields.map((f) => (
                <span key={f} className="rounded border border-border/60 bg-muted/20 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{f}</span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 border-t border-border/40 pt-4">
          <button
            type="button"
            onClick={() => setStep("input")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => void handleCreate()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors ml-auto"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {creating ? "Creating…" : "Create Workflow"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionLabel>Graph definition (JSON)</SectionLabel>
        <div className="relative">
          <textarea
            rows={14}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[11px] leading-5 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={EXAMPLE_LG}
            value={rawInput}
            onChange={(e) => { setRawInput(e.target.value); setParseError(null); }}
          />
          {!rawInput && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-[11px] text-muted-foreground/30">← Paste JSON or click Parse to use the example above</span>
            </div>
          )}
        </div>
        {parseError && (
          <p className="flex items-center gap-1.5 text-[12px] text-red-400">
            <X className="h-3.5 w-3.5" />
            {parseError}
          </p>
        )}
      </div>

      {/* Upload placeholder */}
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border/60 px-6 py-5 transition-colors hover:border-border">
        <div className="flex flex-col items-center gap-2 text-center">
          <FileJson className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-[12px] text-muted-foreground/60">Upload .json or .py file</p>
          <p className="text-[11px] text-muted-foreground/40">File upload — connect storage backend to enable</p>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border/40 bg-muted/10 p-4">
        <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">What gets converted</p>
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          {[
            ["Nodes → function / agent / llm", "Vectorbee Agent steps"],
            ["Nodes → tool / retriever / api", "Tool steps"],
            ["Nodes → conditional / router", "Branch steps"],
            ["Nodes → human / approval / hitl", "Approval gates"],
            ["Edges", "Step handoffs"],
            ["Tools array", "Tool registry entries"],
            ["State schema", "Workflow input schema"],
            ["Unknown node types", "External steps (observability only)"],
          ].map(([from, to]) => (
            <div key={from} className="flex items-center gap-2 text-muted-foreground">
              <span className="font-mono text-[10px] bg-muted/30 rounded px-1.5 py-0.5 shrink-0">{from}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              <span className="text-[11px]">{to}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleParse}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Parse & Preview
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── TEMPORAL SECTION ─────────────────────────────────────────────────────────

const TEMPORAL_CONCEPT_MAP = [
  { temporal: "Workflow Execution", vectorbea: "Agent Run", note: "One-to-one mapping" },
  { temporal: "Workflow History Event", vectorbea: "Run Event", note: "Ingested via history API" },
  { temporal: "Activity", vectorbea: "Tool Call / Step", note: "Each activity → TOOL_CALL_* events" },
  { temporal: "Child Workflow", vectorbea: "Child Run / Relationship", note: "Nested run with parent link" },
  { temporal: "Signal", vectorbea: "External Event", note: "Recorded as metadata event" },
  { temporal: "Query", vectorbea: "Query Event", note: "Observability only" },
  { temporal: "Timer / Sleep", vectorbea: "Timer Step", note: "Duration recorded" },
  { temporal: "Worker", vectorbea: "Worker", note: "Worker registration forwarded" },
];

function TemporalSection() {
  const [namespace, setNamespace] = useState("");
  const [workflowType, setWorkflowType] = useState("");
  const [taskQueue, setTaskQueue] = useState("");
  const [host, setHost] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [runId, setRunId] = useState("");

  function handleRegister() {
    if (!namespace.trim() || !workflowType.trim()) {
      toast.error("Namespace and Workflow Type are required.");
      return;
    }
    toast.info("Temporal registration — connect to your Temporal cluster to enable.");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-5 py-4 space-y-1.5">
        <p className="text-[13px] font-semibold text-sky-300">How Temporal integration works</p>
        <p className="text-[12px] text-sky-300/70 leading-relaxed">
          Temporal remains the system of execution. Vectorbea ingests your workflow history events and
          displays AI-agent-specific timelines. Full replay stays in Temporal unless you migrate the
          workflow to a native Vectorbea graph.
        </p>
      </div>

      {/* Connection */}
      <div className="space-y-3">
        <SectionLabel>Temporal connection</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Namespace" required>
            <input className={inputCls} placeholder="default" value={namespace} onChange={(e) => setNamespace(e.target.value)} />
          </Field>
          <Field label="Workflow Type" required>
            <input className={inputCls} placeholder="CustomerRenewalWorkflow" value={workflowType} onChange={(e) => setWorkflowType(e.target.value)} />
          </Field>
          <Field label="Task Queue">
            <input className={inputCls} placeholder="my-task-queue" value={taskQueue} onChange={(e) => setTaskQueue(e.target.value)} />
          </Field>
          <Field label="Temporal Host">
            <input className={monoInputCls} placeholder="localhost:7233" value={host} onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="Workflow ID (optional)">
            <input className={monoInputCls} placeholder="renewal-workflow-abc123" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} />
          </Field>
          <Field label="Run ID (optional)">
            <input className={monoInputCls} placeholder="01jk2m..." value={runId} onChange={(e) => setRunId(e.target.value)} />
          </Field>
        </div>
      </div>

      {/* Connection placeholder note */}
      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
        <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <p className="text-[12px] text-muted-foreground/70">
          Connection and history import are placeholders. Connect to your Temporal cluster via the Settings → Integrations page when the backend is ready.
        </p>
      </div>

      {/* Concept map */}
      <div className="space-y-2">
        <SectionLabel>Concept mapping — Temporal → Vectorbea</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 bg-muted/20">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-sky-400/70">Temporal concept</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Vectorbea equivalent</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {TEMPORAL_CONCEPT_MAP.map((row) => (
                <tr key={row.temporal} className="hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-sky-300/80">{row.temporal}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.vectorbea}</td>
                  <td className="px-4 py-2.5 text-[11px] text-muted-foreground/50">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleRegister}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Zap className="h-3.5 w-3.5" />
          Register Workflow
        </button>
      </div>
    </div>
  );
}

// ─── SDK SECTION ──────────────────────────────────────────────────────────────

const SDK_EVENTS = [
  { event: "vectorbea.run.start()", desc: "Emits RUN_STARTED, opens a new run context" },
  { event: "vectorbea.agent.start()", desc: "Emits AGENT_STARTED with agent name / model" },
  { event: "vectorbea.llm.call()", desc: "Emits LLM_CALL_STARTED → LLM_CALL_COMPLETED with token counts" },
  { event: "vectorbea.tool.call()", desc: "Emits TOOL_CALL_STARTED → TOOL_CALL_COMPLETED with tool name" },
  { event: "vectorbea.checkpoint.create()", desc: "Emits CHECKPOINT_CREATED, enables partial replay" },
  { event: "vectorbea.approval.request()", desc: "Emits APPROVAL_REQUESTED, pauses run for human review" },
  { event: "vectorbea.artifact.create()", desc: "Emits ARTIFACT_CREATED, stores output artifact" },
  { event: "vectorbea.run.complete()", desc: "Emits RUN_SUCCEEDED or RUN_FAILED" },
];

const TS_SNIPPET = `import { VectorbeeSdk } from "@vectorbee/sdk";

const vb = new VectorbeeSdk({
  apiKey: process.env.VECTORBEE_API_KEY,
  workflowId: "wf-renewal-intelligence",
});

async function runRenewalAgent(customerId: string) {
  const run = await vb.run.start({ input: { customerId } });

  try {
    // Agent lifecycle
    await vb.agent.start(run.id, { agentName: "DataFetcher", model: "gpt-4.1" });

    // LLM call
    const llm = await vb.llm.call(run.id, {
      model: "gpt-4.1",
      prompt: "Analyze renewal probability for customer...",
    });
    // ...call your LLM here...
    await llm.complete({ tokens: 842, cost: 0.0025 });

    // Tool call
    const tool = await vb.tool.call(run.id, { toolName: "send_slack_message" });
    await slackClient.send({ channel: "#renewals", text: "Risk: high" });
    await tool.complete({ output: { ok: true } });

    // Checkpoint for partial replay
    await vb.checkpoint.create(run.id, {
      stepId: "post-analysis",
      state: { risk: 0.82, customerId },
    });

    await vb.run.complete(run.id, { status: "succeeded", output: { risk: 0.82 } });
  } catch (err) {
    await vb.run.complete(run.id, { status: "failed", error: String(err) });
    throw err;
  }
}`;

const PY_SNIPPET = `from vectorbee import VectorbeeSdk

vb = VectorbeeSdk(
    api_key=os.environ["VECTORBEE_API_KEY"],
    workflow_id="wf-renewal-intelligence",
)

async def run_renewal_agent(customer_id: str):
    run = await vb.run.start(input={"customer_id": customer_id})

    try:
        # Agent lifecycle
        await vb.agent.start(run.id, agent_name="DataFetcher", model="gpt-4.1")

        # LLM call
        llm = await vb.llm.call(run.id, model="gpt-4.1",
                                 prompt="Analyze renewal probability...")
        # ...call your LLM here...
        await llm.complete(tokens=842, cost=0.0025)

        # Tool call
        tool = await vb.tool.call(run.id, tool_name="send_slack_message")
        await slack_client.send(channel="#renewals", text="Risk: high")
        await tool.complete(output={"ok": True})

        # Checkpoint for partial replay
        await vb.checkpoint.create(run.id,
            step_id="post-analysis",
            state={"risk": 0.82, "customer_id": customer_id},
        )

        await vb.run.complete(run.id, status="succeeded", output={"risk": 0.82})
    except Exception as err:
        await vb.run.complete(run.id, status="failed", error=str(err))
        raise`;

function SdkSection() {
  const [lang, setLang] = useState<"ts" | "py">("ts");

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 space-y-1.5">
        <p className="text-[13px] font-semibold text-emerald-300">Instrument existing agent code</p>
        <p className="text-[12px] text-emerald-300/70 leading-relaxed">
          Add the Vectorbee SDK to your existing TypeScript or Python agent code. Push structured
          events and checkpoints to Vectorbea for observability, cost tracking, and partial replay
          — without changing how your agent executes.
        </p>
      </div>

      {/* Install */}
      <div className="space-y-3">
        <SectionLabel>Install</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground/60">npm / TypeScript</p>
            <code className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3 font-mono text-[12px] text-emerald-300">
              npm install @vectorbee/sdk
            </code>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground/60">pip / Python</p>
            <code className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3 font-mono text-[12px] text-emerald-300">
              pip install vectorbee-sdk
            </code>
          </div>
        </div>
      </div>

      {/* API key */}
      <div className="space-y-2">
        <SectionLabel>API key</SectionLabel>
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
          <code className="font-mono text-[12px] text-sky-400">vb_sk_••••••••••••••••••••••••</code>
          <Link
            href={"/api-keys" as never}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            Manage keys
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Code snippet */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Example usage</SectionLabel>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["ts", "py"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={cn(
                  "px-3 py-1 text-[11px] font-medium transition-colors",
                  lang === l ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l === "ts" ? "TypeScript" : "Python"}
              </button>
            ))}
          </div>
        </div>
        <pre className="max-h-[360px] overflow-auto rounded-xl border border-border bg-[#0a0a0a] px-5 py-4 font-mono text-[11px] leading-5 text-[#c9d1d9]">
          <code>{lang === "ts" ? TS_SNIPPET : PY_SNIPPET}</code>
        </pre>
      </div>

      {/* SDK events reference */}
      <div className="space-y-2">
        <SectionLabel>SDK event methods</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 bg-muted/20">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-emerald-400/70">Method</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Emits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {SDK_EVENTS.map((e) => (
                <tr key={e.event} className="hover:bg-muted/10">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-emerald-300">{e.event}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ingestion endpoint */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 space-y-2">
        <p className="text-[12px] font-semibold text-emerald-400">Event ingestion endpoint</p>
        <code className="block font-mono text-[11px] text-emerald-300">POST /api/ingest/events</code>
        <p className="text-[11px] text-emerald-300/60">
          Accepts a batch of Vectorbee run events. The SDK uses this internally.
          You can also POST directly if you need fine-grained control.
        </p>
      </div>
    </div>
  );
}

// ─── ENDPOINT SECTION ─────────────────────────────────────────────────────────

function EndpointSection() {
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [authHeader, setAuthHeader] = useState("");
  const [schedule, setSchedule] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("30000");
  const [maxRetries, setMaxRetries] = useState("2");
  const [headers, setHeaders] = useState([{ key: "", value: "" }]);

  function addHeader() {
    setHeaders((h) => [...h, { key: "", value: "" }]);
  }
  function updateHeader(i: number, field: "key" | "value", val: string) {
    setHeaders((h) => h.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  }
  function removeHeader(i: number) {
    setHeaders((h) => h.filter((_, idx) => idx !== i));
  }

  function handleRegister() {
    if (!url.trim()) {
      toast.error("Endpoint URL is required.");
      return;
    }
    try {
      new URL(url);
    } catch {
      toast.error("Enter a valid URL (e.g. https://your-service.com/api/run)");
      return;
    }
    toast.info("Endpoint registered — connect to your backend to enable triggering.");
  }

  return (
    <div className="space-y-6">
      {/* Warning */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 space-y-2">
        <p className="text-[13px] font-semibold text-amber-300">
          External Endpoint — Limited Observability
        </p>
        <p className="text-[12px] text-amber-300/70 leading-relaxed">
          Vectorbee can trigger this endpoint and record start / end status, but cannot inspect
          internal steps, replay from checkpoints, or retry individual agent steps. To unlock
          step-level visibility and replay, add the Vectorbee SDK to your endpoint&apos;s code.
        </p>
      </div>

      {/* Endpoint config */}
      <div className="space-y-3">
        <SectionLabel>Endpoint configuration</SectionLabel>
        <Field label="Endpoint URL" required>
          <input
            className={monoInputCls}
            placeholder="https://your-service.com/api/run"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Method">
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
              {["POST", "GET", "PUT", "PATCH"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Timeout (ms)">
            <input className={inputCls} type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
          </Field>
          <Field label="Max retries (whole job)">
            <input className={inputCls} type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} />
          </Field>
        </div>
        <Field label="Schedule (cron, optional)">
          <input className={monoInputCls} placeholder="0 9 * * 1-5" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        </Field>
      </div>

      {/* Headers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Request headers</SectionLabel>
          <button type="button" onClick={addHeader} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <Plus className="h-3 w-3" />
            Add header
          </button>
        </div>
        <div className="space-y-1.5">
          {headers.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={`${monoInputCls} flex-1`}
                placeholder="Header name"
                value={row.key}
                onChange={(e) => updateHeader(i, "key", e.target.value)}
              />
              <input
                className={`${monoInputCls} flex-1`}
                placeholder="Value"
                value={row.value}
                onChange={(e) => updateHeader(i, "value", e.target.value)}
              />
              <button type="button" onClick={() => removeHeader(i)} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Retry note */}
      <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
        <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 mt-0.5" />
        <p className="text-[12px] text-muted-foreground/70">
          In endpoint mode, retry applies to the whole job only. Individual step retry and approval gates require the Vectorbee SDK.
        </p>
      </div>

      {/* Capability table */}
      <div className="space-y-3">
        <SectionLabel>Capability comparison</SectionLabel>
        <CapabilityTable />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleRegister}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Terminal className="h-3.5 w-3.5" />
          Register Endpoint
        </button>
      </div>
    </div>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function ImportWorkflowPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<ImportMode>("langgraph");

  const meta = MODES.find((m) => m.mode === selected)!;
  const Icon = meta.icon;

  function handleCreated(workflowId: string) {
    router.push(`/workflows/${workflowId}` as never);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 pb-20 lg:p-8">
      {/* Back */}
      <Link
        href={"/workflows" as never}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Workflows
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Import / Instrument Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring existing workflows into Vectorbea for observability, control, and replay.
        </p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MODES.map((m) => {
          const MIcon = m.icon;
          const isSelected = selected === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              onClick={() => setSelected(m.mode)}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-4 text-left transition-all",
                isSelected
                  ? "shadow-[0_0_0_2px_var(--color)]"
                  : "border-border/60 hover:border-border bg-muted/5 hover:bg-muted/10",
              )}
              style={
                isSelected
                  ? {
                      borderColor: `${m.color}40`,
                      background: `${m.color}08`,
                      // @ts-expect-error css var
                      "--color": `${m.color}30`,
                    }
                  : {}
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: `${m.color}15`, border: `1px solid ${m.color}25` }}
                >
                  <MIcon className="h-4 w-4" style={{ color: m.color }} />
                </span>
                {isSelected && <CheckCircle2 className="h-3.5 w-3.5" style={{ color: m.color }} />}
              </div>
              <div>
                <p
                  className="text-[13px] font-semibold"
                  style={{ color: isSelected ? m.color : undefined }}
                >
                  {m.label}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">{m.sublabel}</p>
              </div>
              <span className={cn("text-[10px] font-medium", m.replayColor)}>{m.replayBadge}</span>
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div className="rounded-xl border border-border/60 p-6 space-y-1" style={{ background: "var(--surface-1, hsl(var(--background)))" }}>
        {/* Panel header */}
        <div className="flex items-center gap-3 pb-5 border-b border-border/40 mb-5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `${meta.color}15`, border: `1px solid ${meta.color}25` }}
          >
            <Icon className="h-4.5 w-4.5" style={{ color: meta.color }} />
          </span>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold">{meta.label}</h2>
            <p className="text-[12px] text-muted-foreground">{meta.sublabel}</p>
          </div>
          <span className={cn("text-[11px] font-medium", meta.replayColor)}>
            {meta.replayBadge}
          </span>
        </div>

        {selected === "langgraph" && <LangGraphSection onCreated={handleCreated} />}
        {selected === "temporal" && <TemporalSection />}
        {selected === "sdk" && <SdkSection />}
        {selected === "endpoint" && <EndpointSection />}
      </div>

      {/* Capability table shown for non-endpoint modes too — as a reference */}
      {selected !== "endpoint" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Capability comparison across all modes
            </p>
            <div className="flex-1 border-t border-border/30" />
          </div>
          <CapabilityTable />
        </div>
      )}
    </div>
  );
}
