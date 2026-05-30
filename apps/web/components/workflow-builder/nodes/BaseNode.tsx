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
            0 0 0 4px rgba(37,99,235,0.10),
            0 16px 40px rgba(37,99,235,0.14);
        }
        50% {
          box-shadow:
            0 0 0 6px rgba(37,99,235,0.16),
            0 20px 48px rgba(37,99,235,0.20);
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
        stroke="rgba(37,99,235,0.15)"
        strokeWidth={2.5}
      />
      {/* Animated arc */}
      <circle
        cx={(size + 8) / 2}
        cy={(size + 8) / 2}
        r={r}
        fill="none"
        stroke="#2563EB"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${circ * 0.28} ${circ * 0.72}`}
        strokeDashoffset={0}
        style={{ filter: "drop-shadow(0 0 3px rgba(37,99,235,0.5))" }}
      />
    </svg>
  );
}

function StatusDot({ status }: { status?: string }) {
  if (!status || status === "idle") return null;
  const s = PREVIEW_STATUS_COLORS[status] ?? PREVIEW_STATUS_COLORS.idle;
  return (
    <span className={cn("absolute -top-1 -right-1 z-20 h-2.5 w-2.5 rounded-full border-2 border-white", s.dot)} />
  );
}

// Status-based status text color for light mode
function statusTextColor(dot: string): string {
  if (dot.includes("blue"))   return "#2563EB";
  if (dot.includes("emerald"))return "#059669";
  if (dot.includes("red"))    return "#DC2626";
  if (dot.includes("amber"))  return "#D97706";
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

  // Build border / shadow per state
  let borderColor: string;
  let boxShadow: string;

  if (selected) {
    borderColor = "#2563EB";
    boxShadow = `0 0 0 4px #DBEAFE, 0 16px 36px rgba(37,99,235,0.14)`;
  } else if (status === "running") {
    borderColor = "#93C5FD";
    boxShadow = ""; // animation handles it
  } else if (status === "succeeded") {
    borderColor = "#BBF7D0";
    boxShadow = "0 0 0 3px rgba(22,163,74,0.10), 0 8px 20px rgba(15,23,42,0.06)";
  } else if (status === "failed") {
    borderColor = "#FECACA";
    boxShadow = "0 0 0 3px rgba(220,38,38,0.10), 0 8px 20px rgba(15,23,42,0.06)";
  } else if (status === "waiting") {
    borderColor = "#FDE68A";
    boxShadow = "0 0 0 3px rgba(217,119,6,0.10), 0 8px 20px rgba(15,23,42,0.06)";
  } else {
    borderColor = "#E2E8F0";
    boxShadow = "0 10px 28px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)";
  }

  return (
    <div
      className="relative rounded-2xl border transition-all duration-[160ms] ease-out overflow-hidden"
      style={{
        width,
        background: "#FFFFFF",
        borderColor,
        boxShadow: status === "running" ? undefined : boxShadow,
        animation: status === "running" ? "vb-soft-pulse 1.6s ease-in-out infinite" : undefined,
      }}
    >
      {/* Left accent bar — node-type color */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl"
        style={{ background: meta.color, opacity: selected ? 1 : 0.7 }}
      />

      {/* Running: animated shimmer strip across the top */}
      {status === "running" && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 right-0 h-[3px] overflow-hidden rounded-tl-[0] rounded-tr-2xl"
          style={{ zIndex: 5 }}
        >
          <div
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              background: "linear-gradient(90deg, transparent, #2563EB, #7C3AED, transparent)",
              animation: "vb-node-shimmer 1.4s linear infinite",
            }}
          />
        </div>
      )}

      {/* Status ring / dot */}
      <StatusDot status={status} />

      {/* Content */}
      <div className={cn("relative z-10 pl-4 pr-3", compact ? "py-2.5" : "py-3")}>
        {/* Header row */}
        <div className="flex items-center gap-2.5">
          {/* Icon badge — arc spinner overlaid when running */}
          <span
            className="relative flex shrink-0 items-center justify-center rounded-xl overflow-visible"
            style={{
              width: compact ? 28 : 36,
              height: compact ? 28 : 36,
              background: ProviderIcon ? "transparent" : meta.bgColor,
              border: ProviderIcon ? "none" : `1px solid ${meta.borderColor}`,
            }}
          >
            {status === "running" && (
              <RunningSpinner size={compact ? 28 : 36} />
            )}
            {ProviderIcon ? (
              <ProviderIcon size={compact ? 28 : 36} />
            ) : (
              <LucideIcon
                style={{ color: meta.color, width: compact ? 13 : 16, height: compact ? 13 : 16 }}
              />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {/* Node type badge + status label */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className="inline-block rounded-md px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider"
                style={{ background: meta.bgColor, color: meta.color }}
              >
                {meta.label}
              </span>
              {status !== "idle" && (
                <span
                  className="text-[9px] font-semibold"
                  style={{ color: statusTextColor(statusCfg.dot) }}
                >
                  {statusCfg.label}
                </span>
              )}
            </div>

            {/* Node label */}
            <p className="truncate text-[12px] font-semibold leading-tight text-slate-900">
              {data.label}
            </p>
          </div>
        </div>

        {/* Description */}
        {!compact && data.description && (
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500 line-clamp-2">
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
          className="pointer-events-none absolute bottom-0 left-[3px] right-0 h-[2px] rounded-b-2xl"
          style={{
            background:
              status === "running"   ? "#2563EB" :
              status === "succeeded" ? "#16A34A" :
              status === "failed"    ? "#DC2626" :
              status === "waiting"   ? "#D97706" :
              status === "skipped"   ? "#CBD5E1" : "transparent",
          }}
        />
      )}

      {/* Handles */}
      {(handles === "default" || handles === "top-only") && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: "#FFFFFF",
            border: "2px solid #94A3B8",
            width: 10, height: 10,
            boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
          }}
        />
      )}
      {(handles === "default" || handles === "bottom-only" || handles === "multi-bottom") && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            background: "#FFFFFF",
            border: "2px solid #94A3B8",
            width: 10, height: 10,
            boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
          }}
        />
      )}
      {handles === "lr" && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            style={{ background: "#FFFFFF", border: "2px solid #94A3B8", width: 10, height: 10 }}
          />
          <Handle
            type="source"
            position={Position.Right}
            style={{ background: "#FFFFFF", border: "2px solid #94A3B8", width: 10, height: 10 }}
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
            border: "2px solid #94A3B8",
            width: 10, height: 10,
            boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
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
            border: "2px solid #818CF8",
            width: 10, height: 10,
            boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
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
