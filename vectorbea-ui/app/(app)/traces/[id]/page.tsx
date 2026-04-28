"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Braces,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  Download,
  FileJson,
  Flag,
  GitBranch,
  Network,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Timer,
  Waypoints,
  Workflow,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TraceDetailView, TraceReplayResponse } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

type SpanStatus = "success" | "warning" | "error" | "partial";
type SpanType =
  | "incoming_request"
  | "sidecar_proxy"
  | "prompt_resolution"
  | "template_render"
  | "retrieval_query"
  | "vector_lookup"
  | "rerank"
  | "context_assembly"
  | "cache"
  | "model_selection"
  | "llm_completion"
  | "guardrail"
  | "response_parser"
  | "fallback"
  | "audit_sink"
  | "evaluation_hook";

type LogLevel = "debug" | "info" | "warn" | "error";

type Span = {
  id: string;
  parentId: string | null;
  name: string;
  type: SpanType;
  service: string;
  status: SpanStatus;
  startMs: number;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
  provider?: string;
  promptVersion?: string;
  cacheStatus?: "hit" | "miss";
  guardrailResult?: "passed" | "flagged";
  retries?: number;
  criticalPath?: boolean;
  aiSpecific?: boolean;
  branch?: "primary" | "fallback";
  tags?: Record<string, string | number | boolean>;
  inputPreview?: string;
  outputPreview?: string;
};

type TraceLog = {
  id: string;
  timestamp: string;
  offsetMs: number;
  level: LogLevel;
  component: string;
  message: string;
  spanId?: string;
};

type TraceData = {
  id: string;
  status: SpanStatus;
  startedAt: string;
  env: "prod" | "staging";
  durationMs: number;
  totalCostUsd: number;
  tokensIn: number;
  tokensOut: number;
  promptName: string;
  promptVersion: string;
  sidecarName: string;
  primaryModel: string;
  provider: string;
  cacheStatus: "hit" | "miss";
  fallbackUsed: boolean;
  guardrail: "passed" | "flagged";
  evalScore: number;
  spans: Span[];
  logs: TraceLog[];
  prompt: {
    name: string;
    version: string;
    source: "published" | "draft" | "experiment";
    publishedBy: string;
    rolloutPercent: number;
    releaseTag: string;
    evalBaseline: number;
    params: { temperature: number; top_p: number; max_tokens: number };
    system: string;
    developer: string;
    userTemplate: string;
    renderedPrompt: string;
    variables: Record<string, string>;
  };
  inputs: {
    userInput: string;
    variables: Record<string, string>;
    contextDocs: Array<{ id: string; source: string; title: string; tokenCount: number; content: string }>;
    headers: Record<string, string>;
    tenant: string;
    workspace: string;
    environment: string;
    cacheKey: string;
    sessionId: string;
    conversationId: string;
  };
  outputs: {
    rawPrimary: string;
    rawFallback?: string;
    postProcessed: string;
    finalDelivered: string;
    parsedJson?: Record<string, unknown>;
    safetyNotes: string[];
  };
};

type SpanRow = Span & { depth: number; children: Span[] };

const STATUS_STYLE: Record<SpanStatus, string> = {
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/25",
  error: "bg-red-500/10 text-red-700 border-red-500/25",
  partial: "bg-blue-500/10 text-blue-700 border-blue-500/25",
};

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-cyan-600",
  warn: "text-amber-600",
  error: "text-red-600",
};

const TYPE_META: Record<SpanType, { label: string; color: string; icon: LucideIcon; aiOnly?: boolean }> = {
  incoming_request: { label: "Incoming", color: "bg-slate-500", icon: Network },
  sidecar_proxy: { label: "Sidecar", color: "bg-slate-500", icon: Server, aiOnly: true },
  prompt_resolution: { label: "Prompt", color: "bg-slate-500", icon: Sparkles, aiOnly: true },
  template_render: { label: "Template", color: "bg-slate-500", icon: Braces, aiOnly: true },
  retrieval_query: { label: "Retrieval", color: "bg-slate-500", icon: Database, aiOnly: true },
  vector_lookup: { label: "VectorDB", color: "bg-slate-500", icon: Database, aiOnly: true },
  rerank: { label: "Rerank", color: "bg-slate-500", icon: Sparkles, aiOnly: true },
  context_assembly: { label: "Context", color: "bg-slate-500", icon: Sparkles, aiOnly: true },
  cache: { label: "Cache", color: "bg-slate-500", icon: Zap, aiOnly: true },
  model_selection: { label: "Routing", color: "bg-slate-500", icon: Waypoints, aiOnly: true },
  llm_completion: { label: "LLM", color: "bg-slate-500", icon: Bot, aiOnly: true },
  guardrail: { label: "Guardrail", color: "bg-slate-500", icon: ShieldCheck, aiOnly: true },
  response_parser: { label: "Parser", color: "bg-slate-500", icon: FileJson, aiOnly: true },
  fallback: { label: "Fallback", color: "bg-slate-500", icon: GitBranch, aiOnly: true },
  audit_sink: { label: "Audit", color: "bg-slate-500", icon: ClipboardList },
  evaluation_hook: { label: "Eval", color: "bg-slate-500", icon: Sparkles, aiOnly: true },
};

function spanBarTone(row: Span, selected: boolean) {
  if (selected) return "bg-cyan-300 ring-1 ring-cyan-200/70";
  if (row.status === "error") return "bg-red-400";
  if (row.status === "warning" || row.status === "partial") return "bg-amber-300";
  if (row.criticalPath) return "bg-slate-300";
  return "bg-slate-500";
}

const TRACE: TraceData = {
  id: "trace_01HZX9X3B1QKQ19Q5DM7C2A0XE",
  status: "warning",
  startedAt: "2026-04-22T13:46:21.442Z",
  env: "prod",
  durationMs: 1860,
  totalCostUsd: 0.0084,
  tokensIn: 1843,
  tokensOut: 512,
  promptName: "support-agent-2",
  promptVersion: "v13",
  sidecarName: "jpmorgan-sidecar-cluster",
  primaryModel: "gpt-4.1-mini",
  provider: "OpenAI",
  cacheStatus: "miss",
  fallbackUsed: true,
  guardrail: "passed",
  evalScore: 0.93,
  spans: [
    { id: "s0", parentId: null, name: "support-agent-2 request", type: "incoming_request", service: "api-gateway", status: "warning", startMs: 0, durationMs: 1860, aiSpecific: true, criticalPath: true },
    { id: "s1", parentId: "s0", name: "sidecar interception", type: "sidecar_proxy", service: "vectorbea-sidecar", status: "success", startMs: 22, durationMs: 70, criticalPath: true },
    { id: "s2", parentId: "s0", name: "prompt resolution", type: "prompt_resolution", service: "prompt-control-plane", status: "success", startMs: 95, durationMs: 86, promptVersion: "v13", criticalPath: true },
    { id: "s3", parentId: "s0", name: "template interpolation", type: "template_render", service: "prompt-runtime", status: "success", startMs: 182, durationMs: 48, criticalPath: true },
    { id: "s4", parentId: "s0", name: "retrieval search", type: "retrieval_query", service: "retrieval-orchestrator", status: "success", startMs: 236, durationMs: 360, criticalPath: true },
    { id: "s5", parentId: "s4", name: "vector db lookup", type: "vector_lookup", service: "pgvector-cluster", status: "success", startMs: 246, durationMs: 220 },
    { id: "s6", parentId: "s4", name: "rerank candidates", type: "rerank", service: "retrieval-reranker", status: "success", startMs: 472, durationMs: 85 },
    { id: "s7", parentId: "s4", name: "context assembly", type: "context_assembly", service: "prompt-runtime", status: "success", startMs: 560, durationMs: 26 },
    { id: "s8", parentId: "s0", name: "cache lookup", type: "cache", service: "edge-cache", status: "warning", startMs: 606, durationMs: 22, cacheStatus: "miss" },
    { id: "s9", parentId: "s0", name: "model routing", type: "model_selection", service: "llm-router", status: "success", startMs: 632, durationMs: 28, criticalPath: true },
    { id: "s10", parentId: "s0", name: "LLM completion (primary)", type: "llm_completion", service: "openai-gateway", status: "warning", startMs: 665, durationMs: 540, model: "gpt-4.1-mini", provider: "OpenAI", tokensIn: 1843, tokensOut: 241, costUsd: 0.0047, retries: 1, criticalPath: true, branch: "primary" },
    { id: "s11", parentId: "s0", name: "fallback model call", type: "fallback", service: "anthropic-gateway", status: "success", startMs: 1220, durationMs: 410, model: "claude-3.5-sonnet", provider: "Anthropic", tokensIn: 1792, tokensOut: 512, costUsd: 0.0032, criticalPath: true, branch: "fallback" },
    { id: "s12", parentId: "s0", name: "guardrail validation", type: "guardrail", service: "policy-guardrails", status: "success", startMs: 1638, durationMs: 78, guardrailResult: "passed" },
    { id: "s13", parentId: "s0", name: "response parser", type: "response_parser", service: "output-parser", status: "success", startMs: 1718, durationMs: 64 },
    { id: "s14", parentId: "s0", name: "audit persistence", type: "audit_sink", service: "audit-log-sink", status: "success", startMs: 1760, durationMs: 86 },
    { id: "s15", parentId: "s0", name: "evaluation hook", type: "evaluation_hook", service: "eval-worker", status: "success", startMs: 1788, durationMs: 52 },
  ],
  logs: [
    { id: "l1", timestamp: "2026-04-22T13:46:21.460Z", offsetMs: 18, level: "info", component: "sidecar", message: "Request received from app gateway", spanId: "s1" },
    { id: "l2", timestamp: "2026-04-22T13:46:21.558Z", offsetMs: 116, level: "debug", component: "prompt-runtime", message: "Resolved support-agent-2@v13 from published rollout", spanId: "s2" },
    { id: "l3", timestamp: "2026-04-22T13:46:21.725Z", offsetMs: 283, level: "info", component: "retrieval", message: "Fetched 42 chunks from policy index", spanId: "s5" },
    { id: "l4", timestamp: "2026-04-22T13:46:22.054Z", offsetMs: 612, level: "warn", component: "cache", message: "Semantic cache miss for conversation hash f2a9", spanId: "s8" },
    { id: "l5", timestamp: "2026-04-22T13:46:22.582Z", offsetMs: 1140, level: "warn", component: "llm-router", message: "Primary completion exceeded soft timeout, fallback engaged", spanId: "s10" },
    { id: "l6", timestamp: "2026-04-22T13:46:22.916Z", offsetMs: 1474, level: "info", component: "llm-router", message: "Fallback completion succeeded with higher confidence", spanId: "s11" },
    { id: "l7", timestamp: "2026-04-22T13:46:23.104Z", offsetMs: 1662, level: "info", component: "guardrails", message: "All output policy checks passed", spanId: "s12" },
    { id: "l8", timestamp: "2026-04-22T13:46:23.236Z", offsetMs: 1794, level: "debug", component: "eval", message: "Hook scored response at 0.93 (threshold 0.85)", spanId: "s15" },
  ],
  prompt: {
    name: "support-agent-2",
    version: "v13",
    source: "published",
    publishedBy: "priya.menon@vectorbea.com",
    rolloutPercent: 100,
    releaseTag: "2026.04.r2",
    evalBaseline: 0.91,
    params: { temperature: 0.2, top_p: 0.9, max_tokens: 700 },
    system: "You are VectorBea Support AI. Provide concise policy-grounded responses.",
    developer: "Prioritize compliance and reassurance. If uncertainty > 0.3, add escalation guidance.",
    userTemplate: "User question: {{question}}\\nAccount tier: {{account_tier}}\\nRegion: {{region}}\\n",
    renderedPrompt:
      "User question: How long does a chargeback investigation take for disputed ACH transfer?\\nAccount tier: Enterprise\\nRegion: US\\n\\nContext:\\n- policy_payments_dispute_v7#sec4\\n- policy_ach_settlement_v3#sec2\\n- policy_customer_comms_v5#sec9",
    variables: {
      question: "How long does a chargeback investigation take for disputed ACH transfer?",
      account_tier: "Enterprise",
      region: "US",
      risk_profile: "Medium",
      language: "en-US",
    },
  },
  inputs: {
    userInput: "How long does a chargeback investigation take for disputed ACH transfer?",
    variables: {
      account_tier: "Enterprise",
      region: "US",
      risk_profile: "Medium",
      locale: "en-US",
      customer_id: "cust_7ab3f2",
    },
    contextDocs: [
      {
        id: "doc_01",
        source: "vector-db:policy_chunks",
        title: "policy_payments_dispute_v7#sec4",
        tokenCount: 412,
        content:
          "Dispute investigations for ACH-related cases are initiated within 24 hours. Typical resolution windows range from 3-10 business days depending on receiving institution response SLAs and evidence completeness.",
      },
      {
        id: "doc_02",
        source: "vector-db:policy_chunks",
        title: "policy_ach_settlement_v3#sec2",
        tokenCount: 356,
        content:
          "ACH return and settlement exceptions may require a secondary review when originating account risk score exceeds threshold. In those cases, timeline may extend by 2 business days.",
      },
      {
        id: "doc_03",
        source: "vector-db:policy_chunks",
        title: "policy_customer_comms_v5#sec9",
        tokenCount: 278,
        content:
          "Customer communications must avoid guaranteed timelines; use ranges and explain dependencies. Include escalation path for unresolved disputes beyond expected processing window.",
      },
    ],
    headers: {
      "x-tenant-id": "acme-bank",
      "x-workspace-id": "ws_enterprise_001",
      "x-vectorbea-sidecar": "jpmorgan-sidecar-cluster",
      "x-request-id": "req_7f92c7f4ab",
    },
    tenant: "acme-bank",
    workspace: "ws_enterprise_001",
    environment: "prod",
    cacheKey: "chat:acme-bank:ws_enterprise_001:hash_f2a9d0",
    sessionId: "sess_28b8fb6a",
    conversationId: "conv_9aa1ec4f",
  },
  outputs: {
    rawPrimary: "Chargeback investigations usually take 3-5 days. Please wait and we will notify you soon. [partial]",
    rawFallback:
      "For disputed ACH transfers, investigations typically resolve within 3-10 business days. In elevated-risk or complex cases, this can extend slightly.",
    postProcessed:
      "For disputed ACH transfers, investigations typically resolve within 3-10 business days depending on receiving-bank response and evidence quality.",
    finalDelivered:
      "For disputed ACH transfers, investigations usually complete within 3-10 business days. In complex or high-risk scenarios, this can extend by a couple of days. If your case exceeds that window, we can escalate immediately.",
    parsedJson: {
      answer: "Investigations usually complete within 3-10 business days, with slight extension in complex cases.",
      confidence: 0.92,
      citations: ["policy_payments_dispute_v7#sec4", "policy_ach_settlement_v3#sec2", "policy_customer_comms_v5#sec9"],
      escalationSuggested: true,
    },
    safetyNotes: ["No PII leakage detected", "No policy violations detected", "Hallucination risk: low"],
  },
};

function formatDuration(ms: number) {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(cost?: number) {
  if (!cost) return "$0.0000";
  return `$${cost.toFixed(4)}`;
}

function flattenSpans(spans: Span[]) {
  const byParent = new Map<string | null, Span[]>();
  for (const span of spans) {
    const list = byParent.get(span.parentId) ?? [];
    list.push(span);
    byParent.set(span.parentId, list);
  }
  byParent.forEach((list) => list.sort((a, b) => a.startMs - b.startMs));

  const rows: SpanRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      rows.push({ ...child, depth, children: byParent.get(child.id) ?? [] });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return { rows, byParent };
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg px-2.5 py-1.5 text-xs transition",
        active ? "bg-cyan-500/20 text-cyan-200" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <button className="flex w-full items-center justify-between px-3 py-2.5 text-sm" onClick={onToggle}>
        <span>{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-3 pb-3 text-xs">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("max-w-[68%] break-all text-right text-foreground", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function createEmptyTrace(id: string): TraceDetailView {
  return {
    id,
    status: "success",
    startedAt: new Date(0).toISOString(),
    env: "prod",
    durationMs: 0,
    totalCostUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    promptName: "—",
    promptVersion: "—",
    sidecarName: "—",
    primaryModel: "—",
    provider: "—",
    executorType: "unknown",
    executorName: "—",
    executorOwnership: "unknown",
    executorObservability: "unknown",
    replayOf: null,
    cacheStatus: "unknown",
    fallbackUsed: false,
    guardrail: "passed",
    evalScore: 0,
    evaluation: null,
    spans: [],
    logs: [],
    prompt: {
      name: "—",
      version: "—",
      source: "published",
      publishedBy: "—",
      rolloutPercent: 0,
      releaseTag: "—",
      evalBaseline: 0,
      params: { temperature: 0, top_p: 1, max_tokens: 0 },
      system: "",
      developer: "",
      userTemplate: "",
      renderedPrompt: "",
      variables: {},
    },
    inputs: {
      userInput: "",
      variables: {},
      contextDocs: [],
      headers: {},
      tenant: "—",
      workspace: "—",
      environment: "prod",
      cacheKey: "—",
      sessionId: "—",
      conversationId: "—",
    },
    outputs: {
      rawPrimary: "",
      postProcessed: "",
      finalDelivered: "",
      safetyNotes: [],
    },
  };
}

export default function TraceDetailsPage() {
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();
  const params = useParams<{ id: string }>();
  const traceId = params?.id ?? "";
  const [traceData, setTraceData] = useState<TraceDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayProvider, setReplayProvider] = useState("same");
  const [replayModel, setReplayModel] = useState("");
  const [configuredProviders, setConfiguredProviders] = useState<Array<{ provider_type: string; display_name: string }>>([]);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [existingFlag, setExistingFlag] = useState<{ reason: string | null; flagged_by_email: string | null; flagged_at: string } | null>(null);
  const trace = traceData ?? createEmptyTrace(traceId || "trace");

  useEffect(() => {
    let cancelled = false;

    async function loadTrace() {
      if (!activeWorkspaceId || !traceId) {
        setTraceData(null);
        setLoadError(null);
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          `/api/traces/${encodeURIComponent(traceId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { cache: "no-store" },
        );

        if (response.status === 404) {
          if (!cancelled) {
            setTraceData(null);
            setLoadError("Trace not found in this workspace.");
          }
          return;
        }

        if (!response.ok) {
          const body = (await response.json().catch(() => ({ error: "Failed to load trace" }))) as { error?: string };
          throw new Error(body.error || `Failed to load trace (${response.status})`);
        }

        const payload = (await response.json()) as TraceDetailView;
        if (!cancelled) {
          setTraceData(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load trace");
          setTraceData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTrace();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, traceId]);

  const { rows, byParent } = useMemo(() => flattenSpans(trace.spans), [trace.spans]);
  const rootSpan = rows.find((r) => r.parentId === null) ?? rows[0];
  const [activeTab, setActiveTab] = useState("waterfall");
  const [selectedSpanId, setSelectedSpanId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "errors" | "slow" | "ai" | "infra">("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [spansSearch, setSpansSearch] = useState("");
  const [logsSearch, setLogsSearch] = useState("");
  const [logsSelectedOnly, setLogsSelectedOnly] = useState(false);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    overview: true,
    metadata: true,
    events: false,
    logs: true,
    payload: false,
    related: false,
  });

  const selectedSpan = useMemo(
    () => rows.find((r) => r.id === selectedSpanId) ?? rootSpan,
    [rows, rootSpan, selectedSpanId]
  );
  const SelectedIcon = selectedSpan ? TYPE_META[selectedSpan.type].icon : null;

  useEffect(() => {
    if (!rootSpan) return;
    setSelectedSpanId((current) => (current && rows.some((row) => row.id === current) ? current : rootSpan.id));
  }, [rootSpan, rows]);

  const visibleSet = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = new Set<string>();
    for (const row of rows) {
      const searchMatch = !q || row.name.toLowerCase().includes(q) || row.service.toLowerCase().includes(q);
      const filterMatch =
        filter === "all"
          ? true
          : filter === "errors"
          ? row.status !== "success"
          : filter === "slow"
          ? row.durationMs >= 120
          : filter === "ai"
          ? !!row.aiSpecific
          : !row.aiSpecific;
      if (searchMatch && filterMatch) matched.add(row.id);
    }
    if (!q && filter === "all") return new Set(rows.map((r) => r.id));

    const keep = new Set(matched);
    const idToParent = new Map(rows.map((r) => [r.id, r.parentId]));
    for (const id of matched) {
      let p = idToParent.get(id) ?? null;
      while (p) {
        keep.add(p);
        p = idToParent.get(p) ?? null;
      }
    }
    return keep;
  }, [rows, search, filter]);

  const waterfallRows = useMemo(() => {
    return rows.filter((row) => {
      if (!visibleSet.has(row.id)) return false;
      let p = row.parentId;
      while (p) {
        if (collapsed.has(p)) return false;
        p = rows.find((r) => r.id === p)?.parentId ?? null;
      }
      return true;
    });
  }, [collapsed, rows, visibleSet]);

  const spansRows = useMemo(() => {
    const q = spansSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.service.toLowerCase().includes(q) ||
        (row.model ?? "").toLowerCase().includes(q) ||
        (row.promptVersion ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, spansSearch]);

  const spanLogs = useMemo(() => trace.logs.filter((l) => l.spanId === selectedSpan?.id), [selectedSpan?.id, trace.logs]);
  const logsRows = useMemo(() => {
    const q = logsSearch.trim().toLowerCase();
    return trace.logs.filter((log) => {
      if (logsSelectedOnly && selectedSpan && log.spanId !== selectedSpan.id) return false;
      if (!q) return true;
      return (
        log.message.toLowerCase().includes(q) ||
        log.component.toLowerCase().includes(q) ||
        log.level.toLowerCase().includes(q)
      );
    });
  }, [logsSearch, logsSelectedOnly, selectedSpan, trace.logs]);

  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const replayTrace = async () => {
    if (!activeWorkspaceId || !trace.id || replayPending) return;

    setReplayPending(true);
    setReplayError(null);
    try {
      const response = await fetch(
        `/api/traces/${encodeURIComponent(trace.id)}/replay?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerOverride: replayProvider,
            modelOverride: replayModel.trim() || null,
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "Failed to replay trace" }))) as { error?: string };
        throw new Error(body.error || `Failed to replay trace (${response.status})`);
      }

      const payload = (await response.json()) as Partial<TraceReplayResponse>;
      if (!payload.traceId) {
        throw new Error("Replay completed, but no replay trace id was returned.");
      }

      router.push(
        `/traces/compare?left=${encodeURIComponent(trace.id)}&right=${encodeURIComponent(payload.traceId)}&org=${encodeURIComponent(activeWorkspaceId)}`,
      );
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : "Failed to replay trace");
    } finally {
      setReplayPending(false);
    }
  };

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetch(`/api/settings/providers?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setConfiguredProviders(
            (data as Array<{ provider_type?: string; display_name?: string; enabled?: boolean }>)
              .filter((p) => p.enabled !== false)
              .map((p) => ({ provider_type: p.provider_type ?? "", display_name: p.display_name ?? p.provider_type ?? "" })),
          );
        }
      })
      .catch(() => {/* silent */});
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId || !traceId) return;
    fetch(`/api/traces/${encodeURIComponent(traceId)}/flag?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then((data: unknown) => { if (data && typeof data === "object" && "flagged_at" in data) setExistingFlag(data as typeof existingFlag); })
      .catch(() => {/* silent — flag table may not exist yet */});
  }, [activeWorkspaceId, traceId]);

  const submitFlag = async () => {
    if (!activeWorkspaceId || !traceId || flagging) return;
    setFlagging(true); setFlagError(null);
    try {
      const res = await fetch(`/api/traces/${encodeURIComponent(traceId)}/flag?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: flagReason.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to flag trace");
      setExistingFlag(json as typeof existingFlag);
      setFlagOpen(false);
      setFlagReason("");
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : "Failed to flag trace");
    } finally {
      setFlagging(false);
    }
  };

  const resolveFlag = async () => {
    if (!activeWorkspaceId || !traceId) return;
    try {
      await fetch(`/api/traces/${encodeURIComponent(traceId)}/flag?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "DELETE" });
      setExistingFlag(null);
    } catch { /* silent */ }
  };

  const compareTrace = () => {
    if (!activeWorkspaceId || !trace.replayOf) return;
    router.push(
      `/traces/compare?left=${encodeURIComponent(trace.replayOf)}&right=${encodeURIComponent(trace.id)}&org=${encodeURIComponent(activeWorkspaceId)}`,
    );
  };

  if (!activeWorkspaceId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#050b16] via-[#050c17] to-[#030711] text-slate-100">
        <AppHeader title="Trace" subtitle={`Traces / ${traceId || "unknown"}`} />
        <div className="px-4 py-6 md:px-6 xl:px-8">
          <Card className="rounded-2xl border border-border bg-card">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Select a workspace to inspect trace details.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (loading && !traceData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#050b16] via-[#050c17] to-[#030711] text-slate-100">
        <AppHeader title="Trace" subtitle={`Traces / ${traceId || "unknown"}`} />
        <div className="px-4 py-6 md:px-6 xl:px-8">
          <Card className="rounded-2xl border border-border bg-card">
            <CardContent className="p-6 text-sm text-muted-foreground">Loading trace details…</CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (loadError && !traceData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#050b16] via-[#050c17] to-[#030711] text-slate-100">
        <AppHeader title="Trace" subtitle={`Traces / ${traceId || "unknown"}`} />
        <div className="px-4 py-6 md:px-6 xl:px-8">
          <Card className="rounded-2xl border border-red-500/30 bg-red-500/10">
            <CardContent className="p-6 text-sm text-red-100">{loadError}</CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050b16] via-[#050c17] to-[#030711] text-slate-100">
      <AppHeader
        title="Trace"
        subtitle={`Traces / ${trace.id}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 min-w-[190px] items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">
                    {replayProvider === "same"
                      ? "Same executor/provider"
                      : replayProvider === "enterprise_gateway"
                        ? "Enterprise gateway"
                        : configuredProviders.find((p) => p.provider_type === replayProvider)?.display_name ?? replayProvider}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuPanel className="min-w-[190px]">
                <DropdownMenuRadioGroup value={replayProvider} onValueChange={setReplayProvider}>
                  <DropdownMenuPanelRadioItem value="same">Same executor/provider</DropdownMenuPanelRadioItem>
                  <DropdownMenuPanelRadioItem value="enterprise_gateway">Enterprise gateway</DropdownMenuPanelRadioItem>
                  {configuredProviders.map((p) => (
                    <DropdownMenuPanelRadioItem key={p.provider_type} value={p.provider_type}>
                      {p.display_name}
                    </DropdownMenuPanelRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuPanel>
            </DropdownMenu>
            <Input
              value={replayModel}
              onChange={(event) => setReplayModel(event.target.value)}
              placeholder="Replay model override"
              className="h-9 w-40 border-border bg-card text-xs text-foreground"
            />
            <Button
              size="sm"
              variant="outline"
              className="border-border bg-card text-foreground"
              onClick={replayTrace}
              disabled={replayPending}
            >
              <Workflow className="mr-1 h-4 w-4" />
              {replayPending ? "Replaying..." : "Replay"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border bg-card text-foreground"
              onClick={compareTrace}
              disabled={!trace.replayOf}
              title={trace.replayOf ? "Compare this replay with its source trace" : "Replay this trace first to compare it"}
            >
              <GitBranch className="mr-1 h-4 w-4" />
              Compare
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border bg-card text-foreground"
              onClick={() => copy(JSON.stringify(trace, null, 2))}
            >
              <Download className="mr-1 h-4 w-4" />
              Export JSON
            </Button>
            <Button size="sm" variant="outline" className={`border-border bg-card ${existingFlag ? "text-amber-400" : "text-foreground"}`} onClick={() => setFlagOpen(v => !v)}>
              <Flag className="mr-1 h-4 w-4" />{existingFlag ? "Flagged" : "Mark issue"}
            </Button>
          </div>
        }
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {replayError ? (
          <Card className="rounded-2xl border border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-100">{replayError}</CardContent>
          </Card>
        ) : null}
        {existingFlag && (
          <Card className="rounded-2xl border border-amber-500/40 bg-amber-500/10">
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-amber-300">
                  <Flag className="mr-1 inline h-3.5 w-3.5" />
                  Flagged by {existingFlag.flagged_by_email ?? "unknown"} on {new Date(existingFlag.flagged_at).toLocaleString()}
                </p>
                {existingFlag.reason && <p className="text-xs text-amber-200/80">{existingFlag.reason}</p>}
              </div>
              <button type="button" onClick={() => void resolveFlag()} className="shrink-0 text-xs text-amber-300 hover:text-amber-100 underline">Resolve</button>
            </CardContent>
          </Card>
        )}
        {flagOpen && (
          <Card className="rounded-2xl border border-border bg-background">
            <CardHeader>
              <CardTitle className="text-sm text-foreground">Flag this trace as an issue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {flagError && <p className="text-sm text-red-300">{flagError}</p>}
              <textarea
                className="min-h-20 w-full rounded-lg border border-border bg-muted/80 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                placeholder="Describe the issue (optional)…"
                value={flagReason}
                onChange={e => setFlagReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void submitFlag()} disabled={flagging} className="gap-2">
                  {flagging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flag className="h-3.5 w-3.5" />}
                  Submit flag
                </Button>
                <Button size="sm" variant="outline" className="border-border bg-card text-foreground" onClick={() => setFlagOpen(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="rounded-2xl border border-border bg-card">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("border", STATUS_STYLE[trace.status])}>
                {trace.status === "success"
                  ? "Success"
                  : trace.status === "warning"
                    ? "Warning"
                    : trace.status === "partial"
                      ? "Partial"
                      : "Error"}
              </Badge>
              <Badge variant="outline" className="border-border text-muted-foreground">{trace.env}</Badge>
              <span className="text-xs text-muted-foreground">{new Date(trace.startedAt).toLocaleString()}</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
              <SummaryTile icon={Timer} label="Latency" value={formatDuration(trace.durationMs)} />
              <SummaryTile icon={Clock3} label="Cost" value={formatCost(trace.totalCostUsd)} />
              <SummaryTile icon={Braces} label="Tokens in/out" value={`${trace.tokensIn} / ${trace.tokensOut}`} />
              <SummaryTile icon={Bot} label="Model" value={trace.primaryModel} />
              <SummaryTile icon={Sparkles} label="Prompt" value={`${trace.promptName}@${trace.promptVersion}`} />
              <SummaryTile icon={Server} label="Sidecar" value={trace.sidecarName} />
              <SummaryTile
                icon={Workflow}
                label="Executor"
                value={trace.executorType === "enterprise_gateway" ? trace.executorName : trace.executorType}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              <SummaryStrip label="Latency" value={formatDuration(trace.durationMs)} />
              <SummaryStrip
                label="Cache"
                value={trace.cacheStatus === "unknown" ? "Unavailable" : trace.cacheStatus}
                tone={trace.cacheStatus === "hit" ? "good" : trace.cacheStatus === "miss" || trace.cacheStatus === "stale" ? "warn" : "neutral"}
              />
              <SummaryStrip label="Fallback" value={trace.fallbackUsed ? "Used" : "Not used"} tone={trace.fallbackUsed ? "warn" : "good"} />
              <SummaryStrip label="Guardrail" value={trace.guardrail === "passed" ? "Passed" : "Flagged"} tone={trace.guardrail === "passed" ? "good" : "warn"} />
              <SummaryStrip label="Eval score" value={trace.evalScore.toFixed(2)} tone={trace.evalScore >= 0.9 ? "good" : "warn"} />
              <SummaryStrip
                label="Observability"
                value={trace.executorObservability}
                tone={trace.executorObservability === "full" ? "good" : "warn"}
              />
            </div>
            {trace.replayOf ? (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                Replay of <span className="font-mono">{trace.replayOf}</span>
              </div>
            ) : null}
            {trace.replayOf && trace.executorType !== "enterprise_gateway" ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Simulated replay path: direct-provider replay uses captured output in this repository. Live replay is available through enterprise gateway execution.
              </div>
            ) : null}
            {replayProvider !== "same" ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Replay override selected: live execution requires a configured executor. Provider API keys are not stored by VectorBea unless a secure provider integration is explicitly configured.
              </div>
            ) : null}
            {trace.evaluation ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                Evaluation <span className="font-semibold">{trace.evaluation.label}</span>
                {typeof trace.evaluation.score === "number" ? (
                  <span className="ml-2 font-mono">{Math.round(trace.evaluation.score * 100)}%</span>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="rounded-2xl border border-border bg-card">
            <CardContent className="p-4">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-3 grid w-full grid-cols-3 bg-muted/40 p-1 md:grid-cols-6">
                  <TabsTrigger value="waterfall">TraceLoop</TabsTrigger>
                  <TabsTrigger value="spans">Spans</TabsTrigger>
                  <TabsTrigger value="prompt">Prompt</TabsTrigger>
                  <TabsTrigger value="inputs">Inputs</TabsTrigger>
                  <TabsTrigger value="output">Output</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>

                <TabsContent value="waterfall" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search span name/service"
                        className="h-9 w-[260px] border-border bg-background pl-8 text-foreground"
                      />
                    </div>
                    <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
                      <FilterChip active={filter === "all"} label="All spans" onClick={() => setFilter("all")} />
                      <FilterChip active={filter === "errors"} label="Errors only" onClick={() => setFilter("errors")} />
                      <FilterChip active={filter === "slow"} label="Slow spans" onClick={() => setFilter("slow")} />
                      <FilterChip active={filter === "ai"} label="AI only" onClick={() => setFilter("ai")} />
                      <FilterChip active={filter === "infra"} label="Infrastructure only" onClick={() => setFilter("infra")} />
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="grid grid-cols-[minmax(280px,42%)_1fr] border-b border-border bg-muted/50 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <span>Span / Service</span>
                      <span>Timeline</span>
                    </div>
                    <div className="max-h-[620px] overflow-y-auto">
                      {waterfallRows.map((row) => {
                        const meta = TYPE_META[row.type];
                        const Icon = meta.icon;
                        const hasChildren = (byParent.get(row.id) ?? []).length > 0;
                        const isCollapsed = collapsed.has(row.id);
                        const selected = selectedSpan?.id === row.id;

                        const leftPct = (row.startMs / trace.durationMs) * 100;
                        const widthPct = Math.max((row.durationMs / trace.durationMs) * 100, 0.8);

                        return (
                          <motion.button
                            key={row.id}
                            layout
                            className={cn(
                              "grid w-full grid-cols-[minmax(280px,42%)_1fr] items-center border-b border-border/70 px-3 py-2.5 text-left hover:bg-muted/40",
                              selected && "bg-muted/60"
                            )}
                            onClick={() => setSelectedSpanId(row.id)}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <div style={{ width: row.depth * 14 }} />
                              {hasChildren ? (
                                <span
                                  className="rounded p-0.5 hover:bg-muted"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCollapsed((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(row.id)) next.delete(row.id);
                                      else next.add(row.id);
                                      return next;
                                    });
                                  }}
                                >
                                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                </span>
                              ) : (
                                <span className="w-4" />
                              )}
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-sm">{row.name}</span>
                                  {row.criticalPath ? (
                                    <Badge variant="outline" className="h-5 border-border bg-muted/80 text-[10px] text-foreground">Critical path</Badge>
                                  ) : null}
                                  {row.branch === "fallback" ? (
                                    <Badge variant="outline" className="h-5 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-200">Fallback</Badge>
                                  ) : null}
                                </div>
                                <div className="text-xs text-muted-foreground">{row.service} · {formatDuration(row.durationMs)}</div>
                              </div>
                            </div>

                            <div className="relative h-7">
                              <span className="absolute top-1.5 h-4 rounded-sm bg-muted/80" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
                              <span className={cn("absolute top-1.5 h-4 rounded-sm opacity-90", spanBarTone(row, selected))} style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
                              {row.status !== "success" ? (
                                <span className="absolute right-0 top-1">
                                  {row.status === "warning" ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <XCircle className="h-4 w-4 text-red-300" />}
                                </span>
                              ) : null}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="spans" className="space-y-3">
                  <Input
                    value={spansSearch}
                    onChange={(e) => setSpansSearch(e.target.value)}
                    placeholder="Search spans"
                    className="h-9 max-w-[320px] border-border bg-background text-foreground"
                  />
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="grid grid-cols-[2fr_1fr_1.2fr_0.8fr_0.8fr_0.8fr_0.9fr_1.2fr] bg-muted/50 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <span>Span</span><span>Type</span><span>Service</span><span>Start</span><span>Duration</span><span>Status</span><span>Tokens</span><span>Prompt/Model</span>
                    </div>
                    <div className="max-h-[620px] overflow-y-auto">
                      {spansRows.map((row) => (
                        <button
                          key={row.id}
                          className={cn(
                            "grid w-full grid-cols-[2fr_1fr_1.2fr_0.8fr_0.8fr_0.8fr_0.9fr_1.2fr] items-center border-b border-border/70 px-3 py-2 text-left hover:bg-muted/40",
                            selectedSpan?.id === row.id && "bg-cyan-500/10"
                          )}
                          onClick={() => setSelectedSpanId(row.id)}
                        >
                          <span className="truncate text-sm">{row.name}</span>
                          <span className="text-xs text-muted-foreground">{TYPE_META[row.type].label}</span>
                          <span className="truncate text-xs text-muted-foreground">{row.service}</span>
                          <span className="text-xs text-muted-foreground">{row.startMs}ms</span>
                          <span className="text-xs">{formatDuration(row.durationMs)}</span>
                          <span><Badge className={cn("border", STATUS_STYLE[row.status])}>{row.status}</Badge></span>
                          <span className="text-xs">{(row.tokensIn ?? 0) + (row.tokensOut ?? 0)}</span>
                          <span className="truncate text-xs text-muted-foreground">{row.model ?? row.promptVersion ?? "—"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="prompt" className="grid gap-3 xl:grid-cols-[1fr_320px]">
                  <Card className="border-border bg-muted/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{trace.prompt.name}@{trace.prompt.version}</CardTitle>
                      <CardDescription>Rendered prompt and sections used for this execution</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <PromptBlock title="System" text={trace.prompt.system} />
                      <PromptBlock title="Developer" text={trace.prompt.developer} />
                      <PromptBlock title="User template" text={trace.prompt.userTemplate} />
                      <PromptBlock title="Rendered prompt" text={trace.prompt.renderedPrompt} />
                    </CardContent>
                  </Card>
                  <div className="space-y-3">
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Prompt metadata</CardTitle></CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <KV label="Source" value={trace.prompt.source} />
                        <KV label="Published by" value={trace.prompt.publishedBy} />
                        <KV label="Rollout %" value={`${trace.prompt.rolloutPercent}%`} />
                        <KV label="Release tag" value={trace.prompt.releaseTag} mono />
                        <KV label="Eval baseline" value={trace.prompt.evalBaseline.toFixed(2)} mono />
                      </CardContent>
                    </Card>
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Model parameters</CardTitle></CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <KV label="temperature" value={String(trace.prompt.params.temperature)} mono />
                        <KV label="top_p" value={String(trace.prompt.params.top_p)} mono />
                        <KV label="max_tokens" value={String(trace.prompt.params.max_tokens)} mono />
                        <Button size="sm" variant="outline" className="mt-2 border-border bg-card">Diff from previous version</Button>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="inputs" className="space-y-3">
                  <Card className="border-border bg-muted/30">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">User input</CardTitle></CardHeader>
                    <CardContent><pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm">{trace.inputs.userInput}</pre></CardContent>
                  </Card>
                  <div className="grid gap-3 xl:grid-cols-2">
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Variables</CardTitle></CardHeader>
                      <CardContent className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(trace.inputs.variables).map(([k, v]) => (
                          <div key={k} className="rounded-md border border-border bg-muted/40 p-2 text-xs">
                            <div className="text-muted-foreground">{k}</div>
                            <div className="mt-1">{v}</div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Runtime metadata</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        <KV label="Tenant" value={trace.inputs.tenant} mono />
                        <KV label="Workspace" value={trace.inputs.workspace} mono />
                        <KV label="Environment" value={trace.inputs.environment} />
                        <KV label="Cache key" value={trace.inputs.cacheKey} mono />
                        <KV label="Session" value={trace.inputs.sessionId} mono />
                        <KV label="Conversation" value={trace.inputs.conversationId} mono />
                      </CardContent>
                    </Card>
                  </div>
                  <Card className="border-border bg-muted/30">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Retrieval context</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {trace.inputs.contextDocs.map((doc) => (
                        <details key={doc.id} className="rounded-lg border border-border bg-muted/40 p-3">
                          <summary className="cursor-pointer list-none text-sm">
                            <div className="flex items-center justify-between">
                              <span>{doc.title}</span>
                              <Badge variant="outline" className="border-border text-muted-foreground">{doc.tokenCount} tokens</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">{doc.source}</div>
                          </summary>
                          <p className="mt-2 text-sm text-muted-foreground">{doc.content}</p>
                        </details>
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="output" className="space-y-3">
                  <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm">Output pipeline</CardTitle>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="border-border bg-card" onClick={() => copy(trace.outputs.finalDelivered)}><Copy className="mr-1 h-3.5 w-3.5" />Copy</Button>
                            <Button size="sm" variant="outline" className="border-border bg-card" onClick={() => setShowRawOutput((v) => !v)}><TerminalSquare className="mr-1 h-3.5 w-3.5" />{showRawOutput ? "Hide raw" : "View raw"}</Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <OutputBlock title="Post-processed output" text={trace.outputs.postProcessed} />
                        <OutputBlock title="Final delivered output" text={trace.outputs.finalDelivered} strong />
                        {showRawOutput ? <OutputBlock title="Raw model output" text={trace.outputs.rawPrimary} mono /> : null}
                      </CardContent>
                    </Card>
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        <KV label="Latency" value={formatDuration(trace.durationMs)} />
                        <KV label="Tokens in/out" value={`${trace.tokensIn}/${trace.tokensOut}`} mono />
                        <KV label="Cost" value={formatCost(trace.totalCostUsd)} mono />
                        {trace.outputs.safetyNotes.map((note, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-emerald-300" />
                            <span>{note}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                  {trace.outputs.rawFallback ? (
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Primary vs Fallback compare</CardTitle></CardHeader>
                      <CardContent className="grid gap-3 xl:grid-cols-2">
                        <OutputBlock title="Primary output" text={trace.outputs.rawPrimary} mono tone="warn" />
                        <OutputBlock title="Fallback output (used)" text={trace.outputs.rawFallback} mono tone="good" />
                      </CardContent>
                    </Card>
                  ) : null}
                  {trace.outputs.parsedJson ? (
                    <Card className="border-border bg-muted/30">
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Parsed JSON</CardTitle></CardHeader>
                      <CardContent>
                        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                          {JSON.stringify(trace.outputs.parsedJson, null, 2)}
                        </pre>
                      </CardContent>
                    </Card>
                  ) : null}
                </TabsContent>

                <TabsContent value="logs" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={logsSearch}
                      onChange={(e) => setLogsSearch(e.target.value)}
                      placeholder="Search logs"
                      className="h-9 max-w-[320px] border-border bg-background text-foreground"
                    />
                    <button
                      onClick={() => setLogsSelectedOnly((v) => !v)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-xs transition",
                        logsSelectedOnly ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200" : "border-border bg-card text-muted-foreground"
                      )}
                    >
                      Selected span only
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="grid grid-cols-[140px_80px_120px_1fr_120px] bg-muted/50 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <span>Timestamp</span><span>Level</span><span>Component</span><span>Message</span><span>Span</span>
                    </div>
                    <div className="max-h-[620px] overflow-y-auto">
                      {logsRows.map((log) => (
                        <div key={log.id} className="grid grid-cols-[140px_80px_120px_1fr_120px] items-center border-b border-border/70 px-3 py-2 text-xs">
                          <span className="font-mono text-muted-foreground">{new Date(new Date(trace.startedAt).getTime() + log.offsetMs).toLocaleTimeString()}</span>
                          <span className={cn("uppercase", LEVEL_STYLE[log.level])}>{log.level}</span>
                          <span className="text-muted-foreground">{log.component}</span>
                          <span className="text-muted-foreground">{log.message}</span>
                          <button onClick={() => log.spanId && setSelectedSpanId(log.spanId)} className="text-left text-cyan-300 hover:underline">
                            {log.spanId ?? "—"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card className="h-fit rounded-2xl border border-border bg-card xl:sticky xl:top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Span details</CardTitle>
              <CardDescription>{selectedSpan?.name ?? "Trace summary"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {selectedSpan ? (
                <>
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      {SelectedIcon ? <SelectedIcon className="h-4 w-4 text-muted-foreground" /> : null}
                      <span className="text-sm">{selectedSpan.name}</span>
                      <Badge className={cn("ml-auto border", STATUS_STYLE[selectedSpan.status])}>{selectedSpan.status}</Badge>
                    </div>
                    <div className="space-y-1 text-xs">
                      <KV label="Span ID" value={selectedSpan.id} mono />
                      <KV label="Parent" value={selectedSpan.parentId ?? "root"} mono />
                      <KV label="Start" value={`${selectedSpan.startMs}ms`} mono />
                      <KV label="Duration" value={formatDuration(selectedSpan.durationMs)} />
                      <KV label="Service" value={selectedSpan.service} />
                      <KV label="Type" value={TYPE_META[selectedSpan.type].label} />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 border-border bg-card text-xs" onClick={() => selectedSpan.parentId && setSelectedSpanId(selectedSpan.parentId)} disabled={!selectedSpan.parentId}>Jump to parent</Button>
                      <Button size="sm" variant="outline" className="h-7 border-border bg-card text-xs" onClick={() => setSelectedSpanId(rootSpan?.id ?? "")}>Jump to root</Button>
                    </div>
                  </div>

                  <Section title="Overview" open={openSections.overview} onToggle={() => toggleSection("overview")}>
                    <KV label="Provider" value={selectedSpan.provider ?? "—"} />
                    <KV label="Model" value={selectedSpan.model ?? "—"} />
                    <KV label="Prompt version" value={selectedSpan.promptVersion ?? trace.promptVersion} />
                    <KV label="Tokens in/out" value={`${selectedSpan.tokensIn ?? 0}/${selectedSpan.tokensOut ?? 0}`} mono />
                    <KV label="Cost" value={formatCost(selectedSpan.costUsd)} mono />
                    <KV label="Retries" value={String(selectedSpan.retries ?? 0)} mono />
                    <KV label="Cache" value={selectedSpan.cacheStatus ?? "—"} />
                    <KV label="Guardrail" value={selectedSpan.guardrailResult ?? "—"} />
                    <KV label="Linked logs" value={String(spanLogs.length)} mono />
                  </Section>

                  <Section title="Metadata" open={openSections.metadata} onToggle={() => toggleSection("metadata")}>
                    {selectedSpan.tags && Object.keys(selectedSpan.tags).length > 0 ? (
                      Object.entries(selectedSpan.tags).map(([k, v]) => <KV key={k} label={k} value={String(v)} mono={typeof v !== "boolean"} />)
                    ) : (
                      <div className="text-muted-foreground">No metadata for this span</div>
                    )}
                  </Section>

                  <Section title="Logs" open={openSections.logs} onToggle={() => toggleSection("logs")}>
                    {spanLogs.length ? (
                      spanLogs.map((log) => (
                        <div key={log.id} className="rounded-md border border-border bg-muted/40 p-2">
                          <div className={cn("uppercase", LEVEL_STYLE[log.level])}>{log.level}</div>
                          <div className="text-muted-foreground">{log.message}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-muted-foreground">No logs for this span</div>
                    )}
                  </Section>

                  <Section title="Payload preview" open={openSections.payload} onToggle={() => toggleSection("payload")}>
                    <div>
                      <div className="mb-1 text-muted-foreground">Input</div>
                      <pre className="max-h-28 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-muted-foreground">
                        {selectedSpan.inputPreview ?? "No input preview"}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-muted-foreground">Output</div>
                      <pre className="max-h-28 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-muted-foreground">
                        {selectedSpan.outputPreview ?? "No output preview"}
                      </pre>
                    </div>
                  </Section>

                  <Section title="Related spans" open={openSections.related} onToggle={() => toggleSection("related")}>
                    {(byParent.get(selectedSpan.id) ?? []).length ? (
                      (byParent.get(selectedSpan.id) ?? []).map((child) => (
                        <button key={child.id} className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-2 py-1.5 text-left hover:bg-muted" onClick={() => setSelectedSpanId(child.id)}>
                          <span>{child.name}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      ))
                    ) : (
                      <div className="text-muted-foreground">No child spans</div>
                    )}
                  </Section>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm">{value}</div>
      </div>
    </div>
  );
}

function SummaryStrip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "good"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : tone === "warn"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : "border-border bg-muted/40 text-foreground"
      )}
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{value}</div>
    </div>
  );
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <pre className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">{text}</pre>
    </div>
  );
}

function OutputBlock({
  title,
  text,
  strong = false,
  mono = false,
  tone = "neutral",
}: {
  title: string;
  text: string;
  strong?: boolean;
  mono?: boolean;
  tone?: "neutral" | "warn" | "good";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "warn"
          ? "border-amber-500/30 bg-amber-500/10"
          : tone === "good"
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-border bg-muted/40"
      )}
    >
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <pre className={cn("whitespace-pre-wrap text-sm text-foreground", strong && "font-medium", mono && "font-mono text-xs")}>{text}</pre>
    </div>
  );
}
