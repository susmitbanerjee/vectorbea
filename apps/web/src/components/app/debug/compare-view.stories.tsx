import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { CompareView } from "./compare-view";
import type { CompareNode, Comparison } from "~/lib/api/constellation";

/**
 * "It worked yesterday."
 *
 * The three states that matter: it diverged here, the two are identical, and the
 * comparison would mislead so it was refused.
 */

function node(p: Partial<CompareNode> & { name: string }): CompareNode {
  return {
    key: `${p.name}|${p.kind ?? "tool_call"}|${p.name}|0`,
    name: p.name,
    kind: p.kind ?? "tool_call",
    stepId: p.stepId ?? p.name,
    presence: p.presence ?? "both",
    statusA: p.statusA ?? "ok",
    statusB: p.statusB ?? "ok",
    divergent: p.divergent ?? false,
    deltas: p.deltas ?? [],
  };
}

function comparison(p: Partial<Comparison> & { nodes: CompareNode[] }): Comparison {
  return {
    a: { runId: "3f1c9a24-5b7e-4d61-9f0a-2c8e7b5d4a13", workflowVersionId: "v7", status: "failed" },
    b: { runId: "8b02de51-1c33-4a90-b7e2-9a1f6c4d2e70", workflowVersionId: "v7", status: "succeeded" },
    sameVersion: p.sameVersion ?? true,
    refusal: p.refusal ?? null,
    divergenceKey: p.divergenceKey ?? null,
    onlyInA: p.onlyInA ?? 0,
    onlyInB: p.onlyInB ?? 0,
    nodes: p.nodes,
  };
}

function Frame({ title, note, data }: { title: string; note: string; data: Comparison }) {
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      <Text variant="caption" tone="secondary" className="mb-3 mt-1 block max-w-[80ch]">{note}</Text>
      <CompareView comparison={data} onOpenVersionDiff={() => {}} />
    </section>
  );
}

const meta: Meta = { title: "App/Debug/Compare", parameters: { layout: "padded" } };
export default meta;

/** ACCEPTANCE: a different tool response is identified as the divergence. */
export const ToolResponseChanged: StoryObj = {
  name: "A tool came back with something else",
  render: () => {
    const diverging = node({
      name: "crm.search",
      statusA: "error", statusB: "ok",
      divergent: true,
      deltas: [
        { field: "status", a: "error", b: "ok",
          note: "One run's tool_call error; the other's ok." },
        { field: "outputRef", a: "9f2c1a44b0de", b: "1e77c0aa3b12",
          note: "This tool call returned different content. The reference is a hash of the result, so a different one means the result itself differed." },
        { field: "durationMs", a: 2_400, b: 240, note: null },
      ],
    });
    return (
      <Frame
        title="It worked yesterday — the tool did not"
        note="The divergence leads. Everything below it is downstream of it, so a list that
              treated all four differences equally would bury the answer among its own
              symptoms. The result reference is a SHA-256 of the content, so 'it returned
              something else' is exact rather than inferred."
        data={comparison({
          divergenceKey: diverging.key,
          nodes: [
            node({ name: "Ticket created", kind: "step" }),
            diverging,
            node({ name: "Notify customer", kind: "step",
                   statusA: "skipped", statusB: "ok",
                   deltas: [{ field: "status", a: "skipped", b: "ok",
                              note: "One run's step skipped; the other's ok." }] }),
          ],
        })}
      />
    );
  },
};

/** A branch taken differently: present in one and not the other. */
export const DifferentPath: StoryObj = {
  name: "The two runs took different paths",
  render: () => {
    const only = node({
      name: "Escalate to human", kind: "step",
      presence: "onlyA", statusA: "ok", statusB: null, divergent: true,
    });
    return (
      <Frame
        title="A branch went the other way"
        note="A node present in one run and not the other IS the selected-edge difference,
              in span terms — and it is the point where the two stopped doing the same
              thing."
        data={comparison({
          divergenceKey: only.key,
          onlyInA: 1,
          nodes: [node({ name: "Route", kind: "step" }), only],
        })}
      />
    );
  },
};

/** ACCEPTANCE: across versions, refuse and explain. */
export const RefusedAcrossVersions: StoryObj = {
  name: "Refused: different versions",
  render: () => (
    <Frame
      title="Two runs of two different workflows"
      note="Not a diff with a warning on top. Across versions every difference has two
            possible causes — the workflow changed, or the run behaved differently — and
            nothing in the diff can choose between them. Shown anyway it reads as a
            behaviour change and sends somebody hunting a flaky tool when a colleague
            edited a prompt."
      data={{
        ...comparison({ nodes: [] }),
        b: { runId: "8b02de51-1c33-4a90-b7e2-9a1f6c4d2e70", workflowVersionId: "v6", status: "succeeded" },
        sameVersion: false,
        refusal: {
          reason: "different workflow versions",
          explanation:
            "These runs executed different versions of the workflow, so a node-by-node " +
            "diff cannot tell a behaviour change from an edit. Every difference below " +
            "would have two possible causes and no way to choose between them.",
          offer: "Compare the two workflow versions instead, then compare two runs of the same version.",
        },
      }}
    />
  ),
};

/** ACCEPTANCE: a run against itself has no divergence. */
export const NoDivergence: StoryObj = {
  name: "The two runs did the same thing",
  render: () => (
    <Frame
      title="No divergence"
      note="'No divergence' and 'could not compare' render very differently, and the reader
            has to be able to trust the first. Comparing a run with itself lands here."
      data={comparison({
        nodes: [
          node({ name: "Ticket created", kind: "step" }),
          node({ name: "crm.search" }),
          node({ name: "Notify customer", kind: "step" }),
        ],
      })}
    />
  ),
};
