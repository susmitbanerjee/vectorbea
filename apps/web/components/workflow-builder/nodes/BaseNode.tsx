/**
 * BaseNode — shared visual shell for all workflow nodes.
 * Provides: icon badge, type label, title, description, metadata chips,
 * status ring, handles (top/bottom/left/right), and selection border.
 */

"use client";

import { memo, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { getNodeMeta, getToolNodeMeta, getLLMProviderForNode, PREVIEW_STATUS_COLORS } from "@/components/workflow-builder/NodeIcon";
import type { WFNodeData, WFNodeType } from "@/types/workflow-graph";

interface BaseNodeProps {
  data: WFNodeData;
  selected?: boolean;
  children?: React.ReactNode;        // extra metadata chips / badges
  handles?: "default" | "lr" | "top-only" | "bottom-only" | "none" | "multi-bottom";
  extraTopHandles?: string[];        // ids for multiple top source handles
  extraBottomHandles?: string[];     // ids for multiple bottom target handles
  width?: number;
  compact?: boolean;
}

// Inject animation keyframes once into <head>
let _nodeAnimInjected = false;
function useNodeAnimCSS() {
  useEffect(() => {
    if (_nodeAnimInjected || typeof document === "undefined") return;
    _nodeAnimInjected = true;
    const el = document.createElement("style");
    el.textContent = `
      @keyframes wfNodeSpin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes wfArcSpin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes wfArcDash {
        0%   { stroke-dashoffset: 56; }
        50%  { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: -56; }
      }
    `;
    document.head.appendChild(el);
  }, []);
}

/** Circular arrow spinner — renders as an SVG arc that rotates over the icon badge */
function RunningSpinner({ size }: { size: number }) {
  const r = size / 2 - 3;          // radius leaving 3px gap from edge
  const circ = 2 * Math.PI * r;    // full circumference
  return (
    <svg
      aria-hidden
      width={size + 8}
      height={size + 8}
      viewBox={`0 0 ${size + 8} ${size + 8}`}
      className="pointer-events-none absolute"
      style={{
        top: -4, left: -4,
        animation: "wfArcSpin 1s linear infinite",
        zIndex: 20,
      }}
    >
      {/* Track ring (faint) */}
      <circle
        cx={(size + 8) / 2}
        cy={(size + 8) / 2}
        r={r}
        fill="none"
        stroke="rgba(59,130,246,0.15)"
        strokeWidth={2.5}
      />
      {/* Animated arc */}
      <circle
        cx={(size + 8) / 2}
        cy={(size + 8) / 2}
        r={r}
        fill="none"
        stroke="rgba(59,130,246,0.9)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${circ * 0.28} ${circ * 0.72}`}
        strokeDashoffset={0}
        style={{ filter: "drop-shadow(0 0 3px rgba(59,130,246,0.7))" }}
      />
      {/* Arrow-head at arc end */}
      <polygon
        points={`${(size + 8) / 2 + r - 1},${ (size + 8) / 2 - 5} ${(size + 8) / 2 + r + 4},${(size + 8) / 2} ${(size + 8) / 2 + r - 1},${(size + 8) / 2 + 5}`}
        fill="rgba(59,130,246,0.9)"
      />
    </svg>
  );
}

function StatusDot({ status }: { status?: string }) {
  if (!status || status === "idle") return null;
  const s = PREVIEW_STATUS_COLORS[status] ?? PREVIEW_STATUS_COLORS.idle;
  return (
    <span className={cn("absolute -top-1 -right-1 z-20 h-2.5 w-2.5 rounded-full border-2 border-background", s.dot)} />
  );
}

export const BaseNode = memo(function BaseNode({
  data,
  selected,
  children,
  handles = "default",
  extraTopHandles,
  extraBottomHandles,
  width = 220,
  compact = false,
}: BaseNodeProps) {
  useNodeAnimCSS();

  // Resolve base meta from node type
  const baseMeta = data.nodeType === "tool"
    ? getToolNodeMeta(data)
    : getNodeMeta(data.nodeType as WFNodeType);

  // For agent/llm nodes, check if a specific LLM provider is configured
  const llmProvider = (data.nodeType === "agent" || data.nodeType === "llm")
    ? getLLMProviderForNode(data)
    : null;

  const meta = llmProvider
    ? { ...baseMeta, color: llmProvider.color, bgColor: llmProvider.bgColor, borderColor: llmProvider.borderColor }
    : baseMeta;

  // Resolved icon: LLM provider SVG component (size-aware) or lucide Icon
  const ProviderIcon = llmProvider?.Icon ?? null;
  const LucideIcon = meta.icon;

  const status = data.previewStatus ?? "idle";
  const statusCfg = PREVIEW_STATUS_COLORS[status] ?? PREVIEW_STATUS_COLORS.idle;

  return (
    <div
      className="relative rounded-xl border transition-all duration-150 overflow-hidden"
      style={{
        width,
        background: "hsl(220,13%,11%)",
        borderColor: selected ? meta.color : status === "running" ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.10)",
        boxShadow: selected
          ? `0 0 0 2px ${meta.color}40, 0 6px 28px rgba(0,0,0,0.5)`
          : status === "running"
          ? "0 0 0 2px rgba(59,130,246,0.4), 0 0 20px rgba(59,130,246,0.15)"
          : statusCfg.ring !== "transparent"
          ? `0 0 0 2px ${statusCfg.ring}, 0 2px 10px rgba(0,0,0,0.3)`
          : "0 2px 10px rgba(0,0,0,0.35)",
      }}
    >
      {/* Left accent bar — node-type color */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ background: meta.color, opacity: selected ? 1 : 0.55 }}
      />
      {/* Running animation — pulsing border glow (no conic ring needed; spinner is on the icon) */}
      {status === "running" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{
            boxShadow: "0 0 0 2px rgba(59,130,246,0.5), 0 0 20px rgba(59,130,246,0.15)",
            zIndex: 0,
          }}
        />
      )}

      {/* Status ring / dot */}
      <StatusDot status={status} />

      {/* Content — sits above the running-ring overlay layers */}
      <div className={cn("relative z-10 pl-4 pr-3", compact ? "py-2.5" : "py-3")}>
        {/* Header row */}
        <div className="flex items-center gap-2.5">
          {/* Icon badge — circular arrow spinner overlaid when running */}
          <span
            className="relative flex shrink-0 items-center justify-center rounded-lg overflow-visible"
            style={{
              width: compact ? 28 : 32,
              height: compact ? 28 : 32,
              background: ProviderIcon ? "transparent" : meta.bgColor,
              border: ProviderIcon ? "none" : `1px solid ${status === "running" ? "rgba(59,130,246,0.4)" : meta.borderColor}`,
            }}
          >
            {status === "running" && (
              <RunningSpinner size={compact ? 28 : 32} />
            )}
            {ProviderIcon ? (
              <ProviderIcon size={compact ? 28 : 32} />
            ) : (
              <LucideIcon
                style={{ color: meta.color, width: compact ? 13 : 15, height: compact ? 13 : 15 }}
              />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {/* Node type badge */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="inline-block rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: meta.bgColor, color: meta.color }}
              >
                {meta.label}
              </span>
              {status !== "idle" && (
                <span className="text-[9px] font-medium" style={{ color: statusCfg.dot.includes("emerald") ? "#34d399" : statusCfg.dot.includes("red") ? "#f87171" : statusCfg.dot.includes("amber") ? "#fcd34d" : "#94a3b8" }}>
                  {statusCfg.label}
                </span>
              )}
            </div>

            {/* Node label */}
            <p className="truncate text-[12px] font-semibold leading-tight text-foreground/90">
              {data.label}
            </p>
          </div>
        </div>

        {/* Description */}
        {!compact && data.description && (
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/60 line-clamp-2">
            {data.description}
          </p>
        )}

        {/* Extra chips from children */}
        {children && (
          <div className={cn("flex flex-wrap gap-1", compact ? "mt-1.5" : "mt-2.5")}>
            {children}
          </div>
        )}
      </div>

      {/* Bottom status strip */}
      {status !== "idle" && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-[3px] right-0 h-[2px] rounded-b-xl"
          style={{
            background:
              status === "running"  ? "rgba(59,130,246,0.8)" :
              status === "succeeded"? "rgba(52,211,153,0.8)" :
              status === "failed"   ? "rgba(248,113,113,0.8)":
              status === "waiting"  ? "rgba(251,191,36,0.8)" :
              status === "skipped"  ? "rgba(148,163,184,0.4)": "transparent",
          }}
        />
      )}

      {/* Handles */}
      {(handles === "default" || handles === "top-only") && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: "rgba(148,163,184,0.5)", border: "2px solid rgba(148,163,184,0.3)", width: 8, height: 8 }}
        />
      )}
      {(handles === "default" || handles === "bottom-only" || handles === "multi-bottom") && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{ background: "rgba(148,163,184,0.5)", border: "2px solid rgba(148,163,184,0.3)", width: 8, height: 8 }}
        />
      )}
      {handles === "lr" && (
        <>
          <Handle type="target" position={Position.Left} style={{ background: "rgba(148,163,184,0.4)", width: 8, height: 8 }} />
          <Handle type="source" position={Position.Right} style={{ background: "rgba(148,163,184,0.4)", width: 8, height: 8 }} />
        </>
      )}
      {/* Extra bottom handles for branch/parallel nodes */}
      {extraBottomHandles?.map((hid, i) => (
        <Handle
          key={hid}
          id={hid}
          type="source"
          position={Position.Bottom}
          style={{
            background: "rgba(148,163,184,0.5)",
            border: "2px solid rgba(148,163,184,0.3)",
            width: 8, height: 8,
            left: `${((i + 1) / (extraBottomHandles.length + 1)) * 100}%`,
          }}
        />
      ))}
      {/* Extra top handles for join nodes */}
      {extraTopHandles?.map((hid, i) => (
        <Handle
          key={hid}
          id={hid}
          type="target"
          position={Position.Top}
          style={{
            background: "rgba(129,140,248,0.5)",
            border: "2px solid rgba(129,140,248,0.3)",
            width: 8, height: 8,
            left: `${((i + 1) / (extraTopHandles.length + 1)) * 100}%`,
          }}
        />
      ))}
    </div>
  );
});

// ─── Small chip badge for node metadata ───────────────────────────────────────

export function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium"
      style={
        color
          ? { borderColor: `${color}30`, background: `${color}10`, color }
          : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(148,163,184,0.9)" }
      }
    >
      {children}
    </span>
  );
}
