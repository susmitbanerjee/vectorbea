export const metadata = {
  title: "Golden Traces - VectorBea Docs",
};

import Link from "next/link";
import { AlertTriangle, Shield, Star, Tag, XCircle } from "lucide-react";
import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

// ── Visual: golden trace in context ──────────────────────────────────────────

function GoldenTraceMockup() {
  const traces = [
    { id: "trace_001", prompt: "Summarise invoice #INV-991", status: "golden", label: "Golden" },
    { id: "trace_002", prompt: "What is the total amount due?", status: "normal", label: "" },
    { id: "trace_003", prompt: "Extract line items from PO-442", status: "golden", label: "Golden" },
    { id: "trace_004", prompt: "Is this a recurring charge?", status: "normal", label: "" },
    { id: "trace_005", prompt: "Flag any unusual payment terms", status: "golden", label: "Golden" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-3">
        <Star size={13} className="text-amber-500" />
        <span className="text-[12px] font-semibold text-foreground">Trace list — finance-parser prompt</span>
      </div>
      <div className="divide-y divide-border/50">
        {traces.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">{t.id}</span>
            <span className="flex-1 text-[12px] text-foreground">{t.prompt}</span>
            {t.status === "golden" ? (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                <Star size={9} />
                Golden
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">—</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GoldenTracesPage() {
  return (
    <DocsPage
      eyebrow="Golden Traces"
      title="Protect your most critical cases from regression"
      lede="Golden traces are real production traces you have hand-picked as critical reference cases. They represent the most important behaviours your prompts must handle correctly — the cases you can never afford to break."
    >
      <DocsSection
        id="what-are-golden-traces"
        title="What is a golden trace?"
        description="A golden trace is a regular trace with a metadata annotation. Marking a trace as golden does not change how it was captured or stored — it simply elevates its importance in evaluations."
      >
        <GoldenTraceMockup />
        <DocsCallout title="Annotations, not a separate system">
          Golden traces are not stored in a separate table or system. They are
          existing runtime traces with a <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono">is_golden = true</code> flag.
          This means you can mark any trace as golden retroactively, and
          unmarking a trace is equally simple. The annotation has no effect on
          production runtime behaviour.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="why-golden"
        title="Why mark a trace as golden?"
        description="Golden traces serve two purposes: they act as must-pass test cases in evaluations, and they anchor regression detection."
      >
        <DocsCardGrid>
          <DocsCard
            title="Critical user journeys"
            description="Mark traces that represent the core use cases your users depend on. If a prompt change breaks these, users notice immediately."
          />
          <DocsCard
            title="Known edge cases"
            description="Mark traces that previously caused bugs or regressions. A trace that tripped you up once should always be in your test set."
          />
          <DocsCard
            title="Compliance-critical inputs"
            description="If certain inputs must produce outputs that meet regulatory or legal requirements, mark them golden so they are always tested before deployment."
          />
          <DocsCard
            title="Highest-volume patterns"
            description="The inputs your users send most frequently should be golden. A regression on the most common query has outsized impact."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="golden-in-eval"
        title="How golden traces affect evaluations"
        description="Golden traces receive special treatment when included in a baseline dataset used for evaluation."
      >
        <DocsTable
          headers={["Scenario", "What happens"]}
          rows={[
            ["Golden trace check fails (non-critical check)", "Failure is flagged prominently in the results UI. Verdict may still be 'needs review' rather than 'blocked'."],
            ["Golden trace check fails (critical check)",     "Run is immediately set to 'blocked'. Promotion is prevented regardless of composite score."],
            ["All golden traces pass",                        "A 'golden pass' indicator appears on the run. Required for 'ready' verdict when golden traces are present."],
            ["Dataset has no golden traces",                  "Evaluation proceeds normally. No golden-specific behaviour."],
          ]}
        />
        <DocsCallout title="Best practice: always include golden traces">
          Every baseline dataset used for production evaluation should include at
          least 3–5 golden traces. Datasets that contain only non-golden traces can
          miss the regressions that matter most.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="how-to-use"
        title="How to mark a trace as golden"
      >
        <div className="space-y-3">
          {[
            { n: "1", title: "Open the Traces view", body: "Navigate to Traces in the sidebar. Find the trace you want to mark as golden — use search or filters to locate it." },
            { n: "2", title: "Open trace details", body: "Click the trace row to open the detail panel. You will see the full input, output, latency, and metadata." },
            { n: "3", title: "Click 'Mark as golden'", body: "In the trace detail panel, click the star icon or the 'Mark as golden' button. The trace is immediately annotated. This does not affect production." },
            { n: "4", title: "Add to a dataset", body: "When you next create or update a baseline dataset, include this trace. The golden annotation travels with the trace into the dataset." },
            { n: "5", title: "Run an evaluation", body: "Golden traces in the dataset are automatically treated as must-pass cases in any evaluation run using that dataset." },
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
        id="connections"
        title="Related features"
      >
        <DocsCardGrid>
          <DocsCard
            title="Baseline Datasets →"
            description="Golden traces are included in baseline datasets to ensure critical cases are always tested."
          >
            <Link href={"/docs/baseline-datasets" as any} className="text-xs font-medium text-primary hover:underline">
              Baseline Datasets docs →
            </Link>
          </DocsCard>
          <DocsCard
            title="Regression →"
            description="Regression schedules re-test your golden traces automatically on a schedule."
          >
            <Link href={"/docs/regression" as any} className="text-xs font-medium text-primary hover:underline">
              Regression docs →
            </Link>
          </DocsCard>
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
