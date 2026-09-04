import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { Text } from "~/components/ui/text";
import { TransportIndicator } from "./debug-tab";
import { CompletenessBanner } from "./states";
import type { TraceStreamStatus } from "~/lib/api/trace";

/**
 * Trace completeness — the banner that used to fire on healthy runs.
 *
 * The Debug tab showed amber text saying spans "were dropped while the writer
 * was under pressure", on a run the same page called complete and successful.
 * It came from `traceComplete`, a boolean meaning "the run span is closed": no
 * information about drops at all, and false on healthy finished runs because the
 * run span was written twice.
 *
 * A warning that fires on healthy runs is worse than no warning — it teaches
 * people that amber means nothing. So there are four states, `complete` renders
 * NOTHING, and amber is reserved for the one state that is actually a claim
 * about missing data. Toggle the theme in the toolbar; both must hold.
 */

/** The depth note the banner folds in, for the truncation row. */
function DepthNote() {
  return (
    <Text variant="caption" className="mt-0.5 block text-fg-muted">
      Showing 42 of 128 spans. Deeper levels load when you open them.
    </Text>
  );
}

function Row({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <Text variant="label" tone="max">{title}</Text>
      <Text variant="caption" tone="muted" className="mt-0.5 mb-3 block max-w-[76ch]">{note}</Text>
      <div className="max-w-[62ch] rounded-md border border-subtle bg-surface-base p-3">
        {children}
      </div>
    </section>
  );
}

const meta: Meta = {
  title: "App/Debug/Trace completeness",
  parameters: { layout: "padded" },
};
export default meta;

export const FourStates: StoryObj = {
  name: "The four states",
  render: () => (
    <div>
      <Row
        title="complete — the common case"
        note="Renders nothing at all. The box below is empty on purpose: a healthy
              finished run gets no banner, no reassurance, no colour. This is the
              state the old boolean got wrong."
      >
        <CompletenessBanner completeness={{ state: "complete", droppedSpans: 0, reason: null }} />
      </Row>

      <Row
        title="live — a status, not a warning"
        note="Neutral surface and secondary text. 'This run is still going' is not a
              problem, and colouring it amber is how the previous banner trained
              people to ignore amber."
      >
        <CompletenessBanner completeness={{
          state: "live", droppedSpans: 0,
          reason: "This run is still going, so more spans are still arriving.",
        }} />
      </Row>

      <Row
        title="partial — the only state allowed to claim loss"
        note="Amber, with the real count from agent_runs.dropped_spans, and a note
              on which views are affected. 'Some spans are missing' would be
              unactionable; 16 tells you whether to trust the waterfall."
      >
        <CompletenessBanner completeness={{
          state: "partial", droppedSpans: 16,
          reason: "The writer's buffer was full or a write failed, so 16 span(s) from " +
                  "this run were never recorded. The run itself was unaffected.",
        }} />
      </Row>

      <Row
        title="unavailable — could not be read, which is not the same as empty"
        note="Failure colour. Rendering an empty tree as the answer would say 'this
              run did nothing', a different and far more misleading claim."
      >
        <CompletenessBanner completeness={{
          state: "unavailable", droppedSpans: 0,
          reason: "The run record could not be read, so we cannot tell whether this trace is complete.",
        }} />
      </Row>

      <Row
        title="depth truncation — a fact about the request, never a warning"
        note="Everything was recorded; the client asked for three levels. Muted
              caption, no colour, and it appears under a complete trace too."
      >
        <CompletenessBanner completeness={{ state: "complete", droppedSpans: 0, reason: null }}>
          <DepthNote />
        </CompletenessBanner>
      </Row>
    </div>
  ),
};

export const Transport: StoryObj = {
  name: "Transport, which is not trace state",
  render: () => (
    <div>
      <Text variant="caption" tone="muted" className="mb-4 block max-w-[76ch]">
        SSE health used to share the amber box with &quot;spans are missing&quot;, so a
        reconnect looked like data loss. It is now a quiet inline indicator beside
        the view controls. Note that <code>open</code> renders nothing, and that
        polling avoids the word &quot;unavailable&quot;: updates are still arriving, just
        on a timer, and the trace is identical either way.
      </Text>
      {(["open", "connecting", "polling", "closed"] as TraceStreamStatus[]).map((s) => (
        <div key={s} className="mb-2 flex items-center gap-4">
          <Text variant="caption" tone="muted" className="w-24 shrink-0 font-mono">{s}</Text>
          <div className="rounded-sm border border-subtle bg-surface-base px-2 py-1">
            <TransportIndicator stream={s} />
          </div>
        </div>
      ))}
    </div>
  ),
};
