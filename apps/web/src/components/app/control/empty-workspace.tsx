"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import {
  ByokKeyIcon, AgentBrainIcon, DurableRunIcon, CheckpointIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";
import type { RunNode } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   EMPTY WORKSPACE — the first-run layout.

   Not a dashboard full of zeroes. Empty axes, "0 runs" and a burndown with no
   line are worse than nothing: they teach a new user that the page is broken,
   and they teach nothing about what to do.

   This is the same page, doing its actual job — making the next action obvious —
   for a workspace whose next action happens to be "connect a provider".
══════════════════════════════════════════════════════════════════════════════ */

const DEMO_NODES: RunNode[] = (
  ["committed", "committed", "committed", "executing", "pending", "pending", "pending"] as const
).map((state, i) => ({
  id: `demo-${i}`,
  name: `Node ${i + 1}`,
  kind: "tool" as const,
  state,
  durationMs: state === "pending" ? null : 800,
  tokens: null,
  costUsd: null,
  at: state === "pending" ? null : new Date().toISOString(),
}));

interface Step {
  icon: IconComponent;
  title: string;
  body: string;
  action: { label: string; href: string };
  done?: boolean;
}

const STEPS: Step[] = [
  {
    icon: ByokKeyIcon,
    title: "Connect a model provider",
    body: "Your own key, encrypted with AES-256-GCM and decrypted only in the runner. Your pricing, your rate limits, your data agreement.",
    action: { label: "Add a connection", href: "/connections/new" },
  },
  {
    icon: AgentBrainIcon,
    title: "Build your first workflow",
    body: "Start from a template or describe what you want and let AI Architect draft the graph. You edit the blueprint before anything is created.",
    action: { label: "Browse templates", href: "/templates" },
  },
  {
    icon: DurableRunIcon,
    title: "Run it, then break it",
    body: "Kill the connection mid-run. Watch the run stop at the failed node, keep everything before it, and resume from that checkpoint.",
    action: { label: "Read the tutorial", href: "/docs/first-workflow" },
  },
];

export function EmptyWorkspace({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[52rem]", className)}>
      <div className="border-subtle bg-surface-raised rounded-lg border p-6 text-center sm:p-8">
        {/* Illustrative, and said so immediately below. §5 forbids the Ribbon as
            decoration where it does not represent real state; here it is
            showing the reader what the thing they are about to build looks
            like, on a page whose headline is that nothing real exists yet. */}
        <CheckpointRibbon
          nodes={DEMO_NODES}
          size="md"
          runId="control-empty-demo"
          className="mx-auto w-fit"
        />
        <Text variant="caption" tone="disabled" className="mt-2 block">
          Example run
        </Text>
        <Text variant="heading-md" tone="max" as="h2" className="mt-4 block">
          Nothing has run here yet
        </Text>
        <Text variant="body" tone="secondary" className="mx-auto mt-2 block max-w-[52ch]">
          Control fills in as soon as you have a workflow executing — fleet health, the failure
          budget, and everything that needs you, in one place. Three steps to get there.
        </Text>
      </div>

      <ol className="mt-3 grid gap-2">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="border-subtle bg-surface-raised flex flex-wrap items-start gap-3 rounded-md border p-4"
          >
            <span className="bg-surface-sunken border-subtle text-fg-muted font-code tabular grid size-7 shrink-0 place-items-center rounded-full border text-[11px]">
              {i + 1}
            </span>
            <step.icon size={18} aria-hidden="true" className="text-accent mt-1 shrink-0" />
            <div className="min-w-0 flex-1">
              <Text variant="body-sm" tone="primary" className="block font-medium">{step.title}</Text>
              <Text variant="caption" tone="secondary" className="mt-0.5 block max-w-[62ch]">
                {step.body}
              </Text>
            </div>
            <Button asChild size="sm" variant={i === 0 ? "primary" : "secondary"} className="shrink-0">
              <Link href={step.action.href as Route}>{step.action.label}</Link>
            </Button>
          </li>
        ))}
      </ol>

      <div className="border-subtle mt-4 flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3">
        <CheckpointIcon size={16} aria-hidden="true" className="text-fg-muted shrink-0" />
        <Text variant="caption" tone="muted" className="min-w-0 flex-1">
          Prefer to look around first? The docs walk through durability, approvals and I/O mapping
          with worked examples.
        </Text>
        <Link
          href={"/docs" as Route}
          className={cn(
            "font-ui text-caption text-accent hover:text-accent-hover rounded-xs px-1",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
          )}
        >
          Read the docs
        </Link>
      </div>
    </div>
  );
}
