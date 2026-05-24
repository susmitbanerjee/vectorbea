"use client";

/**
 * RunExecutionTimeline — Datadog-style horizontal trace chart
 *
 * Layout:
 *   • Horizontal time ruler at top
 *   • Swimlanes grouped by agent (or "Run Lifecycle" / "System" for non-agent events)
 *   • Each lane has a header row + span rows indented inside
 *   • Spans: ●━━━━━━━━━━━━━━━━━● with start/end dots
 *   • Point events: single ● at timestamp position
 *
 * Controls:
 *   • Zoom in / Zoom out / Fit — narrow/widen the visible time window
 *   • Click any row → SpanDetail panel slides in below
 */

import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { RunTimelineEventUi, TimelineEventType } from "@/types/agent-run-ui";

// ─── Layout constants ─────────────────────────────────────────────────────────

const LABEL_W    = 220;  // px – fixed label column
const ROW_H      = 32;   // px – height per span row
const LANE_HDR_H = 28;   // px – swimlane header row height
const DOT        = 9;    // px – dot diameter
const LINE_H     = 3;    // px – span line thickness
const RULER_H    = 36;   // px – time ruler
const MIN_SPAN   = 40;   // px – minimum span width so tiny spans are clickable
const INDENT_PX  = 14;   // px – indent per hierarchy level inside a lane

// ─── Colors ───────────────────────────────────────────────────────────────────

function eventColor(type: TimelineEventType, status: string): string {
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

function laneColor(laneName: string): string {
  if (laneName === "Run Lifecycle") return "#38BDF8";
  if (laneName === "System")        return "#94A3B8";
  // Cycle through agent colors
  const agentColors = ["#A78BFA", "#22D3EE", "#6EE7B7", "#FCD34D", "#FB923C", "#F472B6"];
  let hash = 0;
  for (let i = 0; i < laneName.length; i++) hash = (hash * 31 + laneName.charCodeAt(i)) & 0xffff;
  return agentColors[hash % agentColors.length] ?? "#A78BFA";
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTs(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

// ─── Row label helper ─────────────────────────────────────────────────────────

function rowLabel(e: RunTimelineEventUi): string {
  if (e.toolName)  return e.toolName;
  if (e.modelName) return e.modelName;
  return e.type
    .replace(/_(STARTED|COMPLETED|FAILED|CREATED|REQUESTED|APPROVED|REJECTED|EXPIRED|PASSED|SELECTED|EXHAUSTED|SCHEDULED|VALIDATED)$/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase());
}

// ─── Swimlane assignment ──────────────────────────────────────────────────────

function laneFor(e: RunTimelineEventUi): string {
  if (e.agentName) return e.agentName;
  if (e.type.startsWith("RUN_") || e.type.startsWith("BUDGET_") || e.type.startsWith("POLICY_")) {
    return "Run Lifecycle";
  }
  return "System";
}

function subIndent(type: TimelineEventType): number {
  if (type.startsWith("LLM_"))      return 1;
  if (type.startsWith("TOOL_"))     return 1;
  if (type.startsWith("HTTP_"))     return 1;
  if (type.startsWith("APPROVAL_")) return 1;
  if (type.startsWith("RETRY_"))    return 1;
  if (type.startsWith("ARTIFACT_")) return 1;
  return 0;
}

// ─── Data model ───────────────────────────────────────────────────────────────

interface FlatRow {
  event: RunTimelineEventUi;
  startMs: number;
  endMs: number;
  isPoint: boolean;
  indent: number;
  color: string;
  label: string;
}

interface Lane {
  name: string;
  color: string;
  rows: FlatRow[];
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function KV({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex gap-3 py-1.5" style={{ borderBottom: "1px solid rgba(148,163,184,0.06)" }}>
      <span className="w-36 shrink-0 text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span className={`min-w-0 break-all text-[11px] ${mono ? "font-mono" : ""}`} style={{ color: color ?? "var(--text-secondary)" }}>
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

// ─── Span row ─────────────────────────────────────────────────────────────────

function SpanRow({
  row, visibleMs, visibleStart, chartW, selected, onSelect, chartRef,
}: {
  row: FlatRow;
  visibleMs: number;
  visibleStart: number;
  chartW: number;
  selected: boolean;
  onSelect: () => void;
  chartRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const color = row.color;

  // Clamp startMs/endMs into visible window
  const relStart = row.startMs - visibleStart;
  const relEnd   = row.endMs   - visibleStart;

  if (row.isPoint) {
    const dotX = Math.round((relStart / visibleMs) * chartW);
    return (
      <div
        className="flex cursor-pointer items-center transition-colors"
        style={{
          height: ROW_H,
          background: selected ? `${color}0d` : undefined,
          borderLeft: selected ? `2px solid ${color}` : "2px solid transparent",
        }}
        onClick={onSelect}
        onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = "rgba(148,163,184,0.04)"; }}
        onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = ""; }}
      >
        <div className="flex shrink-0 items-center" style={{ width: LABEL_W, paddingLeft: 12 + row.indent * INDENT_PX, paddingRight: 8 }}>
          <span className="truncate text-[11px]" style={{ color: selected ? color : "var(--text-faint)", fontWeight: selected ? 600 : 400 }}>
            {row.label}
          </span>
        </div>
        <div ref={chartRef} className="relative flex-1" style={{ height: ROW_H }}>
          {dotX >= 0 && dotX <= chartW && (
            <div style={{
              position: "absolute", left: dotX - DOT / 2, top: (ROW_H - DOT) / 2,
              width: DOT, height: DOT, borderRadius: "50%",
              background: color, border: `2px solid ${color}`,
              boxShadow: selected ? `0 0 0 3px ${color}30, 0 0 8px ${color}50` : `0 0 4px ${color}40`, zIndex: 2,
            }} />
          )}
        </div>
      </div>
    );
  }

  // Span
  const rawStartPx = Math.max(0, (relStart / visibleMs) * chartW);
  const rawEndPx   = Math.min(chartW, (relEnd   / visibleMs) * chartW);
  const rawW       = rawEndPx - rawStartPx;
  const spanW      = Math.max(rawW, MIN_SPAN);
  const midPx      = rawStartPx + rawW / 2;
  const startPx    = Math.max(0, Math.min(chartW - spanW, midPx - spanW / 2));

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
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = "rgba(148,163,184,0.04)"; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = selected ? `${color}0d` : ""; }}
    >
      <div className="flex shrink-0 items-center" style={{ width: LABEL_W, paddingLeft: 12 + row.indent * INDENT_PX, paddingRight: 8 }}>
        <span className="truncate text-[11px]" style={{ color: selected ? color : "var(--text-secondary)", fontWeight: selected ? 600 : 400 }}>
          {row.label}
        </span>
      </div>

      <div ref={chartRef} className="relative flex-1 overflow-visible" style={{ height: ROW_H }}>
        <div style={{ position: "absolute", left: startPx, width: spanW, top: (ROW_H - DOT) / 2, height: DOT, display: "flex", alignItems: "center" }}>
          {/* Start dot */}
          <div style={{ width: DOT, height: DOT, flexShrink: 0, borderRadius: "50%", background: selected ? color : `${color}bb`, border: `2px solid ${color}`, boxShadow: selected ? `0 0 0 3px ${color}30, 0 0 8px ${color}50` : `0 0 4px ${color}30`, zIndex: 2 }} />
          {/* Line */}
          <div style={{ flex: 1, height: LINE_H, background: selected ? `linear-gradient(90deg,${color}cc,${color})` : `linear-gradient(90deg,${color}60,${color}90)`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "visible" }}>
            {showLabel && (
              <span style={{ position: "absolute", fontSize: 10, fontWeight: 500, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "calc(100% - 8px)", background: "var(--surface-1)", padding: "0 4px", borderRadius: 2, lineHeight: "16px" }}>
                {row.label}{showDur && ` · ${fmtDur(row.event.durationMs!)}`}
              </span>
            )}
          </div>
          {/* End dot */}
          <div style={{ width: DOT, height: DOT, flexShrink: 0, borderRadius: "50%", background: color, border: `2px solid ${color}`, boxShadow: selected ? `0 0 0 3px ${color}30, 0 0 10px ${color}60` : `0 0 5px ${color}50`, zIndex: 2 }} />
        </div>
        {showDur && !showLabel && (
          <span style={{ position: "absolute", left: startPx + spanW + 6, top: "50%", transform: "translateY(-50%)", fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--text-faint)", whiteSpace: "nowrap", pointerEvents: "none" }}>
            {fmtDur(row.event.durationMs!)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Swimlane header row ──────────────────────────────────────────────────────

function LaneHeader({ name, color, count, collapsed, onToggle }: {
  name: string; color: string; count: number; collapsed: boolean; onToggle: () => void;
}) {
  return (
    <div
      className="flex cursor-pointer items-center gap-2 px-3 transition-colors"
      style={{
        height: LANE_HDR_H,
        background: `${color}10`,
        borderBottom: `1px solid ${color}20`,
        borderTop: "1px solid rgba(148,163,184,0.08)",
      }}
      onClick={onToggle}
    >
      {/* Lane color dot */}
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}60` }} />
      <span className="flex-1 text-[11px] font-semibold" style={{ color }}>
        {name}
      </span>
      <span className="font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
        {count} event{count !== 1 ? "s" : ""}
      </span>
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
        {collapsed ? "▸" : "▾"}
      </span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function RunExecutionTimeline({ events }: { events: RunTimelineEventUi[] }) {
  const [selected, setSelected]   = useState<RunTimelineEventUi | null>(null);
  const [zoom, setZoom]           = useState(1);           // 1 = fit; >1 = zoomed in
  const [zoomCenter, setZoomCenter] = useState(0.5);       // 0..1 normalized center
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(600);

  useEffect(() => {
    if (!chartRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setChartW(w);
    });
    obs.observe(chartRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Full time range ─────────────────────────────────────────────────────────
  const { T_min, fullMs } = useMemo(() => {
    if (!events.length) return { T_min: 0, fullMs: 1000 };
    let mn = Infinity, mx = -Infinity;
    for (const e of events) {
      const t = new Date(e.timestamp).getTime();
      const s = e.durationMs ? t - e.durationMs : t;
      if (s < mn) mn = s;
      if (t > mx) mx = t;
    }
    const range = Math.max(mx - mn, 1000);
    const pad   = range * 0.03;
    return { T_min: mn - pad, fullMs: range + pad * 2 };
  }, [events]);

  // ── Visible window (applies zoom + pan) ─────────────────────────────────────
  const { visibleStart, visibleMs } = useMemo(() => {
    const vMs   = fullMs / zoom;
    const vStart = Math.max(0, Math.min(fullMs - vMs, zoomCenter * fullMs - vMs / 2));
    return { visibleStart: vStart, visibleMs: vMs };
  }, [fullMs, zoom, zoomCenter]);

  // ── Zoom controls ───────────────────────────────────────────────────────────
  const zoomIn  = useCallback(() => setZoom(z => Math.min(z * 2, 32)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z / 2, 1)), []);
  const zoomFit = useCallback(() => { setZoom(1); setZoomCenter(0.5); }, []);

  // ── Lane collapse toggle ────────────────────────────────────────────────────
  function toggleLane(name: string) {
    setCollapsedLanes(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // ── Build swimlanes ─────────────────────────────────────────────────────────
  const lanes = useMemo<Lane[]>(() => {
    const laneMap = new Map<string, FlatRow[]>();
    for (const e of events) {
      const lane = laneFor(e);
      const t    = new Date(e.timestamp).getTime();
      const row: FlatRow = {
        event:   e,
        startMs: (e.durationMs ? t - e.durationMs : t) - T_min,
        endMs:   t - T_min,
        isPoint: !e.durationMs,
        indent:  subIndent(e.type),
        color:   eventColor(e.type, e.status),
        label:   rowLabel(e),
      };
      const existing = laneMap.get(lane);
      if (existing) existing.push(row);
      else laneMap.set(lane, [row]);
    }

    // Deterministic order: Run Lifecycle first, then agents alphabetically, System last
    const ordered: Lane[] = [];
    const rl = laneMap.get("Run Lifecycle");
    if (rl) ordered.push({ name: "Run Lifecycle", color: laneColor("Run Lifecycle"), rows: rl });
    const agentLanes = [...laneMap.keys()]
      .filter(k => k !== "Run Lifecycle" && k !== "System")
      .sort();
    for (const name of agentLanes) {
      ordered.push({ name, color: laneColor(name), rows: laneMap.get(name)! });
    }
    const sys = laneMap.get("System");
    if (sys) ordered.push({ name: "System", color: laneColor("System"), rows: sys });

    return ordered;
  }, [events, T_min]);

  // ── Time ruler ticks ────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    const count = 8;
    return Array.from({ length: count + 1 }, (_, i) => ({
      pct: (i / count) * 100,
      ms:  Math.round(visibleStart + (i / count) * visibleMs),
    }));
  }, [visibleStart, visibleMs]);

  if (!events.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl" style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
        <p className="text-[13px]" style={{ color: "var(--text-faint)" }}>No events to display.</p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Controls bar ─────────────────────────────────────────────────────── */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Timeline
        </span>
        <span className="ml-1 rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: "rgba(56,189,248,0.10)", color: "#38BDF8" }}>
          {zoom === 1 ? "fit" : `${zoom}×`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={zoomFit} title="Fit all" className="flex h-7 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
            <Maximize2 className="h-3 w-3" />Fit
          </button>
          <button type="button" onClick={zoomOut} disabled={zoom <= 1} title="Zoom out" className="flex h-7 items-center justify-center rounded-lg border border-border/60 px-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={zoomIn} disabled={zoom >= 32} title="Zoom in" className="flex h-7 items-center justify-center rounded-lg border border-border/60 px-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Chart container ──────────────────────────────────────────────────── */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Time ruler */}
        <div className="flex" style={{ height: RULER_H, borderBottom: "1px solid rgba(148,163,184,0.10)" }}>
          <div
            className="flex shrink-0 items-center px-4"
            style={{ width: LABEL_W, background: "var(--surface-2)", borderRight: "1px solid rgba(148,163,184,0.09)" }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>
              Span · Lane
            </span>
          </div>
          <div className="relative flex-1" style={{ background: "var(--surface-2)" }}>
            {ticks.map((tick, i) => (
              <div key={i} className="absolute flex flex-col items-center" style={{ left: `${tick.pct}%`, top: 0, bottom: 0, transform: "translateX(-50%)" }}>
                <div style={{ width: 1, height: 7, marginTop: 7, background: tick.pct === 0 || tick.pct === 100 ? "rgba(148,163,184,0.4)" : "rgba(148,163,184,0.18)" }} />
                <span style={{ fontSize: 9, fontFamily: "var(--font-mono,monospace)", color: "var(--text-faint)", marginTop: 2, whiteSpace: "nowrap" }}>
                  {tick.ms === 0 ? "0" : fmtDur(tick.ms)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Swimlanes */}
        {lanes.map(lane => (
          <div key={lane.name}>
            <LaneHeader
              name={lane.name}
              color={lane.color}
              count={lane.rows.length}
              collapsed={collapsedLanes.has(lane.name)}
              onToggle={() => toggleLane(lane.name)}
            />
            {!collapsedLanes.has(lane.name) && lane.rows.map((row, idx) => {
              const isSel  = selected?.id === row.event.id;
              const isLast = idx === lane.rows.length - 1;
              return (
                <div key={row.event.id} style={{ borderBottom: !isLast ? "1px solid rgba(148,163,184,0.05)" : undefined }}>
                  <SpanRow
                    row={row}
                    visibleMs={visibleMs}
                    visibleStart={visibleStart}
                    chartW={chartW}
                    selected={isSel}
                    onSelect={() => setSelected(isSel ? null : row.event)}
                    chartRef={idx === 0 ? chartRef : undefined}
                  />
                </div>
              );
            })}
          </div>
        ))}
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
            <span className="inline-flex items-center gap-0.5" style={{ color: item.color }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, display: "inline-block" }} />
              <span style={{ width: 14, height: 2, background: item.color + "80", display: "inline-block" }} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, display: "inline-block" }} />
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{item.label}</span>
          </div>
        ))}
        <span className="ml-auto text-[10px]" style={{ color: "rgba(100,116,139,0.5)" }}>
          click row to inspect · click lane header to collapse
        </span>
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      {selected && (
        <SpanDetail event={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
