import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { cellPath, notchPath, crackPath } from "~/components/app/ribbon/geometry";

/* ══════════════════════════════════════════════════════════════════════════════
   DOCS DIAGRAMS

   Drawn with the SAME cell geometry as the Checkpoint Ribbon and the same node
   marks as the builder, so a concept explained here is recognisable the moment
   the reader sees it in the product. A docs diagram in a different visual
   language teaches the reader something they then have to unlearn.

   All SVG, all semantic tokens, no images. They print correctly because they are
   vector and because nothing depends on a background colour surviving.
══════════════════════════════════════════════════════════════════════════════ */

function Figure({
  caption, children, height = 200, viewBox,
}: {
  caption: string;
  children: React.ReactNode;
  height?: number;
  viewBox: string;
}) {
  return (
    <figure className="border-subtle bg-surface-sunken my-6 overflow-hidden rounded-md border">
      <div className="overflow-x-auto p-4">
        <svg
          viewBox={viewBox}
          role="img"
          aria-label={caption}
          style={{ height, minWidth: 520 }}
          className="w-full"
        >
          {children}
        </svg>
      </div>
      <figcaption className="border-subtle border-t px-4 py-2">
        <Text variant="caption" tone="muted">{caption}</Text>
      </figcaption>
    </figure>
  );
}

/** A ribbon cell at an arbitrary position, in one of the run states. */
function Cell({
  x, y, w = 26, h = 34, state, label,
}: {
  x: number; y: number; w?: number; h?: number;
  state: "committed" | "pending" | "failed" | "executing" | "gated" | "recovered";
  label?: string;
}) {
  const fill = {
    committed: "var(--status-success)",
    executing: "var(--status-live)",
    gated: "var(--status-waiting)",
    failed: "var(--status-failed)",
    recovered: "var(--status-success)",
    pending: "none",
  }[state];

  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={cellPath(w, h)}
        fill={fill}
        stroke={state === "pending" ? "var(--border-subtle)" : "none"}
        strokeWidth={1.25}
      />
      {state === "failed" ? (
        <path d={crackPath(w, h)} fill="none" stroke="var(--bg-sunken)" strokeWidth={3} strokeLinecap="round" />
      ) : null}
      {state === "recovered" ? <path d={notchPath(w, h)} fill="var(--status-waiting)" /> : null}
      {label ? (
        <text
          x={w / 2}
          y={h + 13}
          textAnchor="middle"
          className="fill-[var(--fg-muted)] font-code"
          style={{ fontSize: 9 }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, dashed = false, label }: {
  x1: number; y1: number; x2: number; y2: number; dashed?: boolean; label?: string;
}) {
  return (
    <g>
      <path
        d={`M${x1} ${y1} L${x2} ${y2}`}
        stroke="var(--border-strong)"
        strokeWidth={1.25}
        strokeDasharray={dashed ? "4 3" : undefined}
        markerEnd="url(#docs-arrow)"
      />
      {label ? (
        <text
          x={(x1 + x2) / 2}
          y={y1 - 6}
          textAnchor="middle"
          className="fill-[var(--fg-muted)] font-ui"
          style={{ fontSize: 9.5 }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

function Box({ x, y, w, h, title, subtitle, tone = "neutral" }: {
  x: number; y: number; w: number; h: number;
  title: string; subtitle?: string;
  tone?: "neutral" | "brand" | "waiting";
}) {
  const fill = {
    neutral: "var(--bg-raised)",
    brand: "var(--accent-subtle)",
    waiting: "var(--status-waiting-subtle)",
  }[tone];
  const stroke = {
    neutral: "var(--border-subtle)",
    brand: "var(--accent-border)",
    waiting: "var(--status-waiting-border)",
  }[tone];

  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={8} fill={fill} stroke={stroke} strokeWidth={1} />
      <text x={w / 2} y={subtitle ? h / 2 - 3 : h / 2 + 4} textAnchor="middle"
        className="fill-[var(--fg-primary)] font-ui" style={{ fontSize: 11, fontWeight: 500 }}>
        {title}
      </text>
      {subtitle ? (
        <text x={w / 2} y={h / 2 + 12} textAnchor="middle"
          className="fill-[var(--fg-muted)] font-code" style={{ fontSize: 9 }}>
          {subtitle}
        </text>
      ) : null}
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <marker id="docs-arrow" viewBox="0 0 10 10" refX="9" refY="5"
        markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0 1 L9 5 L0 9 z" fill="var(--border-strong)" />
      </marker>
    </defs>
  );
}

/* ── 1 · Run lifecycle ────────────────────────────────────────────────────── */

export function RunLifecycleDiagram() {
  return (
    <Figure
      viewBox="0 0 760 150"
      height={150}
      caption="A run moves through five states. Only `running` consumes a worker; queued, suspended and failed cost nothing while they wait."
    >
      <Defs />
      <Box x={0} y={40} w={110} h={44} title="Queued" subtitle="accepted" />
      <Arrow x1={112} y1={62} x2={158} y2={62} label="lease" />
      <Box x={160} y={40} w={110} h={44} title="Running" subtitle="worker holds lease" tone="brand" />
      <Arrow x1={272} y1={62} x2={318} y2={62} label="gate" />
      <Box x={320} y={40} w={110} h={44} title="Suspended" subtitle="no compute" tone="waiting" />
      <Arrow x1={432} y1={62} x2={478} y2={62} label="approved" />
      <Box x={480} y={40} w={110} h={44} title="Running" subtitle="resumed" tone="brand" />
      <Arrow x1={592} y1={62} x2={638} y2={62} />
      <Box x={640} y={40} w={110} h={44} title="Succeeded" />

      {/* The failure path returns to running rather than to queued: a resume
          re-enters at the failed node, not at the start. */}
      <path d="M535 88 L535 118 L215 118 L215 88" fill="none" stroke="var(--status-failed)"
        strokeWidth={1.25} strokeDasharray="4 3" markerEnd="url(#docs-arrow)" />
      <text x={375} y={132} textAnchor="middle" className="fill-[var(--status-failed)] font-ui"
        style={{ fontSize: 9.5 }}>
        failure → resume from last checkpoint (never from the start)
      </text>
    </Figure>
  );
}

/* ── 2 · Checkpoint and resume ────────────────────────────────────────────── */

export function CheckpointResumeDiagram() {
  const pitch = 32;
  return (
    <Figure
      viewBox="0 0 760 210"
      height={210}
      caption="Without checkpointing, a failure at step 9 replays steps 1–8 and re-fires their side effects. With checkpointing, it replays nothing."
    >
      <Defs />

      <text x={0} y={14} className="fill-[var(--fg-muted)] font-ui" style={{ fontSize: 10 }}>
        WITHOUT CHECKPOINTS — retry re-executes everything
      </text>
      {Array.from({ length: 10 }, (_, i) => (
        <Cell key={i} x={i * pitch} y={24} state={i === 8 ? "failed" : "pending"} />
      ))}
      <text x={340} y={48} className="fill-[var(--status-failed)] font-ui" style={{ fontSize: 10 }}>
        8 steps replayed · 8 side effects re-fired · full token cost again
      </text>

      <text x={0} y={110} className="fill-[var(--fg-muted)] font-ui" style={{ fontSize: 10 }}>
        WITH CHECKPOINTS — retry re-executes one node
      </text>
      {Array.from({ length: 10 }, (_, i) => (
        <Cell
          key={i}
          x={i * pitch}
          y={120}
          state={i < 8 ? "committed" : i === 8 ? "failed" : "pending"}
          label={i === 8 ? "step 9" : undefined}
        />
      ))}
      <text x={340} y={144} className="fill-[var(--status-success)] font-ui" style={{ fontSize: 10 }}>
        0 steps replayed · 0 side effects repeated · 1 node re-executed
      </text>
      <path d={`M${8 * pitch + 13} 168 L${8 * pitch + 13} 186`} stroke="var(--accent)"
        strokeWidth={1.25} markerEnd="url(#docs-arrow)" />
      <text x={8 * pitch + 22} y={190} className="fill-[var(--accent)] font-ui" style={{ fontSize: 9.5 }}>
        resume enters here
      </text>
    </Figure>
  );
}

/* ── 3 · Queue, lease, worker ─────────────────────────────────────────────── */

export function QueueLeaseDiagram() {
  return (
    <Figure
      viewBox="0 0 760 210"
      height={210}
      caption="A worker leases a run rather than owning it. If the worker dies, the lease expires and another worker claims the run from its last checkpoint."
    >
      <Defs />
      <Box x={0} y={70} w={120} h={56} title="Queue" subtitle="163 runs" />

      <Arrow x1={122} y1={98} x2={188} y2={98} label="lease 30s" />

      <Box x={190} y={20} w={140} h={48} title="Worker A" subtitle="renewals-daily" tone="brand" />
      <Box x={190} y={80} w={140} h={48} title="Worker B" subtitle="dunning" tone="brand" />
      <Box x={190} y={140} w={140} h={48} title="Worker C" subtitle="crashed" />

      <Arrow x1={332} y1={44} x2={398} y2={44} />
      <Arrow x1={332} y1={104} x2={398} y2={104} />

      {/* The crashed worker's lease expires and the run returns to the queue. */}
      <path d="M332 164 L365 164 L365 200 L60 200 L60 128" fill="none" stroke="var(--status-waiting)"
        strokeWidth={1.25} strokeDasharray="4 3" markerEnd="url(#docs-arrow)" />
      <text x={200} y={196} className="fill-[var(--status-waiting)] font-ui" style={{ fontSize: 9.5 }}>
        lease expires after 30s · run is re-queued, not lost
      </text>

      <Box x={400} y={20} w={160} h={48} title="Checkpoint store" subtitle="append-only" />
      <Box x={400} y={80} w={160} h={48} title="Checkpoint store" subtitle="append-only" />
    </Figure>
  );
}

/* ── 4 · Approval gate ───────────────────────────────────────────────────── */

export function ApprovalGateDiagram() {
  const pitch = 34;
  return (
    <Figure
      viewBox="0 0 760 190"
      height={190}
      caption="A gate suspends the run and persists its state. Waiting is free — a run can sit at a gate for four days without holding a worker."
    >
      <Defs />
      {Array.from({ length: 5 }, (_, i) => (
        <Cell key={i} x={i * pitch} y={30} state="committed" />
      ))}
      <Cell x={5 * pitch} y={30} state="gated" label="gate" />
      {Array.from({ length: 4 }, (_, i) => (
        <Cell key={i} x={(6 + i) * pitch} y={30} state="pending" />
      ))}

      <path d={`M${5 * pitch + 13} 78 L${5 * pitch + 13} 104`} stroke="var(--status-waiting)"
        strokeWidth={1.25} markerEnd="url(#docs-arrow)" />

      <Box x={110} y={106} w={150} h={44} title="Suspended" subtitle="state persisted" tone="waiting" />
      <Arrow x1={262} y1={128} x2={318} y2={128} label="reviewer decides" />
      <Box x={320} y={82} w={150} h={40} title="Approve" subtitle="resume at gate" tone="brand" />
      <Box x={320} y={132} w={150} h={40} title="Reject" subtitle="reason required" />

      <text x={480} y={106} className="fill-[var(--fg-muted)] font-ui" style={{ fontSize: 9.5 }}>
        Decision, actor and context are written
      </text>
      <text x={480} y={120} className="fill-[var(--fg-muted)] font-ui" style={{ fontSize: 9.5 }}>
        to the audit trail together.
      </text>
    </Figure>
  );
}

/* ── 5 · I/O mapping ─────────────────────────────────────────────────────── */

export function IoMappingDiagram() {
  return (
    <Figure
      viewBox="0 0 760 230"
      height={230}
      caption="An input binds to a path in an upstream node's output schema. The binding is by path, not by position, so reordering nodes never silently rewires a field."
    >
      <Defs />

      <Box x={0} y={16} w={230} h={26} title="postgres.query" subtitle="node n1004 · output" />
      <rect x={0} y={48} width={230} height={116} rx={8} fill="var(--bg-raised)" stroke="var(--border-subtle)" />
      {[
        "rows: Row[]",
        "rows[0].account_id: string",
        "rows[0].renewal_date: date",
        "rows[0].mrr_gbp: number",
        "rowCount: number",
      ].map((line, i) => (
        <text key={line} x={12} y={68 + i * 21} className="fill-[var(--fg-secondary)] font-code"
          style={{ fontSize: 10 }}>
          {line}
        </text>
      ))}

      {/* Two bindings, drawn as paths so the reader sees which field goes where. */}
      <path d="M232 110 C300 110 300 78 388 78" fill="none" stroke="var(--accent)" strokeWidth={1.5}
        markerEnd="url(#docs-arrow)" />
      <path d="M232 131 C300 131 300 120 388 120" fill="none" stroke="var(--accent)" strokeWidth={1.5}
        markerEnd="url(#docs-arrow)" />

      <Box x={390} y={16} w={230} h={26} title="Draft outreach" subtitle="node n1005 · inputs" tone="brand" />
      <rect x={390} y={48} width={230} height={116} rx={8} fill="var(--bg-raised)" stroke="var(--accent-border)" />
      {[
        { label: "accountId ←", value: "n1004.rows[0].account_id" },
        { label: "mrr ←", value: "n1004.rows[0].mrr_gbp" },
        { label: "tone ←", value: "\"formal\" (literal)" },
      ].map((row, i) => (
        <g key={row.label}>
          <text x={402} y={70 + i * 30} className="fill-[var(--fg-primary)] font-code" style={{ fontSize: 10 }}>
            {row.label}
          </text>
          <text x={402} y={83 + i * 30} className="fill-[var(--fg-muted)] font-code" style={{ fontSize: 9 }}>
            {row.value}
          </text>
        </g>
      ))}

      <text x={0} y={190} className="fill-[var(--fg-muted)] font-ui" style={{ fontSize: 9.5 }}>
        Unbound required inputs fail validation at publish time, not at run time.
      </text>
      <text x={0} y={206} className="fill-[var(--status-failed)] font-ui" style={{ fontSize: 9.5 }}>
        A path that disappears at runtime fails the node with the path it looked for — never a null that spreads.
      </text>
    </Figure>
  );
}
