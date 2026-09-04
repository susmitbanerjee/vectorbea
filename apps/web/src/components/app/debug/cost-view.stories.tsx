import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { CostView } from "./cost-view";
import type {
  Burndown, BurndownBand, BurndownCeiling, BurndownMarker,
} from "~/lib/api/constellation";

/**
 * The burn-down.
 *
 * Answers "why did this run cost 31 cents" with a NAME. The parts that only
 * show under stress: a clamp is marked (it is the reason a worker
 * underperformed and is otherwise invisible), a ceiling names whose limit it is,
 * and money the spans cannot attribute is stated rather than absorbed.
 */

function band(p: {
  name: string; depth: number; role?: string;
  points: Array<[number, number, number]>;   // atMs, cumulative cents, cumulative tokens
  id?: string | null;
}): BurndownBand {
  const last = p.points[p.points.length - 1]!;
  return {
    activationId: p.id === null ? null : (p.id ?? p.name),
    agentName: p.name,
    role: p.role ?? "worker",
    depth: p.depth,
    tokens: last[2],
    costCents: last[1],
    iterations: p.points.length,
    shareOfCost: 0,
    points: p.points.map(([atMs, costCents, tokens], i) => ({
      atMs, costCents, tokens, iterations: i + 1,
    })),
  };
}

function withShares(bands: BurndownBand[]): BurndownBand[] {
  const total = bands.reduce((n, b) => n + b.costCents, 0);
  return bands.map((b) => ({ ...b, shareOfCost: total > 0 ? b.costCents / total : 0 }));
}

function burndown(p: {
  bands: BurndownBand[];
  ceilings?: BurndownCeiling[];
  markers?: BurndownMarker[];
  recordedTotalCents?: number | null;
  durationMs?: number;
}): Burndown {
  const bands = withShares(p.bands);
  const attributed = bands.reduce((n, b) => n + b.costCents, 0);
  const recorded = p.recordedTotalCents === undefined ? attributed : p.recordedTotalCents;
  const diff = (recorded ?? 0) - attributed;
  const agrees = recorded == null || Math.abs(diff) <= 0.005;
  return {
    runId: "r",
    startedAtMs: 0,
    durationMs: p.durationMs ?? 180_000,
    bands,
    ceilings: p.ceilings ?? [],
    markers: p.markers ?? [],
    reconciliation: {
      attributedCents: attributed,
      unattributedCents: diff,
      recordedTotalCents: recorded,
      agrees,
      note: agrees ? null
        : diff > 0
          ? "The run's recorded total is more than the spans account for. Spend recorded as a run event but never on a span cannot be attributed to an agent."
          : "The spans account for more than the run's recorded total. The run row is summed from run events, which only the model-call executor writes.",
    },
  };
}

function Frame({ title, note, data }: { title: string; note: string; data: Burndown }) {
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      <Text variant="caption" tone="secondary" className="mb-3 mt-1 block max-w-[80ch]">{note}</Text>
      <CostView burndown={data} />
    </section>
  );
}

const meta: Meta = { title: "App/Debug/Cost", parameters: { layout: "padded" } };
export default meta;

/** A team run that hit its team budget, with a clamped child. */
export const TeamRun: StoryObj = {
  name: "A team that hit its ceiling",
  render: () => (
    <Frame
      title="A team run that hit its budget"
      note="The ceiling names WHOSE limit it is — 'this run cost 40 of its 100' is a
            different sentence depending on whether the 100 was the workspace's or the
            team's. The crossing point is where the STACK passed the line, not where any
            one band did. The clamp is marked because it is the reason the writer
            underperformed, and nothing else on any screen says so."
      data={burndown({
        durationMs: 180_000,
        bands: [
          band({ name: "supervisor", depth: 0, role: "supervisor",
                 points: [[0, 2.5, 800], [40_000, 4.25, 1_400], [170_000, 5.0, 1_700]] }),
          band({ name: "researcher", depth: 1,
                 points: [[20_000, 6.0, 3_100], [90_000, 21.0, 11_800], [150_000, 26.0, 14_900]] }),
          band({ name: "writer", depth: 1,
                 points: [[60_000, 3.0, 1_200], [120_000, 5.0, 2_100]] }),
        ],
        ceilings: [
          { dimension: "cost", limit: 30, source: "team budget", crossedAtMs: 120_000 },
          { dimension: "cost", limit: 100, source: "workspace", crossedAtMs: null },
          { dimension: "tokens", limit: 20_000, source: "team budget", crossedAtMs: null },
        ],
        markers: [
          { kind: "clamp", atMs: 60_000, label: "Budget clamped",
            detail: "Reduced: tokens, iterations", activationId: "writer" },
          { kind: "ceiling", atMs: 120_000, label: "Budget exceeded",
            detail: "The team's 30¢ ceiling was reached; the run was stopped.",
            activationId: "researcher" },
        ],
      })}
    />
  ),
};

/** ACCEPTANCE: a single-agent run degrades to one band and still answers. */
export const SingleAgent: StoryObj = {
  name: "A single-agent run",
  render: () => (
    <Frame
      title="One agent, one band"
      note="'Why did this cost 31 cents' has an answer either way. The table still gives the
            name, the tokens and the share; the chart still shows when it was spent."
      data={burndown({
        durationMs: 42_000,
        bands: [
          band({ name: "triage", depth: 0,
                 points: [[0, 8.0, 2_400], [15_000, 19.5, 6_100], [40_000, 31.0, 9_800]] }),
        ],
        ceilings: [{ dimension: "cost", limit: 100, source: "workspace", crossedAtMs: null }],
      })}
    />
  ),
};

/** The two write paths disagreeing — reported, never rescaled. */
export const Unreconciled: StoryObj = {
  name: "Two records that disagree",
  render: () => (
    <Frame
      title="The spans and the run row do not agree"
      note="A run's cost is written twice, in two units, by two paths that are not derived
            from each other. Rescaling the bands to match would draw a chart that adds up
            perfectly and lies about where the money went — so the gap is named, and the
            header says which figure the chart is drawing."
      data={burndown({
        durationMs: 60_000,
        bands: [
          band({ name: "supervisor", depth: 0, points: [[0, 4.0, 1_200], [50_000, 9.0, 3_400]] }),
          band({ name: "Unattributed", depth: 0, id: null,
                 points: [[30_000, 3.0, 900]] }),
        ],
        recordedTotalCents: 31,
      })}
    />
  ),
};
