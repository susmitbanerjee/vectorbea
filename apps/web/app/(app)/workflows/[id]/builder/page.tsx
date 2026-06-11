"use client";

/**
 * /workflows/[id]/builder — Production-grade React Flow graph editor.
 *
 * Left   : NodePalette — drag-to-canvas node picker + quick templates
 * Center : React Flow canvas with custom nodes and edges
 * Right  : WorkflowInspector — per-node config or validation summary
 */

import "@xyflow/react/dist/style.css";
// ── Handle visibility + hover styles injected as global CSS ──────────────────
// Must be a module-level <style> to target React Flow's shadow DOM handles.
const HANDLE_CSS = `
  @keyframes wfDashFast { from { stroke-dashoffset: 18; } to { stroke-dashoffset: 0; } }
  /* Source handle (filled dot) — always visible */
  .vb-handle-source {
    cursor: crosshair !important;
  }
  /* Target handle (ring) — always visible */
  .vb-handle-target {
    cursor: crosshair !important;
  }
  /* Both handles grow + glow on hover so users know where to grab */
  .vb-handle:hover,
  .vb-handle.react-flow__handle-connecting {
    transform: scale(1.45) !important;
    box-shadow: 0 0 0 5px rgba(0,127,78,0.30) !important;
    border-color: #007F4E !important;
    background: #007F4E !important;
    z-index: 100;
  }
  /* Larger invisible hit area so handles are easy to click */
  .vb-handle::before {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: 50%;
  }
  /* Green ring when a connection is being drawn and user hovers valid target */
  .react-flow__handle.connectingfrom,
  .react-flow__handle.react-flow__handle-connecting {
    background: #00A65A !important;
    border-color: white !important;
    transform: scale(1.5) !important;
    box-shadow: 0 0 0 6px rgba(0,166,90,0.3) !important;
  }
  .react-flow__handle { transition: transform .15s cubic-bezier(.2,.7,.3,1), box-shadow .15s ease; }

  /* ── Premium controls dock ─────────────────────────────────────────────── */
  .react-flow__controls {
    border-radius: 10px !important;
    overflow: hidden;
    border: 1px solid #E0E3E6 !important;
    background: rgba(255,255,255,0.92) !important;
    backdrop-filter: blur(8px);
    box-shadow: 0 4px 16px rgba(11,13,15,0.08) !important;
    padding: 3px !important;
    gap: 2px;
  }
  .react-flow__controls-button {
    background: transparent !important;
    border: none !important;
    border-radius: 7px !important;
    width: 28px !important;
    height: 28px !important;
    color: #6B7280 !important;
    transition: background .12s ease, color .12s ease;
  }
  .react-flow__controls-button:hover {
    background: #E6F4EF !important;
    color: #007F4E !important;
  }
  .react-flow__controls-button svg { fill: currentColor; }

  /* ── Premium minimap ───────────────────────────────────────────────────── */
  .react-flow__minimap {
    border-radius: 10px !important;
    border: 1px solid #E0E3E6 !important;
    box-shadow: 0 4px 16px rgba(11,13,15,0.08) !important;
    overflow: hidden;
  }
  .react-flow__minimap-mask { fill: rgba(247,248,249,0.6) !important; }

  /* Hide React Flow attribution for a clean premium canvas */
  .react-flow__attribution { display: none !important; }

  /* Connection line being dragged — premium green */
  .react-flow__connectionline .react-flow__connection-path,
  .react-flow__connection-path {
    stroke: #00A65A !important;
    stroke-width: 2 !important;
    stroke-dasharray: 6 5;
    animation: wfDashFast 0.5s linear infinite;
  }
`;

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type OnConnect,
  BackgroundVariant,
  SelectionMode,
  ConnectionLineType,
  type ConnectionLineComponentProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Agent, Tool, Workflow } from "@/types/platform";
import type { WFNodeData, WFEdgeData, WFNodeType, WorkflowGraph } from "@/types/workflow-graph";
import { track } from "@/lib/telemetry/client";
import {
  getAgents,
  getTools,
  getWorkflow,
  saveWorkflowGraph,
  getWorkflowGraph,
  triggerWorkflow,
  updateWorkflow,
  getRun,
  getRunTimeline,
  startDebugRun,
  getDebugNodeSummaries,
  type DebugNodeSummary,
} from "@/lib/repository";
import { NodeInspectorDrawer } from "@/components/workflow-builder/NodeInspectorDrawer";
import { validateWorkflowGraph } from "@/lib/workflows/workflow-validation";
import { WORKFLOW_TEMPLATES } from "@/lib/workflows/workflow-templates";
import { NodePalette } from "@/components/workflow-builder/NodePalette";
import { AddNodeCommandMenu } from "@/components/workflow-builder/AddNodeCommandMenu";
import { WorkflowInspector } from "@/components/workflow-builder/WorkflowInspector";
import { WorkflowTemplatePicker } from "@/components/workflow-builder/WorkflowTemplatePicker";
import { nodeTypes } from "@/components/workflow-builder/nodes";
import { edgeTypes } from "@/components/workflow-builder/edges/WorkflowEdge";
import type { WorkflowTemplate } from "@/types/workflow-graph";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _nodeIdCounter = 1000;
function nextNodeId() {
  return `n${++_nodeIdCounter}`;
}
/**
 * After loading an existing graph, advance the counter past all existing
 * node IDs so new nodes never collide with existing ones.
 * Existing IDs are like "n1001", "n1002" — extract the numeric suffix.
 */
function syncNodeIdCounter(nodeIds: string[]) {
  for (const id of nodeIds) {
    // Guard: architect-generated node IDs can be non-numeric strings (trigger_auto, step_N etc.)
    if (typeof id !== "string") continue;
    const match = id.match(/^n(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= _nodeIdCounter) _nodeIdCounter = num;
    }
  }
}

/**
 * Hydrate architect-generated node data so the inspector picks up toolId/agentId.
 * The architect writes flat data.toolId / data.agentId.
 * The inspector reads data.toolConfig.toolId / data.agentConfig.agentId.
 * This function merges them so both the display layer and inspector work correctly.
 */
const EMAIL_LABELS = ["email", "send email", "mail", "notify", "notification", "resend"];
const isEmailNode = (label: string, toolType?: string) =>
  toolType === "builtin_email" || EMAIL_LABELS.some(k => label.toLowerCase().includes(k));

/**
 * Hydrate architect-generated node data so the inspector pre-populates correctly.
 *
 * The AI Architect compiler writes:
 *   data.toolId, data.agentId, data.toolType, data.generatedByArchitect  (flat)
 *
 * The WorkflowInspector reads:
 *   data.toolConfig.toolId, data.agentConfig.agentId  (nested config objects)
 *
 * This function merges them so a freshly-created architect workflow opens with
 * all tool/agent dropdowns pre-selected and email nodes pre-configured.
 */
function hydrateArchitectNode(data: WFNodeData): WFNodeData {
  if (!data.generatedByArchitect) return data;
  const d = { ...data };
  // Normalize label to always be a string — architect might produce non-string labels
  if (typeof d.label !== "string") d.label = String(d.label ?? "");
  const nodeType = d.nodeType ?? (d as Record<string, unknown>).type as string;

  // ── Tool node ────────────────────────────────────────────────────────────────
  if (nodeType === "tool") {
    const emailNode = isEmailNode(d.label, d.toolType);

    if (emailNode) {
      // Email: use built-in Resend. Promote architect inputMappings (real step IDs) into emailBody.
      const existingCfg = (d.toolConfig ?? {}) as Record<string, unknown>;
      // Architect plan writes inputMappings: {to, subject, body} with real {{steps.X.output.Y}}
      const planMappings = ((d as Record<string, unknown>).inputMappings ?? {}) as Record<string, string>;
      d.toolConfig = {
        ...existingCfg,
        toolType:     "builtin_email",
        builtinEmail: true,
        emailTo:      existingCfg.emailTo      ?? planMappings.to       ?? planMappings.recipient ?? "{{workflow.input.recipientEmail}}",
        emailSubject: existingCfg.emailSubject ?? planMappings.subject  ?? "Your automated report",
        // Use architect-generated body which contains real step IDs, not 'previous'
        emailBody:    existingCfg.emailBody    ?? planMappings.body     ?? planMappings.content   ?? planMappings.email_body ?? "",
      } as WFNodeData["toolConfig"];
    } else if (d.toolId) {
      // Regular tool: bind the real tool record
      d.toolConfig = {
        ...(d.toolConfig ?? {}),
        toolId:   d.toolId,
        toolName: d.label,
        // Preserve existing input/output mappings from architect plan
        inputMapping:  d.toolConfig?.inputMapping  ?? (d as Record<string, unknown>).inputMappings as Record<string, string> ?? {},
        outputMapping: d.toolConfig?.outputMapping ?? (d as Record<string, unknown>).outputMappings as Record<string, string> ?? {},
      };
    }
  }

  // ── Agent node ───────────────────────────────────────────────────────────────
  if (nodeType === "agent" && d.agentId) {
    d.agentConfig = {
      ...(d.agentConfig ?? {}),
      agentId:         d.agentId,
      agentName:       d.label,
      taskInstruction: d.description ?? d.agentConfig?.taskInstruction ?? "",
      // Preserve mappings
      inputMapping:  d.agentConfig?.inputMapping  ?? (d as Record<string, unknown>).inputMappings  as Record<string, string> ?? {},
      outputMapping: d.agentConfig?.outputMapping ?? (d as Record<string, unknown>).outputMappings as Record<string, string> ?? {},
    };
  }

  return d;
}

function graphToFlow(graph: WorkflowGraph): { nodes: Node<WFNodeData>[]; edges: Edge<WFEdgeData>[] } {
  const nodes: Node<WFNodeData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: hydrateArchitectNode(n.data),
  }));
  const edges: Edge<WFEdgeData>[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    type: "workflow",
    data: e.data,
  }));
  return { nodes, edges };
}

function flowToGraph(nodes: Node<WFNodeData>[], edges: Edge<WFEdgeData>[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as WFNodeType,
      position: n.position,
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      data: e.data ?? { edgeType: "default" },
    })),
    version: "1",
  };
}

function makeDefaultNode(type: WFNodeType, position: { x: number; y: number }): Node<WFNodeData> {
  const defaults: Record<WFNodeType, Partial<WFNodeData>> = {
    trigger:      { label: "Trigger",         nodeType: "trigger" },
    agent:        { label: "Agent Step",      nodeType: "agent" },
    llm:          { label: "LLM Call",        nodeType: "llm" },
    tool:         { label: "Tool Call",       nodeType: "tool" },
    http_tool:    { label: "HTTP Request",    nodeType: "http_tool" },
    graphql_tool: { label: "GraphQL Query",   nodeType: "graphql_tool" },
    db_read:      { label: "DB Read",         nodeType: "db_read" },
    db_write:     { label: "DB Write",        nodeType: "db_write" },
    mcp_tool:     { label: "MCP Tool",        nodeType: "mcp_tool" },
    grpc_tool:    { label: "gRPC Call",       nodeType: "grpc_tool" },
    transform:    { label: "Transform",       nodeType: "transform" },
    webhook_wait: { label: "Webhook Wait",    nodeType: "webhook_wait" },
    approval:     { label: "Approval Gate",   nodeType: "approval" },
    branch:       { label: "Branch",          nodeType: "branch" },
    parallel:     { label: "Parallel Fan-Out",nodeType: "parallel" },
    join:         { label: "Join / Merge",    nodeType: "join" },
    timer:        { label: "Timer / Sleep",   nodeType: "timer" },
    artifact:     { label: "Store Artifact",  nodeType: "artifact" },
    checkpoint:   { label: "Checkpoint",      nodeType: "checkpoint" },
    end:          { label: "End",             nodeType: "end" },
  };
  return {
    id: nextNodeId(),
    type,
    position,
    data: { ...(defaults[type] as WFNodeData), previewStatus: "idle" },
  };
}

// ─── Validation badge ─────────────────────────────────────────────────────────

function ValidationBadge({ issueCount, valid }: { issueCount: number; valid: boolean }) {
  if (valid) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Valid
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      {issueCount} issue{issueCount !== 1 ? "s" : ""}
    </span>
  );
}

// ─── Custom connection line (shown while dragging to connect nodes) ───────────

function ConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  // Smart path: straight when aligned, elbow otherwise — matches committed edge style
  const TOLERANCE = 10;
  const CORNER_R = 8;
  let d: string;

  if (Math.abs(fromY - toY) <= TOLERANCE) {
    // Horizontal straight
    d = `M ${fromX} ${fromY} L ${toX} ${toY}`;
  } else if (Math.abs(fromX - toX) <= TOLERANCE) {
    // Vertical straight
    d = `M ${fromX} ${fromY} L ${toX} ${toY}`;
  } else if (fromX < toX - 60 && Math.abs(fromY - toY) < 80) {
    // Horizontal elbow (source to the left)
    const midX = (fromX + toX) / 2;
    const dy = toY - fromY;
    const dirY = dy >= 0 ? 1 : -1;
    const r = Math.min(CORNER_R, Math.abs(midX - fromX) / 2, Math.abs(dy) / 2);
    d = r < 3
      ? `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`
      : [
          `M ${fromX} ${fromY}`,
          `L ${midX - r} ${fromY}`,
          `Q ${midX} ${fromY} ${midX} ${fromY + dirY * r}`,
          `L ${midX} ${toY - dirY * r}`,
          `Q ${midX} ${toY} ${midX + r} ${toY}`,
          `L ${toX} ${toY}`,
        ].join(" ");
  } else {
    // Vertical elbow (default Bottom→Top flow)
    const midY = (fromY + toY) / 2;
    const dx = toX - fromX;
    const dirX = dx >= 0 ? 1 : -1;
    const r = Math.min(CORNER_R, Math.abs(dx) / 2, Math.abs(midY - fromY));
    d = r < 3
      ? `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`
      : [
          `M ${fromX} ${fromY}`,
          `L ${fromX} ${midY - r}`,
          `Q ${fromX} ${midY} ${fromX + dirX * r} ${midY}`,
          `L ${toX - dirX * r} ${midY}`,
          `Q ${toX} ${midY} ${toX} ${midY + r}`,
          `L ${toX} ${toY}`,
        ].join(" ");
  }

  return (
    <g>
      {/* Ghost/preview connector while dragging */}
      <path
        d={d}
        fill="none"
        stroke="#3B82F6"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="5 4"
        style={{ filter: "drop-shadow(0 0 3px rgba(59,130,246,0.5))" }}
      />
      {/* Landing dot at target end */}
      <circle cx={toX} cy={toY} r={4} fill="#3B82F6" opacity={0.9} />
    </g>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// ── ReactFlowProvider wrapper ─────────────────────────────────────────────────
// useReactFlow() must be called INSIDE a ReactFlow provider.
// WorkflowBuilderInner renders <ReactFlow> AND calls useReactFlow(), so it
// needs a parent ReactFlowProvider to avoid Error #001.
export default function WorkflowBuilderPage() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner />
    </ReactFlowProvider>
  );
}

function WorkflowBuilderInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldAnimate = searchParams.get("animate") === "true";
  const architectSessionId = searchParams.get("architectSessionId");

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [animatingArchitect, setAnimatingArchitect] = useState(shouldAnimate);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [animationLabel, setAnimationLabel] = useState("Building your workflow…");
  // Track which node/edge IDs are currently revealed during architect animation
  const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string> | null>(
    shouldAnimate ? new Set() : null   // null = no animation mode (show all)
  );
  const [visibleEdgeIds, setVisibleEdgeIds] = useState<Set<string> | null>(
    shouldAnimate ? new Set() : null
  );
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // ── Live run mode ────────────────────────────────────────────────────────────
  const [activeRunId, setActiveRunId]     = useState<string | null>(null);
  const [liveRunStatus, setLiveRunStatus] = useState<string>("idle");
  const liveRunRef = useRef<NodeJS.Timeout | null>(null);

  // ── Debug Run mode (per-run, not persisted on the workflow) ─────────────────
  const [debugRunning, setDebugRunning]       = useState(false);
  const [debugRunActive, setDebugRunActive]   = useState(false);
  const [debugRunId, setDebugRunId]           = useState<string | null>(null);
  const [debugNodes, setDebugNodes]           = useState<Map<string, DebugNodeSummary>>(new Map());
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const debugRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!debugRunId) return;
    async function pollDebug() {
      try {
        const res = await getDebugNodeSummaries(debugRunId!);
        setDebugNodes(new Map(res.nodes.map((n) => [n.nodeId, n])));
      } catch { /* ignore transient errors */ }
    }
    void pollDebug();
    debugRef.current = setInterval(() => void pollDebug(), 2500);
    return () => { if (debugRef.current) clearInterval(debugRef.current); };
  }, [debugRunId]);

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const { screenToFlowPosition, fitView, setViewport } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WFNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<WFEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ── Run-with-input dialog ────────────────────────────────────────────────────
  const [runInputDialog, setRunInputDialog] = useState<{ mode: "run" | "debug"; schema: Record<string, unknown> } | null>(null);
  const [runInputValues, setRunInputValues] = useState<Record<string, string>>({});

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // ── Live run: poll events → update node previewStatus on canvas ─────────────
  useEffect(() => {
    if (!activeRunId) return;

    // Map run-event types → node previewStatus
    // Use `string` cast since worker emits types not in the frontend TimelineEventType union
    function applyEvents(events: import("@/types/agent-run-ui").RunTimelineEventUi[]) {
      const statusMap: Record<string, WFNodeData["previewStatus"]> = {};

      // Terminal statuses — once a node reaches these, don't downgrade back to "running"
      const TERMINAL: Set<WFNodeData["previewStatus"]> = new Set(["succeeded", "failed", "waiting", "skipped"]);

      for (const ev of events) {
        const sid = ev.stepId;
        if (!sid) continue;
        const t = ev.type as string;

        let newStatus: WFNodeData["previewStatus"] | undefined;
        if (["STEP_SCHEDULED"].includes(t))
          newStatus = "idle";
        else if (["STEP_STARTED","INPUT_MAPPING_STARTED","TOOL_CALL_STARTED",
                  "LLM_CALL_STARTED","AGENT_STARTED","DB_QUERY_STARTED",
                  "HTTP_REQUEST_STARTED","PARALLEL_STARTED","TRANSFORM_STARTED"].includes(t))
          newStatus = "running";
        else if (["STEP_COMPLETED","AGENT_COMPLETED","LLM_CALL_COMPLETED",
                  "TOOL_CALL_COMPLETED","DB_QUERY_COMPLETED","HTTP_REQUEST_COMPLETED",
                  "TRANSFORM_COMPLETED","JOIN_COMPLETED","HTTP_CALL_COMPLETED",
                  "PARALLEL_BRANCH_COMPLETED"].includes(t))
          newStatus = "succeeded";
        else if (["STEP_FAILED","AGENT_FAILED","TOOL_CALL_FAILED",
                  "NODE_TYPE_UNSUPPORTED","LLM_CALL_FAILED","HTTP_CALL_FAILED",
                  "INPUT_MAPPING_FAILED"].includes(t))
          newStatus = "failed";
        else if (["APPROVAL_REQUESTED"].includes(t))
          newStatus = "waiting";
        else if (["STEP_SKIPPED"].includes(t))
          newStatus = "skipped";

        if (newStatus) {
          // Never downgrade a terminal status back to "running" or "idle"
          // (events arrive ordered by sequence, but some "started" sub-events
          //  like LLM_CALL_STARTED may come AFTER STEP_COMPLETED due to
          //  concurrent branch event serialization)
          const current = statusMap[sid];
          if (!current || !TERMINAL.has(current) || TERMINAL.has(newStatus)) {
            statusMap[sid] = newStatus;
          }
        }
      }

      // Debug: log final status map to console (remove after confirming fix)
      if (Object.keys(statusMap).length > 0) {
        console.debug("[live-run] final statusMap:", statusMap);
      }

      setNodes((nds) =>
        nds.map((n) => {
          const newStatus = statusMap[n.id];
          if (!newStatus) return n;
          // Always create a new node object when statusMap has an entry —
          // the equality check was causing React to skip re-renders when the
          // computed status matched the previous status (both "succeeded"),
          // leaving some nodes stale at "running".
          return { ...n, data: { ...n.data, previewStatus: newStatus } };
        })
      );
    }

    async function pollOnce() {
      try {
        const [run, events] = await Promise.all([
          getRun(activeRunId!),
          getRunTimeline(activeRunId!),
        ]);
        if (run) setLiveRunStatus(run.status);
        applyEvents(events);
        // Stop polling when run reaches terminal state
        const terminal = ["succeeded", "failed", "cancelled", "timed_out"];
        if (run && terminal.includes(run.status)) {
          stopLiveRun(false); // keep status visible, just stop polling
        }
      } catch { /* ignore transient errors */ }
    }

    void pollOnce();
    liveRunRef.current = setInterval(() => void pollOnce(), 2500);
    return () => { if (liveRunRef.current) clearInterval(liveRunRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId]);

  function stopLiveRun(resetStatuses = true) {
    if (liveRunRef.current) clearInterval(liveRunRef.current);
    setActiveRunId(null);
    if (resetStatuses) {
      setLiveRunStatus("idle");
      setNodes((nds) =>
        nds.map((n) => ({ ...n, data: { ...n.data, previewStatus: "idle" as const } }))
      );
    }
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [wf, ag, tl] = await Promise.all([
        getWorkflow(id),
        getAgents(),
        getTools(),
      ]);
      setAgents(ag);
      setTools(tl);
      if (wf) {
        setWorkflow(wf);
        const savedGraph = await getWorkflowGraph(wf.id);
        if (savedGraph) {
          const { nodes: n, edges: e } = graphToFlow(savedGraph);
          // Sync counter so new nodes get IDs higher than any existing node
          syncNodeIdCounter(n.map(nd => nd.id));
          setNodes(n);
          setEdges(e);
        } else {
          // Brand-new workflow — show the template picker overlay
          setShowTemplatePicker(true);
        }
      }
      setLoading(false);
    }
    void load();
  }, [id, setNodes, setEdges]);

  // ── Architect animation — real node/edge reveal ──────────────────────────
  // When animate=true the canvas starts with ALL nodes hidden (visibleNodeIds=empty Set).
  // Animation steps progressively add IDs to visibleNodeIds / visibleEdgeIds so nodes
  // and edges appear one by one. Skipping sets both sets to null = show everything.
  // Replaying resets sets to empty and re-runs the sequence.
  // The full graph is already in React Flow state — we only filter what is rendered.
  useEffect(() => {
    if (!animatingArchitect) return;

    // Reduced-motion: skip animation entirely, show full graph immediately
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleNodeIds(null);
      setVisibleEdgeIds(null);
      setAnimationLabel("Workflow ready");
      setAnimationProgress(100);
      setTimeout(() => setAnimatingArchitect(false), 300);
      return;
    }

    // Reset visible sets so canvas starts empty
    setVisibleNodeIds(new Set());
    setVisibleEdgeIds(new Set());
    // Center the viewport to the graph area so animation is always visible
    setViewport({ x: 80, y: 80, zoom: 0.85 }, { duration: 300 });

    // Load server-provided steps from sessionStorage (written by architect page on workflow creation)
    let steps: Array<{ type: string; title: string; nodeId?: string; edgeId?: string; delayMs?: number; durationMs?: number }> = [];
    try {
      const stored = sessionStorage.getItem(`architect-anim-${id}`);
      if (stored) steps = JSON.parse(stored) as typeof steps;
    } catch { /* ignore */ }

    if (steps.length === 0) {
      // Fallback: build reveal steps from current nodes/edges with generic timing
      let delay = 300;
      steps = [{ type: "thinking", title: "Building your workflow…", delayMs: 0 }];
      for (const node of nodes) {
        steps.push({ type: "add_node", title: `Adding ${(node.data as { label?: string }).label ?? node.id}`, nodeId: node.id, delayMs: delay });
        delay += 380;
      }
      for (const edge of edges) {
        steps.push({ type: "add_edge", title: "Connecting…", edgeId: edge.id, delayMs: delay });
        delay += 270;
      }
      steps.push({ type: "complete", title: "Workflow ready!", delayMs: delay + 600 });
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((step, i) => {
      const delay = step.delayMs ?? step.durationMs ?? i * 400;
      timers.push(setTimeout(() => {
        setAnimationLabel(step.title);
        setAnimationProgress(Math.round(((i + 1) / steps.length) * 100));

        if (step.type === "add_node" && step.nodeId) {
          setVisibleNodeIds(prev => prev ? new Set([...prev, step.nodeId!]) : null);
          // Smooth fit after each new node so user tracks the build
          setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 50);
        }
        if (step.type === "add_edge" && step.edgeId) {
          setVisibleEdgeIds(prev => prev ? new Set([...prev, step.edgeId!]) : null);
        }
        if (step.type === "complete") {
          // Reveal any remaining nodes/edges (safety net)
          setVisibleNodeIds(null);
          setVisibleEdgeIds(null);
          setTimeout(() => {
            fitView({ padding: 0.2, duration: 600 });
            setTimeout(() => setAnimatingArchitect(false), 700);
          }, 200);
        }
      }, delay));
    });

    return () => timers.forEach(clearTimeout);
  }, [animatingArchitect, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When animation is skipped, reveal everything immediately
  function skipAnimation() {
    setVisibleNodeIds(null);
    setVisibleEdgeIds(null);
    setAnimatingArchitect(false);
  }

  // When replayed, reset and re-run
  function replayAnimation() {
    setAnimatingArchitect(false);
    setTimeout(() => setAnimatingArchitect(true), 50);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  const validation = validateWorkflowGraph(nodes as Node<WFNodeData>[], edges as Edge<WFEdgeData>[]);

  // ── Connect ─────────────────────────────────────────────────────────────────
  // Auto-assign meaningful edge types based on source node type so that branch
  // and approval nodes get the right conditional/approval edge labels without
  // the user needing to manually configure them.
  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodes.find((n) => n.id === params.source);
      const sourceType = sourceNode?.data.nodeType;

      // Count existing outgoing edges from this source to determine which slot to fill
      setEdges((eds) => {
        const existingOut = eds.filter((e) => e.source === params.source);

        let edgeType: WFEdgeData["edgeType"] = "default";

        if (sourceType === "branch") {
          const hasTrue  = existingOut.some((e) => e.data?.edgeType === "conditional_true");
          const hasFalse = existingOut.some((e) => e.data?.edgeType === "conditional_false");
          if (!hasTrue)       edgeType = "conditional_true";
          else if (!hasFalse) edgeType = "conditional_false";
          else                edgeType = "conditional_true"; // additional edge — default to true
        } else if (sourceType === "approval") {
          const hasApproved = existingOut.some((e) => e.data?.edgeType === "approval_approved");
          const hasRejected = existingOut.some((e) => e.data?.edgeType === "approval_rejected");
          if (!hasApproved)      edgeType = "approval_approved";
          else if (!hasRejected) edgeType = "approval_rejected";
          else                   edgeType = "approval_approved";
        } else if (sourceType === "parallel") {
          edgeType = "parallel_branch";
        }

        return addEdge(
          { ...params, type: "workflow", data: { edgeType } as WFEdgeData },
          eds,
        );
      });
      setUnsaved(true);

      // Smart prompt — nudge the user to auto-map the target node's inputs.
      const targetNode = nodes.find((n) => n.id === params.target);
      const tType = targetNode?.data?.nodeType;
      const HAS_INPUTS = new Set(["agent", "llm", "tool", "db_read", "db_write", "http_tool", "approval"]);
      if (targetNode && params.target && tType && HAS_INPUTS.has(tType)) {
        const tName = targetNode.data?.label || "this node";
        const sName = sourceNode?.data?.label || "the previous node";
        toast(`${sName} → ${tName} connected`, {
          description: "Auto-map its inputs from upstream — no expressions needed.",
          action: { label: "Map inputs", onClick: () => setSelectedNodeId(params.target as string) },
        });
      }
    },
    [nodes, setEdges],
  );

  // ── Drag-to-canvas ──────────────────────────────────────────────────────────
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // prevent existing nodes from consuming the event
    const type = e.dataTransfer.getData("application/reactflow-node") as WFNodeType;
    if (!type) return;

    // screenToFlowPosition accounts for pan, zoom, and any CSS transforms.
    // This is the correct way to map screen → canvas coordinates in React Flow v12.
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    const node = makeDefaultNode(type, position);
    setNodes((nds) => [...nds, node]);
    setSelectedNodeId(node.id);
    setUnsaved(true);
  }

  // ── ⌘K / Ctrl+K opens the Add command palette ───────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setAddMenuOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Node palette click-to-add ───────────────────────────────────────────────
  function handleAddNode(type: WFNodeType) {
    const offset = nodes.length * 30;
    const node = makeDefaultNode(type, { x: 200 + offset, y: 200 + offset });
    setNodes((nds) => [...nds, node]);
    setSelectedNodeId(node.id);
    setUnsaved(true);
  }

  // ── Apply template ──────────────────────────────────────────────────────────
  function handleApplyTemplate(template: WorkflowTemplate) {
    const { nodes: n, edges: e } = graphToFlow(template.graph);
    syncNodeIdCounter(n.map(nd => nd.id));
    setNodes(n);
    setEdges(e);
    setSelectedNodeId(null);
    setUnsaved(true);
    toast.success(`Template "${template.name}" applied`);
  }

  // ── Template picker selection ────────────────────────────────────────────────
  function handlePickerSelect(template: WorkflowTemplate) {
    setShowTemplatePicker(false);
    const { nodes: n, edges: e } = graphToFlow(template.graph);
    setNodes(n);
    setEdges(e);
    setSelectedNodeId(null);
    setUnsaved(true);
    if (template.id !== "blank") {
      toast.success(`Template "${template.name}" applied`);
    }
  }

  // ── Node selection ──────────────────────────────────────────────────────────
  function onNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedNodeId(node.id);
    if (debugRunActive) setInspectorNodeId(node.id);
  }

  function onPaneClick() {
    setSelectedNodeId(null);
    setInspectorNodeId(null);
  }

  // ── Trigger input schema discovery ──────────────────────────────────────────
  function getTriggerInputSchema(): Record<string, unknown> | null {
    const triggerNode = nodes.find((n) => (n.data as WFNodeData)?.nodeType === "trigger");
    const schema = (triggerNode?.data as WFNodeData | undefined)?.triggerConfig?.inputSchema;
    if (!schema || typeof schema !== "object") return null;
    const properties = (schema as Record<string, unknown>).properties;
    if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) return null;
    return schema as Record<string, unknown>;
  }

  function coerceRunInputValues(schema: Record<string, unknown>, raw: Record<string, string>): Record<string, unknown> {
    const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === "") continue;
      const type = properties[key]?.type;
      if (type === "number" || type === "integer") {
        const n = Number(value);
        result[key] = Number.isNaN(n) ? value : n;
      } else if (type === "boolean") {
        result[key] = value === "true";
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function openRunInputDialog(mode: "run" | "debug") {
    const schema = getTriggerInputSchema();
    if (!schema) {
      void (mode === "run" ? executeRun({}) : executeDebugRun({}));
      return;
    }
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    setRunInputValues(Object.fromEntries(Object.keys(properties).map((k) => [k, ""])));
    setRunInputDialog({ mode, schema });
  }

  function confirmRunInputDialog() {
    if (!runInputDialog) return;
    const input = coerceRunInputValues(runInputDialog.schema, runInputValues);
    const mode = runInputDialog.mode;
    setRunInputDialog(null);
    void (mode === "run" ? executeRun(input) : executeDebugRun(input));
  }

  // ── Debug Run — per-run, captures resolved inputs/outputs/variables ─────────
  function handleDebugRun() {
    openRunInputDialog("debug");
  }

  async function executeDebugRun(input: Record<string, unknown>) {
    if (!workflow) return;
    track("workflow_debug_run_queued", { workflowId: workflow.id, properties: { source: "builder" } });
    setDebugRunning(true);
    try {
      await doSave();
      const run = await startDebugRun(workflow.id, input);
      const runId = run.runId;
      if (!runId) {
        toast.error("Debug run triggered but run ID was not returned.");
        return;
      }
      setNodes((nds) =>
        nds.map((n) => ({ ...n, data: { ...n.data, previewStatus: "idle" as const } }))
      );
      setDebugNodes(new Map());
      setLiveRunStatus("queued");
      setActiveRunId(runId);
      setDebugRunId(runId);
      setDebugRunActive(true);
      toast.success("Debug Run started — click any node to inspect resolved variables.");
    } catch {
      toast.error("Failed to start debug run.");
    } finally {
      setDebugRunning(false);
    }
  }

  function stopDebugRun() {
    setDebugRunActive(false);
    setDebugRunId(null);
    setInspectorNodeId(null);
    if (debugRef.current) clearInterval(debugRef.current);
  }

  // ── Update / delete node from inspector ─────────────────────────────────────
  function handleUpdateNode(nodeId: string, data: WFNodeData) {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data } : n)),
    );
    setUnsaved(true);
  }

  function handleDeleteNode(nodeId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
    setUnsaved(true);
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function doSave(): Promise<void> {
    if (!workflow) return;
    const graph = flowToGraph(nodes as Node<WFNodeData>[], edges as Edge<WFEdgeData>[]);
    await Promise.all([
      saveWorkflowGraph(workflow.id, graph),
      updateWorkflow(workflow.id, {
        name: workflow.name,
        status: "active",
      }),
    ]);
    setUnsaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await doSave();
      toast.success("Workflow saved.");
    } catch {
      toast.error("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  // ── Test Run (preview simulation) ───────────────────────────────────────────
  async function handleTestRun() {
    setTestRunning(true);
    // Mark all nodes as idle first
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, previewStatus: "idle" as const } })),
    );

    await new Promise((r) => setTimeout(r, 300));

    // Topological-ish sweep: animate nodes in rough order
    const nodeList = [...nodes];
    for (let i = 0; i < nodeList.length; i++) {
      const n = nodeList[i]!;
      // Mark running
      setNodes((nds) =>
        nds.map((nd) =>
          nd.id === n.id ? { ...nd, data: { ...nd.data, previewStatus: "running" as const } } : nd,
        ),
      );
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));

      // Approval nodes pause as "waiting"
      const status =
        n.data.nodeType === "approval"
          ? ("waiting" as const)
          : Math.random() < 0.1 && n.data.nodeType === "agent"
          ? ("failed" as const)
          : ("succeeded" as const);

      setNodes((nds) =>
        nds.map((nd) =>
          nd.id === n.id ? { ...nd, data: { ...nd.data, previewStatus: status } } : nd,
        ),
      );
      if (status === "waiting") break; // stop at approval
    }

    setTestRunning(false);
    toast.success("Test run complete — check node statuses on canvas.");
  }

  // ── Run Workflow — stays on canvas, animates nodes live ─────────────────────
  function handleRun() {
    openRunInputDialog("run");
  }

  async function executeRun(input: Record<string, unknown>) {
    if (!workflow) return;
    track("workflow_run_queued", { workflowId: workflow.id, properties: { mode: "simulation", source: "builder" } });
    setRunning(true);
    try {
      await doSave();
      const run = await triggerWorkflow(workflow.id, input);
      const runId = run.runId;
      if (!runId) {
        toast.error("Workflow triggered but run ID was not returned.");
        return;
      }
      // Reset all nodes to idle, then start live polling
      setNodes((nds) =>
        nds.map((n) => ({ ...n, data: { ...n.data, previewStatus: "idle" as const } }))
      );
      setLiveRunStatus("queued");
      setActiveRunId(runId);
      toast.success("Workflow started — watch nodes animate live on the canvas.");
    } catch {
      toast.error("Failed to start workflow.");
    } finally {
      setRunning(false);
    }
  }

  // ── Selected node ────────────────────────────────────────────────────────────
  const selectedNode = selectedNodeId
    ? (nodes.find((n) => n.id === selectedNodeId) as Node<WFNodeData> | undefined) ?? null
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24">
        <p className="text-sm text-muted-foreground">Workflow not found</p>
        <Link href={"/workflows" as never} className="text-xs text-primary hover:underline">
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "#F7F8F9" }}>
      {/* ── Handle CSS injected once ─────────────────────────────────────────── */}
      <style dangerouslySetInnerHTML={{ __html: HANDLE_CSS }} />

      {/* ── AI Architect creation animation overlay ──────────────────────────── */}
      {animatingArchitect && (() => {
        // Read step titles from sessionStorage to render progress list
        let allSteps: Array<{ title: string; type: string }> = [];
        try {
          const stored = sessionStorage.getItem(`architect-anim-${id}`);
          if (stored) allSteps = (JSON.parse(stored) as Array<{ title: string; type: string }>)
            .filter(s => !["add_edge"].includes(s.type)); // show meaningful steps only
        } catch {}
        const completedCount = Math.floor((animationProgress / 100) * allSteps.length);
        const visibleSteps = allSteps.slice(0, Math.min(allSteps.length, 8)); // cap at 8 visible

        return (
          <>
            {/* Progress panel — bottom right */}
            <div className="absolute bottom-5 right-5 z-50 w-72 rounded-2xl border border-[#9CCFBB] bg-white/97 shadow-2xl backdrop-blur-sm overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-[#E6F4EF] flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#00A65A] animate-pulse shrink-0" />
                <span className="text-[12px] font-bold text-[#063] flex-1 truncate">{animationLabel}</span>
                <span className="text-[10.5px] text-[#007F4E] font-semibold shrink-0">{animationProgress}%</span>
              </div>
              {/* Progress bar */}
              <div className="px-4 pt-2.5">
                <div className="h-1.5 w-full rounded-full bg-[#E6F4EF] overflow-hidden">
                  <div className="h-full rounded-full bg-[#00A65A] transition-all duration-500"
                    style={{ width: `${animationProgress}%` }} />
                </div>
              </div>
              {/* Step list with checkmarks */}
              {visibleSteps.length > 0 && (
                <div className="px-4 py-2 space-y-1 max-h-40 overflow-y-auto">
                  {visibleSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {i < completedCount
                        ? <div className="h-4 w-4 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                            <svg className="h-2.5 w-2.5 text-green-600" fill="none" viewBox="0 0 12 12">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        : i === completedCount
                          ? <div className="h-4 w-4 rounded-full bg-[#E6F4EF] flex items-center justify-center shrink-0">
                              <div className="h-2 w-2 rounded-full bg-[#00A65A] animate-pulse" />
                            </div>
                          : <div className="h-4 w-4 rounded-full border border-slate-200 shrink-0" />
                      }
                      <span className={`text-[11px] truncate ${i < completedCount ? "text-green-700" : i === completedCount ? "text-[#006B45] font-medium" : "text-slate-400"}`}>
                        {step.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Actions */}
              <div className="px-4 pb-3 pt-1">
                <button type="button" onClick={skipAnimation}
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 py-1.5 text-[12px] font-medium text-stone-500 hover:bg-stone-100 transition-colors">
                  Skip animation
                </button>
              </div>
            </div>
            {/* Top-center status banner */}
            <div className="absolute top-3 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[#9CCFBB] bg-[#E6F4EF]/90 px-4 py-2 shadow-sm backdrop-blur-sm flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[#00A65A] animate-pulse shrink-0" />
              <span className="text-[12.5px] font-semibold text-[#006B45]">Vectorbea is building your workflow…</span>
            </div>
          </>
        );
      })()}
      {/* ── Topbar — floating island over the canvas ─────────────────────────── */}
      <div
        className="z-30 mx-3 mt-2 flex shrink-0 items-center gap-0 rounded-[12px] px-3"
        style={{
          minHeight: 46,
          background: "rgba(255,255,255,0.94)",
          border: "1px solid #E0E3E6",
          boxShadow: "0 8px 28px rgba(11,13,15,0.08), 0 1px 2px rgba(11,13,15,0.04)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Breadcrumb */}
        <Link
          href={`/workflows/${workflow.id}` as never}
          className="flex items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-[12px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F5] hover:text-[#0B0D0F]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">{workflow.name}</span>
        </Link>
        <span className="mx-2 text-[#C9CED4]">/</span>
        <span className="text-[12px] font-semibold text-[#0B0D0F]">Builder</span>

        {/* Version + saved state */}
        <div className="ml-3 flex items-center gap-1.5">
          <span className="rounded border border-[#E0E3E6] bg-[#F7F8F9] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            v1
          </span>
          {unsaved && (
            <span className="text-[10px] font-medium text-amber-600">● unsaved</span>
          )}
        </div>

        <div className="ml-auto flex items-center">
          {/* Validation badge */}
          <div className="mr-3">
            <ValidationBadge issueCount={validation.issues.length} valid={validation.valid} />
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-[#E0E3E6] mr-3" />

          {/* History link */}
          <Link
            href={`/workflows/${workflow.id}` as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F5] hover:text-[#0B0D0F]"
          >
            <Clock className="h-3 w-3" />
            History
          </Link>

          {/* Save + Test grouped */}
          {/* Replay animation button — only shown for architect-created workflows */}
          {architectSessionId && !animatingArchitect && (
            <button type="button"
              onClick={replayAnimation}
              className="flex items-center gap-1.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3 h-8 text-[11.5px] font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
              title="Replay build animation">
              <RefreshCw className="h-3 w-3" /> Replay
            </button>
          )}

          <div className="ml-1 flex items-center rounded-[9px] border border-[#E0E3E6] bg-white">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || running}
              className="inline-flex h-8 items-center gap-1.5 rounded-l-[9px] border-r border-[#E0E3E6] px-3 text-[12px] font-medium text-[#4B5563] transition-all hover:bg-[#F7F8F9] hover:text-[#0B0D0F] disabled:opacity-40"
            >
              {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => void handleTestRun()}
              disabled={testRunning || running}
              className="inline-flex h-8 items-center gap-1.5 rounded-r-[9px] px-3 text-[12px] font-medium text-[#4B5563] transition-all hover:bg-[#F7F8F9] hover:text-[#0B0D0F] disabled:opacity-40"
            >
              {testRunning ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3 text-amber-500" />
              )}
              Test
            </button>
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-[#E0E3E6] mx-3" />

          {/* Run / Live controls */}
          {activeRunId ? (
            <div className="flex items-center gap-2">
              {/* Live status pill */}
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                liveRunStatus === "running"   && "border-teal-200 bg-teal-50 text-teal-700",
                liveRunStatus === "queued"    && "border-slate-200 bg-slate-100 text-slate-600",
                liveRunStatus === "succeeded" && "border-emerald-200 bg-emerald-50 text-emerald-700",
                liveRunStatus === "failed"    && "border-red-200 bg-red-50 text-red-700",
                liveRunStatus === "waiting_for_approval" && "border-amber-200 bg-amber-50 text-amber-700",
              )}>
                {(liveRunStatus === "running" || liveRunStatus === "queued") && (
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                )}
                {liveRunStatus === "waiting_for_approval" && <ShieldCheck className="h-3 w-3" />}
                {liveRunStatus === "succeeded" && <CheckCircle2 className="h-3 w-3" />}
                {liveRunStatus.charAt(0).toUpperCase() + liveRunStatus.slice(1).replace(/_/g, " ")}
              </span>
              {/* View full run */}
              <a
                href={`/runs/${activeRunId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-slate-200 px-3 text-[12px] text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
              >
                Full run →
              </a>
              {/* Stop live view */}
              <button
                type="button"
                onClick={() => stopLiveRun(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-slate-200 px-3 text-[12px] text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
              >
                ✕ Stop
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={saving || running || debugRunning}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[#007F4E] px-4 text-[12px] font-semibold text-white transition-all hover:bg-[#006B45] disabled:opacity-40"
                style={{ boxShadow: "0 2px 8px rgba(0,127,78,0.28)" }}
              >
                {running ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-white" />
                )}
                Run
              </button>
              <button
                type="button"
                onClick={() => void handleDebugRun()}
                disabled={saving || running || debugRunning}
                title="Run with full variable resolution capture — per-run, doesn't change your workflow"
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-amber-200 bg-amber-50 px-4 text-[12px] font-semibold text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-40"
              >
                {debugRunning ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Bug className="h-3.5 w-3.5" />
                )}
                Debug Run
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Debug Run active banner */}
      {debugRunActive && (
        <div className="flex items-center justify-between gap-3 border-b px-6 py-2" style={{ borderColor: "#FDE68A", background: "#FFFBEB" }}>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "#FEF3C7" }}>
              <Bug className="h-3 w-3 text-amber-700" />
            </span>
            <p className="text-[12px] font-semibold text-amber-800">
              Debug Run Active · Click any node to inspect resolved variables
            </p>
          </div>
          <button
            type="button"
            onClick={stopDebugRun}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-200 px-2.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
          >
            <X className="h-3 w-3" /> Exit debug view
          </button>
        </div>
      )}

      {/* ── Three-column layout ─────────────────────────────────────────────── */}
      <div className="flex flex-1 gap-0 overflow-hidden pt-2">

        {/* Left: Node Palette — floating island */}
        <div
          className="z-20 mb-3 ml-3 w-[220px] shrink-0 overflow-hidden rounded-[12px]"
          style={{
            background: "#FFFFFF",
            border: "1px solid #E0E3E6",
            boxShadow: "0 8px 28px rgba(11,13,15,0.06)",
          }}
        >
          <NodePalette onAddNode={handleAddNode} onApplyTemplate={handleApplyTemplate} />
        </div>

        {/* Center: React Flow Canvas */}
        <div ref={reactFlowWrapper} className="relative flex-1 overflow-hidden" onDragOver={onDragOver} onDrop={onDrop}>
          {/* Template picker overlay */}
          {showTemplatePicker && (
            <div className="absolute inset-0 z-20 overflow-y-auto" style={{ background: "#F7F8F9" }}>
              <WorkflowTemplatePicker
                templates={WORKFLOW_TEMPLATES}
                workflowName={workflow.name}
                onSelect={handlePickerSelect}
              />
            </div>
          )}

          <ReactFlow
            nodes={visibleNodeIds !== null
              ? nodes.map(n => ({ ...n, hidden: !visibleNodeIds.has(n.id) }))
              : nodes}
            edges={visibleEdgeIds !== null
              ? edges.map(e => ({ ...e, hidden: !visibleEdgeIds.has(e.id) }))
              : edges}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              setUnsaved(true);
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              setUnsaved(true);
            }}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "workflow", data: { edgeType: "default" } }}
            connectionLineComponent={ConnectionLine}
            connectionLineType={ConnectionLineType.Straight}
            selectionMode={SelectionMode.Partial}
            snapToGrid
            snapGrid={[20, 20]}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            style={{ background: "#FAFAFA" }}
          >
            {/* Marketing-style fine dotted canvas (subtle, no large squares) */}
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1.1}
              color="#D2D6DB"
            />
            {/* Add button — top-right, opens the command palette (reference style) */}
            <Panel position="top-right">
              <button
                type="button"
                onClick={() => setAddMenuOpen(true)}
                className="group inline-flex h-9 items-center gap-2 rounded-[8px] border border-dashed border-[#C9CED4] bg-white/90 px-3 text-[12.5px] font-semibold text-[#0B0D0F] shadow-sm backdrop-blur-sm transition-colors hover:border-[#9CCFBB] hover:bg-[#E6F4EF]"
                title="Add to canvas  (⌘K)"
              >
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[#007F4E] text-white">
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                </span>
                Add
              </button>
            </Panel>

            <Controls
              className="!bottom-4 !left-4"
              showInteractive={false}
            />
            <MiniMap
              className="!bottom-4 !right-4 !h-28 !w-40 rounded-xl"
              style={{ border: "1px solid #E2E8F0", background: "#FFFFFF" }}
              nodeColor={(node) => {
                const colors: Record<string, string> = {
                  trigger: "#059669", agent: "#7C3AED", llm: "#9333EA",
                  tool: "#0891B2", approval: "#D97706", branch: "#2563EB",
                  parallel: "#0369A1", join: "#4F46E5", timer: "#D97706",
                  artifact: "#059669", checkpoint: "#2563EB", end: "#6B7280",
                };
                return colors[node.type ?? ""] ?? "#94A3B8";
              }}
              maskColor="rgba(248,250,252,0.7)"
            />

            {/* Empty state */}
            {nodes.length === 0 && (
              <Panel position="top-center">
                <div
                  className="mt-24 flex flex-col items-center gap-4 rounded-2xl px-10 py-10 text-center"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    boxShadow: "0 12px 32px rgba(15,23,42,0.06)",
                  }}
                >
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{ background: "#E6F4EF", border: "1px solid #9CCFBB" }}
                  >
                    <ShieldCheck className="h-7 w-7" style={{ color: "#007F4E" }} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[15px] font-semibold text-slate-800">Start building your workflow</p>
                    <p className="max-w-[280px] text-[12px] text-slate-500 leading-relaxed">
                      Add a trigger, agent, tool, approval, or database step to create a durable agentic automation.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono">Delete</span>
                    <span>to remove selected</span>
                    <span className="mx-1">·</span>
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono">Shift</span>
                    <span>to multi-select</span>
                  </div>
                </div>
              </Panel>
            )}
          </ReactFlow>

          {/* Add-node command palette (reference-style centered modal) */}
          <AddNodeCommandMenu
            open={addMenuOpen}
            onClose={() => setAddMenuOpen(false)}
            onAddNode={handleAddNode}
            templates={WORKFLOW_TEMPLATES}
            onApplyTemplate={handleApplyTemplate}
          />

          {debugRunActive && inspectorNodeId && debugRunId && (() => {
            const n = nodes.find((nd) => nd.id === inspectorNodeId);
            if (!n) return null;
            return (
              <NodeInspectorDrawer
                runId={debugRunId}
                nodeId={inspectorNodeId}
                nodeLabel={(n.data as WFNodeData)?.label ?? inspectorNodeId}
                nodeType={n.type ?? "node"}
                inputMapping={(n.data as WFNodeData)?.inputMappingJson}
                outputMapping={(n.data as WFNodeData)?.outputMappingJson}
                onClose={() => setInspectorNodeId(null)}
              />
            );
          })()}
        </div>

        {/* Right: Inspector — floating island; hidden while the debug Node
            Inspector drawer is open so the two panels don't sandwich the canvas */}
        <div className={cn(
          "z-20 shrink-0 overflow-hidden rounded-[12px] transition-all duration-150",
          inspectorNodeId ? "w-0 border-0" : "mb-3 mr-3 w-80",
        )} style={inspectorNodeId ? { background: "#FFFFFF" } : {
          background: "#FFFFFF",
          border: "1px solid #E0E3E6",
          boxShadow: "0 8px 28px rgba(11,13,15,0.06)",
        }}>
          <WorkflowInspector
            selectedNode={selectedNode}
            nodes={nodes as Node<WFNodeData>[]}
            edges={edges as Edge<WFEdgeData>[]}
            agents={agents}
            tools={tools}
            validation={validation}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
          />
        </div>
      </div>

      {/* Run-with-input dialog — collects values matching the trigger's input schema */}
      {runInputDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0D0F]/40 px-4">
          <div className="w-full max-w-md rounded-[14px] border border-[#E0E3E6] bg-white p-5 shadow-[0_24px_60px_rgba(11,13,15,0.18)]">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">
              {runInputDialog.mode === "debug" ? "Debug run" : "Run workflow"}
            </p>
            <h2 className="mt-0.5 text-[16px] font-bold tracking-[-0.01em] text-[#0B0D0F]">
              Provide trigger input
            </h2>
            <p className="mt-1 text-[12.5px] text-[#6B7280]">
              This workflow&apos;s trigger expects the following input values.
            </p>
            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
              {Object.entries((runInputDialog.schema.properties ?? {}) as Record<string, { type?: string; description?: string }>).map(([key, prop]) => {
                const required = ((runInputDialog.schema.required ?? []) as string[]).includes(key);
                return (
                  <div key={key}>
                    <label className="mb-1 block text-[12.5px] font-medium text-[#374151]">
                      {key}{required && <span className="ml-0.5 text-[#DC2626]">*</span>}
                      {prop.type && <span className="ml-1.5 font-mono text-[10px] font-normal text-[#9CA3AF]">({prop.type})</span>}
                    </label>
                    <input
                      value={runInputValues[key] ?? ""}
                      onChange={(e) => setRunInputValues((v) => ({ ...v, [key]: e.target.value }))}
                      placeholder={prop.description ?? ""}
                      className="h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[12.5px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRunInputDialog(null)}
                className="inline-flex h-9 items-center rounded-[8px] border border-[#E0E3E6] bg-white px-3.5 text-[12.5px] font-medium text-[#6B7280] transition-colors hover:bg-[#F7F8F9] hover:text-[#0B0D0F]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRunInputDialog}
                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#007F4E] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#006B45]"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                {runInputDialog.mode === "debug" ? "Start Debug Run" : "Run"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
