"use client";

import * as React from "react";
import { ArrowRight, GitDiff, Prohibit, Target } from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { MonoId } from "~/components/ui/mono-id";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatCostCents, formatDuration, formatTokens } from "~/lib/format";
import type { CompareDelta, CompareNode, Comparison } from "~/lib/api/constellation";
import { TONE, toneForNodeStatus } from "./status-vocabulary";

/**
 * "It worked yesterday" — the view that answers it.
 *
 * ── LEAD WITH THE DIVERGENCE, NOT WITH A DIFF ───────────────────────────────
 * Two runs of one workflow part company ONCE and then differ in everything
 * downstream of that. A list of twelve deltas has buried the answer among its
 * own symptoms, so the first node that differs gets the top of the page and the
 * rest is evidence underneath it.
 *
 * ── AND REFUSE WHEN THE ANSWER WOULD MISLEAD ────────────────────────────────
 * Across workflow versions every difference has two possible causes — the
 * workflow changed, or the run behaved differently — and nothing in the diff can
 * choose between them. Rendering it anyway reads as a behaviour change and sends
 * somebody hunting a flaky tool when a colleague edited a prompt.
 */
export function CompareView({
  comparison,
  onOpenVersionDiff,
}: {
  comparison: Comparison;
  onOpenVersionDiff?: () => void;
}) {
  const { refusal, divergenceKey, nodes, a, b } = comparison;

  if (refusal) return <Refused refusal={refusal} a={a} b={b} onOpenVersionDiff={onOpenVersionDiff} />;

  const divergence = nodes.find((n) => n.key === divergenceKey) ?? null;
  const changed = nodes.filter((n) => n.deltas.length > 0 || n.presence !== "both");

  return (
    <div className="space-y-3">
      <RunPair a={a} b={b} />

      {divergence ? (
        <Divergence node={divergence} />
      ) : (
        <div className="rounded-md border border-status-success-border bg-status-success-subtle px-3 py-2">
          <Text variant="label" className="text-status-success">
            These two runs did the same thing
          </Text>
          <Text variant="caption" className="mt-0.5 block text-fg-secondary">
            Every step matched on status, result and timing. If one of them still
            behaved differently, the cause is outside what the trace records.
          </Text>
        </div>
      )}

      {changed.length > 0 && (
        <NodeTable nodes={changed} divergenceKey={divergenceKey} />
      )}
    </div>
  );
}

// ── The refusal ─────────────────────────────────────────────────────────────

function Refused({
  refusal, a, b, onOpenVersionDiff,
}: {
  refusal: NonNullable<Comparison["refusal"]>;
  a: Comparison["a"];
  b: Comparison["b"];
  onOpenVersionDiff?: () => void;
}) {
  return (
    <div className="space-y-3">
      <RunPair a={a} b={b} />

      <div className="rounded-md border border-status-waiting-border bg-status-waiting-subtle p-3">
        <div className="flex items-center gap-2">
          <Icon icon={Prohibit} size="sm" decorative className="text-status-waiting" />
          <Text variant="label" className="text-status-waiting">
            Not compared — {refusal.reason}
          </Text>
        </div>
        <Text variant="caption" className="mt-1 block max-w-[70ch] text-fg-secondary">
          {refusal.explanation}
        </Text>

        {/*
          THE OFFER, not a dead end. Refusing without saying what to do instead
          is how a reader concludes the feature is broken.
        */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Text variant="caption" className="text-fg-secondary">{refusal.offer}</Text>
          {onOpenVersionDiff && (
            <button
              type="button"
              onClick={onOpenVersionDiff}
              className={cn(
                "inline-flex items-center gap-1 rounded-xs px-1 text-xs text-fg-link",
                "transition-opacity hover:opacity-80 motion-reduce:transition-none",
                "focus-visible:focus-ring",
              )}
            >
              <Icon icon={GitDiff} size="xs" decorative />
              Compare the workflow versions
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The two runs ────────────────────────────────────────────────────────────

function RunPair({ a, b }: { a: Comparison["a"]; b: Comparison["b"] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <RunChip label="This run" run={a} />
      <Icon icon={ArrowRight} size="sm" decorative className="text-fg-muted" />
      <RunChip label="Compared with" run={b} />
    </div>
  );
}

function RunChip({ label, run }: { label: string; run: Comparison["a"] }) {
  const tone = run.status ? TONE[toneForNodeStatus(runToneOf(run.status))] : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Text variant="caption" className="text-fg-muted">{label}</Text>
      <MonoId value={run.runId} />
      {tone && (
        <span className={cn("rounded-xs px-1 py-0.5 text-[10px] font-medium", tone.fill, tone.text)}>
          {run.status}
        </span>
      )}
    </span>
  );
}

/** A RUN status onto the shared span vocabulary. */
function runToneOf(status: string): string {
  switch (status) {
    case "succeeded": return "ok";
    case "failed": return "error";
    case "running": return "running";
    case "cancelled": return "cancelled";
    default: return status;
  }
}

// ── The divergence ──────────────────────────────────────────────────────────

/**
 * The first node that differs, given the top of the page.
 *
 * Everything below it is downstream of it, so this is the sentence somebody can
 * act on and the table is the evidence they check it against.
 */
function Divergence({ node }: { node: CompareNode }) {
  return (
    <div className="rounded-md border-2 border-status-failed-border bg-status-failed-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon icon={Target} size="sm" decorative className="text-status-failed" />
        <Text variant="label" className="text-status-failed">
          They first differed at {node.name}
        </Text>
        <span className="rounded-xs border border-subtle px-1.5 py-0.5 text-[10px] text-fg-secondary">
          {node.kind.replace(/_/g, " ")}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {node.presence !== "both" ? (
          <Text variant="caption" className="block text-fg-secondary">
            {node.presence === "onlyA"
              ? "This step ran in this run and not in the other one — the two took different paths here."
              : "This step ran in the other run and not in this one — the two took different paths here."}
          </Text>
        ) : (
          node.deltas.map((d) => <DeltaLine key={d.field} delta={d} />)
        )}
      </div>
    </div>
  );
}

/**
 * One attribute delta, in the reader's terms.
 *
 * The note carries the meaning where the field name does not: `outputRef` says
 * nothing, "this tool call returned different content" says everything, and the
 * ref is a content hash so the claim is exact.
 */
function DeltaLine({ delta: d }: { delta: CompareDelta }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Text variant="caption" className="font-medium text-fg-max">{LABEL[d.field] ?? d.field}</Text>
        <span className="font-mono text-[11px] tabular-nums text-fg-primary">
          {render(d.field, d.a)}
        </span>
        <Icon icon={ArrowRight} size="xs" decorative className="text-fg-muted" />
        <span className="font-mono text-[11px] tabular-nums text-fg-primary">
          {render(d.field, d.b)}
        </span>
      </div>
      {d.note && (
        <Text variant="caption" className="block text-fg-secondary">{d.note}</Text>
      )}
    </div>
  );
}

const LABEL: Record<string, string> = {
  status: "Status",
  outputRef: "Result",
  inputRef: "Input",
  model: "Model",
  contextChars: "Prompt length",
  durationMs: "Duration",
  tokens: "Tokens",
  costCents: "Cost",
  iterationIndex: "Iteration",
};

function render(field: string, v: unknown): string {
  if (v == null) return "—";
  if (field === "durationMs" && typeof v === "number") return formatDuration(v);
  if (field === "costCents" && typeof v === "number") return formatCostCents(v);
  if (field === "tokens" && typeof v === "number") return formatTokens(v);
  if (field === "contextChars" && typeof v === "number") return `${v.toLocaleString()} chars`;
  return String(v);
}

// ── The evidence ────────────────────────────────────────────────────────────

/**
 * Every node that differs, in execution order, with the divergence marked.
 *
 * Nodes that matched are omitted entirely: on a forty-step workflow the two runs
 * usually agree about thirty-eight of them, and listing those is how the four
 * that matter get scrolled past.
 */
function NodeTable({
  nodes, divergenceKey,
}: {
  nodes: CompareNode[];
  divergenceKey: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-subtle bg-surface-raised">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">
          Steps that differ between the two runs, in execution order.
        </caption>
        <thead>
          <tr className="border-b border-subtle">
            <th scope="col" className="px-3 py-2 font-medium text-fg-secondary">Step</th>
            <th scope="col" className="px-3 py-2 font-medium text-fg-secondary">This run</th>
            <th scope="col" className="px-3 py-2 font-medium text-fg-secondary">The other</th>
            <th scope="col" className="px-3 py-2 font-medium text-fg-secondary">What differed</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr
              key={n.key}
              className={cn(
                "border-b border-subtle last:border-0",
                n.key === divergenceKey && "bg-status-failed-subtle",
              )}
            >
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5">
                  {n.key === divergenceKey && (
                    <Icon icon={Target} size="xs" decorative className="shrink-0 text-status-failed" />
                  )}
                  <span className={cn("text-fg-primary", n.key === divergenceKey && "font-medium")}>
                    {n.name}
                  </span>
                </span>
              </td>
              <td className="px-3 py-1.5"><StatusCell status={n.statusA} absent="did not run" /></td>
              <td className="px-3 py-1.5"><StatusCell status={n.statusB} absent="did not run" /></td>
              <td className="px-3 py-1.5 text-fg-secondary">
                {n.presence !== "both"
                  ? "Ran in only one of the two"
                  : n.deltas.map((d) => LABEL[d.field] ?? d.field).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusCell({ status, absent }: { status: string | null; absent: string }) {
  if (status == null) {
    return <span className="italic text-fg-muted">{absent}</span>;
  }
  const t = TONE[toneForNodeStatus(status)];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-xs px-1 py-0.5", t.fill, t.text)}>
      <Icon icon={t.icon} size="xs" decorative />
      <span className="text-[10px] font-medium">{t.label}</span>
    </span>
  );
}
