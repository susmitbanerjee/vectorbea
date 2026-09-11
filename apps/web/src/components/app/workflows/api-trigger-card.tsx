"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { toast } from "sonner";
import { Copy, Check } from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { getApiBaseUrl } from "~/lib/api/config";

/* ══════════════════════════════════════════════════════════════════════════════
   RUNNING A WORKFLOW FROM SOMEWHERE ELSE

   ── WHY THIS HAD TO EXIST ───────────────────────────────────────────────────
   `POST /api/workflows/:id/run` has been the product's front door since the
   beginning, and the UI never showed it. So the only way to find out that a
   workflow could be called from your own code was to read the API docs and
   assemble the URL by hand — which meant most people assumed it could not, and
   used the Run button as the only trigger there was.

   A workflow that can only be started by a person clicking is a different and
   much smaller product than one that can be called from a job, a webhook or
   somebody's backend. The capability was there; the sentence saying so was not.

   ── AND WHY IT SHOWS THE THREE MODES ────────────────────────────────────────
   `async`, `sync` and `stream` answer three genuinely different questions, and
   picking the wrong one is the most common way this endpoint disappoints:

     · async  — the default. Returns a run id immediately. Right for anything
                that takes more than a moment, which is most agent work.
     · sync   — blocks for the result, and DEGRADES rather than hanging: past
                the deadline it returns the run id and how to follow it.
     · stream — Server-Sent Events, chosen by the Accept header or `?mode=`
                and NOT by the body, because the response format is decided
                before the body is read.

   The third of those is worth stating explicitly here, because the API's own
   error message for getting it wrong is the only other place it is said.
══════════════════════════════════════════════════════════════════════════════ */

type Mode = "async" | "sync" | "stream";

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "async", label: "Async", blurb: "Returns a run id straight away. The default, and the right one for work that takes minutes." },
  { id: "sync", label: "Sync", blurb: "Waits for the result. Past the deadline it returns the run id instead of hanging." },
  { id: "stream", label: "Stream", blurb: "Server-sent events as the run progresses. Chosen by the header or the query string, never by the body." },
];

export function ApiTriggerCard({
  workflowId, workflowName, hasVersion,
}: {
  workflowId: string;
  workflowName: string;
  hasVersion: boolean;
}) {
  const [mode, setMode] = React.useState<Mode>("async");
  const base = getApiBaseUrl();
  const snippet = curlFor(base, workflowId, mode);

  return (
    <div className="grid gap-3">
      {!hasVersion ? (
        <div className="border-status-waiting-border bg-status-waiting-subtle rounded-sm border p-2.5">
          <Text variant="body-sm" tone="secondary" className="block leading-snug">
            This workflow has no published version yet, so the endpoint below exists but refuses
            every call with &ldquo;has no current version&rdquo;. Publish one and it starts working.
          </Text>
        </div>
      ) : null}

      <div>
        <Text variant="caption" tone="muted" className="mb-1 block">Endpoint</Text>
        <CopyLine value={`POST ${base}/api/workflows/${workflowId}/run`} />
      </div>

      <div>
        <Text variant="caption" tone="muted" className="mb-1.5 block">Response mode</Text>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setMode(entry.id)}
              aria-pressed={mode === entry.id}
              className={cn(
                "font-ui text-caption rounded-full border px-2.5 py-1",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                mode === entry.id
                  ? "bg-accent-subtle border-accent-border text-accent"
                  : "bg-surface-raised border-subtle text-fg-secondary hover:border-default",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
          {MODES.find((entry) => entry.id === mode)?.blurb}
        </Text>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <Text variant="caption" tone="muted">Call it</Text>
          <CopyButton value={snippet} label="Copy the request" />
        </div>
        <pre className="border-subtle bg-surface-sunken overflow-x-auto rounded-sm border p-2.5">
          <code className="font-code text-mono-sm text-fg-secondary whitespace-pre">{snippet}</code>
        </pre>
      </div>

      <div>
        <Text variant="caption" tone="muted" className="mb-1 block">What comes back</Text>
        <pre className="border-subtle bg-surface-sunken overflow-x-auto rounded-sm border p-2.5">
          <code className="font-code text-mono-sm text-fg-secondary whitespace-pre">
            {RESPONSES[mode]}
          </code>
        </pre>
        <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
          {mode === "sync"
            ? "`output` is what the workflow's output node emitted. When the run outlives the deadline the same call returns the run id with `status: \"running\"` instead — the work carries on, and you follow it by id."
            : mode === "stream"
              ? "Each event carries the node that produced it. The last one carries the same `output` the output node emitted."
              : "The run id is the handle for everything else — read it back with GET /api/runs/{runId}, whose `output` is what the output node emitted."}
        </Text>
      </div>

      <div className="border-subtle border-t pt-3">
        <Text variant="caption" tone="muted" className="block leading-snug">
          The key goes in the <span className="font-code">Authorization</span> header and is scoped
          to this workspace. A key inherits the member cap of whoever created it — it cannot spend
          more than they can.
        </Text>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild size="xs" variant="secondary">
            <Link href={"/api-keys" as Route}>Create an API key</Link>
          </Button>
          <Button asChild size="xs" variant="ghost">
            <Link href={"/settings/sdk" as Route}>SDK and docs</Link>
          </Button>
        </div>
      </div>

      <Text variant="caption" tone="disabled" className="block">
        Triggering {workflowName} this way is recorded with <span className="font-code">trigger_type: api</span> and is
        otherwise identical to pressing Run — the same quota, the same admission control, the same trace.
      </Text>
    </div>
  );
}

/* ── Snippets ─────────────────────────────────────────────────────────────── */

function curlFor(base: string, workflowId: string, mode: Mode): string {
  const url = `${base}/api/workflows/${workflowId}/run${mode === "stream" ? "?mode=stream" : ""}`;
  const lines = [
    `curl -X POST '${url}' \\`,
    `  -H 'Authorization: Bearer $VECTORBEA_API_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
  ];
  /* The Accept header is what actually selects SSE — `?mode=stream` above is
     the alternative, and both are shown because a caller who can set one often
     cannot set the other. */
  if (mode === "stream") lines.push(`  -H 'Accept: text/event-stream' \\`);
  lines.push(`  -d '${bodyFor(mode)}'`);
  return lines.join("\n");
}

function bodyFor(mode: Mode): string {
  const input = `"input": { "example": "your payload" }`;
  if (mode === "sync") {
    return `{ ${input}, "responseMode": "sync", "timeoutMs": 60000 }`;
  }
  /* No `responseMode` for stream: the API refuses it in the body with a message
     explaining that the format is chosen before the body is read, and printing
     a request that earns that error would be teaching the mistake. */
  if (mode === "stream") return `{ ${input} }`;
  return `{ ${input}, "idempotencyKey": "your-own-key" }`;
}

const RESPONSES: Record<Mode, string> = {
  async: `202 Accepted
{
  "runId": "3f9c…",
  "status": "QUEUED"
}`,
  sync: `200 OK
{
  "runId": "3f9c…",
  "status": "SUCCEEDED",
  "output": { … }        // the output node's result
}`,
  stream: `200 OK  (text/event-stream)

event: node.completed
data: {"node":"Draft the reply","status":"SUCCEEDED"}

event: run.completed
data: {"runId":"3f9c…","output":{ … }}`,
};

/* ── Copy ─────────────────────────────────────────────────────────────────── */

function CopyLine({ value }: { value: string }) {
  return (
    <div className="border-subtle bg-surface-sunken flex items-center gap-2 rounded-sm border p-2">
      <code className="font-code text-mono-sm text-fg-secondary min-w-0 flex-1 truncate">{value}</code>
      <CopyButton value={value} label="Copy the endpoint" />
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  /* The timer is cleared on unmount: this sits inside a tab that can close
     while the 1.4s is still running, and setting state after that is a leak
     React will warn about in development and nobody will read. */
  React.useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <Button
      size="xs"
      variant="ghost"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value)
          .then(() => setCopied(true))
          /* A clipboard write can be refused outright — an insecure origin, or
             a browser with the permission denied. Saying so beats a button that
             silently does nothing. */
          .catch(() => toast.error("The clipboard is not available here. Select the text and copy it."));
      }}
      iconLeft={<Icon icon={copied ? Check : Copy} size="sm" decorative />}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
