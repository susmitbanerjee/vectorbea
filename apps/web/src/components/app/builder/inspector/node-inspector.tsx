"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Kbd } from "~/components/ui/kbd";
import { NODE_MARKS } from "~/components/icons/nodes";
import { InputsTab } from "./inputs-tab";
import { ConfigureTab } from "./configure-tab";
import { AdvancedTab, type AdvancedConfig } from "./advanced-tab";
import { OutputTab } from "./output-test-tabs";
import { useBuilderRegistry } from "../use-builder-registry";
import { stepInputs, readInputMapping } from "../step-io";
import type { BuilderEdge, BuilderNode } from "~/mocks/builder";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   THE NODE INSPECTOR

   Five tabs over one node. The panel owns its own edit history, because ⌘Z
   inside a form must undo the field you just typed — not the last thing that
   happened to the graph. Sharing the canvas's history would make undo mean two
   different things depending on where the pointer happens to be.

   AUTOSAVE, WITH A GUARD. Edits persist on a debounce, and the guard exists for
   the window between the last keystroke and the write landing: navigating away
   inside it would silently drop the edit, and this is a panel people leave by
   clicking a different node rather than by closing anything.
══════════════════════════════════════════════════════════════════════════════ */

export type InspectorTabId = "configure" | "inputs" | "output" | "advanced";

/* No Test tab. It simulated a call with a timer, showed invented numbers and
   JSON, and said it ran "against real connections". Run the workflow instead. */
const TABS: { id: InspectorTabId; label: string }[] = [
  { id: "configure", label: "Configure" },
  { id: "inputs", label: "Inputs" },
  { id: "output", label: "Output" },
  { id: "advanced", label: "Advanced" },
];

/* Inputs are part of `config` (`config.inputMapping`), so they save, reload and
   reach the worker with everything else on the step. */
export interface NodeEdits {
  name?: string;
  config?: Record<string, unknown>;
  advanced: AdvancedConfig;
}

const WIDTH_KEY = "vectorbea-inspector-width";
const MIN_WIDTH = 320;
const MAX_WIDTH = 900;

/* ══════════════════════════════════════════════════════════════════════════════
   THE 30-SECOND DEFAULT WAS THE COLD START.

   `timeoutMs` defaulted to a flat 30000 for every node kind, and the commit path
   writes the Advanced panel's values on every save — so opening the inspector on
   an agent node once was enough to stamp 30s onto it permanently.

   The worker has per-class defaults for exactly this reason
   (`WorkflowRuntime.defaultTimeoutFor`): 120s for an agent, 90s for an LLM call,
   30s for HTTP. A node config value OVERRIDES those, so the panel was quietly
   cutting an agent's budget to a quarter. A first call pays DNS, the TLS
   handshake, the JVM's TLS and JIT warm-up and a cold provider connection; a
   tool-calling agent pays that plus several model round trips. Thirty seconds is
   frequently not enough for the first one and comfortably enough for the second,
   which is exactly the reported symptom: the first agent execution fails, the
   retry succeeds.

   These values MIRROR the worker's. If either side changes, change both — a
   panel that draws a budget the runtime does not use is how this started.
══════════════════════════════════════════════════════════════════════════════ */
const DEFAULT_TIMEOUT_MS: Partial<Record<VersionNode["kind"], number>> = {
  agent: 120_000,   // AGENT_NODE_TIMEOUT_MS
  llm: 90_000,      // LLM_NODE_TIMEOUT_MS
  tool: 30_000,     // HTTP_NODE_TIMEOUT_MS — a tool node is an outbound call
};

/** The worker's DEFAULT_NODE_TIMEOUT_MS, for every kind not listed above. */
const FALLBACK_TIMEOUT_MS = 60_000;

/**
 * The Advanced panel's starting values, read back from what was saved.
 *
 * `baseDelayMs`, `jitter` and `errorPolicy` used to be hard-coded here, so even
 * once the values were being persisted the panel would reopen showing 2000ms /
 * no jitter / fail-run regardless of what had been set. Reading them back is
 * what makes the round trip observable.
 */
function defaultAdvanced(node: VersionNode): AdvancedConfig {
  const retry = node.config.retry as {
    attempts?: number; backoff?: string; baseDelayMs?: number; maxDelayMs?: number; jitter?: boolean;
  } | undefined;
  return {
    retry: {
      attempts: retry?.attempts ?? 3,
      backoff: (retry?.backoff as AdvancedConfig["retry"]["backoff"]) ?? "exponential",
      baseDelayMs: retry?.baseDelayMs ?? 2000,
      maxDelayMs: retry?.maxDelayMs ?? 8000,
      jitter: retry?.jitter ?? String(retry?.backoff ?? "").includes("jitter"),
    },
    timeoutMs: Number(node.config.timeoutMs ?? DEFAULT_TIMEOUT_MS[node.kind] ?? FALLBACK_TIMEOUT_MS),
    idempotencyKey: String(node.config.idempotencyKey ?? ""),
    errorPolicy: (node.config.errorPolicy as AdvancedConfig["errorPolicy"]) ?? "fail-run",
    fallbackNodeId: (node.config.fallbackNodeId as string | null) ?? null,
    checkpoint: (node.config.checkpoint as boolean | undefined) ?? true,
    /* Read back like everything else above. These were hard-coded, so the panel
       reopened at 8 / none / blank / none no matter what had been saved — the
       same write-only bug the retry fields had. */
    maxConcurrency: Number(node.config.maxConcurrency ?? 8),
    rateLimitPerMinute: (node.config.rateLimitPerMinute as number | null | undefined) ?? null,
    skipIf: String(node.config.skipIf ?? ""),
    costCeilingUsd: (node.config.costCeilingUsd as number | null | undefined) ?? null,
  };
}

export function NodeInspector({
  node, nodes, edges, onCommit, onClose, workflowBudgetMs,
}: {
  node: VersionNode;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  onCommit: (nodeId: string, edits: NodeEdits) => void;
  onClose: () => void;
  workflowBudgetMs: number;
}) {
  const [tab, setTab] = React.useState<InspectorTabId>("configure");
  const [width, setWidth] = React.useState(384);
  const [expanded, setExpanded] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"saved" | "saving" | "dirty">("saved");

  /* ── Per-panel edit state, with its own undo stack ─────────────────────── */

  /* Seeded from the NODE ID, not from the node object.
     Depending on the object meant every commit produced a new node, a new seed
     and a reset of the panel's own edit state — so the field you were typing in
     was overwritten by the value you had just saved. The panel reloads when you
     select a different node; while you are on one, it owns its state. */
  const seed = React.useMemo<NodeEdits>(() => ({
    name: node.name,
    config: node.config,
    advanced: defaultAdvanced(node),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [node.id]);

  const [edits, setEdits] = React.useState<NodeEdits>(seed);
  const historyRef = React.useRef<NodeEdits[]>([seed]);
  const cursorRef = React.useRef(0);

  // Switching nodes resets the panel's history: undoing into another node's
  // edits would apply them to the wrong node.
  React.useEffect(() => {
    setEdits(seed);
    historyRef.current = [seed];
    cursorRef.current = 0;
    setSaveState("saved");
  }, [seed]);

  const push = React.useCallback((next: NodeEdits) => {
    historyRef.current = [...historyRef.current.slice(0, cursorRef.current + 1), next].slice(-60);
    cursorRef.current = historyRef.current.length - 1;
    setEdits(next);
    setSaveState("dirty");
  }, []);

  const update = React.useCallback((patch: Partial<NodeEdits>) => {
    push({ ...edits, ...patch });
  }, [edits, push]);

  /* ── Autosave ───────────────────────────────────────────────────────────── */

  /* `onCommit` and `edits` are read through refs rather than depended on.
     Committing dispatches into the graph, which rebuilds the parent's callback
     and the `seed` this panel derives from — so depending on their identity
     made the effect re-fire on its own result, commit again, and loop until
     React aborted the tree. The effect must be driven by the SAVE STATE alone. */
  const commitRef = React.useRef(onCommit);
  commitRef.current = onCommit;
  const editsRef = React.useRef(edits);
  editsRef.current = edits;

  React.useEffect(() => {
    if (saveState !== "dirty") return;
    const id = window.setTimeout(() => {
      setSaveState("saving");
      commitRef.current(node.id, editsRef.current);
      window.setTimeout(() => setSaveState("saved"), 260);
    }, 700);
    return () => window.clearTimeout(id);
  }, [saveState, node.id]);

  /* Unsaved-changes guard. The window between a keystroke and the debounced
     write is small, and it is exactly when somebody clicks away. */
  React.useEffect(() => {
    if (saveState === "saved") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  /* ── ⌘Z inside the panel ────────────────────────────────────────────────── */
  const panelRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      // Only when the focus is inside this panel — otherwise ⌘Z belongs to the
      // canvas, and undoing a field edit from the canvas would be baffling.
      if (!panelRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        if (cursorRef.current >= historyRef.current.length - 1) return;
        cursorRef.current += 1;
      } else {
        if (cursorRef.current === 0) return;
        cursorRef.current -= 1;
      }
      setEdits(historyRef.current[cursorRef.current]);
      setSaveState("dirty");
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  /* ── Resize ─────────────────────────────────────────────────────────────── */
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WIDTH_KEY);
      if (raw) setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(raw))));
    } catch {}
  }, []);

  const dragRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current === null) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      try { window.localStorage.setItem(WIDTH_KEY, String(width)); } catch {}
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [width]);

  const registry = useBuilderRegistry();
  const entry = NODE_MARKS.find((m) => m.type === node.kind);
  const Icon = entry?.Icon;
  const workingNode: VersionNode = { ...node, name: edits.name ?? node.name, config: edits.config ?? node.config };
  const workingMapping = readInputMapping(workingNode.config);
  const unbound = stepInputs(workingNode, registry)
    .filter((d) => d.required && !workingMapping[d.id]?.trim()).length;

  return (
    <aside
      ref={panelRef}
      aria-label={`Inspector for ${node.name}`}
      className={cn(
        "border-subtle bg-surface-base relative flex shrink-0 flex-col border-l",
        expanded && "fixed inset-0 z-modal w-full border-l-0",
      )}
      style={expanded ? undefined : { width }}
    >
      {/* Resize grip. */}
      {!expanded ? (
        <span
          role="separator"
          aria-label="Resize the inspector"
          aria-orientation="vertical"
          onPointerDown={(e) => {
            e.preventDefault();
            dragRef.current = width + e.clientX;
            document.body.style.cursor = "col-resize";
          }}
          className={cn(
            "absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize",
            "after:bg-accent after:absolute after:left-1/2 after:h-full after:w-px",
            "after:opacity-0 after:transition-opacity after:duration-fast hover:after:opacity-100",
          )}
        />
      ) : null}

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="border-subtle border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="border-accent-border bg-accent-subtle text-accent grid size-6 shrink-0 place-items-center rounded-xs border">
            {Icon ? <Icon size={13} aria-hidden="true" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <Text variant="body-sm" tone="primary" className="block truncate">{workingNode.name}</Text>
            <Text variant="caption" tone="muted" className="block">{node.kind}</Text>
          </span>

          <SaveDot state={saveState} />

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse the inspector" : "Expand the inspector to full screen"}
            title={expanded ? "Collapse" : "Expand — more room for mapping"}
            className={cn(
              "text-fg-muted hover:text-fg-primary hover:bg-surface-hover grid size-6 place-items-center rounded-xs",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              {expanded
                ? <path d="M4.6 1.5v3.1H1.5M7.4 10.5V7.4h3.1" />
                : <path d="M1.5 4.4V1.5h2.9M10.5 7.6v2.9H7.6" />}
            </svg>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close the inspector"
            className={cn(
              "text-fg-muted hover:text-fg-primary hover:bg-surface-hover grid size-6 place-items-center rounded-xs",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Node configuration" className="border-subtle flex items-center gap-0.5 border-b px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "font-ui text-caption flex items-center rounded-sm px-2 py-1",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
              tab === t.id ? "bg-surface-active text-fg-primary" : "text-fg-muted hover:text-fg-primary",
            )}
          >
            {t.label}
            {t.id === "inputs" && unbound > 0 ? (
              <span className="bg-status-failed text-fg-on-accent font-code ml-1 rounded-full px-1 text-[9px] tabular">
                {unbound}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {tab === "configure" ? (
          <ConfigureTab
            node={workingNode}
            onChange={(patch) => update({
              name: patch.name ?? edits.name,
              config: patch.config ?? edits.config,
            })}
          />
        ) : null}

        {tab === "inputs" ? (
          <InputsTab
            node={workingNode}
            nodes={nodes}
            edges={edges}
            onChange={(inputMapping) => update({ config: { ...workingNode.config, inputMapping } })}
          />
        ) : null}

        {tab === "output" ? (
          <OutputTab
            node={workingNode}
            nodes={nodes}
            onFieldsChange={(outputFields) => update({ config: { ...workingNode.config, outputFields } })}
          />
        ) : null}

        {tab === "advanced" ? (
          <AdvancedTab
            node={workingNode}
            config={edits.advanced}
            onChange={(patch) => update({ advanced: { ...edits.advanced, ...patch } })}
            workflowBudgetMs={workflowBudgetMs}
            nodeNames={nodes.map((n) => ({ id: n.node.id, name: n.node.name }))}
          />
        ) : null}

      </div>

      <footer className="border-subtle flex items-center justify-between gap-2 border-t px-3 py-1.5">
        <Text variant="caption" tone="muted">
          {saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved" : "Saved"}
        </Text>
        <Text variant="caption" tone="disabled" className="flex items-center gap-1">
          <Kbd keys="⌘ Z" /> undoes edits here
        </Text>
      </footer>
    </aside>
  );
}

function SaveDot({ state }: { state: "saved" | "saving" | "dirty" }) {
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      aria-live="polite"
      title={state === "saved" ? "All changes saved" : state === "saving" ? "Saving" : "Unsaved changes"}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "saved" ? "bg-status-success" : state === "saving" ? "bg-status-live" : "bg-status-waiting",
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{state === "saved" ? "Saved" : state === "saving" ? "Saving" : "Unsaved changes"}</span>
    </span>
  );
}
