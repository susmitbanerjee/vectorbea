/**
 * WorkflowEdge — custom edge with type-specific color, label, and arrowhead.
 */

"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { WFEdgeData, WFEdgeType } from "@/types/workflow-graph";

type WFEdge = Edge<WFEdgeData>;

const EDGE_STYLES: Record<WFEdgeType, { stroke: string; strokeDasharray?: string; labelBg: string; labelColor: string }> = {
  default:             { stroke: "rgba(148,163,184,0.5)",   labelBg: "rgba(30,30,40,0.9)",   labelColor: "#94a3b8" },
  success:             { stroke: "rgba(52,211,153,0.6)",    labelBg: "rgba(20,40,30,0.9)",   labelColor: "#34d399" },
  failure:             { stroke: "rgba(248,113,113,0.6)",   labelBg: "rgba(40,20,20,0.9)",   labelColor: "#f87171" },
  conditional_true:    { stroke: "rgba(52,211,153,0.7)",    labelBg: "rgba(20,40,30,0.9)",   labelColor: "#34d399" },
  conditional_false:   { stroke: "rgba(251,146,60,0.7)",    labelBg: "rgba(40,30,15,0.9)",   labelColor: "#fb923c" },
  parallel:            { stroke: "rgba(103,232,249,0.6)",   strokeDasharray: "5,3",          labelBg: "rgba(15,35,40,0.9)", labelColor: "#67e8f9" },
  approval_approved:   { stroke: "rgba(52,211,153,0.75)",   labelBg: "rgba(20,40,30,0.9)",   labelColor: "#34d399" },
  approval_rejected:   { stroke: "rgba(248,113,113,0.75)",  labelBg: "rgba(40,20,20,0.9)",   labelColor: "#f87171" },
  join:                { stroke: "rgba(129,140,248,0.55)",  strokeDasharray: "4,2",          labelBg: "rgba(25,25,45,0.9)", labelColor: "#818cf8" },
};

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
  markerEnd,
}: EdgeProps<WFEdge>) {
  const edgeData = data as WFEdgeData | undefined;
  const edgeType = edgeData?.edgeType ?? "default";
  const style = EDGE_STYLES[edgeType] ?? EDGE_STYLES.default;
  const label = edgeData?.label;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: style.stroke,
          strokeWidth: selected ? 2.5 : 1.8,
          strokeDasharray: style.strokeDasharray,
          transition: "stroke-width 0.1s",
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
                borderColor: style.stroke,
                color: style.labelColor,
                whiteSpace: "nowrap",
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
