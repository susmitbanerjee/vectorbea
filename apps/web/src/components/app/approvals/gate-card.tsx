"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { formatDuration } from "~/lib/format";
import { formatSpan } from "~/lib/control/model";
import { slaState, type GateView } from "~/lib/approvals/model";
import { SlaRing } from "./sla-ring";
import { EscalationIcon, ApprovalGateIcon } from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   GATE CARD

   The screen this replaces rendered decision context as template chips — "risk
   score", "account name", "arr usd" — the NAMES of the values rather than the
   values. That is a placeholder shipped as a feature, and it makes the approval
   meaningless: a reviewer clicking Approve on "risk score" has approved nothing
   they can defend.

   So: resolved values, large, with their producing step one click away. The
   Evidence panel is the audit substrate — a human taking responsibility for an
   automated decision must be able to check the basis of it, and "trust the
   agent" is not a governance model.

   The Ribbon shows the reviewer the CONSEQUENCE: what has committed, and what
   runs the moment they approve.
══════════════════════════════════════════════════════════════════════════════ */

const RISK_STYLE: Record<GateView["risk"], string> = {
  low: "text-fg-muted border-subtle",
  medium: "text-fg-secondary border-default",
  high: "text-status-waiting border-status-waiting-border",
  critical: "text-status-failed border-status-failed-border",
};

export interface GateCardProps {
  gate: GateView;
  selected: boolean;
  cursored: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onApprove: () => void;
  onReject: () => void;
}

export function GateCard({
  gate, selected, cursored, expanded,
  onToggleSelect, onToggleExpand,
  onApprove, onReject,
}: GateCardProps) {
  const sla = slaState(gate);
  const pending = gate.status === "pending";
  const committed = gate.run?.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length ?? 0;
  const willRun = gate.run ? gate.run.nodes.length - committed - 1 : 0;

  return (
    <article
      data-gate={gate.id}
      aria-current={cursored ? "true" : undefined}
      className={cn(
        "border-subtle bg-surface-raised overflow-hidden rounded-lg border",
        "transition-colors duration-fast",
        cursored && "border-focus",
        selected && "bg-surface-selected",
      )}
    >
      {/* ── Head ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-3 p-3">
        {pending ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select gate on ${gate.workflowName}`}
            className="accent-accent mt-1 size-3.5 shrink-0 rounded-xs outline-none focus-visible:focus-ring"
          />
        ) : null}

        {gate.slaAvailable ? <SlaRing fraction={sla.fraction} remainingMs={sla.remainingMs} tone={sla.tone} /> : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text variant="body-sm" tone="max" className="font-medium">{gate.nodeName}</Text>
            <span className={cn("font-ui text-caption rounded-sm border px-1.5 py-0.5", RISK_STYLE[gate.risk])}>
              {gate.risk} risk
            </span>
            {gate.status !== "pending" ? (
              <span
                className={cn(
                  "font-ui text-caption rounded-full border px-2 py-0.5",
                  gate.status === "approved"
                    ? "text-status-success border-status-success-border bg-status-success-subtle"
                    : "text-status-failed border-status-failed-border bg-status-failed-subtle",
                )}
              >
                {gate.status === "approved" ? "Approved" : gate.status === "rejected" ? "Rejected" : "Changes requested"}
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={`/workflows` as Route}
              className="font-ui text-caption text-fg-secondary hover:text-accent rounded-xs underline decoration-dotted underline-offset-2 outline-none focus-visible:focus-ring"
            >
              {gate.workflowName}
            </Link>
            {gate.run ? (
              <Link
                href={`/runs/${gate.run.id}` as Route}
                className="rounded-xs outline-none focus-visible:focus-ring"
              >
                <MonoId value={gate.run.id} head={7} tail={4} srLabel="Run identifier" />
              </Link>
            ) : null}
            <Text variant="caption" tone="muted">
              requested {formatSpan(Date.now() - Date.parse(gate.requestedAt))} ago by {gate.requester}
            </Text>
          </div>

          {/* Escalation path — visible before the breach, not after. */}
          {gate.slaAvailable ? <div className="mt-1 flex items-center gap-1.5">
            <EscalationIcon size={12} aria-hidden="true" className={cn("shrink-0", sla.tone === "ok" ? "text-fg-disabled" : "text-status-waiting")} />
            <Text variant="caption" tone="muted">
              {sla.tone === "breached" ? (
                <span className="text-status-failed">
                  SLA breached — on timeout: {gate.escalatesTo}
                </span>
              ) : (
                <>{gate.approverGroup} → on timeout: {gate.escalatesTo}</>
              )}
            </Text>
          </div> : null}
        </div>
      </div>

      {/* ── Decision context, RESOLVED ─────────────────────────────────────── */}
      <div className="border-subtle border-t px-3 py-2.5">
        <Text variant="eyebrow" tone="muted" className="mb-2 block">Decision context</Text>
        {gate.context.length === 0 ? <Text variant="caption" tone="muted">No sanitized decision context was provided.</Text> : <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {gate.context.map((entry) => (
            <div key={entry.label} className="min-w-0">
              <dt><Text variant="caption" tone="muted">{entry.label}</Text></dt>
              <dd>
                <Text variant="body-sm" tone="max" className="block truncate font-medium">
                  {entry.value}
                </Text>
                <Text variant="caption" tone="disabled" className="block truncate font-code">
                  {entry.source}
                </Text>
              </dd>
            </div>
          ))}
        </dl>}
      </div>

      {/* ── Consequence ────────────────────────────────────────────────────── */}
      {gate.run ? (
        <div className="border-subtle border-t px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <Text variant="eyebrow" tone="muted">What your decision does</Text>
            <Text variant="caption" tone="muted">
              <span className="text-status-success tabular">{committed}</span> committed ·{" "}
              <span className="tabular">{willRun}</span> {willRun === 1 ? "step" : "steps"} run on approval
            </Text>
          </div>
          <CheckpointRibbon nodes={gate.run.nodes} size="sm" runId={`gate-${gate.id}`} />
        </div>
      ) : null}

      {/* ── Evidence ───────────────────────────────────────────────────────── */}
      <div className="border-subtle border-t">
        <button
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className={cn(
            "hover:bg-surface-hover flex w-full items-center gap-2 px-3 py-2 text-left",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
          )}
        >
          <ApprovalGateIcon size={13} aria-hidden="true" className="text-fg-muted shrink-0" />
          <Text variant="caption" tone="secondary">
            Evidence — {gate.evidence.length} {gate.evidence.length === 1 ? "step" : "steps"} produced these values
          </Text>
          <Chevron open={expanded} />
        </button>

        {expanded ? (
          <ul className="border-subtle border-t">
            {gate.evidence.map((step) => (
              <li key={step.nodeIndex} className="border-subtle flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-b-0">
                <span className="font-code text-fg-disabled tabular w-5 shrink-0 text-[11px]">
                  {step.nodeIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Text variant="caption" tone="primary" className="block truncate">{step.nodeName}</Text>
                  <Text variant="caption" tone="muted" className="block truncate font-code">{step.summary}</Text>
                </div>
                <Text variant="caption" tone="muted" tabular className="shrink-0">
                  {formatDuration(step.durationMs)}
                </Text>
                <div className="flex flex-wrap gap-1">
                  {step.produces.map((field) => (
                    <span key={field} className="bg-accent-subtle text-accent font-ui rounded-full px-1.5 py-0.5 text-[10px]">
                      {field}
                    </span>
                  ))}
                </div>
                {gate.run ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/runs/${gate.run.id}` as Route}>Open step</Link>
                  </Button>
                ) : null}
              </li>
            ))}

            {/* Decision audit — who, when, why, and the context at the time. */}
            {gate.audit.length > 0 ? (
              <li className="bg-surface-sunken px-3 py-2">
                <Text variant="eyebrow" tone="muted" className="mb-1.5 block">Decision audit</Text>
                <ol className="grid gap-1.5">
                  {gate.audit.map((entry, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-2">
                      <Text variant="caption" tone="muted" tabular className="shrink-0">
                        {new Date(entry.at).toISOString().replace("T", " ").slice(0, 16)}Z
                      </Text>
                      <Text variant="caption" tone="primary" className="font-code shrink-0">{entry.actor}</Text>
                      <Text variant="caption" tone="secondary">{entry.action}</Text>
                      {entry.reason ? (
                        <Text variant="caption" tone="muted" className="w-full pl-1">“{entry.reason}”</Text>
                      ) : null}
                      {entry.contextSnapshot ? (
                        <Text variant="caption" tone="disabled" className="w-full pl-1 font-code">
                          context at decision: {entry.contextSnapshot.map((c) => `${c.label}=${c.value}`).join(", ")}
                        </Text>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      {pending ? (
        <div className="border-subtle bg-surface-sunken flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
          <Button size="sm" variant="primary" onClick={onApprove}>Approve</Button>
          <Button size="sm" variant="danger" onClick={onReject}>Reject</Button>
          <Text variant="caption" tone="disabled" className="ml-auto hidden lg:block">
            a approve · r reject · Enter evidence
          </Text>
        </div>
      ) : (
        <div className="border-subtle bg-surface-sunken border-t px-3 py-2">
          <Text variant="caption" tone="muted">
            {gate.status === "approved" ? "Approved" : "Rejected"} by{" "}
            <span className="text-fg-primary font-code">{gate.decidedBy}</span>{" "}
            {gate.decidedAt ? `${formatSpan(Date.now() - gate.decidedAt)} ago` : ""}
            {gate.decisionReason ? ` — “${gate.decisionReason}”` : ""}
          </Text>
        </div>
      )}
    </article>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn("text-fg-muted ml-auto size-3 shrink-0 transition-transform duration-fast", open && "rotate-180")}
    >
      <path d="M3 4.5L6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
