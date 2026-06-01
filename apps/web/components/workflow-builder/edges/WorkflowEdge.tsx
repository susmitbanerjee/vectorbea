/**
 * WorkflowEdge — premium connector with smart path routing.
 *
 * Routing logic:
 *  • Right→Left handles: straight horizontal when |Δy| ≤ tolerance; else orthogonal elbow
 *  • Bottom→Top handles: straight vertical when |Δx| ≤ tolerance; else orthogonal elbow
 *  • Smooth rounded elbows using SVG Q (quadratic bezier) for corners
 *
 * Visuals:
 *  • Static solid stroke by default (no always-on animation — clean canvas)
 *  • Animated flowing dash ONLY when edge.data.isRunning === true
 *  • Clean concave arrowhead aligned to path direction
 *  • Selected: blue accent, wider stroke, subtle glow
 *  • Edge type colors: success=green, failure=red, conditional=appropriate
 */

"use client";

import { memo } from "react";
import {
  EdgeLabelRenderer,
  Position,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { WFEdgeData, WFEdgeType } from "@/types/workflow-graph";

type WFEdge = Edge<WFEdgeData>;

// ─── Routing constants ────────────────────────────────────────────────────────

/** px: within this Δ the connector renders as a straight line.
 *  Set very high — draw.io style: if nodes are in the same rough column
 *  the connector ALWAYS goes straight. Only genuinely offset nodes get elbows. */
const ALIGNMENT_TOLERANCE = 200;
/** px: radius for elbow rounded corners */
const CORNER_RADIUS = 10;

// ─── Per-edge-type style config ───────────────────────────────────────────────

type EdgeStyleCfg = {
  stroke: string;
  labelBg: string;
  labelColor: string;
  labelBorder: string;
};

const EDGE_STYLES: Record<WFEdgeType, EdgeStyleCfg> = {
  default:           { stroke: "#94A3B8", labelBg: "#FFFFFF", labelColor: "#475569", labelBorder: "#E2E8F0" },
  success:           { stroke: "#16A34A", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  failure:           { stroke: "#DC2626", labelBg: "#FEF2F2", labelColor: "#B91C1C", labelBorder: "#FECACA" },
  conditional_true:  { stroke: "#16A34A", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  conditional_false: { stroke: "#EA580C", labelBg: "#FFF7ED", labelColor: "#C2410C", labelBorder: "#FED7AA" },
  parallel:          { stroke: "#0891B2", labelBg: "#ECFEFF", labelColor: "#0E7490", labelBorder: "#A5F3FC" },
  parallel_branch:   { stroke: "#0891B2", labelBg: "#ECFEFF", labelColor: "#0E7490", labelBorder: "#A5F3FC" },
  approval_approved: { stroke: "#16A34A", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  approved:          { stroke: "#16A34A", labelBg: "#ECFDF5", labelColor: "#15803D", labelBorder: "#BBF7D0" },
  approval_rejected: { stroke: "#DC2626", labelBg: "#FEF2F2", labelColor: "#B91C1C", labelBorder: "#FECACA" },
  rejected:          { stroke: "#DC2626", labelBg: "#FEF2F2", labelColor: "#B91C1C", labelBorder: "#FECACA" },
  join:              { stroke: "#4F46E5", labelBg: "#EEF2FF", labelColor: "#4338CA", labelBorder: "#C7D2FE" },
  timeout:           { stroke: "#EA580C", labelBg: "#FFF7ED", labelColor: "#C2410C", labelBorder: "#FED7AA" },
};

// ─── Running animation CSS (injected once) ────────────────────────────────────

let _cssInjected = false;
function injectAnimCSS() {
  if (_cssInjected || typeof document === "undefined") return;
  _cssInjected = true;
  const el = document.createElement("style");
  el.textContent = `
    /* Slow ambient flow — always on, shows data direction */
    @keyframes wfDashSlow {
      from { stroke-dashoffset: 24; }
      to   { stroke-dashoffset: 0;  }
    }
    /* Fast flow — active/running state */
    @keyframes wfDashFast {
      from { stroke-dashoffset: 20; }
      to   { stroke-dashoffset: 0;  }
    }
  `;
  document.head.appendChild(el);
}

// ─── Path routing helpers ─────────────────────────────────────────────────────

type PathResult = [path: string, labelX: number, labelY: number];

/**
 * Horizontal elbow — source exits Right, target enters Left.
 * Routes: right → turn → down/up → turn → left
 */
function horizontalElbow(sx: number, sy: number, tx: number, ty: number): PathResult {
  const midX = (sx + tx) / 2;
  const dy   = ty - sy;
  const dirY = dy >= 0 ? 1 : -1;
  const r    = Math.min(CORNER_RADIUS, Math.abs(midX - sx) / 2, Math.abs(dy) / 2);

  const path = r < 3
    ? `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`
    : [
        `M ${sx} ${sy}`,
        `L ${midX - r} ${sy}`,
        `Q ${midX} ${sy} ${midX} ${sy + dirY * r}`,
        `L ${midX} ${ty - dirY * r}`,
        `Q ${midX} ${ty} ${midX + r} ${ty}`,
        `L ${tx} ${ty}`,
      ].join(" ");

  return [path, midX, (sy + ty) / 2];
}

/**
 * Vertical elbow — source exits Bottom, target enters Top.
 * Routes: down → turn → left/right → turn → up.
 *
 * When the horizontal offset is small (< 120px), uses a cubic bezier
 * instead of a hard elbow so the line looks nearly-straight rather than
 * making a jarring 90° detour.
 */
function verticalElbow(sx: number, sy: number, tx: number, ty: number): PathResult {
  const dx    = tx - sx;
  const absDx = Math.abs(dx);

  // For small offsets use a smooth S-curve (barely visible deflection)
  if (absDx < 120) {
    const cy = (sy + ty) / 2;
    const path = `M ${sx} ${sy} C ${sx} ${cy} ${tx} ${cy} ${tx} ${ty}`;
    return [path, (sx + tx) / 2, cy];
  }

  const midY = (sy + ty) / 2;
  const dirX = dx >= 0 ? 1 : -1;
  const r    = Math.min(CORNER_RADIUS, absDx / 2, Math.abs(midY - sy));

  const path = r < 3
    ? `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`
    : [
        `M ${sx} ${sy}`,
        `L ${sx} ${midY - r}`,
        `Q ${sx} ${midY} ${sx + dirX * r} ${midY}`,
        `L ${tx - dirX * r} ${midY}`,
        `Q ${tx} ${midY} ${tx} ${midY + r}`,
        `L ${tx} ${ty}`,
      ].join(" ");

  return [path, (sx + tx) / 2, midY];
}

/**
 * Draw.io-style path routing.
 *
 * For VERTICAL flow (Bottom→Top — the default for sequential workflows):
 *   • Within ALIGNMENT_TOLERANCE (200px): route through the SHARED CENTERLINE
 *     so the connector always appears perfectly straight regardless of the
 *     exact handle positions. This is exactly how draw.io handles "straight"
 *     connections — it snaps to the center column, not the raw handle coords.
 *   • Beyond 200px: orthogonal elbow (genuinely offset nodes).
 *
 * For HORIZONTAL flow (Right→Left): same logic on the Y axis.
 */
function getWorkflowPath(
  sourceX: number, sourceY: number,
  targetX: number, targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
): PathResult {
  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2;
  const dx = Math.abs(sourceX - targetX);
  const dy = Math.abs(sourceY - targetY);

  // Detect horizontal flow (Left/Right handles)
  const isHorizontalFlow =
    sourcePosition === Position.Right ||
    targetPosition === Position.Left;

  // ── Horizontal flow (Left→Right or Right→Left) ─────────────────────────────
  if (isHorizontalFlow) {
    if (dy <= ALIGNMENT_TOLERANCE) {
      // Route through shared center Y — always looks straight
      const cy = (sourceY + targetY) / 2;
      const path = `M ${sourceX} ${sourceY} L ${sourceX} ${cy} L ${targetX} ${cy} L ${targetX} ${targetY}`;
      return [path, labelX, cy];
    }
    return horizontalElbow(sourceX, sourceY, targetX, targetY);
  }

  // ── Vertical flow (Bottom→Top — sequential workflow nodes) ─────────────────
  if (dx <= ALIGNMENT_TOLERANCE) {
    // ★ Draw.io straight connector:
    // Route through the shared center X so the line is perfectly vertical
    // regardless of how far off the actual handle positions are.
    const cx = (sourceX + targetX) / 2;
    // Short horizontal jogs at source and target to exit/enter handles cleanly,
    // then a long perfectly vertical segment down the center column.
    const jog = Math.min(dx / 2, 8); // tiny jog, invisible at normal zoom
    if (dx < 4) {
      // Handles are essentially identical — pure straight line
      return [`M ${cx} ${sourceY} L ${cx} ${targetY}`, cx, labelY];
    }
    const path = [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceX} ${sourceY + jog}`,
      `L ${cx} ${sourceY + jog}`,
      `L ${cx} ${targetY - jog}`,
      `L ${targetX} ${targetY - jog}`,
      `L ${targetX} ${targetY}`,
    ].join(" ");
    return [path, cx, labelY];
  }

  // Genuinely offset nodes — full orthogonal elbow
  return verticalElbow(sourceX, sourceY, targetX, targetY);
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
  injectAnimCSS();

  const edgeData  = data as WFEdgeData | undefined;
  const edgeType  = edgeData?.edgeType ?? "default";
  const styleCfg  = EDGE_STYLES[edgeType] ?? EDGE_STYLES.default;
  const label     = edgeData?.label;
  const isRunning = (edgeData as unknown as Record<string, unknown>)?.isRunning === true;

  const [edgePath, labelX, labelY] = getWorkflowPath(
    sourceX, sourceY,
    targetX, targetY,
    sourcePosition,
    targetPosition,
  );

  // Stroke state
  const strokeColor = selected ? "#3B82F6" : styleCfg.stroke;
  const strokeWidth = selected ? 2.5 : 1.75;
  const markerId    = `wf-arrow-${id}`;

  // Always animate — slow ambient flow shows data direction.
  // Running state: brighter color, faster flow.
  const dashArray = isRunning ? "5 3" : "8 5";
  const animation = isRunning
    ? "wfDashFast 0.45s linear infinite"
    : "wfDashSlow 2.2s linear infinite";
  const strokeOpacity = selected ? 1 : isRunning ? 0.9 : 0.65;
  const filter = selected
    ? `drop-shadow(0 0 4px ${strokeColor}60)`
    : isRunning
      ? `drop-shadow(0 0 3px ${strokeColor}80)`
      : undefined;

  return (
    <>
      {/* Per-edge arrowhead (unique id so color tracks strokeColor) */}
      <defs>
        <marker
          id={markerId}
          markerWidth="7"
          markerHeight="7"
          refX="5.5"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          {/* Slightly concave filled arrowhead — clean and professional */}
          <path
            d="M 0 0.75 L 5.5 3.5 L 0 6.25 L 1.5 3.5 Z"
            fill={strokeColor}
            opacity={selected ? 1 : 0.85}
          />
        </marker>
      </defs>

      {/* Invisible wider hit zone for comfortable click/hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        className="react-flow__edge-interaction"
      />

      {/* Main connector */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashArray}
        strokeOpacity={strokeOpacity}
        markerEnd={`url(#${markerId})`}
        style={{
          transition: "stroke 0.15s ease, stroke-width 0.15s ease",
          animation,
          filter,
        }}
      />

      {/* Label chip — rendered outside SVG via EdgeLabelRenderer */}
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
                background: styleCfg.labelBg,
                borderColor: styleCfg.labelBorder,
                color: styleCfg.labelColor,
                whiteSpace: "nowrap",
                boxShadow: "0 1px 4px rgba(15,23,42,0.07)",
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
