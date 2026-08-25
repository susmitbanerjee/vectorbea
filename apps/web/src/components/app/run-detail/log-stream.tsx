"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import type { contracts } from "@vectorbea/shared";
import type { LogLevel, LogLine } from "~/mocks/run-detail";
import { useReplay, timeAt } from "./replay";

/* ══════════════════════════════════════════════════════════════════════════════
   BOTTOM PANE · LOG STREAM

   Terminal aesthetic because that is the register: monospace, dense, level
   prefixes, no decoration. Virtualised, so 100,000 lines is a scroll rather than
   a hang.

   SCRUB SEEKS THE LOG. When the ribbon is dragged, this pane jumps to the first
   line at or after the focused step's timestamp (§7.2 #7). Seeking by index into
   an already-sorted array, not re-filtering — this runs on every pointer move.

   AUTO-SCROLL WITH A JUMP-TO-LIVE PILL (§7.2 #3). Following the tail is the
   default; scrolling up detaches and says so, because a log that silently yanks
   you back to the bottom while you are reading is the most annoying possible
   behaviour.
══════════════════════════════════════════════════════════════════════════════ */

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "text-fg-disabled",
  info: "text-fg-secondary",
  warn: "text-status-waiting",
  error: "text-status-failed",
};

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const LINE_H = 18;

export type TimestampMode = "relative" | "absolute" | "elapsed";

export function LogStream({
  padTo, fullscreen, onToggleFullscreen, className,
}: {
  padTo?: number;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  className?: string;
}) {
  const { run, events, focusIndex, scrubbing, select } = useReplay();

  /* THE LOG IS THE RUN'S EVENT LOG.
     `buildLog` generated plausible-looking lines from a seeded RNG — timings,
     messages, levels, all invented. On a real run that meant a log that read
     like a log and described nothing that happened. These lines are the events
     the worker actually recorded; when there are none, the pane says so rather
     than filling itself in. */
  const all = React.useMemo(
    () => toLogLines(events, run.nodes.map((node) => node.id)),
    [events, run.nodes],
  );

  const [minLevel, setMinLevel] = React.useState<LogLevel>("debug");
  const [nodeFilter, setNodeFilter] = React.useState<number | null>(null);
  const [query, setQuery] = React.useState("");
  const [tsMode, setTsMode] = React.useState<TimestampMode>("relative");
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
      if (lines[i].message.toLowerCase().includes(needle)) out.push(i);
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
    // Binary search: this runs on every pointer move.
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
    if (tsMode === "absolute") return new Date(line.at).toISOString().slice(11, 23);
    if (tsMode === "elapsed") return `+${((line.at - startedAt) / 1000).toFixed(3)}s`;
    const delta = line.at - startedAt;
    return `${String(Math.floor(delta / 60000)).padStart(2, "0")}:${String(Math.floor((delta % 60000) / 1000)).padStart(2, "0")}.${String(delta % 1000).padStart(3, "0")}`;
  };

  return (
    <div className={cn("bg-surface-base flex min-h-0 flex-col", className)}>
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="border-subtle bg-surface-sunken flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <Text variant="eyebrow" tone="muted">Log</Text>

        <div role="group" aria-label="Minimum level" className="flex items-center gap-0.5">
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setMinLevel(level)}
              aria-pressed={minLevel === level}
              className={cn(
                "font-code rounded-xs px-1.5 py-0.5 text-[10px] uppercase",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                minLevel === level ? "bg-surface-active text-fg-primary" : "text-fg-disabled hover:text-fg-primary",
              )}
            >
              {level}
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
            placeholder="Search"
            aria-label="Search log"
            data-no-shortcuts
            className={cn(
              "bg-surface-raised border-subtle font-code w-36 rounded-sm border px-1.5 py-0.5 text-[11px]",
              "text-fg-primary placeholder:text-fg-disabled outline-none focus-visible:focus-ring",
            )}
          />
          {matches.length > 0 ? (
            <span className="ml-1 flex items-center gap-0.5">
              <span className="font-code text-fg-muted tabular text-[10px]">
                {matchIndex + 1}/{matches.length}
              </span>
              <NavButton label="Previous match" onClick={() => gotoMatch(-1)}>↑</NavButton>
              <NavButton label="Next match" onClick={() => gotoMatch(1)}>↓</NavButton>
            </span>
          ) : query ? (
            <span className="font-code text-fg-disabled ml-1 text-[10px]">no match</span>
          ) : null}
        </div>

        <select
          value={nodeFilter ?? ""}
          onChange={(e) => setNodeFilter(e.target.value === "" ? null : Number(e.target.value))}
          aria-label="Filter by node"
          className={cn(
            "bg-surface-raised border-subtle font-ui text-caption rounded-sm border px-1.5 py-0.5",
            "text-fg-secondary outline-none focus-visible:focus-ring",
          )}
        >
          <option value="">All nodes</option>
          {run.nodes.map((n, i) => <option key={n.id} value={i}>{i + 1}. {n.name}</option>)}
        </select>

        <button
          onClick={() => setTsMode((m) => (m === "relative" ? "absolute" : m === "absolute" ? "elapsed" : "relative"))}
          className="font-ui text-caption text-fg-muted hover:text-fg-primary rounded-xs px-1.5 py-0.5 outline-none transition-colors duration-fast focus-visible:focus-ring"
        >
          {tsMode}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <Text variant="caption" tone="muted" tabular>
            {lines.length.toLocaleString("en-GB")} lines
          </Text>
          <button
            onClick={() => navigator.clipboard?.writeText(lines.map((l) => `${formatTs(l)} ${l.level} ${l.message}`).join("\n"))}
            className="font-ui text-caption text-fg-muted hover:text-fg-primary rounded-xs px-1.5 py-0.5 outline-none transition-colors duration-fast focus-visible:focus-ring"
          >
            Copy
          </button>
          {onToggleFullscreen ? (
            <button
              onClick={onToggleFullscreen}
              aria-pressed={fullscreen}
              className="font-ui text-caption text-fg-muted hover:text-fg-primary rounded-xs px-1.5 py-0.5 outline-none transition-colors duration-fast focus-visible:focus-ring"
            >
              {fullscreen ? "Restore" : "Full screen"}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Lines ────────────────────────────────────────────────────────── */}
      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto [contain:paint_layout]">
        <div style={{ height: virtualizer.getTotalSize() }} className="relative">
          {virtualizer.getVirtualItems().map((item) => {
            const line = lines[item.index];
            const isMatch = matches[matchIndex] === item.index;
            return (
              <div
                key={item.key}
                onClick={() => select(line.nodeIndex)}
                className={cn(
                  "absolute left-0 top-0 flex w-full cursor-pointer items-baseline gap-2 px-2",
                  "hover:bg-surface-hover",
                  isMatch && "bg-accent-subtle",
                  line.nodeIndex === focusIndex && "border-accent border-l-2",
                )}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <span className="font-code text-fg-disabled tabular shrink-0 text-[11px]">
                  {formatTs(line)}
                </span>
                <span className={cn("font-code w-9 shrink-0 text-[10px] uppercase", LEVEL_STYLE[line.level])}>
                  {line.level}
                </span>
                <span className="font-code text-fg-disabled hidden w-28 shrink-0 truncate text-[11px] sm:block">
                  {line.nodeName}
                </span>
                <span className={cn("font-code min-w-0 flex-1 truncate text-[11px]", LEVEL_STYLE[line.level])}>
                  {query ? <Highlighted text={line.message} query={query} /> : line.message}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* §7.2 #3 — the pill, only when detached. */}
      {!following ? (
        <button
          onClick={() => setFollowing(true)}
          className={cn(
            "bg-accent text-fg-on-accent font-ui text-caption absolute bottom-3 left-1/2 -translate-x-1/2",
            "rounded-full px-3 py-1 shadow-2 outline-none focus-visible:focus-ring",
            "motion-safe:animate-[ink-log-line_180ms_var(--ease-entrance)]",
          )}
        >
          Jump to live
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
      className="text-fg-muted hover:text-fg-primary grid size-4 place-items-center rounded-xs text-[10px] outline-none transition-colors duration-fast focus-visible:focus-ring"
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

/** Event type → severity, using the type's own vocabulary rather than a guess. */
function levelFor(type: string, status: string | null | undefined): LogLevel {
  const text = `${type} ${status ?? ""}`.toLowerCase();
  if (/fail|error|timeout|dead|reject/.test(text)) return "error";
  if (/retry|recover|warn|cancel|skip|yield/.test(text)) return "warn";
  if (/debug|trace/.test(text)) return "debug";
  return "info";
}

/**
 * A run's events, as log lines.
 *
 * `nodeIndex` is what the pane filters and scrubs by. A run event carries no
 * node reference, so it is resolved from the event type where the type happens
 * to name a step and left at -1 otherwise — which the pane reads as "belongs to
 * the run, not to a step". Inventing an index would silently file lines under
 * whichever step the scrubber happened to be on.
 */
function toLogLines(events: contracts.RunEvent[], nodeIds: string[]): LogLine[] {
  return [...events]
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => {
      const index = nodeIds.findIndex((id) => event.type.includes(id));
      const detail = [
        event.status ? `status=${event.status}` : null,
        event.source ? `source=${event.source}` : null,
        event.durationMs != null ? `${event.durationMs}ms` : null,
      ].filter(Boolean).join(" ");
      return {
        seq: event.sequence,
        at: Date.parse(event.timestamp),
        level: levelFor(event.type, event.status),
        nodeIndex: index,
        nodeName: index === -1 ? "run" : nodeIds[index],
        message: detail ? `${event.type} ${detail}` : event.type,
      };
    });
}
