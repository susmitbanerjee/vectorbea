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
  { stroke: string; labelBg: string; labelColor: string; dasharray: string; speed: string }
> = {
  default:           { stroke: "rgba(148,163,184,0.65)", dasharray: "6 3",  speed: "1.6s", labelBg: "rgba(30,30,40,0.9)",   labelColor: "#94a3b8" },
  success:           { stroke: "rgba(52,211,153,0.75)",  dasharray: "6 3",  speed: "1.2s", labelBg: "rgba(20,40,30,0.9)",   labelColor: "#34d399" },
  failure:           { stroke: "rgba(248,113,113,0.75)", dasharray: "4 4",  speed: "0.8s", labelBg: "rgba(40,20,20,0.9)",   labelColor: "#f87171" },
  conditional_true:  { stroke: "rgba(52,211,153,0.8)",   dasharray: "6 3",  speed: "1.2s", labelBg: "rgba(20,40,30,0.9)",   labelColor: "#34d399" },
  conditional_false: { stroke: "rgba(251,146,60,0.8)",   dasharray: "4 4",  speed: "1.2s", labelBg: "rgba(40,30,15,0.9)",   labelColor: "#fb923c" },
  parallel:          { stroke: "rgba(103,232,249,0.75)", dasharray: "5 3",  speed: "1.0s", labelBg: "rgba(15,35,40,0.9)",   labelColor: "#67e8f9" },
  parallel_branch:   { stroke: "rgba(103,232,249,0.75)", dasharray: "5 3",  speed: "1.0s", labelBg: "rgba(15,35,40,0.9)",   labelColor: "#67e8f9" },
  approval_approved: { stroke: "rgba(52,211,153,0.85)",  dasharray: "6 3",  speed: "1.2s", labelBg: "rgba(20,40,30,0.9)",   labelColor: "#34d399" },
  approved:          { stroke: "rgba(52,211,153,0.85)",  dasharray: "6 3",  speed: "1.2s", labelBg: "rgba(20,40,30,0.9)",   labelColor: "#34d399" },
  approval_rejected: { stroke: "rgba(248,113,113,0.85)", dasharray: "4 4",  speed: "0.8s", labelBg: "rgba(40,20,20,0.9)",   labelColor: "#f87171" },
  rejected:          { stroke: "rgba(248,113,113,0.85)", dasharray: "4 4",  speed: "0.8s", labelBg: "rgba(40,20,20,0.9)",   labelColor: "#f87171" },
  join:              { stroke: "rgba(129,140,248,0.7)",  dasharray: "5 3",  speed: "1.4s", labelBg: "rgba(25,25,45,0.9)",   labelColor: "#818cf8" },
  timeout:           { stroke: "rgba(251,146,60,0.75)",  dasharray: "3 3",  speed: "0.9s", labelBg: "rgba(40,30,15,0.9)",   labelColor: "#fb923c" },
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

  const strokeWidth = selected ? 2.5 : 1.8;
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
                borderColor: strokeColor,
                color: style.labelColor,
                whiteSpace: "nowrap",
                backdropFilter: "blur(4px)",
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
