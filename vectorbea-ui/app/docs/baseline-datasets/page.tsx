export const metadata = {
  title: "Baseline Datasets - VectorBea Docs",
};

import Link from "next/link";
import { Database, Filter, Plus, RefreshCw, Star, Tag } from "lucide-react";
import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

// ── Dataset anatomy visual ────────────────────────────────────────────────────

function DatasetAnatomy() {
  const rows = [
    { id: "trace_a1b2", input: "Summarise this contract in 3 bullet points…", expected: "• Parties: Acme Corp…", golden: true  },
    { id: "trace_c3d4", input: "What is the penalty clause for late delivery?", expected: "Section 7.2 states…", golden: false },
    { id: "trace_e5f6", input: "Is this agreement subject to US law?",          expected: "Yes — clause 12…",  golden: false },
    { id: "trace_g7h8", input: "List all defined terms in the document.",        expected: "1. \"Agreement\"…",  golden: true  },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <Database size={13} className="text-primary" />
          <span className="text-[12px] font-semibold text-foreground">contract-qa-prod-aug</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">4 traces</span>
        </div>
        <span className="text-[10px] text-muted-foreground">Created 3 days ago</span>
      </div>
      <table className="w-full border-collapse text-left text-[12px]">
        <thead className="bg-muted/10 text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Trace ID</th>
            <th className="px-4 py-2 font-medium">Input (truncated)</th>
            <th className="px-4 py-2 font-medium">Expected output</th>
            <th className="px-4 py-2 font-medium">Golden?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border/50">
              <td className="px-4 py-2.5 font-mono text-muted-foreground">{row.id}</td>
              <td className="px-4 py-2.5 text-foreground max-w-[180px] truncate">{row.input}</td>
              <td className="px-4 py-2.5 text-muted-foreground max-w-[140px] truncate">{row.expected}</td>
              <td className="px-4 py-2.5">
                {row.golden ? (
                  <span className="flex items-center gap-1 text-amber-500">
                    <Star size={11} />
                    <span className="text-[10px] font-medium">Golden</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BaselineDatasetsPage() {
  return (
    <DocsPage
      eyebrow="Baseline Datasets"
      title="The foundation for evaluations and regression"
      lede="A baseline dataset is a named, versioned collection of real production traces used as the input set for evaluation runs and regression schedules. Datasets represent your ground truth — the cases a prompt must handle correctly."
    >
      <DocsSection
        id="what-is-a-dataset"
        title="What is a baseline dataset?"
        description="A dataset captures a snapshot of real traces: the rendered input, the LLM output at the time, and any golden annotations. It is reusable across many evaluation runs."
      >
        <DatasetAnatomy />
        <DocsCallout title="Datasets are immutable snapshots">
          Once created, a dataset&apos;s traces are frozen. Adding new production traces
          does not update existing datasets — you create a new dataset (or add traces
          to a draft). This ensures that evaluation results are reproducible: the same
          dataset run against the same prompt version always produces the same inputs.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="what-goes-in"
        title="What makes a good baseline dataset?"
        description="Dataset quality directly determines evaluation quality. A low-quality dataset gives you misleading scores."
      >
        <DocsCardGrid>
          <DocsCard
            title="Representative inputs"
            description="Include traces that cover the full range of inputs your users actually send — common cases, edge cases, and any known tricky inputs."
          />
          <DocsCard
            title="Recent production data"
            description="Use traces from the recent production window (last 7–30 days). Older traces may not reflect current user behaviour or data patterns."
          />
          <DocsCard
            title="Golden traces"
            description="Always include your golden traces. They represent must-pass cases. A dataset without golden traces may miss critical regressions."
          />
          <DocsCard
            title="Minimum size"
            description="Aim for at least 20 traces. Fewer than 10 produces statistically unreliable scores. Datasets of 50–200 traces provide good signal-to-noise ratio."
          />
        </DocsCardGrid>
        <DocsTable
          headers={["Dataset characteristic", "Good", "Avoid"]}
          rows={[
            ["Size",         "20–200 traces",                 "< 10 (unreliable scores)"],
            ["Recency",      "Last 7–30 days of production",  "6+ month old traces (stale patterns)"],
            ["Coverage",     "Diverse inputs, edge cases included", "Only the most common case"],
            ["Golden traces","At least 3–5 golden traces",   "No golden traces"],
            ["Environment",  "Production traces",             "Synthetic/test inputs only"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="how-to-use"
        title="How to create a baseline dataset"
      >
        <div className="space-y-3">
          {[
            { n: "1", title: "Go to the Traces view", body: "Open the Traces section in the sidebar. You will see a list of all recent runtime traces for your workspace." },
            { n: "2", title: "Filter to the target prompt", body: "Use the prompt filter to focus on the prompt you are working with. Optionally filter by environment (prod recommended) and time window." },
            { n: "3", title: "Select traces", body: "Select individual traces using the checkboxes, or select all visible traces. Look for a representative sample — include varied inputs and any known tricky cases." },
            { n: "4", title: "Create dataset", body: "Click 'Save as baseline dataset'. Enter a descriptive name (e.g. 'support-agent-prod-aug'). The dataset is created immediately." },
            { n: "5", title: "Add golden traces (optional)", body: "Open the dataset and mark individual traces as golden by clicking the star icon. This elevates them to must-pass status in evaluations." },
            { n: "6", title: "Use the dataset", body: "Your dataset is now available in the Evaluations and Regression views. Select it when creating a new evaluation run or regression schedule." },
          ].map((step) => (
            <div key={step.n} className="flex gap-4 rounded-xl border border-border/70 bg-card/95 p-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-bold text-primary">
                {step.n}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection
        id="reuse"
        title="Datasets are reusable"
        description="A single dataset can power many evaluation runs and regression schedules."
      >
        <DocsCallout title="Use the same dataset across runs">
          Reusing the same dataset across multiple evaluation runs lets you compare
          scores over time as you iterate on the prompt. If you change the dataset
          between runs, score differences could reflect dataset changes rather than
          prompt quality changes. Keep dataset changes intentional and documented.
        </DocsCallout>
        <DocsCardGrid>
          <DocsCard
            title="Evaluation runs"
            description="Each evaluation run selects a dataset as input. Run the same dataset against different prompt versions to A/B compare them."
          />
          <DocsCard
            title="Regression schedules"
            description="Regression schedules re-run an evaluation on a fixed dataset on a schedule. The dataset should represent the worst-case / most important inputs."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="connections"
        title="Related features"
      >
        <DocsCardGrid>
          <DocsCard
            title="Golden Traces →"
            description="Learn how to mark traces as golden and what that means for evaluation scoring."
          >
            <Link href={"/docs/golden-traces" as any} className="text-xs font-medium text-primary hover:underline">
              Golden Traces docs →
            </Link>
          </DocsCard>
          <DocsCard
            title="Evaluations →"
            description="See how datasets are used as the input for evaluation runs."
          >
            <Link href={"/docs/evaluations" as any} className="text-xs font-medium text-primary hover:underline">
              Evaluations docs →
            </Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
