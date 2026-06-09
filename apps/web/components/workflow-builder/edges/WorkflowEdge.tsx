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

/** px: within this Δ use a straight line (handles this close look aligned visually) */
const ALIGNMENT_TOLERANCE = 80;
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
      from { stroke-dashoffset: 18; }
      to   { stroke-dashoffset: 0;  }
    }
    /* Soft pulse for the running glow underlay */
    @keyframes wfEdgeGlow {
      0%, 100% { opacity: 0.28; }
      50%      { opacity: 0.55; }
    }
    /* Premium hover feedback — thicken + lift the connector under the cursor */
    .react-flow__edge:hover .vb-edge-path {
      stroke-width: 2.6px !important;
      stroke-opacity: 1 !important;
      filter: drop-shadow(0 1px 3px rgba(0,127,78,0.30));
    }
    .react-flow__edge.selected .vb-edge-path {
      stroke-width: 2.6px !important;
    }
    /* Traveling data packet on running edges */
    .vb-edge-packet { filter: drop-shadow(0 0 4px rgba(0,166,90,0.7)); }
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
 * Proper draw.io-style routing.
 *
 * Rules:
 *  PARALLEL/BRANCH fan-out → smooth bezier curves (intentional wide arcs)
 *  SEQUENTIAL aligned (dx ≤ 12px) → pure straight vertical line
 *  SEQUENTIAL offset (12px < dx ≤ 400px) → rounded orthogonal step
 *     M sx,sy → down to midY → across to tx → down to ty
 *     This always starts at the real source handle and ends at the real target.
 *  SEQUENTIAL far-offset (dx > 400) → smooth bezier (fan-in/merge)
 */
function roundedOrthogonal(
  sx: number, sy: number, tx: number, ty: number, r = CORNER_RADIUS,
): string {
  const midY  = (sy + ty) / 2;
  const dx    = tx - sx;
  const dirX  = dx >= 0 ? 1 : -1;
  const absDx = Math.abs(dx);
  const safeR = Math.min(r, absDx / 2, Math.abs(midY - sy), Math.abs(ty - midY));
  if (safeR < 2) {
    return `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
  }
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${midY - safeR}`,
    `Q ${sx} ${midY} ${sx + dirX * safeR} ${midY}`,
    `L ${tx - dirX * safeR} ${midY}`,
    `Q ${tx} ${midY} ${tx} ${midY + safeR}`,
    `L ${tx} ${ty}`,
  ].join(" ");
}

function getWorkflowPath(
  sourceX: number, sourceY: number,
  targetX: number, targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  edgeType?: string,
): PathResult {
  const cx = (sourceX + targetX) / 2;
  const cy = (sourceY + targetY) / 2;
  const dx = Math.abs(sourceX - targetX);
  const dy = Math.abs(sourceY - targetY);

  // ── Horizontal flow (side handles) ────────────────────────────────────────
  if (sourcePosition === Position.Right || targetPosition === Position.Left) {
    if (dy <= ALIGNMENT_TOLERANCE) {
      return [`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`, cx, sourceY];
    }
    return horizontalElbow(sourceX, sourceY, targetX, targetY);
  }

  // ── Parallel / branch fan-out → smooth bezier (keep the arcs) ────────────
  const isParallel = edgeType === "parallel" || edgeType === "parallel_branch";
  if (isParallel) {
    const path = `M ${sourceX} ${sourceY} C ${sourceX} ${cy} ${targetX} ${cy} ${targetX} ${targetY}`;
    return [path, cx, cy];
  }

  // ── Sequential vertical flow ──────────────────────────────────────────────
  if (dx <= ALIGNMENT_TOLERANCE) {
    // Very close — straight line
    return [`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`, cx, cy];
  }

  if (dx <= 300) {
    // Medium offset (same-size nodes not perfectly centred).
    // Use a gentle S-curve with control points close to the endpoints so the
    // connector looks nearly straight: the deviation at the midpoint is only
    // dx/2 pixels wide over the full dy height — barely visible.
    // Crucially it connects FROM the real source handle TO the real target handle.
    const tension = Math.min(dy * 0.35, 80); // control point offset — small = straighter
    const path = [
      `M ${sourceX} ${sourceY}`,
      `C ${sourceX} ${sourceY + tension}`,   // control 1 — pulls down from source
      `  ${targetX} ${targetY - tension}`,   // control 2 — pulls up to target
      `  ${targetX} ${targetY}`,
    ].join(" ");
    return [path, cx, cy];
  }

  // Wide offset → full arc (fan-out / fan-in style)
  const path = `M ${sourceX} ${sourceY} C ${sourceX} ${cy} ${targetX} ${cy} ${targetX} ${targetY}`;
  return [path, cx, cy];
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

  // ── Path: supports straight / step / smooth curve (default = smart routing)
  const curveStyle = (edgeData as unknown as { curveStyle?: string } | undefined)?.curveStyle;
  let edgePath: string;
  let labelX: number;
  let labelY: number;
  if (curveStyle === "straight") {
    edgePath = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = (sourceY + targetY) / 2;
  } else if (curveStyle === "step") {
    edgePath = roundedOrthogonal(sourceX, sourceY, targetX, targetY);
    labelX = (sourceX + targetX) / 2;
    labelY = (sourceY + targetY) / 2;
  } else {
    [edgePath, labelX, labelY] = getWorkflowPath(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, edgeType);
  }

  // ── Stroke state ──────────────────────────────────────────────────────────
  const strokeColor = selected ? "#007F4E" : isRunning ? "#0F766E" : styleCfg.stroke;
  const strokeWidth = selected ? 2.4 : 1.75;
  const markerId    = `wf-arrow-${id}`;
  const gradId      = `wf-grad-${id}`;

  const dashArray = isRunning ? "6 5" : undefined;
  const animation = isRunning ? "wfDashFast 0.5s linear infinite" : undefined;
  const strokeOpacity = selected ? 1 : isRunning ? 0.95 : 0.8;

  return (
    <>
      <defs>
        {/* Running gradient — teal → bright green, conveys flow */}
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0F766E" />
          <stop offset="100%" stopColor="#00A65A" />
        </linearGradient>
        {/* Modern arrowhead */}
        <marker id={markerId} markerWidth="9" markerHeight="9" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M 0.6 1 L 6.6 4 L 0.6 7 L 2.5 4 Z" fill={isRunning ? "#00A65A" : strokeColor} opacity={selected || isRunning ? 1 : 0.9} />
        </marker>
      </defs>

      {/* Soft glow underlay — depth on selected / running */}
      {(selected || isRunning) && (
        <path
          d={edgePath}
          fill="none"
          stroke={isRunning ? `url(#${gradId})` : strokeColor}
          strokeWidth={isRunning ? 7 : 6}
          strokeLinecap="round"
          strokeOpacity={0.18}
          style={{ filter: "blur(3px)", animation: isRunning ? "wfEdgeGlow 1.6s ease-in-out infinite" : undefined }}
        />
      )}

      {/* Invisible wider hit zone for comfortable click/hover */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction" />

      {/* Main connector */}
      <path
        id={id}
        d={edgePath}
        className="vb-edge-path"
        fill="none"
        stroke={isRunning ? `url(#${gradId})` : strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashArray}
        strokeOpacity={strokeOpacity}
        markerEnd={`url(#${markerId})`}
        style={{
          transition: "stroke-width 0.18s ease, stroke-opacity 0.18s ease",
          animation,
          filter: selected ? `drop-shadow(0 0 5px ${strokeColor}55)` : undefined,
        }}
      />

      {/* Traveling data packet — premium running animation */}
      {isRunning && (
        <circle r="3.2" fill="#00A65A" className="vb-edge-packet">
          <animateMotion dur="1.3s" repeatCount="indefinite" path={edgePath} rotate="auto" />
        </circle>
      )}

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
              className="rounded-full border px-2 py-[3px] text-[9.5px] font-semibold shadow-[0_2px_6px_rgba(11,13,15,0.08)]"
              style={{
                background: styleCfg.labelBg,
                borderColor: styleCfg.labelBorder,
                color: styleCfg.labelColor,
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
