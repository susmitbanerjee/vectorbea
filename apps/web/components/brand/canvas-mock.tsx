"use client";

/**
 * Static, presentational canvas mock used on marketing / empty states.
 * Mirrors the Suga reference: browser-chrome shell, product top bar with
 * breadcrumb, narrow icon rail, dotted canvas, reference-style node cards
 * with header + muted footer + status dot, and floating canvas controls.
 *
 * Purely visual — no state, no backend. Safe to render anywhere.
 */

import type { ReactNode } from "react";
import {
  Clock,
  Plus,
  LayoutGrid,
  Braces,
  Settings,
  Bot,
  ShieldCheck,
  Webhook,
  Database,
  GitBranch,
  Undo2,
  Redo2,
  Minus,
  Maximize2,
  Sliders,
} from "lucide-react";

/* ── Browser chrome shell ─────────────────────────────────────────────────── */

export function BrowserShell({
  breadcrumb = "dashboard.vectorbea.com / acme-corp / production",
  right = "canvas",
  children,
  className = "",
}: {
  breadcrumb?: string;
  right?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[14px] border bg-white ${className}`}
      style={{ borderColor: "#E0E3E6", boxShadow: "0 24px 70px rgba(11,13,15,0.10), 0 6px 20px rgba(11,13,15,0.05)" }}
    >
      {/* Chrome bar */}
      <div className="flex items-center justify-between px-4" style={{ height: 44, borderBottom: "1px solid #ECEEEF", background: "#FBFBFC" }}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#E0E3E6" }} />
            <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#E0E3E6" }} />
            <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#E0E3E6" }} />
          </div>
          <span className="hidden font-mono text-[12px] text-[#6B7280] sm:inline">{breadcrumb}</span>
        </div>
        <span className="font-mono text-[12px] text-[#9CA3AF]">{right}</span>
      </div>
      {children}
    </div>
  );
}

/* ── Product top bar (workspace / project / env breadcrumb) ───────────────── */

function Cube() {
  return (
    <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px]" style={{ background: "#0B0D0F" }}>
      <svg width="15" height="15" viewBox="0 0 32 32" fill="none">
        <g stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="11.6" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fillOpacity="0.9" />
          <ellipse cx="20.4" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fillOpacity="0.9" />
          <ellipse cx="16" cy="18" rx="4" ry="5" fill="#007F4E" />
          <path d="M12.4 16.4h7.2" />
          <path d="M12.2 19h7.6" />
          <path d="M12.8 21.6h6.4" />
        </g>
      </svg>
    </span>
  );
}

function Chevron() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="text-[#9CA3AF]">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProductTopBar() {
  return (
    <div className="flex items-center justify-between px-3.5" style={{ height: 52, borderBottom: "1px solid #ECEEEF", background: "#FFFFFF" }}>
      <div className="flex items-center gap-2.5">
        <Cube />
        <span className="text-[#C9CED4]">/</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-[#0B0D0F]">acme-corp</span>
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: "#007F4E" }}>Pro</span>
          <Chevron />
        </span>
        <span className="text-[#C9CED4]">/</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium text-[#4B5563]">renewals-ai</span>
          <Chevron />
        </span>
        <span className="text-[#C9CED4]">/</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[14px] font-medium text-[#4B5563]">production</span>
          <Chevron />
        </span>
      </div>
      <span className="h-[26px] w-[26px] rounded-full" style={{ background: "#00A65A", boxShadow: "0 0 0 3px #E6F4EF" }} />
    </div>
  );
}

/* ── Narrow icon rail ─────────────────────────────────────────────────────── */

export function IconRail() {
  const items = [
    { icon: LayoutGrid, active: true },
    { icon: Braces, active: false },
    { icon: Settings, active: false },
  ];
  return (
    <div className="flex w-[52px] shrink-0 flex-col items-center gap-1 py-3" style={{ borderRight: "1px solid #ECEEEF", background: "#FFFFFF" }}>
      {items.map(({ icon: Icon, active }, i) => (
        <span
          key={i}
          className="flex h-9 w-9 items-center justify-center rounded-[8px]"
          style={active ? { background: "#E6F4EF", color: "#007F4E" } : { color: "#9CA3AF" }}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
      ))}
    </div>
  );
}

/* ── Reference node card ──────────────────────────────────────────────────── */

type Visibility = "Public" | "Private";

export function MockNode({
  icon,
  title,
  subtitle,
  visibility,
  dotColor = "#9CA3AF",
  selected = false,
  subRows = [],
  inline = false,
  style,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  visibility?: Visibility;
  dotColor?: string;
  selected?: boolean;
  subRows?: { icon: ReactNode; label: string; meta?: string }[];
  /** Render in normal document flow (full-width) instead of absolutely positioned on a canvas. */
  inline?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={
        inline
          ? "relative w-full overflow-hidden rounded-[9px] bg-white"
          : "absolute w-[230px] overflow-hidden rounded-[9px] bg-white"
      }
      style={{
        border: `1px solid ${selected ? "#168A5B" : "#E0E3E6"}`,
        boxShadow: inline
          ? "0 1px 2px rgba(11,13,15,0.04)"
          : selected
            ? "0 0 0 3px #E6F4EF, 0 10px 28px rgba(11,13,15,0.08)"
            : "0 4px 14px rgba(11,13,15,0.06)",
        ...style,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-[#0B0D0F]">{title}</p>
          <p className="truncate text-[11px] leading-tight text-[#6B7280]">{subtitle}</p>
        </div>
      </div>
      {/* Footer / sub-rows */}
      {subRows.length > 0
        ? subRows.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid #ECEEEF", background: "#FAFBFB" }}>
              <span className="flex items-center gap-2 text-[12px] font-mono text-[#4B5563]">
                <span className="text-[#9CA3AF]">{r.icon}</span>
                {r.label}
                {r.meta && <span className="text-[10.5px] text-[#9CA3AF]">{r.meta}</span>}
              </span>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />
            </div>
          ))
        : visibility && (
            <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid #ECEEEF", background: "#FAFBFB" }}>
              <span className="flex items-center gap-1.5 text-[12px]" style={{ color: visibility === "Public" ? "#007F4E" : "#6B7280" }}>
                <Globe />
                {visibility}
              </span>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />
            </div>
          )}
    </div>
  );
}

function Globe() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" strokeLinecap="round" />
    </svg>
  );
}

/* ── Floating canvas controls ─────────────────────────────────────────────── */

function FloatingButton({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center gap-1 rounded-[9px] border bg-white px-1 py-1 ${className}`}
      style={{ borderColor: "#E0E3E6", boxShadow: "0 2px 8px rgba(11,13,15,0.06)" }}
    >
      {children}
    </div>
  );
}

/* ── The full canvas surface ──────────────────────────────────────────────── */

export function CanvasMock({ height = 520, compact = false }: { height?: number; compact?: boolean }) {
  return (
    <div className="flex" style={{ height }}>
      <IconRail />
      <div className="relative flex-1 overflow-hidden">
        {/* Unpublished banner */}
        <div className="flex items-center justify-between px-4" style={{ height: 42, background: "#E6F4EF", borderBottom: "1px solid #9CCFBB" }}>
          <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: "#006B45" }}>
            <GitBranch className="h-4 w-4" />
            You have 3 unpublished changes
          </span>
          <div className="flex items-center gap-2">
            <button className="rounded-[7px] border bg-white px-3 py-1 text-[12.5px] font-semibold" style={{ borderColor: "#9CCFBB", color: "#006B45" }}>Apply</button>
            <button className="px-2 py-1 text-[12.5px] font-medium text-[#9CA3AF]">Discard Changes</button>
          </div>
        </div>

        {/* Dotted canvas */}
        <div className="vb-canvas-dots relative" style={{ height: height - 42 }}>
          {/* History — top left */}
          <div className="absolute left-4 top-4 z-10">
            <FloatingButton className="!px-2.5 !py-1.5 gap-1.5">
              <Clock className="h-3.5 w-3.5 text-[#6B7280]" />
              <span className="text-[12.5px] font-medium text-[#4B5563]">History</span>
            </FloatingButton>
          </div>
          {/* Add — top right */}
          <div className="absolute right-4 top-4 z-10">
            <div className="flex items-center gap-2 rounded-[9px] border border-dashed px-3 py-1.5" style={{ borderColor: "#C9CED4", background: "rgba(255,255,255,0.7)" }}>
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-white" style={{ background: "#007F4E" }}>
                <Plus className="h-3 w-3" strokeWidth={2.5} />
              </span>
              <span className="text-[12.5px] font-semibold text-[#0B0D0F]">Add</span>
            </div>
          </div>

          {/* Edges */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 1 }}>
            <defs>
              <marker id="mk-arrow" markerWidth="8" markerHeight="8" refX="5.5" refY="3.5" orient="auto">
                <path d="M0 1 L5.5 3.5 L0 6 L1.5 3.5 Z" fill="#8B8F94" />
              </marker>
            </defs>
            {compact ? (
              <path d="M 258 96 C 296 96 286 150 312 150" fill="none" stroke="#8B8F94" strokeWidth="1.6" markerEnd="url(#mk-arrow)" />
            ) : (
              <>
                <path d="M 250 165 C 320 165 300 230 372 230" fill="none" stroke="#8B8F94" strokeWidth="1.6" markerEnd="url(#mk-arrow)" />
                <path d="M 432 300 C 432 350 432 360 432 392" fill="none" stroke="#8B8F94" strokeWidth="1.6" markerEnd="url(#mk-arrow)" />
                <path d="M 540 270 C 640 270 660 340 700 392" fill="none" stroke="#8B8F94" strokeWidth="1.6" markerEnd="url(#mk-arrow)" />
              </>
            )}
          </svg>

          {/* Nodes */}
          {compact ? (
            <>
              <MockNode
                style={{ left: 28, top: 56, zIndex: 2 }}
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#EEF2FF", color: "#4F46E5" }}><Webhook className="h-4 w-4" /></span>}
                title="renewal-trigger"
                subtitle="Schedule · daily 09:00"
                visibility="Public"
                dotColor="#9CA3AF"
              />
              <MockNode
                style={{ left: 312, top: 112, zIndex: 3 }}
                selected
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#E6F4EF", color: "#007F4E" }}><Bot className="h-4 w-4" /></span>}
                title="risk-scoring-agent"
                subtitle="gpt-4o-mini · BYOK OpenAI"
                visibility="Private"
                dotColor="#0F766E"
              />
            </>
          ) : (
            <>
              <MockNode
                style={{ left: 40, top: 120, zIndex: 2 }}
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#EEF2FF", color: "#4F46E5" }}><Webhook className="h-4 w-4" /></span>}
                title="renewal-trigger"
                subtitle="Schedule · daily 09:00"
                visibility="Public"
                dotColor="#9CA3AF"
              />
              <MockNode
                style={{ left: 320, top: 185, zIndex: 3 }}
                selected
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#E6F4EF", color: "#007F4E" }}><Bot className="h-4 w-4" /></span>}
                title="risk-scoring-agent"
                subtitle="gpt-4o-mini · BYOK OpenAI"
                visibility="Private"
                dotColor="#0F766E"
              />
              <MockNode
                style={{ left: 320, top: 392, zIndex: 2 }}
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#FFFBEB", color: "#CA8A04" }}><ShieldCheck className="h-4 w-4" /></span>}
                title="manager-approval"
                subtitle="waits for human decision"
                subRows={[{ icon: <Clock className="h-3.5 w-3.5" />, label: "SLA 24h" }]}
                dotColor="#CA8A04"
              />
              <MockNode
                style={{ left: 588, top: 360, zIndex: 2 }}
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: "#ECFDF5", color: "#1D6F42" }}><Database className="h-4 w-4" /></span>}
                title="renewals-db"
                subtitle="postgres:16 · encrypted"
                subRows={[{ icon: <Database className="h-3.5 w-3.5" />, label: "txn-data", meta: "10GB" }]}
                dotColor="#007F4E"
              />
            </>
          )}

          {/* Undo / redo — bottom left (full mode only) */}
          {!compact && (
            <div className="absolute bottom-4 left-4 z-10">
              <FloatingButton>
                <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6B7280]"><Undo2 className="h-3.5 w-3.5" /></span>
                <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6B7280]"><Redo2 className="h-3.5 w-3.5" /></span>
              </FloatingButton>
            </div>
          )}
          {/* Zoom controls — bottom right */}
          <div className="absolute bottom-4 right-4 z-10">
            <FloatingButton>
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6B7280]"><Minus className="h-3.5 w-3.5" /></span>
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6B7280]"><Plus className="h-3.5 w-3.5" /></span>
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6B7280]"><Maximize2 className="h-3.5 w-3.5" /></span>
              {!compact && <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6B7280]"><LayoutGrid className="h-3.5 w-3.5" /></span>}
              {!compact && <span className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[#6B7280]"><Sliders className="h-3.5 w-3.5" /></span>}
            </FloatingButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Full product mock (chrome + topbar + canvas) ─────────────────────────── */

export function ProductMock({ canvasHeight = 480 }: { canvasHeight?: number }) {
  return (
    <BrowserShell>
      <ProductTopBar />
      <CanvasMock height={canvasHeight} />
    </BrowserShell>
  );
}
