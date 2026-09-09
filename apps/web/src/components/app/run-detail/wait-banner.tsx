"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { formatDuration } from "~/lib/format";
import { WaitUntilIcon, ApprovalGateIcon } from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT THIS RUN IS PARKED ON

   A run that has been sitting on "Waiting" for six minutes is indistinguishable
   from a hung one, and the difference is the whole point of the wait primitive:
   the run holds no worker, its progress is committed, and something outside is
   still working. Without this banner an operator's only rational move on a
   long-running render is to cancel and retry — throwing away six minutes of a
   job that was going perfectly well.

   FOUR FACTS, in the order somebody parked in front of this screen needs them:

     WHAT      the wait's own label, written by whatever opened it
     HOW LONG  elapsed, because "is this normal" is the first question
     UNTIL     the deadline, because "will this ever end" is the second
     HANDLE    the provider's reference, because the third question is asked in
               the provider's dashboard and needs an id to paste

   THE DEADLINE IS THE LOAD-BEARING ONE. A wait with no timeout is the failure
   mode the timeout exists to prevent, so a wait that has one says so, and a wait
   that is past it says THAT — rather than clamping to zero and implying the
   sweeper has already dealt with it.

   Deliberately not a countdown. A ticking clock re-rendered every second from a
   value refetched every ten would be inventing precision the page does not have,
   and the answer to "how long has this been waiting" has never needed a second
   hand.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * How each kind reads to a person, and who — if anyone — is expected to act.
 *
 * The wire names come from `WaitKind` in the worker. An unrecognised kind falls
 * back rather than throwing: the worker and the web deploy separately, so a new
 * kind reaching an older browser is routine, and rendering the raw wire name is
 * strictly better than rendering nothing.
 */
const KIND: Record<string, { noun: string; icon: IconComponent; hint: string }> = {
  approval: {
    noun: "a person",
    icon: ApprovalGateIcon,
    hint: "Nothing will move until somebody decides.",
  },
  async_tool: {
    noun: "a tool that works in the background",
    icon: WaitUntilIcon,
    hint: "The tool accepted the work and will call back when it finishes.",
  },
  signal: {
    noun: "a signal",
    icon: WaitUntilIcon,
    hint: "Send it to this run to continue.",
  },
  agent_wait: {
    noun: "an external event",
    icon: WaitUntilIcon,
    hint: "The agent chose to wait rather than guess.",
  },
};

export interface WaitBannerProps {
  waits: contracts.RunWait[];
  className?: string;
}

export function WaitBanner({ waits, className }: WaitBannerProps) {
  if (waits.length === 0) return null;

  return (
    <section
      aria-labelledby="wait-heading"
      className={cn(
        "border-status-waiting-border bg-status-waiting-subtle rounded-lg border px-4 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <WaitUntilIcon size={17} aria-hidden="true" className="text-status-waiting shrink-0" />
        <Text
          variant="body-sm"
          tone="inherit"
          as="h2"
          id="wait-heading"
          className="text-status-waiting font-medium"
        >
          {waits.length === 1 ? "Waiting" : `Waiting on ${waits.length} things`}
        </Text>
        <Text variant="caption" tone="muted" className="ml-auto">
          This run is holding no worker while it waits.
        </Text>
      </div>

      <ul className="mt-2 flex flex-col gap-2">
        {waits.map((wait) => (
          <WaitRow key={wait.waitId} wait={wait} />
        ))}
      </ul>
    </section>
  );
}

function WaitRow({ wait }: { wait: contracts.RunWait }) {
  const kind = KIND[wait.kind];
  const Icon = kind?.icon ?? WaitUntilIcon;
  const noun = kind?.noun ?? wait.kind;

  return (
    <li className="border-status-waiting-border/50 bg-surface-raised rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Icon size={15} aria-hidden="true" className="text-status-waiting shrink-0 self-center" />
        <Text variant="body-sm" tone="primary" className="min-w-0 font-medium">
          {wait.label ?? `Waiting for ${noun}`}
        </Text>
        {wait.nodeId ? (
          <Text variant="caption" tone="muted" className="font-code">
            {wait.nodeId}
          </Text>
        ) : null}
      </div>

      <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Fact label="Waiting for">{formatDuration(wait.waitingMs)}</Fact>
        <Fact label="Gives up">{deadline(wait)}</Fact>
        {wait.signalName ? (
          <Fact label="Signal" mono>
            {wait.signalName}
          </Fact>
        ) : null}
        {wait.externalRef ? (
          <Fact label="Handle" mono>
            {wait.externalRef}
          </Fact>
        ) : null}
        {/* Only once polling has actually happened: "0 polls" on a callback-driven
            wait describes a mechanism that is not in use. */}
        {wait.pollAttempts > 0 ? (
          <Fact label="Polled">{`${wait.pollAttempts}×`}</Fact>
        ) : null}
      </dl>

      {kind ? (
        <Text variant="caption" tone="muted" className="mt-1 block">
          {kind.hint}
        </Text>
      ) : null}
    </li>
  );
}

/**
 * The deadline, in the reader's terms.
 *
 * Three genuinely different answers, and collapsing any two of them loses the
 * one thing this field is read for. "No deadline" is a warning, not a blank.
 */
function deadline(wait: contracts.RunWait): string {
  if (wait.expiresInMs == null) return "No deadline set";
  if (wait.expiresInMs <= 0) return "Overdue — being timed out";
  return `in ${formatDuration(wait.expiresInMs)}`;
}

function Fact({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      </dt>
      <dd>
        <Text
          variant="caption"
          tone="secondary"
          tabular
          className={cn(mono && "font-code")}
        >
          {children}
        </Text>
      </dd>
    </div>
  );
}
