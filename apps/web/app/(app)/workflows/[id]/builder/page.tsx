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

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WFNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<WFEdgeData>>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

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

  // ── Run Workflow ─────────────────────────────────────────────────────────────
  async function handleRun() {
    if (!workflow) return;
    setRunning(true);
    try {
      await doSave();
      const run = await triggerWorkflow(workflow.id, {});
      const runId = run.runId;
      if (!runId) {
        toast.error("Workflow triggered but run ID was not returned. Check the runs list.");
        window.location.href = "/runs";
        return;
      }

      toast.success("Workflow started.");

      // Preserve the org/workspaceId query param so the run page can load immediately
      const orgParam =
        new URLSearchParams(window.location.search).get("org") ??
        new URLSearchParams(window.location.search).get("workspaceId") ??
        "";
      const runUrl = orgParam
        ? `/runs/${runId}?org=${encodeURIComponent(orgParam)}`
        : `/runs/${runId}`;

      // Fire execution in the background — client-side fire-and-forget.
      // The run page polls at 1.5 s intervals to show live progress.
      const executeUrl = `/api/platform/workflows/${workflow.id}/run/${runId}/execute${orgParam ? `?workspaceId=${encodeURIComponent(orgParam)}` : ""}`;
      void fetch(executeUrl, { method: "POST" });

      // Hard navigate — bypasses Next.js typed-route enforcement that can mangle dynamic segments
      window.location.href = runUrl;
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

          {/* Run */}
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
