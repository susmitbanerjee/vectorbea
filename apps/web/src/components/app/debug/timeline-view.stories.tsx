import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { TimelineView } from "./timeline-view";
import type { TraceSpan } from "~/lib/api/trace";

/**
 * The waterfall.
 *
 * Three things it has to get right, none of which is visible in a screenshot of
 * a healthy single-tick run: parked time must read as parked, MISSING time must
 * read as missing, and concurrent work must read as concurrent.
 */

const T0 = Date.parse("2026-08-31T10:00:00.000Z");
let seq = 0;

function s(p: {
  kind: string; at: number; ms: number;
  name?: string; status?: string; selfMs?: number;
  spanId?: string; children?: TraceSpan[];
}): TraceSpan {
  seq += 1;
  return {
    spanId: p.spanId ?? `s${seq}`,
    parentSpanId: null,
    kind: p.kind as TraceSpan["kind"],
    name: p.name ?? p.kind,
    status: (p.status ?? "ok") as TraceSpan["status"],
    stepId: null,
    iterationIndex: null,
    startedAt: new Date(T0 + p.at).toISOString(),
    endedAt: new Date(T0 + p.at + p.ms).toISOString(),
    durationMs: p.ms,
    selfMs: p.selfMs ?? p.ms,
    failureClass: null,
    isRootCause: false,
    hasInput: false,
    hasOutput: false,
    tokensIn: null,
    tokensOut: null,
    costCents: null,
    childCount: p.children?.length ?? 0,
    children: p.children ?? [],
    truncated: false,
  };
}

function Frame({ title, note, spans, critical = [] }: {
  title: string; note: string; spans: TraceSpan[]; critical?: string[];
}) {
  const [sel, setSel] = React.useState<string | null>(null);
  return (
    <section className="mb-10">
      <Text variant="heading-md" tone="max">{title}</Text>
      <Text variant="caption" tone="muted" className="mt-1 mb-3 block max-w-[80ch]">{note}</Text>
      <div className="h-[26rem]">
        <TimelineView
          spans={spans}
          criticalPathIds={new Set(critical)}
          selectedSpanId={sel}
          onSelectSpan={setSel}
        />
      </div>
    </section>
  );
}

const meta: Meta = { title: "App/Debug/Timeline", parameters: { layout: "padded" } };
export default meta;

/** The shape §5.4 draws: a yielding run, parked on an approval. */
export const YieldingRun: StoryObj = {
  name: "A yielding run",
  render: () => (
    <Frame
      title="A yielding run, parked on an approval"
      note="The approval is hatched and labelled, so 2m38s of waiting reads as waiting and
            not as a hang. Tick 2 is marked, so the seam between the two halves of the run
            reads as a yield rather than a gap. The critical path is ringed."
      critical={["run", "tick1", "step-triage", "act-researcher", "tool-crm"]}
      spans={[
        s({
          kind: "run", at: 0, ms: 252_000, spanId: "run", name: "run", selfMs: 0,
          children: [
            s({ kind: "wait", name: "wait:queue", at: 0, ms: 2_000 }),
            s({
              kind: "tick", at: 2_000, ms: 12_000, spanId: "tick1", name: "tick 1",
              children: [
                s({
                  kind: "step", at: 2_000, ms: 12_000, spanId: "step-triage", name: "Triage",
                  selfMs: 400,
                  children: [
                    s({
                      kind: "activation", at: 2_100, ms: 3_000, name: "supervisor",
                      children: [
                        s({ kind: "iteration", at: 2_150, ms: 1_400, name: "iteration 1",
                            children: [s({ kind: "llm_call", at: 2_200, ms: 1_200, name: "gpt-4o-mini" })] }),
                        s({ kind: "handoff", at: 3_600, ms: 40, name: "DELEGATE → researcher" }),
                      ],
                    }),
                    s({
                      kind: "activation", at: 5_200, ms: 8_600, spanId: "act-researcher",
                      name: "researcher", status: "error",
                      children: [
                        s({ kind: "llm_call", at: 5_300, ms: 2_100, name: "gpt-4o" }),
                        s({ kind: "tool_call", at: 7_500, ms: 6_200, spanId: "tool-crm",
                            name: "crm.search", status: "error" }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            s({ kind: "wait", name: "wait:approval", at: 14_000, ms: 158_000 }),
            s({
              kind: "tick", at: 172_000, ms: 80_000, spanId: "tick2", name: "tick 2",
              children: [
                s({ kind: "step", at: 172_000, ms: 79_000, name: "Notify", selfMs: 200,
                    children: [s({ kind: "tool_call", at: 172_200, ms: 78_600, name: "slack.post" })] }),
              ],
            }),
          ],
        }),
      ]}
    />
  ),
};

/** The hole. Whitespace would say "idle"; this says "we do not know". */
export const UnaccountedTime: StoryObj = {
  name: "Unaccounted time",
  render: () => (
    <Frame
      title="A run with 40 seconds nobody recorded"
      note="Between the two ticks there is no span at all. Drawn as whitespace it reads as
            'the run was idle', which is exactly what a lost span looks like — so the bug
            hides behind the shape of the answer. Named, it is a work item. The header
            reports the total even when it is too small to draw."
      spans={[
        s({
          kind: "run", at: 0, ms: 100_000, spanId: "run", name: "run", selfMs: 0,
          children: [
            s({ kind: "tick", at: 0, ms: 20_000, name: "tick 1",
                children: [s({ kind: "step", at: 0, ms: 19_000, name: "Fetch" })] }),
            // 40 seconds of nothing at all
            s({ kind: "tick", at: 60_000, ms: 40_000, name: "tick 2",
                children: [s({ kind: "step", at: 60_000, ms: 39_000, name: "Summarise" })] }),
          ],
        }),
      ]}
    />
  ),
};

/** ACCEPTANCE: a three-way fan-out shows three overlapping bars. */
export const FanOut: StoryObj = {
  name: "A three-way fan-out",
  render: () => (
    <Frame
      title="A supervisor fanning out to three agents"
      note="The three activations share the same stretch of axis, because they ran at the
            same time. Laid out sequentially — one slice each — the picture would say the
            supervisor worked through them one at a time, which is the opposite of what
            happened."
      spans={[
        s({
          kind: "run", at: 0, ms: 12_000, spanId: "run", name: "run", selfMs: 0,
          children: [
            s({
              kind: "tick", at: 0, ms: 12_000, name: "tick 1",
              children: [
                s({
                  kind: "step", at: 0, ms: 12_000, name: "Research team", selfMs: 300,
                  children: [
                    s({ kind: "activation", at: 200, ms: 1_200, name: "supervisor" }),
                    s({ kind: "activation", at: 1_500, ms: 9_800, name: "researcher-a",
                        children: [s({ kind: "llm_call", at: 1_600, ms: 9_500, name: "gpt-4o" })] }),
                    s({ kind: "activation", at: 1_560, ms: 8_200, name: "researcher-b",
                        children: [s({ kind: "llm_call", at: 1_700, ms: 7_900, name: "gpt-4o" })] }),
                    s({ kind: "activation", at: 1_520, ms: 10_100, name: "researcher-c",
                        children: [s({ kind: "tool_call", at: 1_700, ms: 9_800, name: "web.search" })] }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ]}
    />
  ),
};

/** Virtualisation and the critical-path filter, at the size that needs them. */
export const LargeTrace: StoryObj = {
  name: "A 2000-span trace",
  render: () => {
    const kids: TraceSpan[] = [];
    for (let i = 0; i < 2_000; i += 1) {
      kids.push(s({
        kind: i % 3 === 0 ? "llm_call" : "tool_call",
        name: i % 3 === 0 ? `gpt-4o-mini #${i}` : `tool.call #${i}`,
        at: i * 60, ms: 45, spanId: `n${i}`,
        status: i === 1_337 ? "error" : "ok",
      }));
    }
    const trace = [
      s({
        kind: "run", at: 0, ms: 2_000 * 60, spanId: "run", name: "run", selfMs: 0,
        children: [s({ kind: "tick", at: 0, ms: 2_000 * 60, spanId: "tick", name: "tick 1", children: kids })],
      }),
    ];
    return (
      <Frame
        title="A 2000-span trace"
        note="Only the rows in view are in the DOM; the scrollbar is sized by arithmetic so
              it stays honest about how much there is. Tick 'Critical path only' — at this
              size it is the only view that fits, and the only one that answers what
              actually determined the duration."
        spans={trace}
        critical={["run", "tick", "n1337", "n900", "n1500"]}
      />
    );
  },
};
