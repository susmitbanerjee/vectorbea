import type { Route } from "next";
import { GearSix, UsersThree, Sparkle } from "@phosphor-icons/react/dist/ssr";
import type { IconComponent } from "~/components/icons/types";
import {
  DurableRunIcon, IncidentIcon, ApprovalGateIcon, AgentBrainIcon, ToolCallIcon,
  QueueDepthIcon, CheckpointIcon, TokenMeterIcon, BlastRadiusIcon,
  FanOutIcon, LeaseIcon, ByokKeyIcon, CommitBoundaryIcon,
} from "~/components/icons/domain";

/* Members and Settings take PHOSPHOR glyphs, not bespoke marks. Design §6 makes
   Phosphor the base set and reserves the 29 hand-drawn marks for concepts no
   library contains — a checkpoint, a lease, a blast radius. "Settings" is not
   one of those, and minting a bespoke gear would both waste the effort and
   dilute what a bespoke mark signals. */

/* ══════════════════════════════════════════════════════════════════════════════
   INFORMATION ARCHITECTURE — design §9.

   Four groups that match the mental model rather than the database:

     OBSERVE   what production is doing right now
     BUILD     what you are creating
     CONNECT   what it talks to
     GOVERN    who may do what, and what it costs

   Three deliberate changes from the old IA:
     - Overview  → Control    (it is a control plane, not a summary page)
     - Schedules → Triggers   (a schedule is one KIND of trigger; webhooks and
                               manual/API runs are the others, and they had no home)
     - Incidents and Audit log are NEW. 83 failed runs are not 83 problems, they
       are probably 3 — and enterprise buyers ask for the audit trail on the
       first call.
══════════════════════════════════════════════════════════════════════════════ */

export type BadgeKind = "approvals" | "incidents" | "connections";

export interface NavItem {
  label: string;
  href: Route;
  icon: IconComponent;
  /** Live count source. Rendered only when the count is > 0. */
  badge?: BadgeKind;
  /** Tone for the badge — a count is meaningless without knowing if it is bad. */
  badgeTone?: "waiting" | "failed" | "neutral";
  /** Marks a route that exists but has no real screen yet. */
  placeholder?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: "observe",
    label: "Observe",
    items: [
      { label: "Control", href: "/control" as Route, icon: CheckpointIcon, placeholder: true },
      { label: "Runs", href: "/runs" as Route, icon: DurableRunIcon },
      { label: "Incidents", href: "/incidents" as Route, icon: IncidentIcon, badge: "incidents", badgeTone: "failed", placeholder: true },
      /* Failures is deliberately NOT in the sidebar. It is a peer of Incidents —
         the same failures grouped by class and owner over a window rather than
         by live signature — and two adjacent doors onto the same subject made
         neither legible. The route and the view stay: /failures is reachable
         directly and from a run, it just no longer competes with Incidents for
         the operator's attention. */
      { label: "Approvals", href: "/approvals" as Route, icon: ApprovalGateIcon, badge: "approvals", badgeTone: "waiting" },
    ],
  },
  {
    id: "build",
    label: "Build",
    items: [
      { label: "Workflows", href: "/workflows" as Route, icon: FanOutIcon },
      { label: "Agents", href: "/agents" as Route, icon: AgentBrainIcon },
      { label: "Tools", href: "/tools" as Route, icon: ToolCallIcon },
      { label: "Skills", href: "/skills" as Route, icon: Sparkle },
      { label: "Templates", href: "/templates" as Route, icon: CommitBoundaryIcon },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    items: [
      { label: "Integrations", href: "/integrations" as Route, icon: BlastRadiusIcon },
      { label: "Connections", href: "/connections" as Route, icon: LeaseIcon, badge: "connections", badgeTone: "failed" },
      { label: "Triggers", href: "/triggers" as Route, icon: QueueDepthIcon, placeholder: true },
    ],
  },
  {
    id: "govern",
    label: "Govern",
    /*
     * Usage & limits and Members are sections OF Settings, and listing them
     * here as well gave each two front doors with no way to tell which was
     * canonical — the sidebar highlighted one thing while the settings nav
     * highlighted another on the same screen. They are reachable from Settings
     * and from the command palette.
     *
     * The audit log stays top-level and is deliberately NOT a settings section:
     * it is a record you go and read during an incident or a review, not a
     * thing you configure, and burying it two clicks deep is how a governance
     * surface stops being consulted.
     */
    items: [
      { label: "Audit log", href: "/audit-log" as Route, icon: ByokKeyIcon },
      { label: "Settings", href: "/settings" as Route, icon: GearSix as IconComponent },
    ],
  },
];

/** Flat lookup for the breadcrumb and command palette. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/**
 * Human label for a path segment, for the breadcrumb.
 *
 * Falls back to title-casing the segment, so a route added later still produces
 * something sensible rather than a raw slug.
 */
const SEGMENT_LABELS: Record<string, string> = {
  control: "Control",
  runs: "Runs",
  incidents: "Incidents",
  approvals: "Approvals",
  workflows: "Workflows",
  agents: "Agents",
  tools: "Tools",
  skills: "Skills",
  templates: "Templates",
  integrations: "Integrations",
  connections: "Connections",
  triggers: "Triggers",
  settings: "Settings",
  usage: "Usage & limits",
  members: "Members",
  "audit-log": "Audit log",
  builder: "Builder",
  new: "New",
  architect: "AI Architect",
  import: "Import",
  dashboard: "Dashboard",
  schedules: "Schedules",
};

export function segmentLabel(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // Ids stay as-is; the breadcrumb renders them with <MonoId>.
  if (/^[0-9a-f-]{8,}$/i.test(segment) || segment.includes("_")) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

/** Is this segment an identifier rather than a page name? */
export function isIdSegment(segment: string): boolean {
  return /^[0-9a-f]{8}-/i.test(segment) || /^(run|wf|agt|tool|conn)_/i.test(segment) || /^\d+$/.test(segment);
}
