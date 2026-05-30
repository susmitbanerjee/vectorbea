/**
 * WorkflowEdge — custom edge with:
 *  • Directed arrowhead per edge type
 *  • Animated flowing dash (stroke-dashoffset animation)
 *  • Color-coded per edge semantics (success, failure, conditional, etc.)
 *  • Label chip rendered via EdgeLabelRenderer
 */

"use client";

import { memo } from "react";
import { EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { WFEdgeData, WFEdgeType } from "@/types/workflow-graph";

type WFEdge = Edge<WFEdgeData>;

// ─── Per-edge-type style config ───────────────────────────────────────────────

const EDGE_STYLES: Record<
  WFEdgeType,
  { stroke: string; labelBg: string; labelColor: string; labelBorder: string; dasharray: string; speed: string }
> = {
  default:           { stroke: "#94A3B8",  dasharray: "6 3",  speed: "1.6s", labelBg: "#FFFFFF", labelColor: "#475569", labelBorder: "#E2E8F0" },
  success:           { stroke: "#16A34A",  dasharray: "6 3",  speed: "1.2s", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  failure:           { stroke: "#DC2626",  dasharray: "4 4",  speed: "0.8s", labelBg: "#FEF2F2", labelColor: "#B91C1C", labelBorder: "#FECACA" },
  conditional_true:  { stroke: "#16A34A",  dasharray: "6 3",  speed: "1.2s", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  conditional_false: { stroke: "#EA580C",  dasharray: "4 4",  speed: "1.2s", labelBg: "#FFF7ED", labelColor: "#C2410C", labelBorder: "#FED7AA" },
  parallel:          { stroke: "#0891B2",  dasharray: "5 3",  speed: "1.0s", labelBg: "#ECFEFF", labelColor: "#0E7490", labelBorder: "#A5F3FC" },
  parallel_branch:   { stroke: "#0891B2",  dasharray: "5 3",  speed: "1.0s", labelBg: "#ECFEFF", labelColor: "#0E7490", labelBorder: "#A5F3FC" },
  approval_approved: { stroke: "#16A34A",  dasharray: "6 3",  speed: "1.2s", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  approved:          { stroke: "#16A34A",  dasharray: "6 3",  speed: "1.2s", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  approval_rejected: { stroke: "#DC2626",  dasharray: "4 4",  speed: "0.8s", labelBg: "#FEF2F2", labelColor: "#B91C1C", labelBorder: "#FECACA" },
  rejected:          { stroke: "#DC2626",  dasharray: "4 4",  speed: "0.8s", labelBg: "#FEF2F2", labelColor: "#B91C1C", labelBorder: "#FECACA" },
  join:              { stroke: "#4F46E5",  dasharray: "5 3",  speed: "1.4s", labelBg: "#EEF2FF", labelColor: "#4338CA", labelBorder: "#C7D2FE" },
  timeout:           { stroke: "#EA580C",  dasharray: "3 3",  speed: "0.9s", labelBg: "#FFF7ED", labelColor: "#C2410C", labelBorder: "#FED7AA" },
};

// ─── CSS injected once into the document ─────────────────────────────────────
// We use a SVG <defs><style> approach so it stays scoped to the SVG context.

const ANIM_CSS = `
@keyframes wfDashFlow {
  from { stroke-dashoffset: 36; }
  to   { stroke-dashoffset: 0;  }
}
@keyframes wfNodeSpin {
  from { --wf-spin-angle: 0deg; transform: rotate(0deg); }
  to   { --wf-spin-angle: 360deg; transform: rotate(360deg); }
}
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected || typeof document === "undefined") return;
  _cssInjected = true;
  const el = document.createElement("style");
  el.textContent = ANIM_CSS;
  document.head.appendChild(el);
}

// ─── Edge component ───────────────────────────────────────────────────────────

export const WorkflowEdge = memo(function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<WFEdge>) {
  // Inject CSS keyframes on first render (client only)
  injectCSS();

  const edgeData = data as WFEdgeData | undefined;
  const edgeType = edgeData?.edgeType ?? "default";
  const style = EDGE_STYLES[edgeType] ?? EDGE_STYLES.default;
  const label = edgeData?.label;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const strokeWidth = selected ? 2.5 : 1.5;
  const strokeColor = style.stroke;
  const markerId = `wf-arrow-${id}`;

  return (
    <>
      {/* SVG defs: arrowhead marker per edge (unique id so color matches) */}
      <defs>
        <marker
          id={markerId}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polygon
            points="0,0 7,3.5 0,7"
            fill={strokeColor}
            opacity="0.9"
          />
        </marker>
      </defs>

      {/* Invisible wider hit-area for click/hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="react-flow__edge-interaction"
      />

      {/* Animated dashed path */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={style.dasharray}
        markerEnd={`url(#${markerId})`}
        style={{
          animation: `wfDashFlow ${style.speed} linear infinite`,
          transition: "stroke-width 0.1s, stroke 0.2s",
          filter: selected ? `drop-shadow(0 0 3px ${strokeColor})` : undefined,
        }}
      />

      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              zIndex: 1,
            }}
          >
            <span
              className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
              style={{
                background: style.labelBg,
                borderColor: style.labelBorder,
                color: style.labelColor,
                whiteSpace: "nowrap",
                boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
              }}
            >
              {label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const edgeTypes = {
  workflow: WorkflowEdge,
};
