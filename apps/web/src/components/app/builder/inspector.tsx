"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Kbd } from "~/components/ui/kbd";
import { CATEGORY_LABEL, type Issue, type IssueCategory, type ValiditySummary } from "./validation";
import type { HistoryEntry } from "./store";
import { LocalTime } from "~/components/ui/local-time";

/* ══════════════════════════════════════════════════════════════════════════════
   RIGHT INSPECTOR — the shell.

   Node configuration is P16. What lives here now is everything ABOUT the graph
   rather than about one node: the counts, the validation queue, whether a replay
   is available, and the history stack.

   THE ISSUE LIST IS A WORK QUEUE, not a report. Hovering an issue highlights its
   node on the canvas; clicking selects it and brings it into view. An inspector
   that names a problem without taking you to it makes you hunt through forty
   nodes for something the app already knows the position of.
══════════════════════════════════════════════════════════════════════════════ */

export type InspectorTab = "issues" | "history";

export interface InspectorProps {
  nodeCount: number;
  edgeCount: number;
  selection: string[];
  selectedNodeName: string | null;
  issues: Issue[];
  summary: ValiditySummary;
  history: HistoryEntry[];
  cursor: number;
  /** Runs exist for this workflow, so the canvas can replay one. */
  replayAvailable: boolean;
  replayCount: number;
  onHoverIssue: (nodeId: string | null) => void;
  onSelectIssue: (nodeId: string | null) => void;
  onJumpHistory: (cursor: number) => void;
  onOpenReplay: () => void;
}

export function Inspector({
  nodeCount, edgeCount, selection, selectedNodeName, issues, summary,
  history, cursor, replayAvailable, replayCount,
  onHoverIssue, onSelectIssue, onJumpHistory, onOpenReplay,
}: InspectorProps) {
  const [tab, setTab] = React.useState<InspectorTab>("issues");

  return (
    <aside className="border-subtle bg-surface-base flex w-72 shrink-0 flex-col border-l">
      {/* Counts. The three numbers that describe the graph, always visible. */}
      <div className="border-subtle grid grid-cols-3 gap-px border-b">
        <Count label="Nodes" value={nodeCount} />
        <Count label="Edges" value={edgeCount} />
        <Count
          label="Issues"
          value={issues.length}
          tone={summary.errors > 0 ? "failed" : issues.length > 0 ? "waiting" : undefined}
        />
      </div>

      <div className="border-subtle flex items-center gap-0.5 border-b px-2 py-1.5">
        <Tab active={tab === "issues"} onClick={() => setTab("issues")}>
          Issues
          {issues.length > 0 ? (
            <span
              className={cn(
                "font-code ml-1 rounded-full px-1 text-[9px] tabular",
                summary.errors > 0 ? "bg-status-failed text-fg-on-accent" : "bg-status-waiting text-fg-on-accent",
              )}
            >
              {issues.length}
            </span>
          ) : null}
        </Tab>
        <Tab active={tab === "history"} onClick={() => setTab("history")}>History</Tab>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "issues" ? (
          <IssuesPane
            issues={issues}
            summary={summary}
            selection={selection}
            selectedNodeName={selectedNodeName}
            onHoverIssue={onHoverIssue}
            onSelectIssue={onSelectIssue}
          />
        ) : (
          <HistoryPane history={history} cursor={cursor} onJump={onJumpHistory} />
        )}
      </div>

      <div className="border-subtle border-t p-2">
        <button
          type="button"
          onClick={onOpenReplay}
          disabled={!replayAvailable}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
            "hover:bg-surface-hover transition-colors duration-fast",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
            "outline-none focus-visible:focus-ring",
          )}
        >
          <span className={cn("shrink-0", replayAvailable ? "text-status-success" : "text-fg-disabled")}>
            <svg viewBox="0 0 14 14" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7a5 5 0 1 0 1.6-3.7M2 2v3h3" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="font-ui text-body-sm text-fg-primary block">
              {replayAvailable ? "Replay a run on this canvas" : "No runs to replay"}
            </span>
            <span className="font-ui text-caption text-fg-muted block">
              {replayAvailable
                ? `${replayCount} run${replayCount === 1 ? "" : "s"} available`
                : "Runs appear here once this workflow has executed"}
            </span>
          </span>
        </button>
      </div>
    </aside>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "failed" | "waiting" }) {
  return (
    <div className="bg-surface-base px-2 py-2">
      <Text variant="caption" tone="muted" className="block">{label}</Text>
      <Text
        variant="body"
        tone={tone ? "inherit" : "primary"}
        tabular
        className={cn("block", tone === "failed" && "text-status-failed", tone === "waiting" && "text-status-waiting")}
      >
        {value}
      </Text>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "font-ui text-caption flex items-center rounded-sm px-2 py-1",
        "transition-colors duration-fast outline-none focus-visible:focus-ring",
        active ? "bg-surface-active text-fg-primary" : "text-fg-muted hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

/* ── Issues ───────────────────────────────────────────────────────────────── */

function IssuesPane({
  issues, summary, selection, selectedNodeName, onHoverIssue, onSelectIssue,
}: {
  issues: Issue[];
  summary: ValiditySummary;
  selection: string[];
  selectedNodeName: string | null;
  onHoverIssue: (nodeId: string | null) => void;
  onSelectIssue: (nodeId: string | null) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="p-3">
        <Text variant="body-sm" tone="inherit" className="text-status-success block">
          No issues.
        </Text>
        <Text variant="caption" tone="muted" className="mt-1 block">
          The graph has one entry point, nothing unreachable, every required input bound, every
          connection present, and no high-risk tool running without a person in the loop.
        </Text>

        {/* The "select a node" empty state the prompt asks for, shown once the
            graph is clean and there is nothing else competing for this space. */}
        <div className="border-subtle mt-4 rounded-md border border-dashed p-3 text-center">
          <Text variant="body-sm" tone="secondary" className="block">
            {selection.length === 0
              ? "Select a node to configure it"
              : selection.length === 1
                ? selectedNodeName
                : `${selection.length} nodes selected`}
          </Text>
          <Text variant="caption" tone="muted" className="mt-1 block">
            {selection.length === 0
              ? <>Click one, or press <Kbd keys="Tab" /> to walk the graph from the trigger.</>
              : "Configuration lands here next."}
          </Text>
        </div>
      </div>
    );
  }

  const grouped = new Map<IssueCategory, Issue[]>();
  for (const issue of issues) {
    grouped.set(issue.category, [...(grouped.get(issue.category) ?? []), issue]);
  }

  return (
    <div className="p-2">
      <div className="flex flex-wrap items-baseline gap-x-2 px-1 pb-2">
        {summary.errors > 0 ? (
          <Text variant="caption" tone="inherit" className="text-status-failed">
            {summary.errors} {summary.errors === 1 ? "error" : "errors"}
          </Text>
        ) : null}
        {summary.warnings > 0 ? (
          <Text variant="caption" tone="inherit" className="text-status-waiting">
            {summary.warnings} {summary.warnings === 1 ? "warning" : "warnings"}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted">
          {summary.valid ? "publishable" : "blocks publish"}
        </Text>
      </div>

      {[...grouped.entries()].map(([category, list]) => (
        <section key={category} className="mb-2">
          <Text variant="eyebrow" tone="muted" className="mb-1 block px-1">
            {CATEGORY_LABEL[category]}
          </Text>
          <ul className="grid gap-px">
            {list.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  onMouseEnter={() => onHoverIssue(issue.nodeId)}
                  onMouseLeave={() => onHoverIssue(null)}
                  onFocus={() => onHoverIssue(issue.nodeId)}
                  onBlur={() => onHoverIssue(null)}
                  onClick={() => onSelectIssue(issue.nodeId)}
                  className={cn(
                    "grid w-full gap-0.5 rounded-sm px-2 py-1.5 text-left",
                    "hover:bg-surface-hover transition-colors duration-fast",
                    "outline-none focus-visible:focus-ring",
                  )}
                >
                  <span className="flex items-start gap-1.5">
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        issue.severity === "error" ? "bg-status-failed" : "bg-status-waiting",
                      )}
                      aria-hidden="true"
                    />
                    <span className="font-ui text-body-sm text-fg-primary min-w-0">{issue.title}</span>
                  </span>
                  <span className="font-ui text-caption text-fg-muted block pl-3 leading-snug">
                    {issue.detail}
                  </span>
                  <span className="font-ui text-caption text-fg-secondary block pl-3 leading-snug">
                    {issue.fix}
                  </span>
                  <span className="sr-only">
                    {issue.severity}. {issue.nodeId ? "Selects its node." : "Applies to the whole graph."}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ── History ──────────────────────────────────────────────────────────────── */

/**
 * The undo stack, visible and clickable.
 *
 * Undo as a stack you can SEE is the difference between "press ⌘Z until it looks
 * right" and "go back to before I ran auto-layout". Entries past the cursor stay
 * listed and dimmed, because a redo you cannot see is a redo you do not know you
 * have.
 */
function HistoryPane({
  history, cursor, onJump,
}: {
  history: HistoryEntry[];
  cursor: number;
  onJump: (cursor: number) => void;
}) {
  return (
    <ol className="p-2">
      {[...history].reverse().map((entry, i) => {
        const index = history.length - 1 - i;
        const current = index === cursor;
        const future = index > cursor;
        return (
          <li key={`${entry.at}-${index}`}>
            <button
              type="button"
              onClick={() => onJump(index)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left",
                "hover:bg-surface-hover transition-colors duration-fast",
                "outline-none focus-visible:focus-ring",
                current && "bg-surface-active",
                future && "opacity-45",
              )}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  current ? "bg-accent" : future ? "bg-fg-disabled" : "bg-border-strong",
                )}
                aria-hidden="true"
              />
              <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 truncate">
                {entry.label}
              </span>
              <span className="font-code text-fg-disabled shrink-0 text-[10px] tabular">
                <LocalTime at={entry.at} format="clock" />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
