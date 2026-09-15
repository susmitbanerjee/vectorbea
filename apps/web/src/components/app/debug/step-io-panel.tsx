"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import type { PayloadRef, SpanDetail, TraceApi, TraceSpan } from "~/lib/api/trace";
import { parseRedactions } from "./iterations-view";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT ONE STEP RECEIVED AND RETURNED.

   A pipeline of agents hands data forward through step inputs, not through
   recorded handoffs, so the constellation has no edge to hover. This is the
   same question asked of a node instead: read from the step span's input and
   output payloads, which the worker stores redacted.

   Fields, not a JSON blob. Each top-level key is a labelled block and a long
   string wraps as text, because the answer is usually "this field was empty"
   or "this is the text it wrote", and both read faster as prose.
══════════════════════════════════════════════════════════════════════════════ */

export function StepIoPanel({
  api, runId, spans, stepId, title,
}: {
  api: TraceApi;
  runId: string;
  spans: TraceSpan[];
  stepId: string | null | undefined;
  title: string;
}) {
  const span = React.useMemo(() => (stepId ? lastStepSpan(spans, stepId) : null), [spans, stepId]);
  const spanId = span?.spanId ?? null;
  const [detail, setDetail] = React.useState<SpanDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDetail(null);
    setError(null);
    if (!spanId) return;
    const ac = new AbortController();
    setLoading(true);
    api.span(runId, spanId, { content: true }, ac.signal)
      .then(setDetail)
      .catch((e: unknown) => {
        if (isAborted(e)) return;
        setError(e instanceof Error ? e.message : "Could not load this step.");
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [api, runId, spanId]);

  const failure = detail?.errorJson ? reasonOf(detail.errorJson) : null;
  const recorded = Boolean(span?.hasInput || span?.hasOutput);

  return (
    <div className="rounded-lg border border-subtle bg-surface-raised p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Text variant="label" tone="max">{title}</Text>
        {span ? <Text variant="caption" tone="secondary">{STATUS[span.status] ?? span.status}</Text> : null}
      </div>

      {failure ? (
        <div className="mt-2 rounded-md border border-status-failed-border bg-status-failed-subtle px-2 py-1.5">
          <Text variant="body-sm" tone="inherit" className="block break-words text-status-failed">{failure}</Text>
        </div>
      ) : null}

      {!span ? (
        <Text variant="caption" tone="muted" className="mt-2 block">No record of this step in the trace.</Text>
      ) : !recorded ? (
        <Text variant="caption" tone="muted" className="mt-2 block">Inputs and outputs were not recorded for this run.</Text>
      ) : loading ? (
        <div className="mt-2 h-24 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none" aria-busy="true" />
      ) : error ? (
        <Text variant="caption" tone="inherit" className="mt-2 block text-status-failed">{error}</Text>
      ) : (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <PayloadFields title="Received" present={span.hasInput} payload={detail?.input ?? null} />
          <PayloadFields title="Returned" present={span.hasOutput} payload={detail?.output ?? null} />
        </div>
      )}
    </div>
  );
}

const STATUS: Record<string, string> = {
  ok: "Completed",
  error: "Failed",
  paused: "Paused",
  skipped: "Skipped",
  running: "Running",
};

function PayloadFields({ title, present, payload }: { title: string; present: boolean; payload: PayloadRef | null }) {
  const fields = React.useMemo(() => (payload?.value ? toFields(payload.value) : null), [payload?.value]);
  /* The column holds "[]" when nothing was masked, which is not a redaction. */
  const masked = parseRedactions(payload?.redactions);

  return (
    <div className="min-w-0">
      <Text variant="caption" tone="secondary" className="block">{title}</Text>
      <div className="mt-1 grid gap-2">
        {!present ? (
          <Text variant="body-sm" tone="muted">Nothing</Text>
        ) : !payload ? (
          <Text variant="body-sm" tone="muted">No longer available</Text>
        ) : !payload.value && payload.url ? (
          <a href={payload.url} rel="noreferrer" className="font-ui text-caption text-fg-link underline">Open full content</a>
        ) : fields === null ? (
          <Text variant="body-sm" tone="muted">Nothing</Text>
        ) : fields.length === 0 ? (
          <Text variant="body-sm" tone="muted">Empty</Text>
        ) : (
          fields.map((f) => <FieldBlock key={f.key} field={f} />)
        )}
        {payload?.truncated ? <Text variant="caption" tone="muted">Shortened before it was stored.</Text> : null}
        {masked.length > 0 ? <Text variant="caption" tone="muted">Masked: {masked.join(", ")}</Text> : null}
      </div>
    </div>
  );
}

type Field = { key: string; kind: "text" | "value" | "structured" | "empty"; text: string };

function FieldBlock({ field }: { field: Field }) {
  return (
    <div className="min-w-0">
      <Text variant="caption" tone="muted" className="block">{field.key}</Text>
      {field.kind === "empty" ? (
        <Text variant="body-sm" tone="inherit" className="block text-status-waiting">Empty</Text>
      ) : field.kind === "value" ? (
        <Text variant="body-sm" tone="primary" className="block break-words">{field.text}</Text>
      ) : (
        <div className="mt-0.5 max-h-60 overflow-auto rounded-sm border border-subtle bg-surface-sunken p-2">
          <Text
            variant={field.kind === "structured" ? "mono-sm" : "body-sm"}
            tone="secondary"
            className={cn("block whitespace-pre-wrap break-words", field.kind === "text" && "leading-relaxed")}
          >
            {field.text}
          </Text>
        </div>
      )}
    </div>
  );
}

/** Top-level keys as labelled blocks. A payload that is not a JSON object becomes one block. */
export function toFields(raw: string): Field[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.trim() ? [{ key: "Content", kind: "text", text: raw }] : null;
  }
  /* Stored text comes back JSON-encoded from an older API: a string whose content
     is itself the JSON object. Unwrap once so its fields are labelled. */
  if (typeof parsed === "string") {
    const text = parsed;
    const inner = text.trim();
    if (!inner) return null;
    if (inner.startsWith("{") || inner.startsWith("[")) {
      try { parsed = JSON.parse(inner); } catch { return [{ key: "Content", kind: "text", text }]; }
    }
  }
  if (parsed === null || parsed === undefined) return null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) return [fieldOf("Content", parsed)];
  return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => fieldOf(k, v));
}

function fieldOf(key: string, value: unknown): Field {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return { key, kind: "empty", text: "" };
  }
  if (typeof value === "string") {
    return value.length > 80 || value.includes("\n")
      ? { key, kind: "text", text: value }
      : { key, kind: "value", text: value };
  }
  if (typeof value === "number" || typeof value === "boolean") return { key, kind: "value", text: String(value) };
  return { key, kind: "structured", text: JSON.stringify(value, null, 2) };
}

/** The most recent execution of a step: a retried or resumed step has several. */
function lastStepSpan(spans: TraceSpan[], stepId: string): TraceSpan | null {
  let found: TraceSpan | null = null;
  const walk = (list: TraceSpan[]) => {
    for (const s of list) {
      if (s.kind === "step" && s.stepId === stepId && (!found || s.startedAt >= found.startedAt)) found = s;
      if (s.children.length > 0) walk(s.children);
    }
  };
  walk(spans);
  return found;
}

function reasonOf(errorJson: string): string | null {
  try {
    const parsed = JSON.parse(errorJson) as { reason?: unknown; message?: unknown };
    const text = parsed.reason ?? parsed.message;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return errorJson.trim() || null;
  }
}

function isAborted(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  return typeof e === "object" && e !== null && (e as { kind?: string }).kind === "aborted";
}
