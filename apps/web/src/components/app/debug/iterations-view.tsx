"use client";

import * as React from "react";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import type { PayloadRef, SpanDetail, TraceApi, TraceSpan } from "~/lib/api/trace";
import {
  KIND_LABEL, TONE_CLASSES, TONE_FOR_STATUS, TONE_LABEL, formatCost, formatDuration,
} from "./span-status";

/**
 * The inspector: one activation's iterations down the left, the detail on the
 * right. Layout follows §5.5.
 *
 * The decisions in that section that actually matter, and are implemented here:
 *
 *  - **Prompt and response collapsed by default.** Expanded they drown the page;
 *    removed entirely the tab is useless to the one person who can fix it.
 *  - **The truncation warning sits ON the prompt**, where the missing information
 *    is — not in a panel nobody opens.
 *  - **Parsed action beside the raw response**, so a repaired unparseable reply is
 *    visible AS a repair instead of looking like the model chose to think.
 *  - **Budget gauges are read, not deduced.** "It ran out of iterations" should be
 *    a bar that is full, not an inference from a stop reason.
 */
export function IterationsView({
  api,
  runId,
  spans,
  selectedSpanId,
  onSelectSpan,
}: {
  api: TraceApi;
  runId: string;
  spans: TraceSpan[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}) {
  /*
   * Until P6 emits activation and iteration spans, the closest real thing is a
   * step and the model/tool calls beneath it. Rendering that honestly beats
   * rendering an empty view labelled "coming soon" — the calls are what the
   * reader needs, and they exist today.
   */
  const groups = React.useMemo(() => collectGroups(spans), [spans]);
  const [activeGroup, setActiveGroup] = React.useState(0);
  const [diffWith, setDiffWith] = React.useState<string | null>(null);

  const group = groups[activeGroup];
  const selected =
    group?.calls.find((c) => c.spanId === selectedSpanId) ?? group?.calls[0] ?? null;

  if (groups.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-subtle bg-surface-raised">
        <div className="max-w-md text-center">
          <Text variant="body" className="text-fg-secondary">
            No agent iterations were recorded for this run.
          </Text>
          <Text variant="caption" className="mt-1 text-fg-muted">
            Only runs with an agent step produce iterations.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* ── Left rail: the iterations ─────────────────────────────────────── */}
      <div className="w-64 shrink-0 space-y-3">
        {groups.length > 1 && (
          <label className="block">
            <span className="text-xs text-fg-muted">Step</span>
            <select
              value={activeGroup}
              onChange={(e) => setActiveGroup(Number(e.target.value))}
              className={cn(
                "mt-1 w-full rounded-sm border border-default bg-surface-raised px-2 py-1.5 text-xs",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-border-focus",
              )}
            >
              {groups.map((g, i) => (
                <option key={g.step.spanId} value={i}>{g.step.name}</option>
              ))}
            </select>
          </label>
        )}

        <ol className="space-y-0.5" aria-label="Iterations">
          {group.calls.map((call, i) => {
            const tone = TONE_FOR_STATUS[call.status];
            const isSel = selected?.spanId === call.spanId;
            return (
              <li key={call.spanId}>
                <button
                  type="button"
                  onClick={() => onSelectSpan(call.spanId)}
                  aria-current={isSel ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
                    "transition-opacity hover:opacity-90 motion-reduce:transition-none",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2",
                    "focus-visible:outline-border-focus",
                    isSel && "bg-surface-selected",
                  )}
                >
                  <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASSES[tone].dot)} />
                  <span className="w-4 shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">{i + 1}</span>
                  <span className="flex-1 truncate text-xs text-fg-primary">
                    {KIND_LABEL[call.kind] ?? call.kind}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-fg-muted">
                    {formatDuration(call.durationMs)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <BudgetGauges group={group} />

        {/* Prompt diff between two iterations — usually the fastest route to
            "the model never got the data it needed". */}
        {group.calls.length > 1 && (
          <div className="space-y-1 border-t border-subtle pt-3">
            <label className="block text-xs text-fg-muted" htmlFor="diff-with">
              Compare prompt with
            </label>
            <select
              id="diff-with"
              value={diffWith ?? ""}
              onChange={(e) => setDiffWith(e.target.value || null)}
              className={cn(
                "w-full rounded-sm border border-default bg-surface-raised px-2 py-1.5 text-xs",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-border-focus",
              )}
            >
              <option value="">None</option>
              {group.calls
                .filter((c) => c.spanId !== selected?.spanId)
                .map((c, i) => (
                  <option key={c.spanId} value={c.spanId}>
                    Iteration {group.calls.indexOf(c) + 1}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* ── Right pane: the detail ────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        {selected ? (
          <SpanDetailPane api={api} runId={runId} span={selected} diffWithSpanId={diffWith} />
        ) : (
          <Text variant="body" className="text-fg-secondary">Select an iteration.</Text>
        )}
      </div>
    </div>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────

function SpanDetailPane({
  api, runId, span, diffWithSpanId,
}: {
  api: TraceApi;
  runId: string;
  span: TraceSpan;
  diffWithSpanId: string | null;
}) {
  const detail = useSpanDetail(api, runId, span.spanId);
  const other = useSpanDetail(api, runId, diffWithSpanId);
  const tone = TONE_FOR_STATUS[span.status];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Text variant="body" className="font-medium text-fg-max">{span.name}</Text>
        <span className={cn("text-xs", TONE_CLASSES[tone].text)}>{TONE_LABEL[tone]}</span>
        <span className="font-mono text-xs tabular-nums text-fg-muted">
          {formatDuration(span.durationMs)}
        </span>
        {span.tokensIn != null && (
          <span className="font-mono text-xs tabular-nums text-fg-muted">
            {(span.tokensIn + (span.tokensOut ?? 0)).toLocaleString()} tokens
          </span>
        )}
      </header>

      {detail.error && (
        <div className="rounded-sm border border-status-failed-border bg-status-failed-subtle p-3">
          <Text variant="caption" className="text-status-failed">{detail.error}</Text>
        </div>
      )}

      {/* PROMPT — collapsed, and carrying its own truncation warning. */}
      <PayloadPanel
        title="Prompt"
        payload={detail.data?.input ?? null}
        loading={detail.loading}
        absent={!span.hasInput}
      />

      {/* MODEL RESPONSE beside PARSED ACTION. */}
      <PayloadPanel
        title="Model response"
        payload={detail.data?.output ?? null}
        loading={detail.loading}
        absent={!span.hasOutput}
        parsedAction={detail.data?.attributes ?? null}
      />

      {detail.data?.errorJson && (
        <Section title="Error">
          <pre className="overflow-x-auto rounded-sm bg-surface-sunken p-2 font-mono text-[11px] text-fg-primary">
            {detail.data.errorJson}
          </pre>
        </Section>
      )}

      {diffWithSpanId && (
        <Section title="Prompt diff">
          {other.loading ? (
            <Text variant="caption" className="text-fg-muted">Loading…</Text>
          ) : (
            <PromptDiff
              a={other.data?.input?.value ?? null}
              b={detail.data?.input?.value ?? null}
            />
          )}
        </Section>
      )}
    </div>
  );
}

/**
 * A payload, fetched ON DEMAND and collapsed by default.
 *
 * Never arrives with the tree — a trace response that inlined prompts would be
 * measured in megabytes, and the reader opens perhaps one of them.
 */
function PayloadPanel({
  title, payload, loading, absent, parsedAction,
}: {
  title: string;
  payload: PayloadRef | null;
  loading: boolean;
  absent: boolean;
  parsedAction?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const redactions = parseRedactions(payload?.redactions);

  return (
    <Section
      title={title}
      right={
        payload && (
          <span className="font-mono text-[11px] tabular-nums text-fg-muted">
            {payload.sizeBytes.toLocaleString()} bytes
          </span>
        )
      }
    >
      {absent ? (
        <Text variant="caption" className="text-fg-muted">Not recorded for this span.</Text>
      ) : loading ? (
        <div className="h-4 w-40 animate-pulse rounded-xs bg-surface-sunken" />
      ) : (
        <>
          {/*
           * The truncation warning lives HERE, on the prompt, because that is
           * where the missing information is. A silently shortened prompt is one
           * of the hardest agent failures to diagnose, and a warning in a
           * separate panel is a warning nobody reads.
           */}
          {payload?.truncated && (
            <div className="mb-2 rounded-sm border border-status-waiting-border bg-status-waiting-subtle px-2 py-1.5">
              <Text variant="caption" className="text-status-waiting">
                This content was truncated before it was stored. What the model saw
                may be longer than what is shown here.
              </Text>
            </div>
          )}

          {redactions.length > 0 && (
            <div className="mb-2 rounded-sm border border-subtle bg-surface-sunken px-2 py-1.5">
              <Text variant="caption" className="text-fg-secondary">
                Redacted before storage: {redactions.join(", ")}. The gap is deliberate.
              </Text>
            </div>
          )}

          {parsedAction && (
            <div className="mb-2">
              {/* Parsed action beside the raw response. When the model emitted
                  something unparseable and it was repaired into a THINK, that
                  repair is visible rather than looking like a choice. */}
              <span className="text-[11px] uppercase tracking-wide text-fg-muted">Parsed action</span>
              <pre className="mt-1 overflow-x-auto rounded-sm bg-surface-sunken p-2 font-mono text-[11px] text-fg-primary">
                {prettyJson(parsedAction)}
              </pre>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn(
              "rounded-xs px-1 text-xs text-fg-link",
              "transition-opacity hover:opacity-80 motion-reduce:transition-none",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-border-focus",
            )}
          >
            {open ? "Hide" : "Show"} {title.toLowerCase()}
          </button>

          {open && (
            payload?.value ? (
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-sunken p-2 font-mono text-[11px] text-fg-primary">
                {payload.value}
              </pre>
            ) : payload?.url ? (
              <Text variant="caption" className="mt-2 block text-fg-muted">
                Stored outside the database.{" "}
                <a href={payload.url} className="text-fg-link underline" rel="noreferrer">
                  Open the full content
                </a>
              </Text>
            ) : (
              <Text variant="caption" className="mt-2 block text-fg-muted">
                Content is no longer available — it may have passed its retention window.
              </Text>
            )
          )}
        </>
      )}
    </Section>
  );
}

function BudgetGauges({ group }: { group: Group }) {
  const used = group.calls.length;
  const tokens = group.calls.reduce((n, c) => n + (c.tokensIn ?? 0) + (c.tokensOut ?? 0), 0);
  const cost = group.calls.reduce((n, c) => n + (c.costCents ?? 0), 0);
  const time = group.step.durationMs ?? 0;

  return (
    <div className="space-y-2 border-t border-subtle pt-3">
      <span className="text-xs text-fg-muted">Budget</span>
      <Gauge label="Iterations" value={used} display={`${used}`} pct={null} />
      <Gauge label="Tokens" value={tokens} display={tokens.toLocaleString()} pct={null} />
      <Gauge label="Cost" value={cost} display={formatCost(cost)} pct={null} />
      <Gauge label="Time" value={time} display={formatDuration(time)} pct={null} />
      <Text variant="caption" className="text-fg-muted">
        Ceilings are not yet exposed per step, so these read as totals rather than
        as bars against a limit.
      </Text>
    </div>
  );
}

function Gauge({ label, display, pct }: { label: string; value: number; display: string; pct: number | null }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="text-[11px] text-fg-secondary">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-fg-primary">{display}</span>
      </div>
      {pct != null && (
        <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className={cn("h-full rounded-full", pct > 0.9 ? "bg-status-failed" : "bg-status-live")}
            style={{ width: `${Math.min(100, pct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Section({ title, right, children }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-subtle bg-surface-raised p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Line-level diff. Enough to answer "what changed", without a dependency. */
function PromptDiff({ a, b }: { a: string | null; b: string | null }) {
  if (!a || !b) {
    return <Text variant="caption" className="text-fg-muted">Expand both prompts to compare them.</Text>;
  }
  const aLines = new Set(a.split("\n"));
  const bLines = b.split("\n");
  return (
    <pre className="max-h-64 overflow-auto rounded-sm bg-surface-sunken p-2 font-mono text-[11px]">
      {bLines.map((line, i) => (
        <div key={i} className={aLines.has(line) ? "text-fg-muted" : "text-status-success"}>
          {aLines.has(line) ? "  " : "+ "}{line}
        </div>
      ))}
    </pre>
  );
}

// ── Data ────────────────────────────────────────────────────────────────────

function useSpanDetail(api: TraceApi, runId: string, spanId: string | null) {
  const [data, setData] = React.useState<SpanDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!spanId) { setData(null); return; }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    api
      .span(runId, spanId, ac.signal)
      .then(setData)
      /* See the note in debug-tab: an abort here is our own cleanup, and the
         transport reports it as kind "aborted", not as an AbortError. */
      .catch((e: unknown) => {
        const aborted =
          (e instanceof Error && e.name === "AbortError") ||
          (typeof e === "object" && e !== null && (e as { kind?: string }).kind === "aborted");
        if (!aborted) setError(e instanceof Error ? e.message : "Could not load this span.");
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [api, runId, spanId]);

  return { data, loading, error };
}

interface Group { step: TraceSpan; calls: TraceSpan[] }

function collectGroups(spans: TraceSpan[]): Group[] {
  const out: Group[] = [];
  const walk = (list: TraceSpan[]) =>
    list.forEach((s) => {
      if (s.kind === "step") {
        const calls = s.children.filter((c) => c.kind === "llm_call" || c.kind === "tool_call");
        if (calls.length > 0) out.push({ step: s, calls });
      }
      walk(s.children);
    });
  walk(spans);
  return out;
}

function parseRedactions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ label: string; count: number }>;
    return parsed.map((r) => `${r.label} (${r.count})`);
  } catch { return []; }
}

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}
