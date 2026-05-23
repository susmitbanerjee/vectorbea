"use client";

/**
 * RunExecutionTimeline — horizontal trace chart (Temporal-style)
 *
 * One row per event. Spans shown as:  ●━━━━━━━━━━━━━━━━━●
 * Point events shown as:              ●
 *
 * Hierarchy via left-column indentation:
 *   Run lifecycle          indent 0
 *   Agent spans            indent 1
 *   LLM / Tool / HTTP      indent 2
 *
 * Key UX rules
 * ─────────────
 * • min-width 40 px on every span → tiny events are always visible + clickable
 * • End dot always rendered at correct proportional position (not just right edge)
 * • Click any row → SpanDetail panel slides in below the chart
 */

import React, { useMemo, useRef, useState, useEffect } from "react";
import type { RunTimelineEventUi, TimelineEventType } from "@/types/agent-run-ui";

// ─── Layout ───────────────────────────────────────────────────────────────────

const LABEL_W   = 220;  // px – fixed label column
const ROW_H     = 34;   // px – height per row
const DOT       = 10;   // px – dot diameter
const LINE_H    = 3;    // px – connecting line thickness
const RULER_H   = 36;   // px – time ruler
const MIN_SPAN  = 44;   // px – minimum span width (px) so tiny spans are clickable
const INDENT_PX = 16;   // px – per indent level

// ─── Colors ───────────────────────────────────────────────────────────────────

function eventColor(type: TimelineEventType, status: string) {
  if (status === "FAILED")  return "#EF4444";
  if (status === "WAITING" || status === "PENDING") return "#F59E0B";
  if (type.startsWith("RUN_"))      return "#38BDF8";
  if (type.startsWith("AGENT_"))    return "#A78BFA";
  if (type.startsWith("LLM_"))      return "#C084FC";
  if (type.startsWith("TOOL_"))     return "#22D3EE";
  if (type.startsWith("HTTP_"))     return "#6EE7B7";
  if (type.startsWith("APPROVAL_")) return "#FCD34D";
  if (type.startsWith("RETRY_"))    return "#FDA4AF";
  if (type.startsWith("BUDGET_") || type.startsWith("POLICY_")) return "#94A3B8";
  if (type.startsWith("ARTIFACT_")) return "#86EFAC";
  return "#64748B";
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDur(ms: number) {
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

// ─── Label helpers ────────────────────────────────────────────────────────────

function rowLabel(e: RunTimelineEventUi): string {
  if (e.toolName)  return e.toolName;
  if (e.modelName) return e.modelName;
  if (e.agentName) return e.agentName;
  return e.type
    .replace(/_(STARTED|COMPLETED|FAILED|CREATED|REQUESTED|APPROVED|REJECTED|EXPIRED|PASSED|SELECTED|EXHAUSTED|SCHEDULED|VALIDATED)$/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase());
}

function indentLevel(type: TimelineEventType): number {
  if (type.startsWith("AGENT_"))    return 1;
  if (type.startsWith("LLM_"))      return 2;
  if (type.startsWith("TOOL_"))     return 2;
  if (type.startsWith("HTTP_"))     return 2;
  if (type.startsWith("APPROVAL_")) return 2;
  if (type.startsWith("RETRY_"))    return 2;
  if (type.startsWith("ARTIFACT_")) return 1;
  return 0;
}

// ─── Flat span rows ───────────────────────────────────────────────────────────

interface FlatRow {
  event: RunTimelineEventUi;
  startMs: number;
  endMs: number;
  isPoint: boolean;
  indent: number;
  color: string;
  label: string;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function KV({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
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
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <pre
        className="overflow-auto rounded-lg p-3 text-[10px] font-mono leading-relaxed"
        style={{ background: "#060A10", color: "#CBD5E1", border: "1px solid rgba(148,163,184,0.10)", maxHeight: 130 }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function SpanDetail({ event, onClose }: { event: RunTimelineEventUi; onClose: () => void }) {
  const color = eventColor(event.type, event.status);
  return (
    <div
      className="mt-3 overflow-hidden rounded-xl"
      style={{ border: `1px solid ${color}33`, background: "var(--surface-2)" }}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ background: `${color}12`, borderBottom: `1px solid ${color}25` }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}80` }} />
          <span className="shrink-0 font-mono text-[10px] font-semibold" style={{ color: "var(--text-faint)" }}>
            #{event.sequence}
          </span>
          <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color }}>
            {event.type}
          </span>
          <span className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {event.title}
          </span>
          {event.durationMs != null && (
            <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: `${color}18`, color }}>
              {fmtDur(event.durationMs)}
            </span>
          )}
        </div>
        <button
          type="button" onClick={onClose}
          className="shrink-0 rounded px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/10"
          style={{ color: "var(--text-faint)" }}
        >
          Close ✕
        </button>
      </div>
      <div className="grid gap-6 p-4 lg:grid-cols-2">
        <div>
          <KV label="Status"       value={event.status} />
          <KV label="Source"       value={event.source}    mono />
          <KV label="Timestamp"    value={fmtTs(event.timestamp)} mono />
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
                <KV label="Approval ID"  value={a.id}     mono />
                <KV label="Appr. Status" value={a.status} />
                {a.decidedBy      && <KV label="Decided By" value={a.decidedBy}       mono />}
                {a.decisionReason && <KV label="Decision"   value={a.decisionReason} />}
              </>
            );
          })()}
        </div>
        <div className="space-y-3">
          {event.inputJson    != null && <JsonBlock label="Input"    value={event.inputJson} />}
          {event.outputJson   != null && <JsonBlock label="Output"   value={event.outputJson} />}
          {event.metadataJson != null && <JsonBlock label="Metadata" value={event.metadataJson} />}
        </div>
      </div>
    </div>
  );
}

// ─── Span row component ───────────────────────────────────────────────────────

function SpanRow({
  row, chartW, totalMs, selected, onSelect, chartRef,
}: {
  row: FlatRow;
  chartW: number;
  totalMs: number;
  selected: boolean;
  onSelect: () => void;
  chartRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const color = row.color;

  if (row.isPoint) {
    // Point event — single dot at the timestamp position
    const dotX = Math.round((row.startMs / totalMs) * chartW);
    return (
      <div
        className="flex cursor-pointer items-center transition-colors"
        style={{
          height: ROW_H,
          background: selected ? `${color}0d` : undefined,
          borderLeft: selected ? `2px solid ${color}` : "2px solid transparent",
        }}
        onClick={onSelect}
      >
        {/* Label */}
        <div
          className="flex shrink-0 items-center"
          style={{ width: LABEL_W, paddingLeft: 12 + row.indent * INDENT_PX, paddingRight: 8 }}
        >
          <span
            className="truncate text-[11px]"
            style={{ color: selected ? color : "var(--text-faint)", fontWeight: selected ? 600 : 400 }}
          >
            {row.label}
          </span>
        </div>
        {/* Point marker */}
        <div ref={chartRef} className="relative flex-1" style={{ height: ROW_H }}>
          <div
            style={{
              position: "absolute",
              left: dotX - DOT / 2,
              top: (ROW_H - DOT) / 2,
              width: DOT,
              height: DOT,
              borderRadius: "50%",
              background: color,
              border: `2px solid ${color}`,
              boxShadow: selected ? `0 0 0 3px ${color}30, 0 0 8px ${color}50` : `0 0 4px ${color}40`,
              zIndex: 2,
            }}
          />
        </div>
      </div>
    );
  }

  // Span event — dot ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ dot
  const rawStartPx = (row.startMs / totalMs) * chartW;
  const rawEndPx   = (row.endMs   / totalMs) * chartW;
  const rawWidthPx = rawEndPx - rawStartPx;

  // Apply minimum width — center it on the midpoint so positioning stays honest
  const spanW   = Math.max(rawWidthPx, MIN_SPAN);
  const midPx   = rawStartPx + rawWidthPx / 2;
  const startPx = Math.max(0, Math.min(chartW - spanW, midPx - spanW / 2));

  // Duration label — only if the bar is wide enough to fit text
  const showDur   = spanW > 80 && row.event.durationMs != null;
  const showLabel = spanW > 120;

  return (
    <div
      className="flex cursor-pointer items-center transition-colors"
      style={{
        height: ROW_H,
        background: selected ? `${color}0d` : undefined,
        borderLeft: selected ? `2px solid ${color}` : "2px solid transparent",
      }}
      onClick={onSelect}
      onMouseEnter={e => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = "rgba(148,163,184,0.04)";
      }}
      onMouseLeave={e => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = "";
      }}
    >
      {/* Label column */}
      <div
        className="flex shrink-0 items-center"
        style={{ width: LABEL_W, paddingLeft: 12 + row.indent * INDENT_PX, paddingRight: 8 }}
      >
        <span
          className="truncate text-[11px]"
          style={{ color: selected ? color : "var(--text-secondary)", fontWeight: selected ? 600 : 400 }}
        >
          {row.label}
        </span>
      </div>

      {/* Chart area */}
      <div ref={chartRef} className="relative flex-1 overflow-visible" style={{ height: ROW_H }}>
        {/* The span itself: start-dot ━━━━ end-dot */}
        <div
          style={{
            position: "absolute",
            left: startPx,
            width: spanW,
            top: (ROW_H - DOT) / 2,
            height: DOT,
            display: "flex",
            alignItems: "center",
          }}
        >
          {/* Start dot */}
          <div
            style={{
              width:         DOT,
              height:        DOT,
              flexShrink:    0,
              borderRadius:  "50%",
              background:    selected ? color : `${color}bb`,
              border:        `2px solid ${color}`,
              boxShadow:     selected ? `0 0 0 3px ${color}30, 0 0 8px ${color}50` : `0 0 4px ${color}30`,
              zIndex:        2,
            }}
          />

          {/* Connecting line */}
          <div
            style={{
              flex:       1,
              height:     LINE_H,
              background: selected
                ? `linear-gradient(90deg, ${color}cc, ${color})`
                : `linear-gradient(90deg, ${color}60, ${color}90)`,
              position:   "relative",
              display:    "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow:   "visible",
            }}
          >
            {/* Inline label (only if bar is wide enough) */}
            {showLabel && (
              <span
                style={{
                  position:   "absolute",
                  fontSize:   10,
                  fontWeight: 500,
                  color,
                  whiteSpace: "nowrap",
                  overflow:   "hidden",
                  textOverflow: "ellipsis",
                  maxWidth:   "calc(100% - 8px)",
                  background: "var(--surface-1)",
                  padding:    "0 4px",
                  borderRadius: 2,
                  lineHeight: "16px",
                }}
              >
                {row.label}
                {showDur && ` · ${fmtDur(row.event.durationMs!)}`}
              </span>
            )}
          </div>

          {/* End dot */}
          <div
            style={{
              width:        DOT,
              height:       DOT,
              flexShrink:   0,
              borderRadius: "50%",
              background:   color,
              border:       `2px solid ${color}`,
              boxShadow:    selected
                ? `0 0 0 3px ${color}30, 0 0 10px ${color}60`
                : `0 0 5px ${color}50`,
              zIndex: 2,
            }}
          />
        </div>

        {/* Duration badge to the right of end dot (only for short bars with no inline label) */}
        {showDur && !showLabel && (
          <span
            style={{
              position:   "absolute",
              left:       startPx + spanW + 6,
              top:        "50%",
              transform:  "translateY(-50%)",
              fontSize:   9,
              fontFamily: "var(--font-mono, monospace)",
              color:      "var(--text-faint)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {fmtDur(row.event.durationMs!)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function RunExecutionTimeline({ events }: { events: RunTimelineEventUi[] }) {
  const [selected, setSelected] = useState<RunTimelineEventUi | null>(null);
  const chartRef  = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(600);

  // Track container width for pixel-accurate positioning
  useEffect(() => {
    if (!chartRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setChartW(w);
    });
    obs.observe(chartRef.current);
    return () => obs.disconnect();
  }, []);

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
    const range = Math.max(mx - mn, 1000);
    const pad   = range * 0.03;
    return { T_min: mn - pad, totalMs: range + pad * 2 };
  }, [events]);

  // ── Build flat rows ─────────────────────────────────────────────────────────
  const rows = useMemo<FlatRow[]>(() => {
    return events.map(e => {
      const t = new Date(e.timestamp).getTime();
      return {
        event:   e,
        startMs: (e.durationMs ? t - e.durationMs : t) - T_min,
        endMs:   t - T_min,
        isPoint: !e.durationMs,
        indent:  indentLevel(e.type),
        color:   eventColor(e.type, e.status),
        label:   rowLabel(e),
      };
    });
  }, [events, T_min]);

  // ── Time ruler ticks ────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    const count = 9;
    return Array.from({ length: count + 1 }, (_, i) => ({
      pct: (i / count) * 100,
      ms:  Math.round((i / count) * totalMs),
    }));
  }, [totalMs]);

  return (
    <div>
      {/* ── Chart container ──────────────────────────────────────────────── */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
      >
        {/* ── Time ruler ── */}
        <div
          className="flex"
          style={{ height: RULER_H, borderBottom: "1px solid rgba(148,163,184,0.10)" }}
        >
          {/* Corner */}
          <div
            className="flex shrink-0 items-center px-4"
            style={{
              width: LABEL_W,
              background: "var(--surface-2)",
              borderRight: "1px solid rgba(148,163,184,0.09)",
            }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>
              Span
            </span>
          </div>

          {/* Tick marks */}
          <div className="relative flex-1" style={{ background: "var(--surface-2)" }}>
            {ticks.map((tick, i) => (
              <div
                key={i}
                className="absolute flex flex-col items-center"
                style={{ left: `${tick.pct}%`, top: 0, bottom: 0, transform: "translateX(-50%)" }}
              >
                <div style={{
                  width: 1, height: 7, marginTop: 7,
                  background: tick.pct === 0 || tick.pct === 100
                    ? "rgba(148,163,184,0.4)" : "rgba(148,163,184,0.2)",
                }} />
                <span style={{
                  fontSize: 9,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--text-faint)",
                  marginTop: 2,
                  whiteSpace: "nowrap",
                }}>
                  {tick.ms === 0 ? "0" : fmtDur(tick.ms)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Rows ── */}
        <div>
          {rows.map((row, idx) => {
            const isSel  = selected?.id === row.event.id;
            const isLast = idx === rows.length - 1;
            return (
              <div
                key={row.event.id}
                style={{ borderBottom: !isLast ? "1px solid rgba(148,163,184,0.05)" : undefined }}
              >
                <SpanRow
                  row={row}
                  chartW={chartW}
                  totalMs={totalMs}
                  selected={isSel}
                  onSelect={() => setSelected(isSel ? null : row.event)}
                  chartRef={idx === 0 ? chartRef : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
        {[
          { label: "Run lifecycle", color: "#38BDF8" },
          { label: "Agent",         color: "#A78BFA" },
          { label: "LLM",           color: "#C084FC" },
          { label: "Tool",          color: "#22D3EE" },
          { label: "HTTP",          color: "#6EE7B7" },
          { label: "Approval",      color: "#FCD34D" },
          { label: "Retry",         color: "#FDA4AF" },
          { label: "Failed",        color: "#EF4444" },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-0.5"
              style={{ color: item.color }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, display: "inline-block" }} />
              <span style={{ width: 14, height: 2, background: item.color + "80", display: "inline-block" }} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, display: "inline-block" }} />
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
              {item.label}
            </span>
          </div>
        ))}
        <span className="ml-auto text-[10px]" style={{ color: "rgba(100,116,139,0.5)" }}>
          click any row to inspect
        </span>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {selected && (
        <SpanDetail event={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
