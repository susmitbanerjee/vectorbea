import * as React from "react";
import { Mark } from "../domain/_cell";
import type { IconComponent, IconComponentProps } from "../types";

/* ══════════════════════════════════════════════════════════════════════════════
   NODE MARKS — design §6.2. Twelve glyphs for the builder canvas.

   Abstract-structural, never literal. Each is a state of the cell rather than a
   picture of a thing: open, closed, filled, nested, split, stacked, struck. On
   canvas each sits on a tinted chip (see <NodeMarkChip>), which is what carries
   the node's colour; the glyph itself is always currentColor.
══════════════════════════════════════════════════════════════════════════════ */

/** trigger — a struck arc. The impulse that starts a run. */
export function TriggerMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M6 19A9 9 0 0 1 15 5" />
      <path d="M13.5 3 19 6.5 15.5 12" />
    </Mark>
  );
}

/** agent — a nested cell. A unit of work containing its own reasoning. */
export function AgentMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 4H20V16L16 20H4V8Z" />
      <path d="M11 9H16V13.5L14 15.5H9V11Z" />
    </Mark>
  );
}

/**
 * agent_team — three cells and the arrow between two of them.
 *
 * Deliberately built from the agent mark rather than from a group-of-people
 * glyph: a team here is not a group of users, it is several agent cells and a
 * DELEGATION relation over them, and the arrow is the half that distinguishes
 * a team from three unrelated agents sitting next to each other.
 */
export function AgentTeamMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M4 3.5h6.5V9L8.5 11H2.5V5.5Z" />
      <path d="M15.5 3.5H22V9L20 11h-6.5V5.5Z" />
      <path d="M9.5 14.5H16V20l-2 2H7.5v-5.5Z" />
      <path d="M10.8 7.2h2.6" />
      <path d="M12.4 12.2v1.6" />
    </Mark>
  );
}

/** llm — a radiating point. Generation from a single source. */
export function LlmMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 3v3.5" />
      <path d="M12 17.5V21" />
      <path d="M3 12h3.5" />
      <path d="M17.5 12H21" />
      <path d="M5.9 5.9 8.3 8.3" />
      <path d="M15.7 15.7 18.1 18.1" />
    </Mark>
  );
}

/** tool — a keyed slot. The shape a capability fits into. */
export function ToolMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 4H20V16L16 20H4V8Z" />
      <circle cx="12" cy="10.5" r="2.2" />
      <path d="M12 12.7V16.5" />
    </Mark>
  );
}

/** branch — a divergence. */
export function BranchMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M4 12h5" />
      <path d="M9 12c4 0 4-6.5 8-6.5" />
      <path d="M9 12c4 0 4 6.5 8 6.5" />
      <circle cx="19.2" cy="5.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19.2" cy="18.5" r="1.8" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/** parallel — stacked cells running at once. */
export function ParallelMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M10 3H21V11L18 14H7V6Z" />
      <path d="M6 10H17V18L14 21H3V13Z" />
    </Mark>
  );
}

/** merge — a convergence. */
export function MergeMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M20 12h-5" />
      <path d="M15 12c-4 0-4-6.5-8-6.5" />
      <path d="M15 12c-4 0-4 6.5-8 6.5" />
      <circle cx="4.8" cy="5.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="18.5" r="1.8" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/** wait — an arrested arc. Motion stopped against a bar. */
export function WaitMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M12 4a8 8 0 1 0 8 8" />
      <path d="M20 4v8" />
      <path d="M12 8.5V12l3 1.8" />
    </Mark>
  );
}

/** approval — a shield-cell. Something must pass through a person. */
export function ApprovalMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 3H20V13L12 21L4 13V7Z" />
      <path d="M4.5 11.5H19.5" />
    </Mark>
  );
}

/** checkpoint — a filled cell. Work that survives. */
export function CheckpointMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 4H20V16L16 20H4V8Z" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/** output — an opened cell. The right wall is gone; the result leaves. */
export function OutputMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M15 4H8V8L4 8V20H16L16 16" />
      <path d="M11 12h10" />
      <path d="M18 8.5 21.5 12 18 15.5" />
    </Mark>
  );
}

/** end — a closed cell. Sealed with a terminal bar. */
export function EndMark({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 4H20V16L16 20H4V8Z" />
      <path d="M7.5 15.5 16 7" />
    </Mark>
  );
}

export type NodeType =
  | "trigger" | "agent" | "agent_team" | "llm" | "tool" | "branch" | "parallel"
  | "merge" | "wait" | "approval" | "checkpoint" | "output" | "end";

export const NODE_MARKS: { type: NodeType; Icon: IconComponent; meaning: string }[] = [
  { type: "trigger", Icon: TriggerMark, meaning: "A struck arc — the impulse that starts a run" },
  { type: "agent", Icon: AgentMark, meaning: "A nested cell — work containing its own reasoning" },
  { type: "agent_team", Icon: AgentTeamMark, meaning: "Three cells and a delegation — a roster, not a crowd" },
  { type: "llm", Icon: LlmMark, meaning: "A radiating point — generation from one source" },
  { type: "tool", Icon: ToolMark, meaning: "A keyed slot — the shape a capability fits" },
  { type: "branch", Icon: BranchMark, meaning: "A divergence" },
  { type: "parallel", Icon: ParallelMark, meaning: "Stacked cells running at once" },
  { type: "merge", Icon: MergeMark, meaning: "A convergence" },
  { type: "wait", Icon: WaitMark, meaning: "An arrested arc" },
  { type: "approval", Icon: ApprovalMark, meaning: "A shield-cell — passes through a person" },
  { type: "checkpoint", Icon: CheckpointMark, meaning: "A filled cell — work that survives" },
  { type: "output", Icon: OutputMark, meaning: "An opened cell — the result leaves" },
  { type: "end", Icon: EndMark, meaning: "A closed cell — sealed" },
];

/* ── The tinted chip ─────────────────────────────────────────────────────────
   Design §6.2: each node mark sits on a tinted chip. The chip carries the
   node's role colour; the glyph stays currentColor so it inherits from the chip.

   Only two hues are used, and both are semantic rather than decorative: ember
   for the one node type that blocks on a person, brand for everything else.
   Status hues never appear here — a node type is not a run state. */
const CHIP_TONE: Record<NodeType, string> = {
  trigger: "bg-accent-subtle text-accent border-accent-border",
  agent: "bg-accent-subtle text-accent border-accent-border",
  agent_team: "bg-accent-subtle text-accent border-accent-border",
  llm: "bg-accent-subtle text-accent border-accent-border",
  tool: "bg-surface-hover text-fg-secondary border-subtle",
  branch: "bg-surface-hover text-fg-secondary border-subtle",
  parallel: "bg-surface-hover text-fg-secondary border-subtle",
  merge: "bg-surface-hover text-fg-secondary border-subtle",
  wait: "bg-surface-hover text-fg-secondary border-subtle",
  approval: "bg-status-waiting-subtle text-status-waiting border-status-waiting-border",
  checkpoint: "bg-accent-subtle text-accent border-accent-border",
  output: "bg-surface-hover text-fg-secondary border-subtle",
  end: "bg-surface-hover text-fg-secondary border-subtle",
};

export function NodeMarkChip({
  type,
  size = 20,
  className = "",
}: {
  type: NodeType;
  size?: number;
  className?: string;
}) {
  const entry = NODE_MARKS.find((n) => n.type === type);
  if (!entry) return null;
  const { Icon } = entry;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border p-1.5 ${CHIP_TONE[type]} ${className}`}
    >
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}
