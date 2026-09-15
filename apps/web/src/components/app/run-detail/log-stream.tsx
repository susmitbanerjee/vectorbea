"use client";

import * as React from "react";
import type { RunStreamState } from "~/lib/api/run-stream";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import type { contracts } from "@vectorbea/shared";
import type { LogLine } from "~/mocks/run-detail";
import type { LogLevel } from "~/lib/runs/model";
import { describe, isPlumbing, levelFor } from "~/lib/runs/log-vocabulary";
import { formatDuration } from "~/lib/format";
import { formatClock, timeZoneLabel, useTimeZone } from "~/lib/time/time-zone";
import { useReplay, timeAt } from "./replay";

/* ══════════════════════════════════════════════════════════════════════════════
   BOTTOM PANE · LOGS

   Virtualised, so 100,000 lines is a scroll rather than a hang.

   ── WHAT A LINE SAYS ────────────────────────────────────────────────────────
   Time of day in the viewer's time zone, level, the STEP NAME, and a sentence.
   It used to be a UTC fragment, the node id ("run" for most lines) and the
   event's type as a phrase with no step attached, plus a Raw toggle and a Debug
   level that showed our worker ids and durable-execution mechanics. Both are
   gone: the platform's own plumbing is not shown at all, and nothing here names
   our infrastructure.

   SCRUB SEEKS THE LOG. When the ribbon is dragged, this pane jumps to the first
   line at or after the focused step's timestamp.

   AUTO-SCROLL WITH A JUMP-TO-LIVE PILL. Following the tail is the default;
   scrolling up detaches and says so.
══════════════════════════════════════════════════════════════════════════════ */

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "text-fg-disabled",
  info: "text-fg-secondary",
  warn: "text-status-waiting",
  error: "text-status-failed",
};

const LEVELS: LogLevel[] = ["info", "warn", "error"];
const LEVEL_LABEL: Record<LogLevel, string> = { debug: "Debug", info: "All", warn: "Warnings", error: "Errors" };
const LEVEL_TAG: Record<LogLevel, string> = { debug: "DEBUG", info: "INFO", warn: "WARN", error: "ERROR" };
const LINE_H = 24;

export type TimestampMode = "clock" | "elapsed";

export function LogStream({
  padTo, fullscreen, onToggleFullscreen, className, stream,
}: {
  padTo?: number;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  className?: string;
  /** How lines are reaching this pane, or null when nothing is following the run. */
  stream?: RunStreamState | null;
}) {
  const { run, events, focusIndex, scrubbing, select } = useReplay();
  const timeZone = useTimeZone();

  const all = React.useMemo(
    () => toLogLines(events, run.nodes.map((node) => ({ id: node.id, name: node.name }))),
    [events, run.nodes],
  );

  const [minLevel, setMinLevel] = React.useState<LogLevel>("info");
  const [nodeFilter, setNodeFilter] = React.useState<number | null>(null);
  const [query, setQuery] = React.useState("");
  const [tsMode, setTsMode] = React.useState<TimestampMode>("clock");
  const [following, setFollowing] = React.useState(true);
  const [matchIndex, setMatchIndex] = React.useState(0);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const startedAt = Date.parse(run.startedAt);

  const lines = React.useMemo(() => {
    const floor = LEVELS.indexOf(minLevel);
    return all.filter((line) => {
      if (LEVELS.indexOf(line.level) < floor) return false;
      if (nodeFilter !== null && line.nodeIndex !== nodeFilter) return false;
      return true;
    });
  }, [all, minLevel, nodeFilter]);

  const matches = React.useMemo(() => {
    if (!query.trim()) return [];
    const needle = query.toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (`${lines[i].nodeName} ${lines[i].message}`.toLowerCase().includes(needle)) out.push(i);
    }
    return out;
  }, [lines, query]);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_H,
    overscan: 24,
  });

  /* ── Scrub seeks ────────────────────────────────────────────────────────── */
  React.useEffect(() => {
    if (!scrubbing) return;
    const target = timeAt(run, focusIndex);
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].at < target) lo = mid + 1;
      else hi = mid;
    }
    setFollowing(false);
    virtualizer.scrollToIndex(lo, { align: "start" });
  }, [scrubbing, focusIndex, run, lines, virtualizer]);

  /* ── Follow the tail ────────────────────────────────────────────────────── */
  React.useEffect(() => {
    if (!following || lines.length === 0) return;
    virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
  }, [following, lines.length, virtualizer]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== following) setFollowing(atBottom);
  };

  const gotoMatch = (delta: number) => {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    setFollowing(false);
    virtualizer.scrollToIndex(matches[next], { align: "center" });
  };

  const formatTs = (line: LogLine) => {
    if (tsMode === "clock") return formatClock(line.at, timeZone);
    const delta = Math.max(0, line.at - startedAt);
    return `+${String(Math.floor(delta / 60000)).padStart(2, "0")}:${String(Math.floor((delta % 60000) / 1000)).padStart(2, "0")}`;
  };

  const controlButton =
    "font-ui text-caption text-fg-muted hover:text-fg-primary rounded-xs px-2 py-1 outline-none transition-colors duration-fast focus-visible:focus-ring";

  return (
    <div className={cn("bg-surface-base relative flex min-h-0 flex-col", className)}>
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="border-subtle bg-surface-sunken flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Text variant="label" tone="primary">Logs</Text>
        <TransportNote stream={stream ?? null} />

        <div role="group" aria-label="Show" className="border-subtle flex items-center rounded-sm border p-0.5">
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setMinLevel(level)}
              aria-pressed={minLevel === level}
              className={cn(
                "font-ui text-caption rounded-xs px-2 py-0.5",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                minLevel === level ? "bg-surface-active text-fg-primary" : "text-fg-muted hover:text-fg-primary",
              )}
            >
              {LEVEL_LABEL[level]}
            </button>
          ))}
        </div>

        <div className="relative flex items-center">
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setMatchIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
            }}
            placeholder="Search logs"
            aria-label="Search logs"
            data-no-shortcuts
            className={cn(
              "bg-surface-raised border-subtle font-ui text-caption w-44 rounded-sm border px-2 py-1",
              "text-fg-primary placeholder:text-fg-disabled outline-none focus-visible:focus-ring",
            )}
          />
          {matches.length > 0 ? (
            <span className="ml-1 flex items-center gap-0.5">
              <span className="font-code text-fg-muted tabular text-[11px]">
                {matchIndex + 1}/{matches.length}
              </span>
              <NavButton label="Previous match" onClick={() => gotoMatch(-1)}>↑</NavButton>
              <NavButton label="Next match" onClick={() => gotoMatch(1)}>↓</NavButton>
            </span>
          ) : query ? (
            <Text variant="caption" tone="muted" className="ml-1">No match</Text>
          ) : null}
        </div>

        <select
          value={nodeFilter ?? ""}
          onChange={(e) => setNodeFilter(e.target.value === "" ? null : Number(e.target.value))}
          aria-label="Filter by step"
          className={cn(
            "bg-surface-raised border-subtle font-ui text-caption max-w-48 rounded-sm border px-2 py-1",
            "text-fg-secondary outline-none focus-visible:focus-ring",
          )}
        >
          <option value="">All steps</option>
          {run.nodes.map((n, i) => <option key={n.id} value={i}>{i + 1}. {n.name}</option>)}
        </select>

        <button
          onClick={() => setTsMode((m) => (m === "clock" ? "elapsed" : "clock"))}
          title={tsMode === "clock" ? "Show time since the run started" : "Show the time of day"}
          className={controlButton}
        >
          {tsMode === "clock" ? timeZoneLabel(timeZone) : "Since start"}
        </button>

        <div className="ml-auto flex items-center gap-1">
          <Text variant="caption" tone="muted" tabular className="mr-1">
            {lines.length.toLocaleString("en-GB")} {lines.length === 1 ? "line" : "lines"}
          </Text>
          <button
            onClick={() => navigator.clipboard?.writeText(
              lines.map((l) => `${formatTs(l)} ${LEVEL_TAG[l.level]} ${l.nodeName}: ${l.message}`).join("\n"),
            )}
            className={controlButton}
          >
            Copy
          </button>
          {onToggleFullscreen ? (
            <button onClick={onToggleFullscreen} aria-pressed={fullscreen} className={controlButton}>
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Lines ────────────────────────────────────────────────────────── */}
      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto [contain:paint_layout]">
        {lines.length === 0 ? (
          <div className="grid h-full place-items-center p-4">
            <Text variant="body-sm" tone="muted">
              {all.length === 0 ? "No log lines yet." : "No lines match these filters."}
            </Text>
          </div>
        ) : null}
        <div style={{ height: virtualizer.getTotalSize() + (padTo ?? 0) }} className="relative">
          {virtualizer.getVirtualItems().map((item) => {
            const line = lines[item.index];
            const isMatch = matches[matchIndex] === item.index;
            return (
              <div
                key={item.key}
                onClick={() => { if (line.nodeIndex >= 0) select(line.nodeIndex); }}
                className={cn(
                  "absolute left-0 top-0 flex w-full items-center gap-3 px-3",
                  line.nodeIndex >= 0 && "cursor-pointer",
                  "hover:bg-surface-hover",
                  isMatch && "bg-accent-subtle",
                  line.nodeIndex >= 0 && line.nodeIndex === focusIndex && "border-accent border-l-2",
                )}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <span className="font-code text-fg-muted tabular w-16 shrink-0 text-[12px]">
                  {formatTs(line)}
                </span>
                <span className={cn("font-code w-12 shrink-0 text-[11px]", LEVEL_STYLE[line.level])}>
                  {LEVEL_TAG[line.level]}
                </span>
                <span className="font-ui text-fg-secondary hidden w-40 shrink-0 truncate text-[12px] sm:block" title={line.nodeName}>
                  {line.nodeName}
                </span>
                <span
                  className={cn("font-ui min-w-0 flex-1 truncate text-[12px]", line.level === "info" ? "text-fg-primary" : LEVEL_STYLE[line.level])}
                  title={line.message}
                >
                  {query ? <Highlighted text={line.message} query={query} /> : line.message}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {!following && lines.length > 0 ? (
        <button
          onClick={() => setFollowing(true)}
          className={cn(
            "bg-accent text-fg-on-accent font-ui text-caption absolute bottom-3 left-1/2 -translate-x-1/2",
            "rounded-full px-3 py-1 shadow-2 outline-none focus-visible:focus-ring",
            "motion-safe:animate-[ink-log-line_180ms_var(--ease-entrance)]",
          )}
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-fg-muted hover:text-fg-primary grid size-5 place-items-center rounded-xs text-[11px] outline-none transition-colors duration-fast focus-visible:focus-ring"
    >
      {children}
    </button>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-accent text-fg-on-accent rounded-[2px]">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

/** Whether updates are arriving. Plain words, no transport details. */
function TransportNote({ stream }: { stream: RunStreamState | null }) {
  if (!stream) return null;
  const label =
    stream.status === "open" || stream.status === "polling" ? "Live"
    : stream.status === "connecting" ? "Connecting"
    : stream.status === "reconnecting" ? "Reconnecting"
    : stream.status === "closed" ? null
    : "Paused";
  if (!label) return null;

  return (
    <span className="flex items-center gap-1.5" aria-live="polite">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          label === "Live" ? "bg-status-live motion-safe:animate-pulse" : "bg-fg-disabled",
        )}
      />
      <Text variant="caption" tone="muted">{label}</Text>
    </span>
  );
}

function toLogLines(
  events: contracts.RunEvent[],
  steps: Array<{ id: string; name: string }>,
): LogLine[] {
  return [...events]
    .filter((event) => !isPlumbing(event.type))
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => {
      /* Attributed by the event's own step id; an older event without one falls
         back to a type that names the step. Unattributed lines belong to the run. */
      const index = event.stepId
        ? steps.findIndex((step) => step.id === event.stepId)
        : steps.findIndex((step) => event.type.includes(step.id));
      return {
        seq: event.sequence,
        at: Date.parse(event.timestamp),
        level: levelFor(event.type, event.status),
        nodeIndex: index,
        nodeName: index === -1 ? "Run" : steps[index].name,
        message: logMessage(event),
      };
    });
}

/**
 * One line, in the reader's words: what happened, then the facts worth having —
 * the model a call used, the attempt when it is a retry, how long it took. Never
 * the event's source, which names our infrastructure rather than their workflow.
 */
export function logMessage(
  event: Pick<contracts.RunEvent, "type" | "durationMs" | "modelName" | "retryAttempt">,
): string {
  const parts = [describe(event.type)];
  if (event.modelName && event.type.startsWith("LLM_CALL")) parts.push(event.modelName);
  if (event.retryAttempt != null && event.retryAttempt > 1) parts.push(`attempt ${event.retryAttempt}`);
  if (event.durationMs != null && event.durationMs > 0) parts.push(formatDuration(event.durationMs));
  return parts.join(" · ");
}
