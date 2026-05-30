"use client";

/**
 * /workflows/[id]/builder — Production-grade React Flow graph editor.
 *
 * Left   : NodePalette — drag-to-canvas node picker + quick templates
 * Center : React Flow canvas with custom nodes and edges
 * Right  : WorkflowInspector — per-node config or validation summary
 */

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
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
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Agent, Tool, Workflow } from "@/types/platform";
import type { WFNodeData, WFEdgeData, WFNodeType, WorkflowGraph } from "@/types/workflow-graph";
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
} from "@/lib/repository";
import { validateWorkflowGraph } from "@/lib/workflows/workflow-validation";
import { WORKFLOW_TEMPLATES } from "@/lib/workflows/workflow-templates";
import { NodePalette } from "@/components/workflow-builder/NodePalette";
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

function graphToFlow(graph: WorkflowGraph): { nodes: Node<WFNodeData>[]; edges: Edge<WFEdgeData>[] } {
  const nodes: Node<WFNodeData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
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
  // Bezier-style cubic approximation for the in-progress connection
  const midX = (fromX + toX) / 2;
  const d = `M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}`;
  return (
    <g>
      {/* Glowing solid line while dragging */}
      <path
        d={d}
        fill="none"
        stroke="rgba(99,179,237,0.9)"
        strokeWidth={2}
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 4px rgba(99,179,237,0.8))" }}
      />
      {/* Target dot */}
      <circle cx={toX} cy={toY} r={4} fill="rgba(99,179,237,0.9)" />
    </g>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [unsaved, setUnsaved] = useState(false);

  // ── Live run mode ────────────────────────────────────────────────────────────
  const [activeRunId, setActiveRunId]     = useState<string | null>(null);
  const [liveRunStatus, setLiveRunStatus] = useState<string>("idle");
  const liveRunRef = useRef<NodeJS.Timeout | null>(null);

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WFNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<WFEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
    const type = e.dataTransfer.getData("application/reactflow-node") as WFNodeType;
    if (!type || !reactFlowWrapper.current) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    // Get position relative to the wrapper — React Flow handles the pan/zoom transform
    const position = {
      x: e.clientX - bounds.left - 120,
      y: e.clientY - bounds.top - 40,
    };

    const node = makeDefaultNode(type, position);
    setNodes((nds) => [...nds, node]);
    setUnsaved(true);
  }

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
  }

  function onPaneClick() {
    setSelectedNodeId(null);
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
  async function handleRun() {
    if (!workflow) return;
    setRunning(true);
    try {
      await doSave();
      const run = await triggerWorkflow(workflow.id, {});
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
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "#F8FAFC" }}>
      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-0 px-4"
        style={{
          minHeight: 44,
          background: "rgba(255,255,255,0.92)",
          borderBottom: "1px solid #E2E8F0",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Breadcrumb */}
        <Link
          href={`/workflows/${workflow.id}` as never}
          className="flex items-center gap-1.5 text-[12px] text-slate-400 transition-colors hover:text-slate-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">{workflow.name}</span>
        </Link>
        <span className="mx-2 text-slate-300">/</span>
        <span className="text-[12px] font-semibold text-slate-700">Builder</span>

        {/* Version + saved state */}
        <div className="ml-3 flex items-center gap-1.5">
          <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-slate-400">
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
          <div className="h-5 w-px bg-slate-200 mr-3" />

          {/* History link */}
          <Link
            href={`/workflows/${workflow.id}` as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <Clock className="h-3 w-3" />
            History
          </Link>

          {/* Save + Test grouped */}
          <div className="ml-1 flex items-center rounded-[10px] border border-slate-200">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || running}
              className="inline-flex h-8 items-center gap-1.5 rounded-l-[10px] border-r border-slate-200 px-3 text-[12px] font-medium text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40"
            >
              {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => void handleTestRun()}
              disabled={testRunning || running}
              className="inline-flex h-8 items-center gap-1.5 rounded-r-[10px] px-3 text-[12px] font-medium text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-700 disabled:opacity-40"
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
          <div className="h-5 w-px bg-slate-200 mx-3" />

          {/* Run / Live controls */}
          {activeRunId ? (
            <div className="flex items-center gap-2">
              {/* Live status pill */}
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                liveRunStatus === "running"   && "border-blue-200 bg-blue-50 text-blue-700",
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
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={saving || running}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-[#2563EB] px-4 text-[12px] font-semibold text-white transition-all hover:bg-[#1D4ED8] disabled:opacity-40"
              style={{ boxShadow: "0 2px 8px rgba(37,99,235,0.28)" }}
            >
              {running ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-white" />
              )}
              Run
            </button>
          )}
        </div>
      </div>

      {/* ── Three-column layout ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Node Palette */}
        <div className="w-[220px] shrink-0 overflow-hidden" style={{ borderRight: "1px solid #E2E8F0", background: "#FFFFFF" }}>
          <NodePalette onAddNode={handleAddNode} onApplyTemplate={handleApplyTemplate} />
        </div>

        {/* Center: React Flow Canvas */}
        <div ref={reactFlowWrapper} className="relative flex-1 overflow-hidden" onDragOver={onDragOver} onDrop={onDrop}>
          {/* Template picker overlay */}
          {showTemplatePicker && (
            <div className="absolute inset-0 z-20 overflow-y-auto" style={{ background: "#F8FAFC" }}>
              <WorkflowTemplatePicker
                templates={WORKFLOW_TEMPLATES}
                workflowName={workflow.name}
                onSelect={handlePickerSelect}
              />
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
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
            connectionLineType={ConnectionLineType.Bezier}
            selectionMode={SelectionMode.Partial}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            style={{ background: "#f0f2f5" }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="rgba(100,116,139,0.28)"
            />
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
                    style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
                  >
                    <ShieldCheck className="h-7 w-7" style={{ color: "#2563EB" }} />
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
        </div>

        {/* Right: Inspector */}
        <div className="w-80 shrink-0 overflow-hidden" style={{ borderLeft: "1px solid #E2E8F0", background: "#FFFFFF" }}>
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
    </div>
  );
}
