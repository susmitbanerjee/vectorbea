"use client";

/**
 * base.css, NOT style.css.
 *
 * `base.css` is the library's layout-only stylesheet: the viewport transform,
 * pointer handling, the positioning that makes a node land where the store says
 * it should. `style.css` adds the default theme on top — the white node boxes,
 * the blue handles, the grey controls — which is what every React Flow app
 * looks like and what the legacy builder imported and then fought with a wall
 * of `!important` hex overrides. Taking the layout without the theme is how
 * "nothing from the library's default styling survives" is achieved by not
 * loading it rather than by out-shouting it.
 */
import "@xyflow/react/dist/base.css";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  ReactFlow, MiniMap, useReactFlow, useStore,
  type Node, type Edge, type NodeChange, type OnSelectionChangeParams, type Connection,
} from "@xyflow/react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Kbd } from "~/components/ui/kbd";
import { LatticeBackground, AlignmentGuides } from "./lattice";
import { WorkflowNode, type WorkflowNodeData, type NodeRunState } from "./workflow-node";
import { WorkflowEdge, type WorkflowEdgeData } from "./workflow-edge";
import { snap, guidesFor, type Guide } from "./layout";
import { NODE_SIZE, pathThrough, type BuilderAction, type BuilderState } from "./store";
import { boundResource, nodeChrome, type BuilderNode } from "~/mocks/builder";
import type { Issue } from "./validation";

/* ══════════════════════════════════════════════════════════════════════════════
   THE CANVAS

   @xyflow/react v12 supplies the viewport transform, the connection gesture and
   the selection plumbing. Every pixel drawn is ours: `nodeTypes` and `edgeTypes`
   are fully custom, the background is our lattice, the controls are ours, and
   the library's stylesheet contributes nothing but layout primitives.

   COMPACT MODE IS DRIVEN BY A ZOOM BUCKET, not by the zoom itself. Passing the
   raw zoom into node data makes every node re-render on every wheel tick; the
   boolean only changes once, at the 60% threshold, so a zoom from 100% to 61%
   re-renders no nodes at all.
══════════════════════════════════════════════════════════════════════════════ */

const COMPACT_BELOW = 0.6;

const nodeTypes = { workflow: WorkflowNode };
const edgeTypes = { workflow: WorkflowEdge };

export interface CanvasProps {
  state: BuilderState;
  dispatch: React.Dispatch<BuilderAction>;
  issues: Issue[];
  /** Node states from a live or replayed run, keyed by node id. */
  runStates?: Record<string, NodeRunState>;
  /** Edge ids currently carrying flow. */
  flowingEdges?: Set<string>;
  presentation: boolean;
  onOpenIssues: (nodeId: string) => void;
  onOpenNode: (nodeId: string) => void;
  /** Called when a connection is dragged to empty canvas. */
  onConnectEnd?: (sourceId: string, at: { x: number; y: number }) => void;
}

/**
 * NO PROVIDER HERE. `BuilderView` owns the single `ReactFlowProvider`.
 *
 * Wrapping this component in its own provider created two stores: the canvas
 * registered against the inner one, while the shell's `useReactFlow` — fitView,
 * screenToFlowPosition, getNode — and the comment layer's `useStore` all read
 * the outer one, which had no canvas attached. Every viewport call silently
 * addressed an empty store, and the two stores updating each other through the
 * shared React tree looped until React gave up with "Maximum update depth
 * exceeded". One provider, one store.
 */
export function Canvas({
  state, dispatch, issues, runStates, flowingEdges, presentation,
  onOpenIssues, onOpenNode, onConnectEnd,
}: CanvasProps) {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const compact = zoom < COMPACT_BELOW;

  /* React Flow stamps a colour-mode class on its own root, and it defaults to
     `light`. Our light theme is selected by a BARE `.light` class, not by
     `:root.light` — so that default silently re-pointed every design token
     inside the canvas to the light palette, and the builder rendered a white
     canvas full of white nodes inside an otherwise dark application.
     Handing React Flow the app's resolved theme makes the class it writes agree
     with the one on <html> instead of overriding it. */
  const { resolvedTheme } = useTheme();
  const colorMode = resolvedTheme === "light" ? "light" : "dark";

  const [guides, setGuides] = React.useState<Guide[]>([]);
  const [hoverPath, setHoverPath] = React.useState<Set<string> | null>(null);
  const dragRef = React.useRef<Record<string, { x: number; y: number }>>({});

  /* ── Derived per-node facts ─────────────────────────────────────────────── */

  const issuesByNode = React.useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      const list = map.get(issue.nodeId) ?? [];
      list.push(issue);
      map.set(issue.nodeId, list);
    }
    return map;
  }, [issues]);

  const versionNodes = React.useMemo(() => state.nodes.map((n) => n.node), [state.nodes]);

  const nodes = React.useMemo<Node<WorkflowNodeData>[]>(() => {
    const disabled = new Set(state.disabled);
    const selected = new Set(state.selection);

    return state.nodes.map((n) => {
      const nodeIssues = issuesByNode.get(n.node.id) ?? [];
      const hasError = nodeIssues.some((i) => i.severity === "error");
      const runState = runStates?.[n.node.id];

      /* Run state wins over configuration state. During a run, "executing" is
         the answer to "what is this node doing"; whether it also has an unbound
         input is true but not what anybody is looking at. */
      const nodeState: NodeRunState =
        runState
        ?? (disabled.has(n.node.id) ? "disabled"
          : hasError ? "has-error"
            : nodeIssues.length > 0 ? "has-warning"
              : isConfigured(n) ? "configured" : "ready");

      return {
        id: n.node.id,
        type: "workflow",
        position: { x: n.x, y: n.y },
        selected: selected.has(n.node.id),
        data: {
          node: n.node,
          state: nodeState,
          resource: boundResource(n.node),
          chrome: nodeChrome(n.node, state.edges, versionNodes),
          issueCount: nodeIssues.length,
          compact,
          dimmed: hoverPath !== null && !hoverPath.has(n.node.id),
          emphasised: hoverPath?.has(n.node.id) ?? false,
          onOpenIssues,
        },
        /* Dimensions are MEASURED, not declared.
           Both `width`/`height` and `initialWidth`/`initialHeight` left
           `measured` unset for long enough that edge culling — which tests
           against `measured` — dropped every edge on the canvas while the nodes
           drew perfectly. Letting React Flow measure costs one layout pass at
           mount and is the only version where the edges exist. */
      };
    });
  }, [
    state.nodes, state.edges, state.selection, state.disabled,
    issuesByNode, runStates, compact, hoverPath, onOpenIssues, versionNodes,
  ]);

  const edges = React.useMemo<Edge<WorkflowEdgeData>[]>(() =>
    state.edges.map((e) => ({
      id: e.id,
      type: "workflow",
      source: e.source,
      target: e.target,
      /* `null`, not `undefined`, for the default handle.
         React Flow resolves an edge by looking up the handle its id names. Our
         default ports render without an id, which the library stores as `null`;
         an edge asking for `undefined` matches nothing, and an edge whose
         handle cannot be resolved is dropped SILENTLY — eleven edges in the
         store, none on the canvas, and no warning to say why. */
      sourceHandle: e.kind === "error" ? "error" : null,
      targetHandle: null,
      selected: state.selectedEdgeId === e.id,
      data: {
        kind: e.kind,
        label: e.label,
        flowing: flowingEdges?.has(e.id) ?? false,
        dimmed: hoverPath !== null && !(hoverPath.has(e.source) && hoverPath.has(e.target)),
        emphasised: hoverPath !== null && hoverPath.has(e.source) && hoverPath.has(e.target),
        onInsert: (edgeId: string) => dispatch({ type: "selectEdge", id: edgeId }),
      },
    })),
  [state.edges, state.selectedEdgeId, flowingEdges, hoverPath, dispatch]);

  /* ── Interaction ────────────────────────────────────────────────────────── */

  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    let dragging = false;
    let ended = false;

    for (const change of changes) {
      if (change.type !== "position" || !change.position) continue;
      // Snapped as it moves, so the node and the lattice never disagree.
      positions[change.id] = { x: snap(change.position.x), y: snap(change.position.y) };
      if (change.dragging) dragging = true;
      else ended = true;
    }

    if (Object.keys(positions).length === 0) return;

    if (dragging) {
      dragRef.current = positions;
      const movingId = Object.keys(positions)[0];
      const moving = state.nodes.find((n) => n.node.id === movingId);
      if (moving) {
        setGuides(guidesFor({ ...moving, ...positions[movingId] }, state.nodes));
      }
      dispatch({ type: "move", positions, commit: false });
      return;
    }

    if (ended) {
      setGuides([]);
      // The commit uses the last dragged positions: the final change event
      // carries no position, so committing from it would write undefined.
      dispatch({ type: "move", positions: { ...dragRef.current, ...positions }, commit: true });
    }
  }, [dispatch, state.nodes]);

  /* Selection flows ONE WAY: this store → React Flow, never back.
     Subscribing to React Flow's own selection and mirroring it into the reducer
     closed a loop — our `selected` flags rebuilt the nodes array, React Flow
     re-synced from it and fired the change callback again, and React aborted
     the tree with "Maximum update depth exceeded". Every selection gesture the
     canvas offers (click, marquee, shift-click) is handled explicitly below and
     dispatched here, so nothing is lost by not listening. */
  const selectionRef = React.useRef(state.selection);
  selectionRef.current = state.selection;

  const onSelectionChange = React.useCallback(({ nodes: picked }: OnSelectionChangeParams) => {
    const ids = picked.map((n) => n.id);
    const current = selectionRef.current;
    const same = ids.length === current.length && ids.every((id) => current.includes(id));
    // Only a marquee or shift-click reaches here with something new; a repeat of
    // what we already hold is React Flow echoing our own state back.
    if (!same) dispatch({ type: "select", ids });
  }, [dispatch]);

  const onConnect = React.useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    dispatch({
      type: "connect",
      source: connection.source,
      target: connection.target,
      kind: connection.sourceHandle === "error" ? "error" : undefined,
    });
  }, [dispatch]);

  /* Dragging a connection into empty canvas opens the node picker, filtered to
     what can legally follow the source. Dropping a connection on nothing and
     having nothing happen is the single most common dead end in n8n. */
  const handleConnectEnd = React.useCallback((
    event: MouseEvent | TouchEvent,
    connectionState: { isValid: boolean | null; fromNode?: { id: string } | null },
  ) => {
    if (connectionState.isValid || !connectionState.fromNode || !onConnectEnd) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const at = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    onConnectEnd(connectionState.fromNode.id, { x: snap(at.x), y: snap(at.y) });
  }, [flow, onConnectEnd]);

  return (
    <div className="relative size-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        onNodeMouseEnter={(_, node) => setHoverPath(pathThrough(node.id, state.edges))}
        onNodeMouseLeave={() => setHoverPath(null)}
        onNodeDoubleClick={(_, node) => onOpenNode(node.id)}
        onEdgeClick={(_, edge) => dispatch({ type: "selectEdge", id: edge.id })}
        onPaneClick={() => { dispatch({ type: "select", ids: [] }); }}
        /* Off-screen elements are not rendered at all — the 200-node budget.
           Without it every node reconciles on every pan frame whether or not it
           is anywhere near the viewport. */
        onlyRenderVisibleElements
        minZoom={0.2}
        maxZoom={2.5}
        snapToGrid
        snapGrid={[16, 16]}
        selectionOnDrag
        panOnDrag={[1, 2]}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        selectionKeyCode={null}
        nodesDraggable={!presentation}
        nodesConnectable={!presentation}
        elementsSelectable
        colorMode={colorMode}
        proOptions={{ hideAttribution: true }}
        fitView
        /* A FLOOR ON THE OPENING ZOOM, not just a ceiling.
           An eleven-node left-to-right graph is ~2,600px wide, and fitting all
           of it into a 900px pane lands at 24% — below the compact threshold
           and below the lattice fade, so the builder opened showing neither
           readable nodes nor its own background. Clamping the fit keeps the
           first frame legible and lets the reader pan to the rest, which is
           what every builder worth using does. */
        fitViewOptions={{ padding: 0.2, maxZoom: 1, minZoom: 0.68 }}
        className="size-full"
      >
        <LatticeBackground />
      </ReactFlow>

      <AlignmentGuides guides={guides} />

      {!presentation ? (
        <>
          <CanvasControls selectionCount={state.selection.length} />
          <MiniMap
            pannable
            zoomable
            ariaLabel="Workflow minimap"
            className={cn(
              "!bottom-3 !right-3 !m-0 overflow-hidden rounded-md",
              "!border-subtle !bg-surface-overlay/90 border",
            )}
            maskColor="var(--bg-canvas)"
            maskStrokeColor="var(--border-default)"
            nodeColor={(node) => {
              const data = node.data as WorkflowNodeData;
              // The minimap carries STATE, not type. Its whole job at a glance
              // is "where is the red one".
              switch (data.state) {
                case "failed":
                case "has-error": return "var(--status-failed)";
                case "gated":
                case "has-warning": return "var(--status-waiting)";
                case "executing": return "var(--status-live)";
                case "committed": return "var(--status-success)";
                case "disabled":
                case "skipped": return "var(--border-subtle)";
                default: return "var(--border-default)";
              }
            }}
            nodeStrokeWidth={0}
            style={{ width: 168, height: 108 }}
          />
        </>
      ) : null}

      {state.nodes.length === 0 ? <EmptyCanvas /> : null}
    </div>
  );
}

/** A node counts as configured once the fields its kind cannot run without are set. */
function isConfigured(n: BuilderNode): boolean {
  const c = n.node.config;
  switch (n.node.kind) {
    case "tool": return Boolean(c.tool);
    case "branch": return Boolean(c.condition);
    case "approval": return Boolean(c.approverGroup);
    case "parallel": return Boolean(c.over);
    case "output": return Boolean(c.destination);
    default: return true;
  }
}

/* ── Controls ─────────────────────────────────────────────────────────────── */

function CanvasControls({ selectionCount }: { selectionCount: number }) {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);

  return (
    <div
      role="group"
      aria-label="Canvas controls"
      className={cn(
        "border-subtle bg-surface-overlay/90 absolute bottom-3 left-3 flex items-center gap-0.5",
        "rounded-md border p-0.5 backdrop-blur-sm",
      )}
    >
      <ControlButton label="Zoom out" onClick={() => flow.zoomOut({ duration: 200 })}>
        <svg viewBox="0 0 12 12" className="size-3"><path d="M2.5 6h7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
      </ControlButton>

      <span className="font-code text-fg-muted w-11 text-center text-[10px] tabular">
        {Math.round(zoom * 100)}%
      </span>

      <ControlButton label="Zoom in" onClick={() => flow.zoomIn({ duration: 200 })}>
        <svg viewBox="0 0 12 12" className="size-3"><path d="M6 2.5v7M2.5 6h7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
      </ControlButton>

      <span className="bg-surface-active mx-0.5 h-4 w-px" />

      <ControlButton label="Fit to view" onClick={() => flow.fitView({ duration: 320, padding: 0.24 })}>
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
          <path d="M2 4.4V2h2.4M7.6 2H10v2.4M10 7.6V10H7.6M4.4 10H2V7.6" />
        </svg>
      </ControlButton>

      <ControlButton
        label={selectionCount > 0 ? `Zoom to ${selectionCount} selected` : "Select nodes to zoom to them"}
        disabled={selectionCount === 0}
        onClick={() => {
          const selected = flow.getNodes().filter((n) => n.selected);
          if (selected.length > 0) flow.fitView({ nodes: selected, duration: 320, padding: 0.4, maxZoom: 1.4 });
        }}
      >
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <rect x="2" y="2" width="8" height="8" rx="1" strokeDasharray="2 1.6" />
          <rect x="4.4" y="4.4" width="3.2" height="3.2" rx="0.6" fill="currentColor" stroke="none" />
        </svg>
      </ControlButton>
    </div>
  );
}

function ControlButton({
  label, onClick, disabled, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "text-fg-muted grid size-6 place-items-center rounded-xs",
        "hover:text-fg-primary hover:bg-surface-hover transition-colors duration-fast",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        "outline-none focus-visible:focus-ring",
      )}
    >
      {children}
    </button>
  );
}

function EmptyCanvas() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="max-w-[24rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">An empty graph</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Drag a step from the palette, or press <Kbd keys="⌘ K" /> to add one by name at the
          pointer. Every workflow starts with a trigger.
        </Text>
      </div>
    </div>
  );
}
