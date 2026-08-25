"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import { Canvas } from "./canvas";
import { Palette, PALETTE, type QuickTemplate } from "./palette";
import { Inspector } from "./inspector";
import { NodeInspector, type NodeEdits } from "./inspector/node-inspector";
import { TopBar, type SaveState } from "./top-bar";
import { AlignToolbar } from "./align-toolbar";
import { SimulatePanel } from "./simulate-panel";
import { CommentLayer } from "./comments";
import { useBuilderStore, type BuilderAction, type BuilderState } from "./store";
import { useApi } from "~/lib/api/api-provider";
import { useScope } from "~/lib/workspace/workspace-provider";
import { validateGraph, summarise } from "./validation";
import { autoLayout, snap } from "./layout";
import { useKeyboardGraph } from "./keyboard-graph";
import { useWorkflowGraph, type WorkflowGraphData } from "./use-workflow-graph";
import { BuilderRegistryProvider, useBuilderRegistry } from "./use-builder-registry";
import type { BuilderGraph } from "~/lib/workflows/builder-graph";
import type { Binding } from "~/mocks/io-schema";
import { NODE_MARKS } from "~/components/icons/nodes";
import { PageContainer } from "~/components/ui/page";
import { ControlSkeleton } from "~/components/app/control/skeletons";
import type { NodeKind } from "~/lib/architect/blueprint";

/** All the builder needs to identify what it is editing. */
export interface BuilderWorkflow {
  id: string;
  name: string;
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE BUILDER

   Palette · canvas · inspector, with a top bar over all three. The canvas owns
   the viewport; this owns the graph, the history and every action that changes
   either.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * The builder, on a REAL workflow.
 *
 * The graph is loaded before the store is created rather than seeded and
 * patched afterwards. `useBuilderStore` takes its initial graph once — feeding
 * it a placeholder and dispatching `replaceGraph` on arrival would put the
 * empty canvas into the undo history as the first entry, so the user's first
 * undo would wipe the workflow.
 */
export function BuilderView({ workflowId }: { workflowId: string }) {
  const data = useWorkflowGraph(workflowId);

  if (data.loading) {
    return <PageContainer><ControlSkeleton /></PageContainer>;
  }

  if (data.error || !data.workflow) {
    return <BuilderLoadFailure workflowId={workflowId} message={data.error?.message} />;
  }

  const workflow: BuilderWorkflow = { id: data.workflow.id, name: data.workflow.name };

  return (
    <BuilderRegistryProvider>
    <ReactFlowProvider>
      {/* THE BLINK AND THE REVERTED EDITS.
          This used to be keyed on `data.version?.id`. Every autosave writes a
          NEW version (there is no PATCH — see use-workflow-graph.ts) and then
          invalidates the workflow queries, so the "current version" this page
          sees changes as a direct result of the user's own edit. Keying on it
          meant every autosave remounted `BuilderInner` from scratch: a fresh
          ReactFlowProvider, a fresh `useBuilderStore(graph)` seeded from
          whatever the refetch had landed — the canvas blinking empty and back,
          and a race where an edit made while an earlier save's refetch was
          still in flight got overwritten by that stale graph, reverting the
          node/edge the user had just changed.

          This route never opens a specific historical version — no `?version=`
          exists, `page.tsx` passes only `workflowId` — so the "different
          document" the original comment was guarding against is only ever a
          genuinely different WORKFLOW, which already gets a fresh `BuilderView`
          from the route change. Keying on the workflow id preserves that
          guarantee (undo never crosses workflows) without remounting on the
          app's own writes. */}
      <BuilderInner
        key={workflow.id}
        workflow={workflow}
        graph={data.graph ?? { nodes: [], edges: [] }}
        data={data}
      />
    </ReactFlowProvider>
    </BuilderRegistryProvider>
  );
}

function BuilderInner({
  workflow, graph, data,
}: {
  workflow: BuilderWorkflow;
  graph: BuilderGraph;
  data: WorkflowGraphData;
}) {
  const flow = useReactFlow();
  const api = useApi();
  const router = useRouter();
  const { workspaceId } = useScope();
  /* The run endpoints resolve the environment server-side from the workspace
     scope, the same way every other write on this screen does. */
  const scope = React.useMemo(
    () => ({ workspaceId, environmentId: null }),
    [workspaceId],
  );
  const [store, dispatch] = useBuilderStore(graph);
  const { state } = store;

  const [paletteCollapsed, setPaletteCollapsed] = React.useState(false);
  const [presentation, setPresentation] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [picker, setPicker] = React.useState<null | { at: { x: number; y: number }; connectFrom?: string }>(null);
  const [simulating, setSimulating] = React.useState(false);
  const [hoverIssueNode, setHoverIssueNode] = React.useState<string | null>(null);
  const shellRef = React.useRef<HTMLDivElement>(null);

  const saveState: SaveState = data.saveState;
  const lastSavedAt = data.lastSavedAt;
  const markDirty = data.markDirty;

  /* ── Validation, continuous ─────────────────────────────────────────────── */
  /* The registry is memoised by its provider and changes only when one of its
     queries resolves, so this does not re-validate on every drag frame. */
  const registry = useBuilderRegistry();
  const issues = React.useMemo(
    () => validateGraph(state.nodes, state.edges, state.disabled, registry),
    [state.nodes, state.edges, state.disabled, registry],
  );
  const summary = React.useMemo(() => summarise(issues), [issues]);

  /* Saving creates a new workflow version, so edits remain explicitly dirty
     until the user presses Save. This also keeps multiple quick graph edits in
     one version instead of autosaving a partial interaction. */
  React.useEffect(() => {
    if (!state.dirty) return;
    markDirty();
  }, [state.dirty, markDirty]);

  /* ── Starting a run ─────────────────────────────────────────────────────── */

  /**
   * TEST, RUN AND DEBUG RUN WERE `console.info` CALLS.
   *
   * All three rendered as enabled buttons, and all three did nothing at all:
   * no request, no error, no feedback. The endpoints behind them existed the
   * whole time.
   *
   *   Test       POST /api/workflows/:id/run   mode "simulation"
   *   Run        POST /api/workflows/:id/run   mode "real"
   *   Debug run  POST /api/workflows/:id/runs/debug
   *
   * THE SAVE IS PART OF THE ACTION, NOT A PRECONDITION THE USER MUST REMEMBER.
   * The API runs `workflow.currentVersionId` — the last version WRITTEN — so
   * triggering with unsaved edits on the canvas silently runs the previous
   * graph. That is the worst possible failure here: it succeeds, and it
   * executes something other than what is on screen. So a dirty canvas is
   * saved first and the run is abandoned if that save fails.
   *
   * EVERY REFUSAL IS SHOWN. The API turns several conditions away by design —
   * no published version, real execution disabled for the workspace, the daily
   * run limit, the queue being down — and each one arrives as a sentence worth
   * reading. They are surfaced verbatim rather than flattened into "failed".
   */
  const [triggering, setTriggering] = React.useState<null | "test" | "run" | "debug">(null);

  const trigger = React.useCallback(async (
    kind: "test" | "run" | "debug",
    start: () => Promise<{ runId: string }>,
    started: string,
  ) => {
    if (triggering) return;
    setTriggering(kind);
    try {
      // Save first, so the run executes the graph the user is looking at.
      if (graphRef.current.dirty) {
        const saved = await data.save({
          nodes: graphRef.current.nodes,
          edges: graphRef.current.edges,
        });
        if (!saved) {
          toast.error(data.saveError ?? "The version could not be saved, so the run was not started.");
          return;
        }
        dispatch({ type: "markSaved" });
      }

      const { runId } = await start();
      toast.success(started);
      router.push(`/runs/${runId}` as Route);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The run could not be started. Check the connection to the API and try again.",
      );
    } finally {
      setTriggering(null);
    }
    // `data` is rebuilt each render; the two fields used are read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggering, data.save, data.saveError, dispatch, router]);

  const handleTest = React.useCallback(() => {
    void trigger(
      "test",
      () => api.workflows.run(workflow.id, { mode: "simulation" }, scope),
      "Test run started. Nothing external was called.",
    );
  }, [trigger, api, workflow.id, scope]);

  const handleRun = React.useCallback(() => {
    void trigger(
      "run",
      () => api.workflows.run(workflow.id, { mode: "real" }, scope),
      "Run started against live connections.",
    );
  }, [trigger, api, workflow.id, scope]);

  const handleDebugRun = React.useCallback(() => {
    void trigger(
      "debug",
      () => api.workflows.startDebugRun(workflow.id, {}, scope),
      "Debug run started. Every node's payloads are being captured.",
    );
  }, [trigger, api, workflow.id, scope]);

  /* ── Viewport helpers ───────────────────────────────────────────────────── */
  /**
   * MUST NOT DEPEND ON `state.nodes`.
   *
   * A drag replaces `state.nodes` on every pointer frame. While this closed
   * over it, `reveal` was a new function every frame, so `handleOpenIssues` was
   * too, so `data.onOpenIssues` on every node object changed — and React Flow
   * only reuses a node's measured size when it is handed the identical object.
   * Every node was therefore rebuilt, unmeasured, and re-measured sixty times a
   * second, which is what made a fast drag blink. See the note on the `nodes`
   * memo in canvas.tsx.
   *
   * The lookup it needed `state.nodes` for was redundant anyway: `flow.getNode`
   * on the next line answers the same question, from the store that actually
   * decides whether the node can be revealed.
   */
  const reveal = React.useCallback((nodeId: string) => {
    // Only recentre when the node is actually off-screen. Recentring on every
    // Tab makes the canvas lurch under a reader who can already see the node.
    const rendered = flow.getNode(nodeId);
    if (!rendered) return;
    flow.fitView({ nodes: [rendered], duration: 220, padding: 1.6, maxZoom: 1.2, minZoom: 0.5 });
  }, [flow]);

  const centreOfViewport = React.useCallback(() => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const at = flow.screenToFlowPosition({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    return { x: snap(at.x), y: snap(at.y) };
  }, [flow]);

  /* ── Actions ────────────────────────────────────────────────────────────── */
  const addNode = React.useCallback((kind: NodeKind, label?: string, at?: { x: number; y: number }, connectFrom?: string) => {
    const position = at ?? centreOfViewport();
    dispatch({ type: "addNode", kind, x: position.x, y: position.y, connectFrom, name: label });
  }, [dispatch, centreOfViewport]);

  const onAddDownstream = React.useCallback((sourceId: string) => {
    const source = state.nodes.find((n) => n.node.id === sourceId);
    if (!source) return;
    setPicker({ at: { x: source.x + 260, y: source.y }, connectFrom: sourceId });
  }, [state.nodes]);

  /* These three are passed INTO node data, so their identity becomes part of
     every node object. As inline arrows they made the nodes array new on every
     render; React Flow re-synced its store from it, that fired a change
     callback, this re-rendered — "Maximum update depth exceeded", a dead
     keyboard and a canvas with no edges. Stable identities are load-bearing
     here, not a micro-optimisation. */
  const handleOpenIssues = React.useCallback((nodeId: string) => {
    dispatch({ type: "select", ids: [nodeId] });
    reveal(nodeId);
  }, [dispatch, reveal]);

  const handleOpenNode = React.useCallback((nodeId: string) => {
    dispatch({ type: "select", ids: [nodeId] });
  }, [dispatch]);

  const handleConnectEnd = React.useCallback((sourceId: string, at: { x: number; y: number }) => {
    setPicker({ at, connectFrom: sourceId });
  }, []);

  const applyTemplate = React.useCallback((template: QuickTemplate) => {
    const base = centreOfViewport();
    let previous: string | undefined;
    template.kinds.forEach((kind, i) => {
      const id = `n-new-${kind}`;
      dispatch({ type: "addNode", kind, x: base.x + i * 260, y: base.y, connectFrom: previous });
      previous = id;
    });
  }, [dispatch, centreOfViewport]);

  const runAutoLayout = React.useCallback(() => {
    dispatch({ type: "replaceGraph", graph: autoLayout(state.nodes, state.edges), label: "Auto-layout" });
    // The spring settle is the viewport's, not the nodes' — animating 200 node
    // positions individually is 200 concurrent transitions and drops frames.
    window.setTimeout(() => flow.fitView({ duration: 420, padding: 0.24 }), 20);
  }, [dispatch, state.nodes, state.edges, flow]);

  /* ── Clipboard ──────────────────────────────────────────────────────────── */
  const clipboard = React.useRef<{ nodes: BuilderState["nodes"]; edges: BuilderState["edges"] } | null>(null);

  React.useEffect(() => {
    const onCopy = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;

      if (event.key.toLowerCase() === "c" && !event.shiftKey && state.selection.length > 0) {
        const picked = state.nodes.filter((n) => state.selection.includes(n.node.id));
        const inner = state.edges.filter(
          (e) => state.selection.includes(e.source) && state.selection.includes(e.target),
        );
        clipboard.current = { nodes: picked, edges: inner };
      }

      if (event.key.toLowerCase() === "v" && !event.shiftKey && clipboard.current) {
        event.preventDefault();
        dispatch({
          type: "paste",
          nodes: clipboard.current.nodes.map((n) => n.node),
          edges: clipboard.current.edges,
          at: centreOfViewport(),
        });
      }

      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPicker({ at: centreOfViewport() });
      }
    };

    window.addEventListener("keydown", onCopy);
    return () => window.removeEventListener("keydown", onCopy);
  }, [state, dispatch, centreOfViewport]);

  /* Escape leaves presentation mode. Presentation hides every exit except the
     pill, so the key has to work even when nothing is focused. */
  React.useEffect(() => {
    if (!presentation) return;
    const onEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setPresentation(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [presentation]);

  useKeyboardGraph({
    state,
    dispatch,
    reveal,
    onOpenNode: handleOpenNode,
    onAddDownstream,
    enabled: !picker && !simulating,
  });

  const toggleFullscreen = React.useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    } else {
      el.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {});
    }
  }, []);

  const selectedNodeName = state.selection.length === 1
    ? state.nodes.find((n) => n.node.id === state.selection[0])?.node.name ?? null
    : null;

  /* One node selected opens the node inspector; anything else keeps the graph
     inspector. Two selected nodes have no single configuration, and showing one
     of them arbitrarily is how people edit the wrong node. */
  const selectedNode = state.selection.length === 1
    ? state.nodes.find((n) => n.node.id === state.selection[0])?.node ?? null
    : null;

  /* Bindings live beside the graph rather than inside each node's config: they
     are edges in the data flow, and the reverse index on the Output tab has to
     read every node's bindings at once to answer "who consumes this field". */
  const [bindingsByNode, setBindingsByNode] = React.useState<Record<string, Binding[]>>({});

  /* Reads the graph through a ref so its identity never changes.
     As a callback depending on `state.nodes`, every commit rebuilt it, which
     re-fired the panel's autosave effect, which committed again. */
  const graphRef = React.useRef(state);
  graphRef.current = state;

  const commitNodeEdits = React.useCallback((nodeId: string, edits: NodeEdits) => {
    // Only write bindings that actually changed — an unconditional setState
    // here produces a new object every commit and re-seeds the open panel.
    setBindingsByNode((prev) => {
      const before = prev[nodeId];
      const same = before !== undefined
        && before.length === edits.bindings.length
        && before.every((b, i) =>
          b.inputId === edits.bindings[i].inputId
          && b.expression === edits.bindings[i].expression
          && b.transform === edits.bindings[i].transform);
      return same ? prev : { ...prev, [nodeId]: edits.bindings };
    });

    const current = graphRef.current;
    const target = current.nodes.find((n) => n.node.id === nodeId);
    if (!target) return;
    const nextName = edits.name ?? target.node.name;
    const nextConfig = edits.config ?? target.node.config;
    if (nextName === target.node.name && nextConfig === target.node.config) return;

    dispatch({
      type: "replaceGraph",
      graph: {
        nodes: current.nodes.map((n) =>
          n.node.id === nodeId ? { ...n, node: { ...n.node, name: nextName, config: nextConfig } } : n,
        ),
        edges: current.edges,
      },
      label: `Edit ${nextName}`,
    });
  }, [dispatch]);

  return (
    <div
      ref={shellRef}
      className="bg-surface-app flex h-[calc(100dvh-var(--shell-header,0px))] min-h-[40rem] flex-col overflow-hidden"
    >
      <TopBar
        workflow={workflow}
        versionNumber={data.version?.version ?? 1}
        isDraft={!data.workflow?.currentVersionId}
        summary={summary}
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        presentation={presentation}
        onTogglePresentation={() => setPresentation((v) => !v)}
        onToggleFullscreen={toggleFullscreen}
        fullscreen={fullscreen}
        onSave={() => {
          void data.save({ nodes: state.nodes, edges: state.edges }).then((saved) => {
            if (saved) dispatch({ type: "markSaved" });
          });
        }}
        onTest={handleTest}
        onSimulate={() => setSimulating(true)}
        onRun={handleRun}
        onDebugRun={handleDebugRun}
        triggering={triggering}
      />

      <div className="flex min-h-0 flex-1">
        {!presentation ? (
          <Palette
            collapsed={paletteCollapsed}
            onToggle={() => setPaletteCollapsed((v) => !v)}
            onAdd={(kind, label) => addNode(kind, label)}
            onApplyTemplate={applyTemplate}
          />
        ) : null}

        <main
          className="relative min-w-0 flex-1"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDrop={(e) => {
            const kind = e.dataTransfer.getData("application/vectorbea-node") as NodeKind;
            if (!kind) return;
            e.preventDefault();
            const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            const item = PALETTE.flatMap((g) => g.items).find((i) => i.kind === kind);
            addNode(kind, item?.label, { x: snap(at.x), y: snap(at.y) });
          }}
        >
          <Canvas
            state={state}
            dispatch={dispatch}
            issues={issues}
            presentation={presentation}
            onOpenIssues={handleOpenIssues}
            onOpenNode={handleOpenNode}
            onConnectEnd={handleConnectEnd}
          />

          <CommentLayer
            comments={state.comments}
            nodes={state.nodes}
            onResolve={(id) => dispatch({ type: "resolveComment", id })}
          />

          {!presentation ? (
            <AlignToolbar
              state={state}
              dispatch={dispatch}
              onAutoLayout={runAutoLayout}
              canUndo={store.canUndo}
              canRedo={store.canRedo}
              onUndo={() => dispatch({ type: "undo" })}
              onRedo={() => dispatch({ type: "redo" })}
              onComment={() => {
                const anchor = state.selection[0] ?? null;
                const node = anchor ? state.nodes.find((n) => n.node.id === anchor) : null;
                const at = node ? { x: node.x + 210, y: node.y - 8 } : centreOfViewport();
                dispatch({
                  type: "addComment",
                  comment: {
                    id: `c-${Date.now().toString(36)}`,
                    body: "",
                    author: "you",
                    at: new Date().toISOString(),
                    nodeId: anchor,
                    x: at.x,
                    y: at.y,
                    resolved: false,
                  },
                });
              }}
            />
          ) : null}

          {/* The hovered issue's node, lit through the canvas overlay. */}
          {hoverIssueNode ? <IssueSpotlight nodeId={hoverIssueNode} /> : null}
        </main>

        {!presentation && selectedNode ? (
          <NodeInspector
            node={selectedNode}
            nodes={state.nodes}
            edges={state.edges}
            bindingsByNode={bindingsByNode}
            onCommit={commitNodeEdits}
            onClose={() => dispatch({ type: "select", ids: [] })}
            // The workspace run budget, for the timeout warning on Advanced.
            workflowBudgetMs={10 * 60_000}
          />
        ) : !presentation ? (
          <Inspector
            nodeCount={state.nodes.length}
            edgeCount={state.edges.length}
            selection={state.selection}
            selectedNodeName={selectedNodeName}
            issues={issues}
            summary={summary}
            history={store.history}
            cursor={store.cursor}
            /* Replay needs real run history, which this screen does not load.
               Saying "0 runs to replay" is wrong in a way a reader cannot
               detect; offering nothing is at least honest. */
            replayAvailable={false}
            replayCount={0}
            onHoverIssue={setHoverIssueNode}
            onSelectIssue={(nodeId) => {
              if (!nodeId) return;
              dispatch({ type: "select", ids: [nodeId] });
              reveal(nodeId);
            }}
            onJumpHistory={(cursor) => dispatch({ type: "jumpTo", cursor })}
            onOpenReplay={() => console.info("replay", workflow.id)}
          />
        ) : null}
      </div>

      {picker ? (
        <NodePicker
          connectFrom={picker.connectFrom}
          onPick={(kind, label) => {
            addNode(kind, label, picker.at, picker.connectFrom);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}

      {simulating ? (
        <SimulatePanel
          nodes={state.nodes.map((n) => n.node)}
          issues={issues}
          onClose={() => setSimulating(false)}
        />
      ) : null}
    </div>
  );
}

/* ── Issue spotlight ──────────────────────────────────────────────────────── */

/**
 * A ring around the node an issue points at, while its row is hovered.
 *
 * Positioned from React Flow's own node record rather than from our state, so it
 * lands on the rendered position mid-drag as well as at rest.
 */
function IssueSpotlight({ nodeId }: { nodeId: string }) {
  const flow = useReactFlow();
  const node = flow.getNode(nodeId);
  const viewport = flow.getViewport();
  if (!node) return null;

  const x = node.position.x * viewport.zoom + viewport.x;
  const y = node.position.y * viewport.zoom + viewport.y;
  const w = (node.measured?.width ?? 200) * viewport.zoom;
  const h = (node.measured?.height ?? 76) * viewport.zoom;

  return (
    <div
      aria-hidden="true"
      className="border-accent pointer-events-none absolute rounded-md border-2"
      style={{ left: x - 6, top: y - 6, width: w + 12, height: h + 12 }}
    />
  );
}

/* ── Node picker ──────────────────────────────────────────────────────────── */

/**
 * ⌘K on the canvas, and the drop target for a connection dragged to nowhere.
 *
 * When it opens from a dangling connection it is FILTERED to what can legally
 * follow the source — offering "Trigger" as the next step after a tool call is
 * an option that produces a validation error the moment it is taken.
 */
function NodePicker({
  connectFrom, onPick, onClose,
}: {
  connectFrom?: string;
  onPick: (kind: NodeKind, label: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const items = React.useMemo(() => {
    const all = PALETTE.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));
    const legal = connectFrom ? all.filter((i) => i.kind !== "trigger") : all;
    const needle = query.trim().toLowerCase();
    if (!needle) return legal;
    return legal.filter(
      (i) => i.label.toLowerCase().includes(needle)
        || i.description.toLowerCase().includes(needle)
        || i.kind.includes(needle),
    );
  }, [query, connectFrom]);

  React.useEffect(() => { setActive(0); }, [query]);

  return (
    <div className="z-modal fixed inset-0" role="dialog" aria-modal="true" aria-label="Add a node">
      <div className="bg-surface-canvas/60 absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          "motion-overlay bg-surface-overlay border-subtle shadow-3 absolute left-1/2 top-[18%]",
          "w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border p-2",
        )}
      >
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={connectFrom ? "What comes next?" : "Add a step by name"}
          aria-label="Search steps"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter" && items[active]) { e.preventDefault(); onPick(items[active].kind, items[active].label); }
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
        />

        {connectFrom ? (
          <Text variant="caption" tone="muted" className="mt-1.5 block px-1">
            Connected downstream of the node you dragged from. Triggers are excluded — a run has
            exactly one entry point.
          </Text>
        ) : null}

        <ul role="listbox" aria-label="Steps" className="mt-2 max-h-72 overflow-y-auto">
          {items.length === 0 ? (
            <li className="px-2 py-3">
              <Text variant="caption" tone="muted">No step matches “{query}”.</Text>
            </li>
          ) : items.map((item, i) => {
            const entry = NODE_MARKS.find((m) => m.type === item.kind);
            const Icon = entry?.Icon;
            return (
              <li key={item.kind} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={() => onPick(item.kind, item.label)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
                    i === active && "bg-surface-hover",
                  )}
                >
                  <span className="border-subtle bg-surface-hover text-fg-secondary grid size-6 shrink-0 place-items-center rounded-xs border">
                    {Icon ? <Icon size={13} aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-ui text-body-sm text-fg-primary block truncate">{item.label}</span>
                    <span className="font-ui text-caption text-fg-muted block truncate">{item.description}</span>
                  </span>
                  <span className="font-ui text-[10px] text-fg-disabled shrink-0 uppercase">{item.group}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="border-subtle mt-2 flex items-center gap-3 border-t px-1 pt-2">
          <Text variant="caption" tone="disabled" className="flex items-center gap-1">
            <Kbd keys="↑ ↓" /> navigate
          </Text>
          <Text variant="caption" tone="disabled" className="flex items-center gap-1">
            <Kbd keys="⏎" /> add
          </Text>
          <Text variant="caption" tone="disabled" className="ml-auto flex items-center gap-1">
            <Kbd keys="Esc" /> close
          </Text>
        </div>
      </div>
    </div>
  );
}

export type { BuilderAction };

/* ── Load failure ─────────────────────────────────────────────────────────── */

/**
 * The builder could not open.
 *
 * Distinguishes the two causes that need different actions: a workflow that is
 * not there (wrong id, deleted, other workspace) is not the same as a workflow
 * that could not be READ, and telling somebody to retry a 404 wastes their time.
 */
function BuilderLoadFailure({ workflowId, message }: { workflowId: string; message?: string }) {
  const missing = message?.toLowerCase().includes("not found") ?? false;

  return (
    <PageContainer>
      <div className="border-subtle bg-surface-raised grid place-items-center rounded-lg border px-4 py-16">
        <div className="max-w-[36rem] text-center">
          <Text variant="heading-sm" tone="max" as="p" className="block">
            {missing ? "This workflow no longer exists" : "The builder could not load this workflow"}
          </Text>
          <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
            {missing
              ? "It was deleted, or the link points at a workflow in another workspace. Nothing was changed."
              : message ?? "The workflow and its versions could not be read. Nothing has been changed."}
          </Text>
          <Text variant="caption" tone="disabled" className="font-code mt-2 block">{workflowId}</Text>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button asChild variant="primary" size="sm">
              <Link href={"/workflows" as Route}>Back to workflows</Link>
            </Button>
            {!missing ? (
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
