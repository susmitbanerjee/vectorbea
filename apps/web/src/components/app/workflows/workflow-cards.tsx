"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Heatstrip } from "~/components/charts/heatstrip";
import { formatCost, formatDuration, EMPTY } from "~/lib/format";
import {
  WorkflowStatusBadge, TriggerCell, SuccessRateCell, LastRunCell, TagList,
  EnvironmentChip, StepsCell,
} from "./atoms";
import { WorkflowRowActions, type WorkflowActionHandlers } from "./row-actions";
import type { Workflow } from "~/lib/workflows/model";

/* ══════════════════════════════════════════════════════════════════════════════
   CARD VIEW

   The table is the default because comparison across rows is the job. Cards
   exist for the other mode: a workspace of eight workflows where you are picking
   one, not scanning forty.

   The heatstrip is the same component at a larger cell size, not a different
   summary. A card that showed "83% success" where the row showed a strip would
   be two different claims about one workflow, and the strip is the one that
   shows a cluster of failures at the end rather than averaging it away.
══════════════════════════════════════════════════════════════════════════════ */

export function WorkflowCardGrid({
  workflows, isSelected, onToggleSelect, handlers, canBuild, onSelectTag, onOpenRun,
}: {
  workflows: Workflow[];
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string, index: number, shiftKey: boolean) => void;
  handlers: WorkflowActionHandlers;
  /** Developer and up — a viewer gets no row menu. */
  canBuild: boolean;
  onSelectTag: (tag: string) => void;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {workflows.map((workflow, index) => (
        <li key={workflow.id}>
          <WorkflowCard
            workflow={workflow}
            index={index}
            selected={isSelected(workflow.id)}
            onToggleSelect={onToggleSelect}
            canBuild={canBuild}
            handlers={handlers}
            onSelectTag={onSelectTag}
            onOpenRun={onOpenRun}
          />
        </li>
      ))}
    </ul>
  );
}

const WorkflowCard = React.memo(function WorkflowCard({
  workflow, index, selected, onToggleSelect, handlers, canBuild, onSelectTag, onOpenRun,
}: {
  workflow: Workflow;
  index: number;
  selected: boolean;
  onToggleSelect: (id: string, index: number, shiftKey: boolean) => void;
  handlers: WorkflowActionHandlers;
  /** Developer and up — a viewer gets no row menu. */
  canBuild: boolean;
  onSelectTag: (tag: string) => void;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <article
      className={cn(
        "bg-surface-raised border-subtle relative flex h-full flex-col gap-3 rounded-lg border p-3",
        "transition-colors duration-fast hover:border-default",
        selected && "border-accent-border bg-surface-selected",
      )}
    >
      <header className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(workflow.id, index, e.shiftKey); }}
          aria-label={`Select ${workflow.name}`}
          className="accent-accent mt-1 size-3.5 shrink-0 rounded-xs outline-none focus-visible:focus-ring"
        />

        <div className="min-w-0 flex-1">
          {/* The whole card is not a link — it holds a checkbox, a menu and an
              interactive heatstrip, and nesting those inside an anchor makes
              every one of them a navigation. The title is the link. */}
          <Link
            href={`/workflows/${workflow.id}` as Route}
            className={cn(
              "font-ui text-body-sm text-fg-primary hover:text-accent block truncate rounded-xs",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            {workflow.name}
          </Link>
          <Text variant="caption" tone="muted" className="mt-0.5 line-clamp-2 block">
            {workflow.description}
          </Text>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <WorkflowStatusBadge status={workflow.status} />
          <WorkflowRowActions workflow={workflow} handlers={handlers} canBuild={canBuild} />
        </div>
      </header>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <Text variant="eyebrow" tone="muted">Last 30 runs</Text>
          {workflow.hasRunData
            ? <SuccessRateCell rate={workflow.successRate30d} />
            : <Text variant="caption" tone="disabled">{EMPTY}</Text>}
        </div>
        {workflow.hasRunData ? <Heatstrip
          statuses={workflow.last30}
          runIds={workflow.last30RunIds}
          label={workflow.name}
          cellWidth={7}
          cellHeight={18}
          gap={2}
          onSelect={(_, runId) => { if (runId) onOpenRun(runId); }}
        /> : <Text variant="caption" tone="disabled">No runs yet</Text>}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Fact label="Trigger">
          <TriggerCell kind={workflow.trigger} summary={workflow.triggers[0]?.summary ?? workflow.trigger} />
        </Fact>
        <Fact label="Last run">
          <LastRunCell status={workflow.lastRunStatus} at={workflow.lastRunAt} />
        </Fact>
        <Fact label="Steps">
          <StepsCell steps={workflow.stepCount} agents={workflow.agentCount} tools={workflow.toolCount} />
        </Fact>
        <Fact label="Avg duration">
          <Text variant="caption" tone="secondary" tabular>{formatDuration(workflow.avgDurationMs)}</Text>
        </Fact>
        <Fact label="Spend 30d">
          <Text variant="caption" tone="secondary" tabular>{formatCost(workflow.spend30dUsd)}</Text>
        </Fact>
        <Fact label="Version">
          <span className="flex items-center gap-1">
            <Text variant="caption" tone={workflow.version === 0 ? "disabled" : "secondary"} tabular>
              {workflow.versionKnown === false && workflow.draftVersion === null ? "Published" : workflow.version === 0 ? EMPTY : `v${workflow.version}`}
            </Text>
            {workflow.draftVersion ? (
              <Text variant="caption" tone="inherit" className="text-status-waiting text-[10px]">
                draft v{workflow.draftVersion}
              </Text>
            ) : null}
          </span>
        </Fact>
      </dl>

      <footer className="border-subtle mt-auto flex flex-wrap items-center gap-2 border-t pt-2">
        <EnvironmentChip environment={workflow.environment} />
        <Text variant="caption" tone="muted" className="truncate">{workflow.owner}</Text>
        <span className="ml-auto"><TagList tags={workflow.tags} onSelect={onSelectTag} /></span>
      </footer>
    </article>
  );
});

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt><Text variant="caption" tone="disabled" className="text-[10px]">{label}</Text></dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
