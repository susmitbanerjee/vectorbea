"use client";

/**
 * RunExecutionTimeline — horizontal Gantt / trace chart
 *
 * Layout:
 *   ┌──────────────┬──────────────────────────────────────────┐
 *   │  0s    20s   │  Ruler ticks                             │
 *   ├──────────────┼──────────────────────────────────────────┤
 *   │  Run         │  ◆────────────────────────────────────◆  │
 *   ├──────────────┼──────────────────────────────────────────┤
 *   │  Orchestrator│  [████ Agent] ◆ ◆                        │
 *   ├──────────────┼──────────────────────────────────────────┤
 *   │  Data Agent  │         [████████████] [██ Tool] [██ LLM]│
 *   └──────────────┴──────────────────────────────────────────┘
 *
 * Spans   = events with durationMs  → rendered as horizontal bars
 * Points  = events without duration → rendered as diamond markers
 * Click   = opens inline detail panel below the chart
 */

import React, { useMemo, useState } from "react";
import type { RunTimelineEventUi, TimelineEventType } from "@/types/agent-run-ui";

// ─── Layout constants ─────────────────────────────────────────────────────────

const LABEL_W  = 200; // px — fixed left label column
const BAR_H    = 18;  // px — span bar height
const ROW_H    = 28;  // px — height per sublane row
const LANE_PAD = 8;   // px — top+bottom padding inside each lane
const RULER_H  = 34;  // px — time ruler height

// ─── Color scheme ─────────────────────────────────────────────────────────────

function spanColor(type: TimelineEventType, status: string) {
  if (status === "FAILED")  return { fill: "rgba(239,68,68,0.18)",    stroke: "#EF4444" };
  if (status === "WAITING") return { fill: "rgba(245,158,11,0.18)",   stroke: "#F59E0B" };
  if (status === "PENDING") return { fill: "rgba(245,158,11,0.12)",   stroke: "#F59E0B" };
  if (type.startsWith("AGENT_"))    return { fill: "rgba(167,139,250,0.20)", stroke: "#A78BFA" };
  if (type.startsWith("LLM_"))      return { fill: "rgba(192,132,252,0.20)", stroke: "#C084FC" };
  if (type.startsWith("TOOL_"))     return { fill: "rgba(34,211,238,0.16)",  stroke: "#22D3EE" };
  if (type.startsWith("HTTP_"))     return { fill: "rgba(110,231,183,0.16)", stroke: "#6EE7B7" };
  if (type.startsWith("APPROVAL_")) return { fill: "rgba(252,211,77,0.16)",  stroke: "#FCD34D" };
  if (type.startsWith("RETRY_"))    return { fill: "rgba(253,164,175,0.16)", stroke: "#FDA4AF" };
  if (type.startsWith("RUN_"))      return { fill: "rgba(56,189,248,0.16)",  stroke: "#38BDF8" };
  if (type.startsWith("BUDGET_") || type.startsWith("POLICY_"))
                                     return { fill: "rgba(148,163,184,0.12)", stroke: "#94A3B8" };
  if (type.startsWith("ARTIFACT_")) return { fill: "rgba(134,239,172,0.16)", stroke: "#86EFAC" };
  return { fill: "rgba(148,163,184,0.10)", stroke: "#64748B" };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTs(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

// Short label to print inside bars
function barLabel(type: TimelineEventType): string {
  return type
    .replace(/_(STARTED|COMPLETED|FAILED|CREATED|REQUESTED|APPROVED|REJECTED|EXPIRED|PASSED|SELECTED|EXHAUSTED|SCHEDULED|VALIDATED)$/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase());
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpanItem {
  event: RunTimelineEventUi;
  startMs: number; // ms from T_min
  endMs: number;   // ms from T_min
  isPoint: boolean;
}

interface Lane {
  name: string;
  sublanes: SpanItem[][];  // non-overlapping rows of span bars
  points: SpanItem[];      // point events (no duration)
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function KV({
  label, value, mono, color,
}: {
  label: string; value: string; mono?: boolean; color?: string;
}) {
  return (
    <div className="flex gap-3 py-1.5" style={{ borderBottom: "1px solid rgba(148,163,184,0.06)" }}>
      <span className="w-36 shrink-0 text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span
        className={`min-w-0 break-all text-[11px] ${mono ? "font-mono" : ""}`}
        style={{ color: color ?? "var(--text-secondary)" }}
      >
        {value}
      </span>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </p>
      <pre
        className="overflow-auto rounded-lg p-3 text-[10px] font-mono leading-relaxed"
        style={{
          background: "#060A10",
          color: "#CBD5E1",
          border: "1px solid rgba(148,163,184,0.10)",
          maxHeight: 130,
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function SpanDetail({
  event, onClose,
}: {
  event: RunTimelineEventUi; onClose: () => void;
}) {
  const c = spanColor(event.type, event.status);

  return (
    <div
      className="mt-3 overflow-hidden rounded-xl"
      style={{ border: `1px solid ${c.stroke}33`, background: "var(--surface-2)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ background: c.fill, borderBottom: `1px solid ${c.stroke}25` }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.stroke }} />
          <span className="shrink-0 font-mono text-[10px] font-semibold" style={{ color: "var(--text-faint)" }}>
            #{event.sequence}
          </span>
          <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: c.stroke }}>
            {event.type}
          </span>
          <span className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {event.title}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/10"
          style={{ color: "var(--text-faint)" }}
        >
          Close ✕
        </button>
      </div>

      {/* Body */}
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        {/* Left: KV rows */}
        <div>
          <KV label="Status"    value={event.status} />
          <KV label="Source"    value={event.source}    mono />
          <KV label="Timestamp" value={fmtTs(event.timestamp)} mono />
          {event.durationMs    != null  && <KV label="Duration"    value={fmtDur(event.durationMs)} mono />}
          {event.agentName               && <KV label="Agent"       value={event.agentName}  mono color="#A78BFA" />}
          {event.toolName                && <KV label="Tool"        value={event.toolName}   mono color="#22D3EE" />}
          {event.modelName               && <KV label="Model"       value={event.modelName}  mono color="#C084FC" />}
          {event.tokensUsed    != null   && <KV label="Tokens"      value={event.tokensUsed.toLocaleString()} mono />}
          {event.estimatedCostUsd != null && <KV label="Cost"       value={`$${event.estimatedCostUsd.toFixed(6)}`} mono />}
          {event.handoffTo               && <KV label="Handoff →"   value={event.handoffTo}  mono color="#A78BFA" />}
          {event.artifactName            && <KV label="Artifact"    value={event.artifactName} mono color="#86EFAC" />}
          {event.actorName               && <KV label="Actor"       value={event.actorName}  mono />}
          {event.summary                 && <KV label="Summary"     value={event.summary} />}
          {event.errorMessage            && <KV label="Error"       value={event.errorMessage} mono color="#FCA5A5" />}
          {event.approval != null && (() => {
            const a = event.approval!;
            return (
              <>
                <KV label="Approval ID"     value={a.id}     mono />
                <KV label="Appr. Status"    value={a.status} />
                {a.decidedBy      && <KV label="Decided By"  value={a.decidedBy} mono />}
                {a.decisionReason && <KV label="Decision"    value={a.decisionReason} />}
              </>
            );
          })()}
        </div>

        {/* Right: JSON blocks */}
        <div className="space-y-3">
          {event.inputJson    != null && <JsonBlock label="Input"    value={event.inputJson} />}
          {event.outputJson   != null && <JsonBlock label="Output"   value={event.outputJson} />}
          {event.metadataJson != null && <JsonBlock label="Metadata" value={event.metadataJson} />}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RunExecutionTimelineProps {
  events: RunTimelineEventUi[];
}

export function RunExecutionTimeline({ events }: RunExecutionTimelineProps) {
  const [selected, setSelected] = useState<RunTimelineEventUi | null>(null);

  // ── Time range ──────────────────────────────────────────────────────────────
  const { T_min, totalMs } = useMemo(() => {
    if (!events.length) return { T_min: 0, totalMs: 1000 };
    let mn = Infinity, mx = -Infinity;
    for (const e of events) {
      const t = new Date(e.timestamp).getTime();
      const s = e.durationMs ? t - e.durationMs : t;
      if (s < mn) mn = s;
      if (t > mx) mx = t;
    }
    const range = mx - mn || 1000;
    const pad = range * 0.025;
    return { T_min: mn - pad, totalMs: range + pad * 2 };
  }, [events]);

  // ── Build lanes ─────────────────────────────────────────────────────────────
  const lanes = useMemo<Lane[]>(() => {
    const map = new Map<string, SpanItem[]>();
    map.set("Run", []);

    for (const e of events) {
      const name = e.agentName ?? "Run";
      if (!map.has(name)) map.set(name, []);
      const t = new Date(e.timestamp).getTime();
      map.get(name)!.push({
        event: e,
        startMs: (e.durationMs ? t - e.durationMs : t) - T_min,
        endMs:   t - T_min,
        isPoint: !e.durationMs,
      });
    }

    return Array.from(map.entries())
      .filter(([, items]) => items.length > 0)
      .map(([name, items]) => {
        const spans  = items.filter(s => !s.isPoint);
        const points = items.filter(s => s.isPoint);

        // Greedy non-overlapping sublane assignment
        const sublanes: SpanItem[][] = [];
        const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
        for (const span of sorted) {
          let placed = false;
          for (const row of sublanes) {
            const last = row[row.length - 1];
            if (!last || last.endMs <= span.startMs) {
              row.push(span);
              placed = true;
              break;
            }
          }
          if (!placed) sublanes.push([span]);
        }

        return { name, sublanes, points };
      });
  }, [events, T_min]);

  // ── Time ruler ticks ────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    const count = 8;
    return Array.from({ length: count + 1 }, (_, i) => ({
      pct: (i / count) * 100,
      label: i === 0 ? "0" : fmtDur(Math.round((i / count) * totalMs)),
    }));
  }, [totalMs]);

  function toPct(ms: number) {
    return Math.max(0, Math.min(100, (ms / totalMs) * 100));
  }
  function toWidthPct(ms: number) {
    return Math.max(0.4, (ms / totalMs) * 100); // 0.4% min so tiny spans are visible
  }

  return (
    <div>
      {/* ── Chart ──────────────────────────────────────────────────────────── */}
      <div
        className="overflow-hidden overflow-x-auto rounded-xl"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", minWidth: 0 }}
      >
        {/* Time ruler */}
        <div
          className="flex"
          style={{ height: RULER_H, borderBottom: "1px solid rgba(148,163,184,0.10)", minWidth: 560 }}
        >
          <div
            className="flex shrink-0 items-center px-4"
            style={{
              width: LABEL_W,
              background: "var(--surface-2)",
              borderRight: "1px solid rgba(148,163,184,0.09)",
            }}
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-faint)" }}
            >
              Agent / Lane
            </span>
          </div>
          <div className="relative flex-1" style={{ background: "var(--surface-2)" }}>
            {ticks.map((tick, i) => (
              <div
                key={i}
                className="absolute flex flex-col items-center"
                style={{ left: `${tick.pct}%`, top: 0, bottom: 0, transform: "translateX(-50%)" }}
              >
                <div
                  style={{
                    width: 1, height: 8, marginTop: 6,
                    background: tick.pct === 0 || tick.pct === 100
                      ? "rgba(148,163,184,0.35)" : "rgba(148,163,184,0.2)",
                  }}
                />
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: "var(--font-mono, monospace)",
                    color: "var(--text-faint)",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {tick.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Lanes */}
        {lanes.map((lane, laneIdx) => {
          const numRows = Math.max(lane.sublanes.length, 1);
          const laneH   = LANE_PAD * 2 + numRows * ROW_H;
          const isLast  = laneIdx === lanes.length - 1;

          return (
            <div
              key={lane.name}
              className="flex"
              style={{
                height: laneH,
                minWidth: 560,
                borderBottom: !isLast ? "1px solid rgba(148,163,184,0.07)" : undefined,
              }}
            >
              {/* Lane label */}
              <div
                className="flex shrink-0 items-start"
                style={{
                  width: LABEL_W,
                  paddingTop: LANE_PAD + 5,
                  paddingLeft: 16,
                  paddingRight: 12,
                  background: "var(--surface-2)",
                  borderRight: "1px solid rgba(148,163,184,0.08)",
                }}
              >
                <span
                  className="truncate text-[12px] font-medium"
                  style={{ color: lane.name === "Run" ? "#38BDF8" : "#A78BFA" }}
                >
                  {lane.name}
                </span>
              </div>

              {/* Bars + markers */}
              <div className="relative flex-1">
                {/* Vertical grid lines */}
                {ticks.map((tick, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `${tick.pct}%`,
                      width: 1,
                      background: "rgba(148,163,184,0.04)",
                    }}
                  />
                ))}

                {/* Span bars */}
                {lane.sublanes.map((row, rowIdx) =>
                  row.map(span => {
                    const left  = toPct(span.startMs);
                    const width = toWidthPct(span.endMs - span.startMs);
                    const c     = spanColor(span.event.type, span.event.status);
                    const isSel = selected?.id === span.event.id;
                    const top   = LANE_PAD + rowIdx * ROW_H + (ROW_H - BAR_H) / 2;
                    const showDur = span.event.durationMs != null &&
                      (span.endMs - span.startMs) > totalMs * 0.05;

                    return (
                      <div
                        key={span.event.id}
                        className="absolute cursor-pointer rounded"
                        style={{
                          left:     `${left}%`,
                          width:    `${width}%`,
                          top,
                          height:   BAR_H,
                          minWidth: 3,
                          background: isSel ? c.stroke + "35" : c.fill,
                          border: `1px solid ${isSel ? c.stroke : c.stroke + "90"}`,
                          boxShadow: isSel
                            ? `0 0 0 1px ${c.stroke}55, 0 0 8px ${c.stroke}22`
                            : undefined,
                          display:    "flex",
                          alignItems: "center",
                          paddingLeft: 5,
                          paddingRight: 4,
                          overflow: "hidden",
                          transition: "box-shadow 0.1s, border-color 0.1s",
                        }}
                        onClick={() => setSelected(isSel ? null : span.event)}
                        title={span.event.title}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 500,
                            color: c.stroke,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontFamily: "var(--font-sans, sans-serif)",
                          }}
                        >
                          {barLabel(span.event.type)}
                          {showDur && ` · ${fmtDur(span.event.durationMs!)}`}
                        </span>
                      </div>
                    );
                  })
                )}

                {/* Point event markers */}
                {lane.points.map(pt => {
                  const left  = toPct(pt.startMs);
                  const c     = spanColor(pt.event.type, pt.event.status);
                  const isSel = selected?.id === pt.event.id;
                  const dSize = isSel ? 8 : 6;

                  return (
                    <React.Fragment key={pt.event.id}>
                      {/* Vertical tick */}
                      <div
                        className="absolute cursor-pointer"
                        style={{
                          left:      `${left}%`,
                          top:       LANE_PAD,
                          bottom:    LANE_PAD,
                          width:     isSel ? 2 : 1,
                          background: c.stroke + (isSel ? "bb" : "55"),
                          transform: "translateX(-50%)",
                          pointerEvents: "none",
                        }}
                      />
                      {/* Diamond */}
                      <div
                        className="absolute cursor-pointer"
                        style={{
                          left:      `${left}%`,
                          top:       "50%",
                          width:     dSize,
                          height:    dSize,
                          background: c.stroke,
                          transform: "translate(-50%, -50%) rotate(45deg)",
                          boxShadow: isSel ? `0 0 0 2px ${c.stroke}44, 0 0 6px ${c.stroke}66` : undefined,
                        }}
                        onClick={() => setSelected(isSel ? null : pt.event)}
                        title={pt.event.title}
                      />
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
        {[
          { label: "Run",      color: "#38BDF8" },
          { label: "Agent",    color: "#A78BFA" },
          { label: "LLM",      color: "#C084FC" },
          { label: "Tool",     color: "#22D3EE" },
          { label: "HTTP",     color: "#6EE7B7" },
          { label: "Approval", color: "#FCD34D" },
          { label: "Retry",    color: "#FDA4AF" },
          { label: "Failed",   color: "#EF4444" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ background: item.color + "60", border: `1px solid ${item.color}` }} />
            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
              {item.label}
            </span>
          </div>
        ))}
        <span className="text-[10px]" style={{ color: "rgba(100,116,139,0.6)" }}>
          · bars = spans · ◆ = point events · click to inspect
        </span>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {selected && (
        <SpanDetail event={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
