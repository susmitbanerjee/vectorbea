import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { FlowView } from "./flow-view";
import type { GraphEdge, GraphNode, TraceGraph } from "~/lib/api/trace";

/**
 * The Flow view — structure and time in one picture.
 *
 * Replaces a wrapped grid of same-sized cards labelled by node type, with no
 * edges, each step rendered twice. Position now carries structure, width carries
 * duration, and one card is one graph NODE. Toggle the theme; both must hold.
 */

function n(p: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    id: p.id, label: p.label ?? p.id, type: p.type ?? "http",
    status: p.status ?? "ok", reached: p.reached ?? true,
    attempts: p.attempts ?? 1, totalMs: p.totalMs ?? 100,
    spanIds: p.spanIds ?? [`span-${p.id}`], warnings: p.warnings ?? [],
    isRootCause: p.isRootCause ?? false, costCents: p.costCents ?? null,
    tokensIn: null, tokensOut: null, summary: p.summary ?? null,
  };
}

function e(id: string, source: string, target: string, traversed: boolean | null = true): GraphEdge {
  return { id, source, target, type: "default", label: null, condition: null, traversed };
}

function graph(p: Partial<TraceGraph> & { nodes: GraphNode[]; edges: GraphEdge[] }): TraceGraph {
  return {
    runId: "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13",
    status: p.status ?? "succeeded",
    completeness: { state: "complete", droppedSpans: 0, reason: null },
    graphUnavailable: false,
    runBar: p.runBar ?? { totalMs: 1_000, segments: [{ kind: "working", ms: 1_000, label: "Working" }] },
    nodes: p.nodes, edges: p.edges,
  };
}

function Frame({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  const [sel, setSel] = React.useState<string | null>(null);
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      <Text variant="caption" tone="muted" className="mt-1 mb-3 block max-w-[80ch]">{note}</Text>
      <div data-selected={sel ?? ""}>
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<{
              selectedNodeId: string | null;
              onSelectNode: (id: string) => void;
            }>, { selectedNodeId: sel, onSelectNode: (id: string) => setSel(id) })
          : children}
      </div>
    </section>
  );
}

const meta: Meta = { title: "App/Debug/Flow view", parameters: { layout: "padded" } };
export default meta;

/** The run from the bug report: four nodes, not eight cards. */
export const FailedRun: StoryObj = {
  name: "A failed run",
  render: () => (
    <Frame
      title="A failed run"
      note="The failing node carries a 2px border and the word 'Root cause'. Its width
            is its duration. Everything downstream never ran, so it is dashed and dimmed
            — that is how a reader sees what did not happen."
    >
      <FlowView
        selectedNodeId={null}
        onSelectNode={() => {}}
        graph={graph({
          status: "failed",
          runBar: {
            totalMs: 252_000,
            segments: [
              { kind: "queued", ms: 2_000, label: "Waiting for a worker" },
              { kind: "working", ms: 12_000, label: "Working" },
              { kind: "parked", ms: 158_000, label: "Waiting for approval" },
              { kind: "failed", ms: 80_000, label: "In the step that failed" },
            ],
          },
          nodes: [
            n({ id: "trigger", label: "Ticket created", type: "trigger", totalMs: 120 }),
            n({ id: "triage", label: "Triage", type: "agent_team", totalMs: 12_000,
                summary: {
                  activations: 3,
                  members: [
                    { name: "supervisor", status: "ok", totalMs: 1_800 },
                    { name: "researcher", status: "error", totalMs: 9_600 },
                    { name: "writer", status: "skipped", totalMs: null },
                  ],
                  failingMember: "researcher",
                } }),
            n({ id: "approve", label: "Approve refund", type: "approval", totalMs: 158_000,
                status: "ok", warnings: [{ kind: "approval", detail: "This step waited for a human decision", count: 1 }] }),
            n({ id: "crm", label: "crm.search", type: "tool", status: "error", totalMs: 80_000,
                isRootCause: true }),
            n({ id: "notify", label: "Notify customer", type: "http", status: "not_reached", reached: false, totalMs: null }),
            n({ id: "close", label: "Close ticket", type: "end", status: "not_reached", reached: false, totalMs: null }),
          ],
          edges: [
            e("e1", "trigger", "triage"), e("e2", "triage", "approve"),
            e("e3", "approve", "crm"), e("e4", "crm", "notify", false),
            e("e5", "notify", "close", false),
          ],
        })}
      />
    </Frame>
  ),
};

/** Green, and still with something to say. */
export const SuccessWithWarnings: StoryObj = {
  name: "Succeeded, with warnings",
  render: () => (
    <Frame
      title="Succeeded, with warnings"
      note="Two retries and a truncated context. All three leave the run green — without
            the markers this is an unbroken row of success and the reader has no way to
            tell it apart from a clean run."
    >
      <FlowView
        selectedNodeId={null}
        onSelectNode={() => {}}
        graph={graph({
          runBar: {
            totalMs: 9_400,
            segments: [
              { kind: "queued", ms: 400, label: "Waiting for a worker" },
              { kind: "working", ms: 9_000, label: "Working" },
            ],
          },
          nodes: [
            n({ id: "fetch", label: "Fetch account", totalMs: 380, attempts: 2,
                warnings: [{ kind: "retry", detail: "Failed and was retried, then succeeded", count: 1 }] }),
            n({ id: "enrich", label: "Enrich", totalMs: 185, attempts: 2,
                warnings: [{ kind: "retry", detail: "Failed and was retried, then succeeded", count: 1 }] }),
            n({ id: "summarise", label: "researcher", type: "agent", totalMs: 8_800,
                summary: {
                  activations: 1,
                  members: [{ name: "researcher", status: "ok", totalMs: 8_800 }],
                  failingMember: null,
                },
                warnings: [{ kind: "context_truncated",
                             detail: "The prompt did not fit, so older context was dropped before the model saw it",
                             count: 1 }] }),
            n({ id: "done", label: "Done", type: "end", totalMs: 3 }),
          ],
          edges: [e("e1", "fetch", "enrich"), e("e2", "enrich", "summarise"), e("e3", "summarise", "done")],
        })}
      />
    </Frame>
  ),
};

/** A branch: the road not taken is drawn. */
export const UnselectedBranch: StoryObj = {
  name: "The branch that did not run",
  render: () => (
    <Frame
      title="The branch that did not run"
      note="Both arms are present. A run that failed at step two and a run that was never
            going to reach step four look identical if only what executed is drawn."
    >
      <FlowView
        selectedNodeId={null}
        onSelectNode={() => {}}
        graph={graph({
          nodes: [
            n({ id: "start", label: "Start", type: "trigger", totalMs: 10 }),
            n({ id: "route", label: "Is it urgent?", type: "branch", totalMs: 4 }),
            n({ id: "page", label: "Page on-call", totalMs: 2_400 }),
            n({ id: "queue", label: "Add to queue", status: "not_reached", reached: false, totalMs: null }),
            n({ id: "end", label: "Done", type: "end", totalMs: 2 }),
          ],
          edges: [
            e("e0", "start", "route"),
            e("e1", "route", "page"), e("e2", "route", "queue", false),
            e("e3", "page", "end"), e("e4", "queue", "end", false),
          ],
        })}
      />
    </Frame>
  ),
};

/** Wide: scrolls, with a minimap. Never shrink-to-fit. */
export const WideGraph: StoryObj = {
  name: "A wide run",
  render: () => {
    const nodes = Array.from({ length: 24 }, (_, i) =>
      n({
        id: `n${i}`, label: `Step ${i + 1}`,
        totalMs: [40, 900, 12, 4_200, 130][i % 5]! * (i === 11 ? 40 : 1),
        status: i === 19 ? "error" : "ok",
        isRootCause: i === 19,
      }));
    return (
      <Frame
        title="A wide run"
        note="24 nodes. The graph keeps its real size and scrolls; the minimap carries the
              overview and marks where the viewport is. Shrink-to-fit would make this 24
              unreadable specks — legible beats complete."
      >
        <FlowView
          selectedNodeId={null}
          onSelectNode={() => {}}
          graph={graph({
            status: "failed",
            nodes,
            edges: nodes.slice(1).map((x, i) => e(`e${i}`, `n${i}`, x.id)),
          })}
        />
      </Frame>
    );
  },
};
