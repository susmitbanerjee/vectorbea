"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { formatCost } from "~/lib/format";
import { RecoveryEngineIcon, RootCauseIcon, BlastRadiusIcon, CheckpointIcon } from "~/components/icons/domain";
import type { Diagnosis } from "~/mocks/run-detail";
import { useReplay } from "./replay";

/* ══════════════════════════════════════════════════════════════════════════════
   RECOVERY ENGINE — promoted from a tab to the first thing you read.

   A tab called "Recovery Engine" is a filing cabinet: the diagnosis exists, and
   the operator has to already suspect it is there. Directly under the header it
   is an answer, delivered before the question.

   Four facts and three actions, in the order they are needed:

     ROOT CAUSE    what broke — the connection, not the node that noticed
     FAILED AT     where, precisely enough to click
     BLAST RADIUS  what else this is taking down, so priority is obvious
     COMMITTED     what survived, and therefore what a retry actually costs

   COMMITTED IS THE ONE THAT MATTERS. "8 of 12 steps survived — retry costs 4
   steps, ~$0.0012" is the product thesis stated in money on the screen where it
   is load-bearing. Every other durable-execution product makes you infer this.
══════════════════════════════════════════════════════════════════════════════ */

export interface RecoveryCardProps {
  diagnosis: Diagnosis;
  onRetryStep: () => void;
  className?: string;
}

export function RecoveryCard({ diagnosis, onRetryStep, className }: RecoveryCardProps) {
  const { select } = useReplay();
  const d = diagnosis;

  return (
    <section
      aria-labelledby="recovery-heading"
      className={cn(
        "border-status-failed-border bg-status-failed-subtle overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <RecoveryEngineIcon size={17} aria-hidden="true" className="text-status-failed shrink-0" />
        <Text variant="body-sm" tone="inherit" as="h2" id="recovery-heading" className="text-status-failed font-medium">
          Recovery Engine
        </Text>
        <Text variant="caption" tone="muted" className="ml-auto font-code">
          {d.classification}
        </Text>
      </div>

      <dl className="grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-2">
        <Fact icon={RootCauseIcon} label="Root cause">
          <Text variant="body-sm" tone="primary" className="block">{d.rootCause}</Text>
        </Fact>

        <Fact label="Failed at">
          <button
            onClick={() => select(d.failedNode.index)}
            className={cn(
              "rounded-xs text-left outline-none focus-visible:focus-ring",
              "hover:text-accent transition-colors duration-fast",
            )}
          >
            <Text variant="body-sm" tone="primary" className="block">
              <span className="font-code">{d.failedNode.node.id}</span> · {d.failedNode.node.name}
            </Text>
            {d.toolCall ? (
              <Text variant="caption" tone="muted" className="block">
                tool call <span className="font-code">{d.toolCall}</span>
              </Text>
            ) : null}
          </button>
        </Fact>

        {d.blastRadius ? (
          <Fact icon={BlastRadiusIcon} label="Blast radius">
            <Text variant="body-sm" tone="primary" className="block">
              <Link href={"/workflows" as Route} className="hover:text-accent underline decoration-dotted underline-offset-2 rounded-xs outline-none focus-visible:focus-ring">
                <span className="tabular">{d.blastRadius.workflows}</span> workflows
              </Link>
              {" · "}
              <Link href={"/tools" as Route} className="hover:text-accent underline decoration-dotted underline-offset-2 rounded-xs outline-none focus-visible:focus-ring">
                <span className="tabular">{d.blastRadius.tools}</span> tools
              </Link>
              {d.blastRadius.queuedRuns > 0 ? (
                <>
                  {" · "}
                  <Link href={"/runs?q=status%3Aqueued" as Route} className="hover:text-accent underline decoration-dotted underline-offset-2 rounded-xs outline-none focus-visible:focus-ring">
                    <span className="tabular">{d.blastRadius.queuedRuns}</span> queued runs
                  </Link>
                </>
              ) : null}
              {" affected"}
            </Text>
          </Fact>
        ) : null}

        <Fact icon={CheckpointIcon} label="Committed">
          <Text variant="body-sm" tone="primary" className="block">
            <span className="text-status-success tabular">{d.committed}</span> of{" "}
            <span className="tabular">{d.total}</span> steps survived — retry costs{" "}
            <span className="tabular">{d.retryNodes}</span>{" "}
            {d.retryNodes === 1 ? "step" : "steps"},{" "}
            <span className="tabular">~{formatCost(d.retryCostUsd)}</span>
          </Text>
          <Text variant="caption" tone="muted" className="block">
            checkpointing saved <span className="tabular">{formatCost(d.savedUsd)}</span> and{" "}
            <span className="tabular">{d.committed}</span> re-fired side effects
          </Text>
        </Fact>
      </dl>

      <div className="border-status-failed-border flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        {d.connectionId ? (
          <Button asChild size="sm" variant="primary">
            <Link href={`/connections/${d.connectionId}` as Route}>Fix connection</Link>
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={onRetryStep}>
          Retry failed step
          <span className="tabular opacity-80">· {formatCost(d.retryCostUsd)}</span>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={(d.incidentId ? `/incidents/${d.incidentId}` : "/incidents") as Route}>
            {d.incidentId ? "View incident" : "Create incident"}
          </Link>
        </Button>
      </div>
    </section>
  );
}

function Fact({
  icon: Glyph, label, children,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 flex items-center gap-1.5">
        {Glyph ? <Glyph size={12} aria-hidden="true" className="text-fg-muted shrink-0" /> : null}
        <Text variant="eyebrow" tone="muted">{label}</Text>
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
