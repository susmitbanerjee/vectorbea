/**
 * BaseNode — shared visual shell for all workflow nodes.
 * Provides: icon badge, type label, title, description, metadata chips,
 * status ring, handles (top/bottom/left/right), and selection border.
 *
 * Light-mode redesign: white cards, slate borders, soft shadows, premium
 * running animation with shimmer strip + arc spinner.
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
      @keyframes vb-node-shimmer {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(260%); }
      }
      @keyframes vb-soft-pulse {
        0%, 100% {
          box-shadow:
            0 0 0 4px rgba(15,118,110,0.10),
            0 16px 40px rgba(15,118,110,0.14);
        }
        50% {
          box-shadow:
            0 0 0 6px rgba(15,118,110,0.16),
            0 20px 48px rgba(15,118,110,0.20);
        }
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
        animation: "wfArcSpin 0.9s linear infinite",
        zIndex: 20,
      }}
    >
      {/* Track ring (faint) */}
      <circle
        cx={(size + 8) / 2}
        cy={(size + 8) / 2}
        r={r}
        fill="none"
        stroke="rgba(15,118,110,0.15)"
        strokeWidth={2.5}
      />
      {/* Animated arc */}
      <circle
        cx={(size + 8) / 2}
        cy={(size + 8) / 2}
        r={r}
        fill="none"
        stroke="#0F766E"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${circ * 0.28} ${circ * 0.72}`}
        strokeDashoffset={0}
        style={{ filter: "drop-shadow(0 0 3px rgba(15,118,110,0.5))" }}
      />
    </svg>
  );
}

// Status-based status text color for light mode
function statusTextColor(dot: string): string {
  if (dot.includes("teal") || dot.includes("blue")) return "#0F766E";
  if (dot.includes("emerald"))return "#007F4E";
  if (dot.includes("red"))    return "#DC2626";
  if (dot.includes("amber"))  return "#CA8A04";
  return "#94A3B8";
}

export const BaseNode = memo(function BaseNode({
  data,
  selected,
  children,
  handles = "default",
  extraTopHandles,
  extraBottomHandles,
  width = 230,
  compact = false,
}: BaseNodeProps) {
  useNodeAnimCSS();

  // Resolve base meta from node type
  const baseMeta = data.nodeType === "tool"
    ? getToolNodeMeta(data)
    : getNodeMeta(data.nodeType as WFNodeType);

  // For agent/llm nodes, detect the LLM provider for the small provider badge.
  // We NO LONGER replace the main icon with the provider icon — the node type
  // icon (robot/neural hub) is always shown as the primary visual identity.
  // Provider (OpenAI/Anthropic/Gemini) appears as a small labeled badge below.
  const llmProvider = (data.nodeType === "agent" || data.nodeType === "llm")
    ? getLLMProviderForNode(data)
    : null;

  // meta always uses the node type colors/icon (not provider colors)
  const meta = baseMeta;

  // Always use the node type icon — custom SVGs from NodeIcons.tsx
  const LucideIcon = meta.icon;

  const status = data.previewStatus ?? "idle";
  const statusCfg = PREVIEW_STATUS_COLORS[status] ?? PREVIEW_STATUS_COLORS.idle;

  // Build border / shadow per state
  let borderColor: string;
  let boxShadow: string;

  if (selected) {
    borderColor = "#168A5B";
    boxShadow = `0 0 0 4px #E6F4EF, 0 16px 36px rgba(0,127,78,0.14)`;
  } else if (status === "running") {
    borderColor = "#5EEAD4";
    boxShadow = ""; // animation handles it
  } else if (status === "succeeded") {
    borderColor = "#9CCFBB";
    boxShadow = "0 0 0 3px rgba(0,127,78,0.10), 0 8px 20px rgba(15,23,42,0.06)";
  } else if (status === "failed") {
    borderColor = "#FECACA";
    boxShadow = "0 0 0 3px rgba(220,38,38,0.10), 0 8px 20px rgba(15,23,42,0.06)";
  } else if (status === "waiting") {
    borderColor = "#FDE68A";
    boxShadow = "0 0 0 3px rgba(202,138,4,0.10), 0 8px 20px rgba(15,23,42,0.06)";
  } else {
    borderColor = "#E0E3E6";
    boxShadow = "0 10px 28px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)";
  }

  return (
    <div
      className="relative rounded-[10px] border transition-all duration-[160ms] ease-out"
      style={{
        width,
        background: "#FFFFFF",
        borderColor,
        boxShadow: status === "running" ? undefined : boxShadow,
        animation: status === "running" ? "vb-soft-pulse 1.6s ease-in-out infinite" : undefined,
        overflow: "visible",   // lets handles extend outside for clickability
      }}
      // Nodes must NOT absorb drag-over/drop events from the palette.
      // Without these, dropping a palette item onto a node would
      // fall into the node's event target and not reach the canvas wrapper.
      onDragOver={e => e.preventDefault()}
      onDrop={e => e.stopPropagation()}
    >
      {/* Inner clip wrapper — keeps shimmer visuals contained */}
      <div className="relative rounded-[10px] overflow-hidden" style={{ background: "transparent" }}>
      {/* Running: animated shimmer strip across the top */}
      {status === "running" && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 right-0 h-[3px] overflow-hidden"
          style={{ zIndex: 5 }}
        >
          <div
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              background: "linear-gradient(90deg, transparent, #0F766E, #00A65A, transparent)",
              animation: "vb-node-shimmer 1.4s linear infinite",
            }}
          />
        </div>
      )}

      {/* Header — icon, title, subtitle (reference layout) */}
      <div className={cn("relative z-10 flex items-center gap-2.5 px-3", compact ? "py-2" : "py-2.5")}>
        {/* Icon badge — always shows node type icon */}
        <span
          className="relative flex shrink-0 items-center justify-center rounded-[8px] overflow-visible"
          style={{
            width: compact ? 26 : 32,
            height: compact ? 26 : 32,
            background: meta.bgColor,
            border: `1px solid ${meta.borderColor}`,
          }}
        >
          {status === "running" && (
            <RunningSpinner size={compact ? 26 : 32} />
          )}
          <LucideIcon
            style={{ color: meta.color, width: compact ? 13 : 16, height: compact ? 13 : 16 }}
          />
          {/* Provider logo badge — bottom-right corner */}
          {llmProvider && !compact && (
            <span
              className="absolute -bottom-1.5 -right-1.5 flex items-center justify-center overflow-hidden"
              style={{
                width: 15, height: 15,
                border: "1.5px solid white",
                boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
                borderRadius: 5,
              }}
              title={llmProvider.label}
            >
              <llmProvider.Icon size={15} />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          {/* Node title */}
          <p className="truncate text-[13px] font-semibold leading-tight text-slate-900">
            {data.label}
          </p>
          {/* Subtitle — node type / description */}
          <p className="truncate text-[11px] leading-tight text-slate-500">
            {(!compact && data.description) ? data.description : meta.label}
          </p>
        </div>
      </div>

      {/* Optional metadata chips (model / provider / settings) */}
      {children && !compact && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {children}
        </div>
      )}

      {/* ↑ close inner overflow-hidden wrapper */}
      </div>

      {/* Footer — muted status row (reference: label left, status dot right) */}
      <div
        className="relative z-10 flex items-center justify-between px-3 py-[7px]"
        style={{ borderTop: "1px solid #ECEEEF", background: "#FAFBFB" }}
      >
        <span
          className="flex items-center gap-1.5 text-[11px] font-medium"
          style={{ color: status === "idle" ? "#6B7280" : statusTextColor(statusCfg.dot) }}
        >
          <span
            className={cn("h-1.5 w-1.5 rounded-full", status === "idle" ? "bg-[#C9CED4]" : statusCfg.dot)}
          />
          {status === "idle" ? "Ready" : statusCfg.label}
        </span>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            status === "idle" ? "bg-[#C9CED4]" : statusCfg.dot,
          )}
        />
      </div>

      {/* ── Handles — large, always visible, easy to grab ─────────────────── */}
      {/* React Flow handle hover/connect styles injected globally */}
      {(handles === "default" || handles === "top-only") && (
        <Handle
          type="target"
          position={Position.Top}
          className="vb-handle vb-handle-target"
          style={{
            background: "#FFFFFF",
            border: `2.5px solid ${meta.color}`,
            width: 14, height: 14,
            boxShadow: `0 0 0 3px ${meta.color}22`,
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
        />
      )}
      {(handles === "default" || handles === "bottom-only" || handles === "multi-bottom") && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="vb-handle vb-handle-source"
          style={{
            background: meta.color,
            border: `2px solid white`,
            width: 14, height: 14,
            boxShadow: `0 0 0 3px ${meta.color}30`,
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
        />
      )}
      {handles === "lr" && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            className="vb-handle vb-handle-target"
            style={{
              background: "#FFFFFF",
              border: `2.5px solid ${meta.color}`,
              width: 14, height: 14,
              boxShadow: `0 0 0 3px ${meta.color}22`,
            }}
          />
          <Handle
            type="source"
            position={Position.Right}
            className="vb-handle vb-handle-source"
            style={{
              background: meta.color,
              border: `2px solid white`,
              width: 14, height: 14,
              boxShadow: `0 0 0 3px ${meta.color}30`,
            }}
          />
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
            background: "#FFFFFF",
            border: `2px solid ${meta.color}55`,
            width: 10, height: 10,
            boxShadow: `0 0 0 2.5px ${meta.color}18`,
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
            background: "#FFFFFF",
            border: "2px solid #5EC9A0",
            width: 10, height: 10,
            boxShadow: "0 0 0 2.5px rgba(0,127,78,0.18)",
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
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold"
      style={
        color
          ? { borderColor: `${color}30`, background: `${color}10`, color }
          : { borderColor: "#E2E8F0", background: "#F8FAFC", color: "#475569" }
      }
    >
      {children}
    </span>
  );
}
