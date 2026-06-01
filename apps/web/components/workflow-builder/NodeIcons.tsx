/**
 * NodeIcons — Custom SVG icon components for the workflow builder.
 *
 * Each icon is designed as a clean monochrome SVG that:
 *  - Uses currentColor so it inherits the node's accent color
 *  - Works cleanly at 14–20px
 *  - Has strokeWidth 1.75 for visual consistency
 *  - Accepts the same props as lucide-react icons (className, style)
 *
 * References: OpenAI rosette, outline robot, AI brain, API browser,
 * 3-tier database, Gmail M-envelope, Slack-style grid, Zap+lines.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

const base: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// ─── Trigger — Zap bolt with motion lines (reference 5) ──────────────────────
export function TriggerIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Motion speed lines */}
      <line x1="3" y1="7"  x2="9"  y2="7"  strokeWidth="1.5" />
      <line x1="2" y1="11" x2="8"  y2="11" strokeWidth="1.5" />
      <line x1="3" y1="15" x2="9"  y2="15" strokeWidth="1.5" />
      {/* Lightning bolt */}
      <path d="M15 3L10 13h5L9 21" strokeWidth="2" />
    </svg>
  );
}

// ─── Agent — Outline robot head (reference 3) ────────────────────────────────
export function AgentIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Antenna stem + dot */}
      <line x1="12" y1="2.5" x2="12" y2="5" />
      <circle cx="12" cy="2" r="1" fill="currentColor" stroke="none" />
      {/* Head */}
      <rect x="5" y="5" width="14" height="11" rx="2.5" />
      {/* Eyes */}
      <circle cx="9" cy="10.5" r="1.75" />
      <circle cx="15" cy="10.5" r="1.75" />
      {/* Ear panels */}
      <rect x="2.5" y="8" width="2.5" height="5" rx="1.25" />
      <rect x="19"  y="8" width="2.5" height="5" rx="1.25" />
      {/* Smile */}
      <path d="M9.5 14q2.5 1.5 5 0" />
      {/* Shoulders */}
      <path d="M8 16L6.5 20h11L16 16" />
    </svg>
  );
}

// ─── LLM — OpenAI-inspired 6-node radial neural hub (reference 1 & 10) ───────
export function LlmIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Center hub */}
      <circle cx="12" cy="12" r="2.25" />
      {/* 6 outer nodes at 60° intervals */}
      <circle cx="12"   cy="3.5"  r="1.5" />
      <circle cx="19.5" cy="7.75" r="1.5" />
      <circle cx="19.5" cy="16.25"r="1.5" />
      <circle cx="12"   cy="20.5" r="1.5" />
      <circle cx="4.5"  cy="16.25"r="1.5" />
      <circle cx="4.5"  cy="7.75" r="1.5" />
      {/* Spokes from center to nodes */}
      <line x1="12"   y1="9.75" x2="12"   y2="5"    />
      <line x1="14"   y1="10.2" x2="18.1" y2="9"    />
      <line x1="14"   y1="13.8" x2="18.1" y2="15"   />
      <line x1="12"   y1="14.25"x2="12"   y2="19"   />
      <line x1="10"   y1="13.8" x2="5.9"  y2="15"   />
      <line x1="10"   y1="10.2" x2="5.9"  y2="9"    />
    </svg>
  );
}

// ─── Brain/Iterative — AI brain with chip (reference 4) ──────────────────────
export function BrainChipIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Brain outline — left half */}
      <path d="M12 4C9 4 6.5 5.5 5.5 8
               C4 8.5 3 9.8 3 11.5
               C3 13 4 14.5 5.5 15.2
               C5.5 17 7 18.5 8.5 18.5
               C9.2 19.5 10.5 20 12 20" />
      {/* Brain outline — right half */}
      <path d="M12 4C15 4 17.5 5.5 18.5 8
               C20 8.5 21 9.8 21 11.5
               C21 13 20 14.5 18.5 15.2
               C18.5 17 17 18.5 15.5 18.5
               C14.8 19.5 13.5 20 12 20" />
      {/* Center AI chip */}
      <rect x="9" y="9.5" width="6" height="5" rx="1" />
      {/* Chip pins — left/right */}
      <line x1="9" y1="11"  x2="7"  y2="11"  />
      <line x1="9" y1="13"  x2="7"  y2="13"  />
      <line x1="15"y1="11"  x2="17" y2="11"  />
      <line x1="15"y1="13"  x2="17" y2="13"  />
      {/* Chip pins — top/bottom */}
      <line x1="11" y1="9.5" x2="11" y2="8"  />
      <line x1="13" y1="9.5" x2="13" y2="8"  />
      <line x1="11" y1="14.5"x2="11" y2="16" />
      <line x1="13" y1="14.5"x2="13" y2="16" />
    </svg>
  );
}

// ─── Database — 3-tier solid cylinder (reference 6) ──────────────────────────
export function DatabaseIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Top ellipse */}
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      {/* Cylinder walls */}
      <line x1="4"  y1="5"  x2="4"  y2="19" />
      <line x1="20" y1="5"  x2="20" y2="19" />
      {/* Tier 2 */}
      <path d="M4 10.3 Q8 12.8 12 12.8 Q16 12.8 20 10.3" />
      {/* Tier 3 */}
      <path d="M4 14.8 Q8 17.3 12 17.3 Q16 17.3 20 14.8" />
      {/* Bottom ellipse */}
      <path d="M4 19 Q8 21.5 12 21.5 Q16 21.5 20 19" />
    </svg>
  );
}

// ─── HTTP / API — Browser window with </> (reference 7) ─────────────────────
export function HttpIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Browser window */}
      <rect x="2" y="3" width="20" height="18" rx="2.5" />
      {/* Top bar */}
      <line x1="2" y1="8.5" x2="22" y2="8.5" />
      {/* Browser dots */}
      <circle cx="5.5"  cy="6"   r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8.5"  cy="6"   r="0.9" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="6"   r="0.9" fill="currentColor" stroke="none" />
      {/* </> code symbol */}
      <path d="M8.5 13L6 15l2.5 2" strokeWidth="2" />
      <path d="M15.5 13l2.5 2-2.5 2" strokeWidth="2" />
      <line x1="13.5" y1="12" x2="10.5" y2="18" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Webhook / Integration — Slack-inspired grid of rounded pills ────────────
export function WebhookIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* A stylised connection/grid — 4 rounded rect segments meeting at center */}
      {/* Top-left segment */}
      <rect x="3"  y="3"  width="7.5" height="3.5" rx="1.75" />
      {/* Top-right segment */}
      <rect x="13.5" y="3"  width="7.5" height="3.5" rx="1.75" />
      {/* Bottom-left segment */}
      <rect x="3"  y="17.5" width="7.5" height="3.5" rx="1.75" />
      {/* Bottom-right segment */}
      <rect x="13.5" y="17.5" width="7.5" height="3.5" rx="1.75" />
      {/* Center connector cross */}
      <line x1="12" y1="7"  x2="12" y2="17" strokeWidth="2" />
      <line x1="7"  y1="12" x2="17" y2="12" strokeWidth="2" />
      {/* Corner connector nodes */}
      <circle cx="7"  cy="12" r="2.5" />
      <circle cx="17" cy="12" r="2.5" />
      <circle cx="12" cy="7"  r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
    </svg>
  );
}

// ─── Email — Gmail-inspired M-fold envelope (reference 9) ────────────────────
export function EmailIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Envelope body */}
      <rect x="2" y="5" width="20" height="15" rx="2.5" />
      {/* M-fold: left panel */}
      <line x1="2"  y1="7"  x2="7"  y2="12.5" />
      {/* M-fold: right panel */}
      <line x1="22" y1="7"  x2="17" y2="12.5" />
      {/* M-fold: center V */}
      <path d="M7 12.5 L12 17 L17 12.5" />
      {/* Top fold line */}
      <line x1="2" y1="7" x2="22" y2="7" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
}

// ─── Approval — Shield with checkmark ────────────────────────────────────────
export function ApprovalIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 3L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6L12 3Z" />
      <path d="M8.5 12l2.5 2.5 4.5-4.5" strokeWidth="2" />
    </svg>
  );
}

// ─── End — Bold circle check ──────────────────────────────────────────────────
export function EndIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" strokeWidth="2.25" />
    </svg>
  );
}

// ─── Checkpoint — Bookmark with check ────────────────────────────────────────
export function CheckpointIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M5 3h14v18l-7-4-7 4V3Z" />
      <path d="M9 10l2.5 2.5L15 8" strokeWidth="2" />
    </svg>
  );
}

// ─── Branch — Y-fork ─────────────────────────────────────────────────────────
export function BranchIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <line x1="12" y1="3" x2="12" y2="10" strokeWidth="2" />
      <circle cx="12" cy="10" r="2.5" />
      <line x1="12" y1="12.5" x2="6"  y2="18" strokeWidth="2" />
      <line x1="12" y1="12.5" x2="18" y2="18" strokeWidth="2" />
      <circle cx="6"  cy="20" r="2" />
      <circle cx="18" cy="20" r="2" />
    </svg>
  );
}

// ─── Parallel — Fan-out arrows ────────────────────────────────────────────────
export function ParallelIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <line x1="3" y1="12" x2="10" y2="12" strokeWidth="2" />
      <line x1="10" y1="12" x2="10" y2="5"  strokeWidth="2" />
      <line x1="10" y1="12" x2="10" y2="19" strokeWidth="2" />
      <line x1="10" y1="5"  x2="21" y2="5"  strokeWidth="2" />
      <line x1="10" y1="12" x2="21" y2="12" strokeWidth="2" />
      <line x1="10" y1="19" x2="21" y2="19" strokeWidth="2" />
      <path d="M18 2.5l3 2.5-3 2.5" />
      <path d="M18 9.5l3 2.5-3 2.5" />
      <path d="M18 16.5l3 2.5-3 2.5" />
    </svg>
  );
}

// ─── Join — Merge arrows ──────────────────────────────────────────────────────
export function JoinIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <line x1="3"  y1="5"  x2="14" y2="5"  strokeWidth="2" />
      <line x1="3"  y1="12" x2="14" y2="12" strokeWidth="2" />
      <line x1="3"  y1="19" x2="14" y2="19" strokeWidth="2" />
      <line x1="14" y1="5"  x2="14" y2="12" strokeWidth="2" />
      <line x1="14" y1="19" x2="14" y2="12" strokeWidth="2" />
      <line x1="14" y1="12" x2="21" y2="12" strokeWidth="2" />
      <path d="M18 9.5l3 2.5-3 2.5" />
    </svg>
  );
}

// ─── Timer — Stopwatch ────────────────────────────────────────────────────────
export function TimerIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Stopwatch body */}
      <circle cx="12" cy="13" r="8" />
      {/* Crown / top button */}
      <rect x="10" y="3" width="4" height="2.5" rx="1" />
      {/* Side button */}
      <line x1="19" y1="6" x2="21" y2="4.5" />
      {/* Clock hands */}
      <line x1="12" y1="13" x2="12" y2="8.5" strokeWidth="2" />
      <line x1="12" y1="13" x2="15.5" y2="13" strokeWidth="2" />
      <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Artifact / Document ──────────────────────────────────────────────────────
export function ArtifactIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9L14 3Z" />
      <path d="M14 3v6h6" />
      <line x1="8"  y1="13" x2="16" y2="13" />
      <line x1="8"  y1="17" x2="13" y2="17" />
    </svg>
  );
}

// ─── MCP Tool ────────────────────────────────────────────────────────────────
export function McpIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Plug connector */}
      <rect x="9" y="2" width="6" height="6" rx="1.5" />
      <line x1="10.5" y1="8" x2="10.5" y2="11" />
      <line x1="13.5" y1="8" x2="13.5" y2="11" />
      <path d="M6 11h12a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3a2 2 0 012-2Z" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="9"  y1="22" x2="15" y2="22" />
    </svg>
  );
}

// ─── GraphQL / Code ───────────────────────────────────────────────────────────
export function GraphqlIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      {/* Hexagon */}
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      {/* Inner triangle up/down (GraphQL diamond) */}
      <path d="M12 7l5 3-5 3-5-3Z" />
      <line x1="7"  y1="10" x2="7"  y2="15" />
      <line x1="17" y1="10" x2="17" y2="15" />
      <path d="M7 15l5 3 5-3" />
    </svg>
  );
}

// ─── Tool / Wrench ────────────────────────────────────────────────────────────
export function ToolIcon({ className, style }: IconProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76Z" />
    </svg>
  );
}
