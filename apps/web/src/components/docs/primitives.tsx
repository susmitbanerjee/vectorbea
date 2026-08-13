"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/input";
import type { IconComponent } from "~/components/icons/types";
import {
  CheckpointIcon, IncidentIcon, GateRejectedIcon, LeaseIcon, ApprovalGateIcon,
} from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   DOCS PRIMITIVES

   Every one uses the product's own tokens and icon set, so a reader moving
   between the docs and the app is not crossing a visual border. That is the
   point of building these rather than reaching for a docs framework: MDX
   starters arrive with their own callout colours, their own code theme and their
   own type scale, and reconciling them costs more than writing these did.
══════════════════════════════════════════════════════════════════════════════ */

/* ── Callout ──────────────────────────────────────────────────────────────── */

type CalloutKind = "note" | "tip" | "warning" | "danger";

const CALLOUT: Record<CalloutKind, { icon: IconComponent; label: string; className: string; tone: string }> = {
  note: {
    icon: CheckpointIcon, label: "Note",
    className: "bg-accent-subtle border-accent-border", tone: "text-accent",
  },
  tip: {
    icon: LeaseIcon, label: "Tip",
    className: "bg-status-success-subtle border-status-success-border", tone: "text-status-success",
  },
  warning: {
    icon: ApprovalGateIcon, label: "Warning",
    className: "bg-status-waiting-subtle border-status-waiting-border", tone: "text-status-waiting",
  },
  danger: {
    icon: GateRejectedIcon, label: "Danger",
    className: "bg-status-failed-subtle border-status-failed-border", tone: "text-status-failed",
  },
};

export function Callout({
  kind = "note", title, children,
}: {
  kind?: CalloutKind;
  title?: string;
  children: React.ReactNode;
}) {
  const meta = CALLOUT[kind];
  const Glyph = meta.icon;

  return (
    <aside className={cn("my-5 flex gap-3 rounded-md border p-3.5", meta.className)}>
      <Glyph size={18} aria-hidden="true" className={cn("mt-0.5 shrink-0", meta.tone)} />
      <div className="min-w-0">
        <Text variant="body-sm" className={cn("mb-0.5 block font-medium", meta.tone)}>
          {title ?? meta.label}
        </Text>
        <div className="text-fg-secondary [&_p]:text-body-sm [&_p]:mt-0 [&_p+p]:mt-2">{children}</div>
      </div>
    </aside>
  );
}

/* ── Steps ────────────────────────────────────────────────────────────────── */

export function Steps({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <ol className="my-6 grid gap-0">
      {items.map((child, i) => (
        <li key={i} className="relative grid grid-cols-[1.75rem_1fr] gap-3 pb-6 last:pb-0">
          {/* The rail connects the steps; it stops at the last one rather than
              trailing into whitespace. */}
          {i < items.length - 1 ? (
            <span aria-hidden="true" className="bg-surface-active absolute left-[0.8125rem] top-7 bottom-0 w-px" />
          ) : null}
          <span className="bg-accent text-fg-on-accent font-code tabular relative grid size-7 shrink-0 place-items-center rounded-full text-[11px]">
            {i + 1}
          </span>
          <div className="min-w-0 pt-0.5">{child}</div>
        </li>
      ))}
    </ol>
  );
}

export function Step({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <>
      <Text variant="heading-sm" tone="max" as="h3" className="mb-1 block">{title}</Text>
      <div className="text-fg-secondary">{children}</div>
    </>
  );
}

/* ── Parameter / props / response tables ──────────────────────────────────── */

export interface ParamRow {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  description: React.ReactNode;
}

export function ParamTable({ rows, caption }: { rows: ParamRow[]; caption?: string }) {
  return (
    <div className="border-subtle my-5 overflow-x-auto rounded-md border">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-subtle bg-surface-sunken border-b">
            {["Field", "Type", "Description"].map((h) => (
              <th key={h} className="font-ui text-eyebrow text-fg-muted px-3 py-2 uppercase">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-subtle border-b last:border-b-0 align-top">
              <td className="px-3 py-2.5">
                <code className="font-code text-mono-sm text-fg-primary">{row.name}</code>
                {row.required ? (
                  <span className="text-status-failed font-ui text-caption ml-1.5">required</span>
                ) : null}
              </td>
              <td className="px-3 py-2.5">
                <code className="font-code text-mono-sm text-accent">{row.type}</code>
                {row.default ? (
                  <div className="font-code text-mono-sm text-fg-muted mt-0.5">
                    default {row.default}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2.5">
                <Text variant="body-sm" tone="secondary">{row.description}</Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Props tables are parameter tables with a component's vocabulary. */
export const PropsTable = ParamTable;

export function ResponseSchema({
  status, rows, description,
}: {
  status: number;
  rows: ParamRow[];
  description?: string;
}) {
  const ok = status < 400;
  return (
    <div className="my-5">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "font-code text-mono-sm rounded-xs border px-1.5 py-0.5",
            ok
              ? "bg-status-success-subtle border-status-success-border text-status-success"
              : "bg-status-failed-subtle border-status-failed-border text-status-failed",
          )}
        >
          {status}
        </span>
        {description ? <Text variant="caption" tone="muted">{description}</Text> : null}
      </div>
      <ParamTable rows={rows} caption={`Response schema for status ${status}`} />
    </div>
  );
}

/* ── Comparison table ─────────────────────────────────────────────────────── */

export function ComparisonTable({
  columns, rows,
}: {
  columns: string[];
  rows: { label: string; cells: React.ReactNode[]; note?: string }[];
}) {
  return (
    <div className="border-subtle my-5 overflow-x-auto rounded-md border">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <thead>
          <tr className="border-subtle bg-surface-sunken border-b">
            <th className="font-ui text-eyebrow text-fg-muted px-3 py-2 uppercase" />
            {columns.map((c, i) => (
              <th
                key={c}
                className={cn(
                  "font-ui text-eyebrow px-3 py-2 uppercase",
                  i === columns.length - 1 ? "text-accent" : "text-fg-muted",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-subtle border-b last:border-b-0 align-top">
              <th scope="row" className="px-3 py-2.5 text-left font-normal">
                <Text variant="body-sm" tone="primary" className="block">{row.label}</Text>
                {row.note ? <Text variant="caption" tone="muted" className="block">{row.note}</Text> : null}
              </th>
              {row.cells.map((cell, i) => (
                <td key={i} className="px-3 py-2.5">
                  <Text variant="body-sm" tone="secondary">{cell}</Text>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Anchored headings ────────────────────────────────────────────────────── */

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="group scroll-mt-24 pt-8">
      <Text variant="heading-md" tone="max" as="span" className="inline-flex items-baseline gap-2">
        {children}
        <AnchorLink id={id} />
      </Text>
    </h2>
  );
}

export function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="group scroll-mt-24 pt-5">
      <Text variant="heading-sm" tone="max" as="span" className="inline-flex items-baseline gap-2">
        {children}
        <AnchorLink id={id} />
      </Text>
    </h3>
  );
}

function AnchorLink({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label="Link to this section"
      className={cn(
        "text-fg-disabled hover:text-accent font-code text-mono-sm",
        "opacity-0 transition-opacity duration-fast group-hover:opacity-100",
        "rounded-sm outline-none focus-visible:opacity-100 focus-visible:focus-ring",
        // Hidden in print — an anchor glyph on paper is noise.
        "print:hidden",
      )}
    >
      #
    </a>
  );
}

/* ── Prose wrappers ───────────────────────────────────────────────────────── */

export function P({ children }: { children: React.ReactNode }) {
  return <Text variant="body" tone="secondary" as="p" className="my-4 block">{children}</Text>;
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <Text variant="body-lg" tone="secondary" as="p" className="mt-2 mb-6 block">{children}</Text>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="my-4 grid gap-2">{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden="true" className="bg-accent mt-2 size-1 shrink-0 rounded-full" />
      <Text variant="body" tone="secondary">{children}</Text>
    </li>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-surface-active border-subtle text-fg-primary font-code text-mono-sm rounded-xs border px-1 py-0.5">
      {children}
    </code>
  );
}

export function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-fg-primary font-medium">{children}</strong>;
}

/* ── Was this helpful ─────────────────────────────────────────────────────── */

export function WasThisHelpful({ slug }: { slug: string }) {
  const [verdict, setVerdict] = React.useState<null | "yes" | "no">(null);
  const [comment, setComment] = React.useState("");
  const [sent, setSent] = React.useState(false);

  if (sent) {
    return (
      <div className="border-subtle bg-surface-sunken mt-12 rounded-md border p-4 print:hidden">
        <Text variant="body-sm" tone="secondary">
          Thanks — that goes to the people who write these pages.
        </Text>
      </div>
    );
  }

  return (
    <div className="border-subtle bg-surface-sunken mt-12 rounded-md border p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <Text variant="body-sm" tone="primary">Was this page helpful?</Text>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={verdict === "yes" ? "subtle" : "secondary"}
            onClick={() => setVerdict("yes")}
            aria-pressed={verdict === "yes"}
          >
            Yes
          </Button>
          <Button
            size="sm"
            variant={verdict === "no" ? "subtle" : "secondary"}
            onClick={() => setVerdict("no")}
            aria-pressed={verdict === "no"}
          >
            No
          </Button>
        </div>
      </div>

      {verdict ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(e) => { e.preventDefault(); setSent(true); }}
        >
          <Textarea
            minRows={2}
            maxRows={5}
            placeholder={
              verdict === "yes"
                ? "What did this page get right? (optional)"
                : "What were you trying to do that this page did not answer? (optional)"
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Feedback comment"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="primary">Send feedback</Button>
            <Text variant="caption" tone="muted">
              Sent with the page path ({slug}). Nothing else.
            </Text>
          </div>
        </form>
      ) : null}
    </div>
  );
}
