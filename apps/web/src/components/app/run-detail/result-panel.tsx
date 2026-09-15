"use client";

import * as React from "react";
import { toast } from "sonner";
import type { contracts } from "@vectorbea/shared";
import { Copy, Check, CaretRight } from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { JsonViewer } from "./inspector";

/* ══════════════════════════════════════════════════════════════════════════════
   THE RESULT

   ── WHY THIS IS NOT ON A TAB, AND NOT ONLY IN THE INSPECTOR ─────────────────
   The run's output was already on this page: click the last step, and the
   inspector renders `outputJson`. That is correct and it was not findable.
   Somebody who ran a workflow to get an answer had to know that the answer
   lives behind the final node of a timeline, which is a thing you learn by
   being told, not by looking.

   So the result sits under the header, at full width, whenever there is one.
   The inspector's copy stays exactly as it was — it is the right thing when you
   are walking the timeline — and this is the right thing when you came for the
   answer.

   ── AND IT SAYS WHERE THE VALUE CAME FROM ───────────────────────────────────
   `output` is what the workflow's OUTPUT NODE emitted, and that is worth
   naming: it is the difference between "the run finished" and "the run
   produced this", and it is the same field an API caller reads back from
   `GET /api/runs/{id}` or gets inline from a `sync` trigger. Saying so here is
   what connects the screen to the endpoint — somebody who sees the shape on
   this page knows what their own code will receive.
══════════════════════════════════════════════════════════════════════════════ */

export function ResultPanel({
  detail, runId,
}: {
  detail: contracts.RunDetail | null;
  runId: string;
}) {
  const [showShape, setShowShape] = React.useState(false);

  const output = detail?.outputJson;
  const hasOutput = output !== undefined && output !== null
    && !(typeof output === "object" && Object.keys(output as object).length === 0);

  /*
   * A finished run with no output is a REAL and ordinary state — a workflow
   * whose last step posts to Slack has done its job and emitted nothing. Saying
   * so beats an empty panel, which reads as a value that failed to load.
   */
  const terminal = detail
    ? ["succeeded", "failed", "cancelled", "ceiling_exceeded"].includes(detail.status.toLowerCase())
    : false;

  if (!detail || (!hasOutput && !terminal)) return null;

  return (
    <section className="border-subtle bg-surface-raised rounded-lg border">
      <div className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <Text variant="label" tone="primary" className="block">Result</Text>
          <Text variant="caption" tone="muted" className="block leading-snug">
            {hasOutput
              ? "What the output node emitted. The same value an API caller reads back."
              : "This run finished without emitting one."}
          </Text>
        </div>
        {hasOutput ? <CopyButton value={JSON.stringify(output, null, 2)} /> : null}
      </div>

      <div className="p-3">
        {hasOutput ? (
          <JsonViewer value={output} />
        ) : (
          <Text variant="body-sm" tone="secondary" className="block leading-snug">
            Nothing was emitted. A workflow only produces a result when its graph has an output
            node — a run whose last step posts a message or writes a row has done its work and
            has nothing to return. Add an output node to the graph if a caller needs a value back.
          </Text>
        )}
      </div>

      {/*
        The bridge to the API. Collapsed by default because most visits are
        about the value, not about how to fetch it — but on this page the two
        questions are one click apart rather than one documentation site apart.
      */}
      <div className="border-subtle border-t">
        <button
          type="button"
          onClick={() => setShowShape((open) => !open)}
          aria-expanded={showShape}
          className={cn(
            "flex w-full items-center gap-1.5 px-3 py-2 text-left",
            "hover:bg-surface-hover transition-colors duration-fast",
            "outline-none focus-visible:focus-ring",
          )}
        >
          <Icon
            icon={CaretRight}
            size="sm"
            decorative
            className={cn(
              "text-fg-muted shrink-0",
              "transition-transform duration-fast ease-standard motion-reduce:transition-none",
              showShape && "rotate-90",
            )}
          />
          <Text variant="caption" tone="secondary">How to read this from your own code</Text>
        </button>

        {showShape ? (
          <div className="grid gap-2 px-3 pb-3">
            <Text variant="caption" tone="muted" className="block leading-snug">
              Every run is readable by id. The <span className="font-code">output</span> field below
              is the object above, verbatim.
            </Text>
            <pre className="border-subtle bg-surface-sunken overflow-x-auto rounded-sm border p-2.5">
              <code className="font-code text-mono-sm text-fg-secondary whitespace-pre">
{`GET /api/runs/${runId}

{
  "id": "${runId}",
  "status": "${detail.status}",
  "output": ${hasOutput ? "{ … }   // exactly what is shown above" : "null"}
}`}
              </code>
            </pre>
            <Text variant="caption" tone="muted" className="block leading-snug">
              A caller that does not want to poll can trigger the workflow with{" "}
              <span className="font-code">responseMode: &quot;sync&quot;</span>, which returns the same{" "}
              <span className="font-code">output</span> inline once the run finishes — and returns the
              run id instead if it outlives the deadline, rather than hanging.
            </Text>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <Button
      size="xs"
      variant="secondary"
      aria-label="Copy the result as JSON"
      onClick={() => {
        void navigator.clipboard.writeText(value)
          .then(() => setCopied(true))
          .catch(() => toast.error("The clipboard is not available here. Select the text and copy it."));
      }}
      iconLeft={<Icon icon={copied ? Check : Copy} size="sm" decorative />}
    >
      {copied ? "Copied" : "Copy JSON"}
    </Button>
  );
}
