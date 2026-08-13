import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { CheckpointRibbon } from "./checkpoint-ribbon";
import { resetAnimationClaim } from "./animation-coordinator";
import { RIBBON_SHAPES, RUNS } from "~/mocks/fixtures";
import type { CellState, RunNode } from "~/mocks/domain";
import { formatCost, formatDuration, formatTokens } from "~/lib/format";
import { SIZES, type RibbonSize } from "./geometry";

/**
 * ⭐ THE CHECKPOINT RIBBON — the review gate for the whole project.
 *
 * Every shape below is real fixture data at the workspace's true 58/83/22
 * split, not a tidy demo. Toggle the theme in the toolbar; both must hold.
 */

const SIZE_ORDER: RibbonSize[] = ["xs", "sm", "md", "lg"];

const SIZE_NOTE: Record<RibbonSize, string> = {
  xs: "3px cells, 1px gap — inline in a table row",
  sm: "8px cells, 2px gap — workflow and run cards",
  md: "20px cells, 3px gap — run detail header",
  lg: "full width, interactive, labelled — run detail primary view",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <Text variant="heading-md" tone="max">{title}</Text>
      {hint ? (
        <Text variant="caption" tone="muted" className="mt-1 mb-4 block max-w-[76ch]">{hint}</Text>
      ) : <div className="mb-4" />}
      {children}
    </section>
  );
}

/* ── 1. All seven states, isolated ────────────────────────────────────────── */

const STATE_ORDER: CellState[] = [
  "committed", "executing", "gated", "failed", "pending", "skipped", "recovered",
];

const STATE_MEANING: Record<CellState, string> = {
  committed: "work that survives a crash",
  executing: "in flight right now",
  gated: "waiting on a person",
  failed: "the node that died",
  pending: "never reached",
  skipped: "branch not taken",
  recovered: "succeeded on retry",
};

function stateNode(state: CellState, i: number): RunNode {
  return {
    id: `n${i}`, name: state, kind: "tool", state,
    durationMs: state === "pending" || state === "skipped" ? null : 1840,
    tokens: 2400, costUsd: 0.0031,
    at: state === "pending" || state === "skipped" ? null : new Date().toISOString(),
    attempt: state === "recovered" ? 2 : undefined,
  };
}

/* ── 2. Live bloom demo ───────────────────────────────────────────────────── */

function BloomDemo() {
  const total = 12;
  const [committedCount, setCommittedCount] = React.useState(4);

  const nodes = React.useMemo<RunNode[]>(
    () =>
      Array.from({ length: total }, (_, i) => ({
        id: `n${i}`,
        name: `Node ${i + 1}`,
        kind: "tool" as const,
        state: (i < committedCount ? "committed" : i === committedCount ? "executing" : "pending") as CellState,
        durationMs: i < committedCount ? 1200 + i * 180 : null,
        tokens: i < committedCount ? 900 + i * 120 : null,
        costUsd: i < committedCount ? 0.0028 : null,
        at: i < committedCount ? new Date().toISOString() : null,
      })),
    [committedCount],
  );

  return (
    <div className="bg-surface-raised border-subtle rounded-lg border p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => setCommittedCount((c) => Math.min(total, c + 1))}
          disabled={committedCount >= total}
        >
          Commit next node
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { resetAnimationClaim(); setCommittedCount(4); }}>
          Reset
        </Button>
        <Text variant="caption" tone="muted">
          Springs from .82 with one hex ring over 480ms. Fires once, never loops.
        </Text>
      </div>
      <CheckpointRibbon nodes={nodes} size="md" runId="bloom-demo" />
    </div>
  );
}

/* ── 3. The single-animation rule ─────────────────────────────────────────── */

function SingleAnimationDemo() {
  const [tick, setTick] = React.useState(0);
  const runs = React.useMemo(() => RUNS.slice(0, 8), []);

  // Commit one more node in EVERY ribbon at once. Only one may bloom.
  const nodesFor = React.useCallback(
    (runIndex: number): RunNode[] =>
      Array.from({ length: 10 }, (_, i) => ({
        id: `n${i}`,
        name: `Node ${i + 1}`,
        kind: "tool" as const,
        state: (i < 3 + tick ? "committed" : "pending") as CellState,
        durationMs: i < 3 + tick ? 900 : null,
        tokens: null, costUsd: null,
        at: i < 3 + tick ? new Date().toISOString() : null,
      })),
    [tick],
  );

  return (
    <div className="bg-surface-raised border-subtle rounded-lg border p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => setTick((t) => Math.min(6, t + 1))} disabled={tick >= 6}>
          Commit in all eight at once
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { resetAnimationClaim(); setTick(0); }}>Reset</Button>
        <Text variant="caption" tone="muted">
          Exactly one ribbon blooms. The other seven update without motion — a hard §5 requirement.
        </Text>
      </div>
      <div className="grid gap-2">
        {runs.map((run, i) => (
          <div key={run.id} className="flex items-center gap-3">
            <MonoId value={run.id} head={10} tail={4} />
            <CheckpointRibbon nodes={nodesFor(i)} size="sm" runId={run.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 4. Interactive scrub ─────────────────────────────────────────────────── */

function ScrubDemo() {
  const run = RIBBON_SHAPES[2].run; // failure after many commits
  const [index, setIndex] = React.useState<number | null>(null);
  const node = index === null ? null : run.nodes[index];

  return (
    <div className="bg-surface-raised border-subtle rounded-lg border p-5">
      <CheckpointRibbon
        nodes={run.nodes}
        size="lg"
        runId={`${run.id}-scrub`}
        interactive
        showLabels
        onScrub={setIndex}
        onCellClick={(n, i) => setIndex(i)}
      />
      <div className="border-subtle mt-4 min-h-16 rounded-md border p-3">
        {node ? (
          <>
            <Text variant="body-sm" tone="primary" className="block">
              Node {index! + 1} · {node.name}
            </Text>
            <Text variant="caption" tone="muted" className="tabular block">
              {node.state} · {formatDuration(node.durationMs)} · {formatTokens(node.tokens)} tokens ·{" "}
              {formatCost(node.costUsd)}
            </Text>
          </>
        ) : (
          <Text variant="caption" tone="muted">
            Drag across the ribbon to scrub. In P12 this drives the canvas and log replay.
          </Text>
        )}
      </div>
    </div>
  );
}

/* ── Gallery ──────────────────────────────────────────────────────────────── */

function Gallery() {
  return (
    <div className="font-ui p-8">
      <header className="mb-10">
        <Text variant="eyebrow" tone="accent" className="mb-2 block">The signature</Text>
        <Text variant="display-md" tone="max" className="mb-2">Checkpoint Ribbon</Text>
        <Text variant="body-sm" tone="secondary" className="block max-w-[76ch]">
          A run is a sequence of durable commits. The fill encodes commit state, so a failed run
          reports how much work survives it — 8 of 12 committed means a retry costs 4 nodes, not 12.
          That is the product thesis, rendered. Cells are hexagon-derived: a soft-cornered rectangle
          with the top-left and bottom-right corners clipped.
        </Text>
      </header>

      <Section title="Seven states" hint="Shown at md. Colour is never the only signal — failed is cracked, skipped is dashed, recovered carries an ember notch.">
        <div className="bg-surface-raised border-subtle grid gap-3 rounded-lg border p-5 sm:grid-cols-2 lg:grid-cols-4">
          {STATE_ORDER.map((state) => (
            <div key={state} className="flex items-center gap-3">
              <CheckpointRibbon nodes={[stateNode(state, 0)]} size="md" runId={`state-${state}`} />
              <span className="min-w-0">
                <Text variant="body-sm" tone="primary" className="block">{state}</Text>
                <Text variant="caption" tone="muted" className="block">{STATE_MEANING[state]}</Text>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Nine run shapes × four sizes"
        hint="One component at every scale. The same run reads correctly as a 3px tick in a table row and as a full-width interactive strip."
      >
        <div className="grid gap-4">
          {RIBBON_SHAPES.map((shape) => (
            <div key={shape.label} className="bg-surface-raised border-subtle rounded-lg border p-5">
              <div className="mb-4">
                <Text variant="heading-sm" tone="max" className="block">{shape.label}</Text>
                <Text variant="caption" tone="muted" className="block">{shape.description}</Text>
                <Text variant="caption" tone="muted" className="tabular mt-1 block">
                  {shape.run.nodes.length} nodes ·{" "}
                  {shape.run.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length} committed
                </Text>
              </div>

              <div className="grid gap-4">
                {SIZE_ORDER.map((size) => (
                  <div key={size} className="grid grid-cols-[3.5rem_1fr] items-center gap-4">
                    <span>
                      <Text variant="mono-sm" tone="secondary" className="block">{size}</Text>
                      <Text variant="caption" tone="muted" className="block text-[10px] leading-tight">
                        {SIZES[size].cell === null ? "fluid" : `${SIZES[size].cell}px`}
                      </Text>
                    </span>
                    <CheckpointRibbon
                      nodes={shape.run.nodes}
                      size={size}
                      runId={`${shape.label}-${size}`}
                      interactive={size === "lg"}
                    />
                  </div>
                ))}
              </div>

              <Text variant="caption" tone="muted" className="mt-3 block">
                {SIZE_NOTE.lg}
              </Text>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Checkpoint bloom" hint="§7.2 motion 1 — the brand motion.">
        <BloomDemo />
      </Section>

      <Section title="One ribbon animates at a time" hint="§5 anti-requirement. A Runs table renders 163 of these; if a poll updated them together, every one would bloom and the signal would mean nothing.">
        <SingleAnimationDemo />
      </Section>

      <Section title="Scrub" hint="Drag across the ribbon. It emits the hovered node index, which drives canvas and log replay in P12.">
        <ScrubDemo />
      </Section>

      <Section title="In a table row" hint="xs inline against real fixture runs — the density the Runs table will actually ship.">
        <div className="bg-surface-raised border-subtle overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] tabular-auto text-left">
            <thead>
              <tr className="border-subtle border-b">
                {["Run", "Workflow", "Shape", "Duration", "Cost"].map((h) => (
                  <th key={h} className="text-eyebrow text-fg-muted px-3 py-2 font-semibold uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RUNS.slice(0, 12).map((run) => (
                <tr key={run.id} className="border-subtle border-b last:border-b-0">
                  <td className="px-3 py-1.5"><MonoId value={run.id} head={10} tail={4} /></td>
                  <td className="px-3 py-1.5">
                    <Text variant="body-sm" tone="secondary">{run.workflowName}</Text>
                  </td>
                  <td className="px-3 py-1.5">
                    <CheckpointRibbon nodes={run.nodes} size="xs" runId={run.id} />
                  </td>
                  <td className="font-code text-mono-sm tabular text-fg-secondary px-3 py-1.5">
                    {formatDuration(run.durationMs)}
                  </td>
                  <td className="font-code text-mono-sm tabular text-fg-secondary px-3 py-1.5">
                    {formatCost(run.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

const meta = { title: "Signature/Checkpoint Ribbon", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ribbon: Story = { render: () => <Gallery /> };
