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
      for (const ev of events) {
        const sid = ev.stepId;
        if (!sid) continue;
        const t = ev.type as string;
        if (["STEP_SCHEDULED"].includes(t))
          statusMap[sid] = "idle";
        else if (["STEP_STARTED","INPUT_MAPPING_STARTED","TOOL_CALL_STARTED",
                  "LLM_CALL_STARTED","AGENT_STARTED","DB_QUERY_STARTED",
                  "HTTP_REQUEST_STARTED","PARALLEL_STARTED","TRANSFORM_STARTED"].includes(t))
          statusMap[sid] = "running";
        else if (["STEP_COMPLETED","AGENT_COMPLETED","LLM_CALL_COMPLETED",
                  "TOOL_CALL_COMPLETED","DB_QUERY_COMPLETED","HTTP_REQUEST_COMPLETED",
                  "TRANSFORM_COMPLETED","JOIN_COMPLETED","HTTP_CALL_COMPLETED"].includes(t))
          statusMap[sid] = "succeeded";
        else if (["STEP_FAILED","AGENT_FAILED","TOOL_CALL_FAILED",
                  "NODE_TYPE_UNSUPPORTED","LLM_CALL_FAILED","HTTP_CALL_FAILED"].includes(t))
          statusMap[sid] = "failed";
        else if (["APPROVAL_REQUESTED"].includes(t))
          statusMap[sid] = "waiting";
        else if (["STEP_SKIPPED"].includes(t))
          statusMap[sid] = "skipped";
      }
      setNodes((nds) =>
        nds.map((n) => {
          const newStatus = statusMap[n.id];
          if (!newStatus || n.data.previewStatus === newStatus) return n;
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
  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "workflow",
            data: { edgeType: "default" } as WFEdgeData,
          },
          eds,
        ),
      );
      setUnsaved(true);
    },
    [setEdges],
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
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card/80 px-4 py-2 backdrop-blur">
        {/* Breadcrumb */}
        <Link
          href={`/workflows/${workflow.id}` as never}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {workflow.name}
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="text-[12px] font-semibold text-foreground">Builder</span>

        {unsaved && (
          <span className="ml-1 text-[10px] text-amber-600">● unsaved</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Validation badge */}
          <ValidationBadge issueCount={validation.issues.length} valid={validation.valid} />

          {/* History link */}
          <Link
            href={`/workflows/${workflow.id}` as never}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Clock className="h-3 w-3" />
            History
          </Link>

          {/* Save */}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || running}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>

          {/* Test Run */}
          <button
            type="button"
            onClick={() => void handleTestRun()}
            disabled={testRunning || running}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {testRunning ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Zap className="h-3 w-3" />
            )}
            Test
          </button>

          {/* Run / Live controls */}
          {activeRunId ? (
            <div className="flex items-center gap-2">
              {/* Live status pill */}
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                liveRunStatus === "running"  && "bg-blue-50 text-blue-700 border border-blue-200",
                liveRunStatus === "queued"   && "bg-slate-100 text-slate-600 border border-slate-200",
                liveRunStatus === "succeeded"&& "bg-emerald-50 text-emerald-700 border border-emerald-200",
                liveRunStatus === "failed"   && "bg-red-50 text-red-700 border border-red-200",
                liveRunStatus === "waiting_for_approval" && "bg-amber-50 text-amber-700 border border-amber-200",
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
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] text-muted-foreground hover:text-foreground"
              >
                Full run →
              </a>
              {/* Stop live view */}
              <button
                type="button"
                onClick={() => stopLiveRun(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-[12px] text-muted-foreground hover:text-foreground"
              >
                ✕ Stop
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={saving || running}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {running ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Run Workflow
            </button>
          )}
        </div>
      </div>

      {/* ── Three-column layout ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Node Palette */}
        <div className="w-56 shrink-0 overflow-hidden border-r border-border/40 bg-card/60">
          <NodePalette onAddNode={handleAddNode} onApplyTemplate={handleApplyTemplate} />
        </div>

        {/* Center: React Flow Canvas */}
        <div ref={reactFlowWrapper} className="relative flex-1 overflow-hidden" onDragOver={onDragOver} onDrop={onDrop}>
          {/* Template picker overlay */}
          {showTemplatePicker && (
            <div className="absolute inset-0 z-20 overflow-y-auto" style={{ background: "hsl(220,13%,7%)" }}>
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
            className="bg-[hsl(220,13%,7%)]"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="rgba(255,255,255,0.04)"
            />
            <Controls
              className="!bottom-4 !left-4"
              showInteractive={false}
            />
            <MiniMap
              className="!bottom-4 !right-4 !h-28 !w-40 rounded-xl border border-border/30 !bg-card/80"
              nodeColor={(node) => {
                const colors: Record<string, string> = {
                  trigger: "#34D399", agent: "#A78BFA", llm: "#C084FC",
                  tool: "#22D3EE", approval: "#FCD34D", branch: "#38BDF8",
                  parallel: "#67E8F9", join: "#818CF8", timer: "#FB923C",
                  artifact: "#4ADE80", checkpoint: "#60A5FA", end: "#94A3B8",
                };
                return colors[node.type ?? ""] ?? "#94A3B8";
              }}
              maskColor="rgba(0,0,0,0.4)"
            />

            {/* Empty state */}
            {nodes.length === 0 && (
              <Panel position="top-center">
                <div className="mt-20 flex flex-col items-center gap-3 rounded-2xl border border-border/40 bg-card/90 px-8 py-8 text-center shadow-2xl backdrop-blur">
                  <ShieldCheck className="h-10 w-10 text-muted-foreground/20" />
                  <p className="text-[14px] font-semibold text-foreground/70">Canvas is empty</p>
                  <p className="max-w-xs text-[12px] text-muted-foreground/50">
                    Drag nodes from the left palette, or click &quot;Quick Templates&quot; to load a pre-built workflow.
                  </p>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {/* Right: Inspector */}
        <div className="w-80 shrink-0 overflow-hidden border-l border-border/40 bg-card/60">
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
