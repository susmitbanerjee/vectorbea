"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { ReplayProvider, useReplay } from "./replay";
import { RunHeader } from "./run-header";
import { RecoveryCard } from "./recovery-card";
import { WaitBanner } from "./wait-banner";
import { DeliveryPanel } from "./delivery-panel";
import { StepTimeline } from "./step-timeline";
import { CanvasMirror } from "./canvas-mirror";
import { Inspector } from "./inspector";
import { LogStream } from "./log-stream";
import type { RunStreamState } from "~/lib/api/run-stream";
import { CompareView, EventHistory } from "./compare-and-events";
import { diagnoseRun } from "./diagnose-run";
import { ApprovalGateIcon } from "~/components/icons/domain";
import type { contracts } from "@vectorbea/shared";
import type { Run } from "~/lib/runs/model";
import { useRunDetailData } from "./use-run-detail-data";
import { ControlSkeleton } from "~/components/app/control/skeletons";

/* ══════════════════════════════════════════════════════════════════════════════
   RUN DETAIL — panes, not tabs.

   The five tabs it replaces (Execution View, Logs, Recovery Engine, Tool Calls,
   Event History) were the wrong shape for the moment this screen exists for.
   During an incident you are correlating: this log line, at that step, on that
   node. Tabs make correlation a memory exercise — you read the log, hold a
   timestamp in your head, switch tab, and try to find the step it belongs to.

   Panes make it a glance, and the scrubber makes it one gesture.

   The panes are resizable and collapsible because "simultaneously" does not mean
   "in fixed proportion" — reading a stack trace wants a wide inspector, watching
   a live run wants a wide canvas.
══════════════════════════════════════════════════════════════════════════════ */

export interface RunDetailViewProps {
  runId: string;
  frozen?: boolean;
}

export function RunDetailView({ runId, frozen: frozenProp }: RunDetailViewProps) {
  const params = useSearchParams();
  const frozen = frozenProp ?? params.get("frozen") === "1";
  const data = useRunDetailData(runId);

  /* `?demo=` swaps the run for a state, so every state has a real URL rather
     than living only in Storybook.

     It is an OVERRIDE of a real run, never a substitute for one. It used to be
     the other way round — the fixture answered first and the real run was never
     asked for — which is how every real run id ended up rendering the same
     fabricated one. */
  const demo = params.get("demo");
  const run = React.useMemo(
    () => (data.run ? applyDemoState(data.run, demo) : null),
    [data.run, demo],
  );

  /* `?demo=waiting` has to fabricate the wait as well as the status: the real
     waits come from the API and are keyed on the REAL run's status, so a demo
     recast alone would show a parked run with nothing to be parked on — the
     exact confusion the banner exists to remove. */
  const waits = React.useMemo(
    () => (demo === "waiting" ? DEMO_WAITS : demo ? [] : data.waits),
    [demo, data.waits],
  );

  if (data.loading) {
    return <PageContainer><ControlSkeleton /></PageContainer>;
  }

  if (data.notFound || (!run && !data.error)) {
    return (
      <PageContainer>
        <div className="border-subtle mx-auto mt-16 max-w-[32rem] rounded-lg border p-6 text-center">
          <Text variant="heading-sm" tone="max" as="h1" className="block">Run not found</Text>
          <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
            No run with id <span className="font-code">{runId}</span>. It may have been outside the
            retention window, or the link may be truncated.
          </Text>
          <Button asChild variant="secondary" size="sm" className="mt-4">
            <Link href={"/runs" as Route}>Back to runs</Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (!run) {
    /* Reachable only when the API could not be asked. Distinct from "not
       found" on purpose: one means the run is gone, the other means we do not
       know, and telling someone their run does not exist when the API is
       simply down sends them looking for the wrong problem. */
    return (
      <PageContainer>
        <div className="border-subtle mx-auto mt-16 max-w-[32rem] rounded-lg border p-6 text-center">
          <Text variant="heading-sm" tone="max" as="h1" className="block">This run could not be loaded</Text>
          <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
            {data.error?.message ?? "The API did not answer. The run itself is unaffected."}
          </Text>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void data.refetch()}>Try again</Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={"/runs" as Route}>Back to runs</Link>
            </Button>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <ReplayProvider run={run} events={data.events} detail={data.detail}>
      <RunDetailBody
        run={run}
        frozen={frozen}
        incident={data.incident}
        waits={waits}
        deliveries={data.deliveries}
        onRedeliver={data.redeliver}
        onCancel={data.cancel}
        onRetryStep={data.retryStep}
        onRetryRun={data.retryRun}
        stream={data.stream}
      />
    </ReplayProvider>
  );
}

function RunDetailBody({
  run, frozen, incident, waits, deliveries, onRedeliver,
  onCancel, onRetryStep, onRetryRun, stream,
}: {
  run: Run;
  frozen: boolean;
  incident: contracts.FailureIncident | null;
  waits: contracts.RunWait[];
  deliveries: contracts.RunDelivery[];
  onRedeliver: (deliveryId: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRetryStep: (nodeId: string) => Promise<void>;
  onRetryRun: () => Promise<void>;
  stream: RunStreamState | null;
}) {
  const { select, detail } = useReplay();
  const diagnosis = React.useMemo(
    () => diagnoseRun(run, incident, detail),
    [run, incident, detail],
  );

  const [comparing, setComparing] = React.useState(false);
  const [showEvents, setShowEvents] = React.useState(false);
  const [logFullscreen, setLogFullscreen] = React.useState(false);
  const [logHeight, setLogHeight] = React.useState(220);
  const [leftWidth, setLeftWidth] = React.useState(272);
  const [rightWidth, setRightWidth] = React.useState(300);
  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(true);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);
  const [retryError, setRetryError] = React.useState<string | null>(null);

  const cancelRun = React.useCallback(async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await onCancel();
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "The cancellation request failed.");
    } finally {
      setCancelling(false);
    }
  }, [onCancel]);

  /*
   * One runner for both retries.
   *
   * They differ only in which call they make; the pending flag, the failure
   * message and the reset are identical, and two copies of that is how one of
   * them ends up never clearing its spinner.
   *
   * The message says what did NOT happen, per the copy rules — a retry that the
   * API refuses because the run moved on is a legitimate answer, not a fault,
   * and "Something went wrong" would send somebody looking for a bug.
   */
  const runRetry = React.useCallback(async (go: () => Promise<void>) => {
    setRetrying(true);
    setRetryError(null);
    try {
      await go();
    } catch (error) {
      setRetryError(
        error instanceof Error ? error.message : "The run could not be retried.",
      );
    } finally {
      setRetrying(false);
    }
  }, []);

  const drag = (
    axis: "x" | "y",
    apply: (delta: number) => void,
  ) => (e: React.PointerEvent) => {
    e.preventDefault();
    const start = axis === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => apply((axis === "x" ? ev.clientX : ev.clientY) - start);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startLeft = React.useRef(leftWidth);
  const startRight = React.useRef(rightWidth);
  const startLog = React.useRef(logHeight);

  return (
    <PageContainer className="flex min-h-0 flex-col gap-3">
      <RunHeader
        run={run}
        retryCostUsd={diagnosis?.retryCostUsd ?? null}
        onCancel={() => void cancelRun()}
        cancelling={cancelling}
        cancelError={cancelError}
        onCompare={() => setComparing((c) => !c)}
        comparing={comparing}
        onRetryStep={(nodeId) => void runRetry(() => onRetryStep(nodeId))}
        onRetryRun={() => void runRetry(onRetryRun)}
        retrying={retrying}
        retryError={retryError}
      />

      {diagnosis ? (
        <RecoveryCard diagnosis={diagnosis} onRetryStep={() => select(diagnosis.failedNode.index)} />
      ) : null}

      {run.status === "awaiting-approval" ? <GateBanner run={run} /> : null}

      {/* Above the panes for the same reason the recovery card is: on a parked
          run this is the only thing on the page that has changed, and it is the
          answer to the question that brought the operator here. */}
      <WaitBanner waits={waits} />

      {/* Under the header for the same reason the recovery card is: a run that
          produced the right answer and failed to deliver it is not a success,
          and putting that on a tab means the person closes the page first. */}
      <DeliveryPanel deliveries={deliveries} onRedeliver={onRedeliver} />

      {comparing ? <CompareView run={run} onClose={() => setComparing(false)} /> : null}

      {/* ── Panes ──────────────────────────────────────────────────────────── */}
      {logFullscreen ? (
        <div className="border-subtle relative h-[70vh] overflow-hidden rounded-lg border">
          <LogStream fullscreen onToggleFullscreen={() => setLogFullscreen(false)} className="h-full" stream={stream} />
        </div>
      ) : (
        <div className="border-subtle flex h-[62vh] min-h-[26rem] overflow-hidden rounded-lg border">
          {leftOpen ? (
            <>
              <div style={{ width: leftWidth }} className="flex min-w-0 shrink-0 flex-col">
                <StepTimeline className="h-full" />
              </div>
              <Divider
                axis="x"
                label="Resize step timeline"
                onPointerDown={(e) => {
                  startLeft.current = leftWidth;
                  drag("x", (d) => setLeftWidth(Math.min(420, Math.max(180, startLeft.current + d))))(e);
                }}
                onCollapse={() => setLeftOpen(false)}
              />
            </>
          ) : (
            <CollapsedRail label="Steps" onExpand={() => setLeftOpen(true)} />
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <CanvasMirror className="h-full" />
            </div>

            <Divider
              axis="y"
              label="Resize log"
              onPointerDown={(e) => {
                startLog.current = logHeight;
                drag("y", (d) => setLogHeight(Math.min(520, Math.max(96, startLog.current - d))))(e);
              }}
            />

            <div style={{ height: logHeight }} className="relative shrink-0">
              <LogStream
                onToggleFullscreen={() => setLogFullscreen(true)}
                stream={stream}
                padTo={frozen ? 0 : undefined}
                className="h-full"
              />
            </div>
          </div>

          {rightOpen ? (
            <>
              <Divider
                axis="x"
                label="Resize inspector"
                onPointerDown={(e) => {
                  startRight.current = rightWidth;
                  drag("x", (d) => setRightWidth(Math.min(460, Math.max(220, startRight.current - d))))(e);
                }}
                onCollapse={() => setRightOpen(false)}
              />
              <div style={{ width: rightWidth }} className="flex min-w-0 shrink-0 flex-col">
                <Inspector className="h-full" />
              </div>
            </>
          ) : (
            <CollapsedRail label="Inspector" onExpand={() => setRightOpen(true)} />
          )}
        </div>
      )}

      {/* ── Event history ──────────────────────────────────────────────────── */}
      {showEvents ? (
        <EventHistory run={run} />
      ) : (
        <button
          onClick={() => setShowEvents(true)}
          className={cn(
            "border-subtle bg-surface-raised hover:bg-surface-hover w-full rounded-lg border px-3 py-2 text-left",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
          )}
        >
          <Text variant="body-sm" tone="primary" className="font-medium">Event history</Text>
          <Text variant="caption" tone="muted" className="ml-2">
            the raw event-sourced log every view on this page is derived from
          </Text>
        </button>
      )}
    </PageContainer>
  );
}

/* ── States ───────────────────────────────────────────────────────────────── */

function GateBanner({ run }: { run: Run }) {
  const gate = run.nodes.find((n) => n.state === "gated");
  return (
    <section className="border-status-waiting-border bg-status-waiting-subtle flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <ApprovalGateIcon size={18} aria-hidden="true" className="text-status-waiting shrink-0" />
      <div className="min-w-0 flex-1">
        <Text variant="body-sm" tone="primary" className="block font-medium">
          Suspended at {gate?.name ?? "an approval gate"}
        </Text>
        <Text variant="caption" tone="secondary" className="block">
          No compute is consumed while the run waits. Everything before this step stays committed.
        </Text>
      </div>
      <Button asChild size="sm" variant="primary">
        <Link href={"/approvals" as Route}>Review approval</Link>
      </Button>
    </section>
  );
}

/* ── Pane chrome ──────────────────────────────────────────────────────────── */

function Divider({
  axis, label, onPointerDown, onCollapse,
}: {
  axis: "x" | "y";
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onCollapse?: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      onPointerDown={onPointerDown}
      onDoubleClick={onCollapse}
      title={onCollapse ? `${label} · double-click to collapse` : label}
      className={cn(
        "bg-surface-sunken group relative shrink-0",
        "hover:bg-accent-subtle transition-colors duration-fast",
        axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "bg-border-strong absolute opacity-0 transition-opacity duration-fast group-hover:opacity-100",
          axis === "x" ? "left-0 top-1/2 h-6 w-full -translate-y-1/2" : "left-1/2 top-0 h-full w-8 -translate-x-1/2",
        )}
      />
    </div>
  );
}

function CollapsedRail({ label, onExpand }: { label: string; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      aria-label={`Expand ${label}`}
      className={cn(
        "bg-surface-sunken border-subtle hover:bg-surface-hover w-7 shrink-0 border-r",
        "transition-colors duration-fast outline-none focus-visible:focus-ring",
      )}
    >
      <span className="font-ui text-eyebrow text-fg-muted block whitespace-nowrap [writing-mode:vertical-rl]">
        {label}
      </span>
    </button>
  );
}

/* ── Demo states ──────────────────────────────────────────────────────────── */

/** Pinned so the demo URL screenshots identically every time. */
const FROZEN_DEMO_NOW = new Date("2026-08-11T14:20:00Z").getTime();

/**
 * One async-tool wait, for `?demo=waiting`.
 *
 * Deliberately a six-minute render six minutes in with four minutes left: the
 * case the wait primitive was built for, at the moment somebody would open the
 * page to find out whether it is stuck.
 */
const DEMO_WAITS: contracts.RunWait[] = [{
  waitId: "00000000-0000-4000-8000-0000000aa001",
  kind: "async_tool",
  label: "waiting for render_video to finish",
  nodeId: "render_video",
  signalName: null,
  externalRef: "job_9f2c41ab",
  createdAt: new Date(FROZEN_DEMO_NOW - 6 * 60_000).toISOString(),
  timeoutAt: new Date(FROZEN_DEMO_NOW + 4 * 60_000).toISOString(),
  waitingMs: 6 * 60_000,
  expiresInMs: 4 * 60_000,
  pollAttempts: 3,
}];


/**
 * Recast a REAL run into a demo state, for the `?demo=` URLs.
 *
 * Every state is derived from the run in front of you rather than from a
 * fixture, so the demo URLs stay useful and never conjure a run that does not
 * exist. Without `?demo=` this returns the run untouched.
 */
function applyDemoState(base: Run, demo: string | null): Run {
  if (!demo) return base;

  const nodes = base.nodes;
  const mid = Math.floor(nodes.length / 2);

  switch (demo) {
    case "running":
      return {
        ...base, status: "running", finishedAt: null,
        nodes: nodes.map((n, i) => ({
          ...n,
          state: i < mid ? "committed" : i === mid ? "executing" : "pending",
          error: undefined,
        })),
      };
    case "queued":
      return {
        ...base, status: "queued", durationMs: null, finishedAt: null,
        nodes: nodes.map((n) => ({ ...n, state: "pending", durationMs: null, at: null, error: undefined })),
      };
    case "gated":
      return {
        ...base, status: "awaiting-approval", finishedAt: null,
        nodes: nodes.map((n, i) => ({
          ...n,
          state: i < mid ? "committed" : i === mid ? "gated" : "pending",
          error: undefined,
        })),
      };
    case "succeeded":
      return {
        ...base, status: "succeeded",
        nodes: nodes.map((n, i) => ({ ...n, state: i === 4 ? "recovered" : "committed", error: undefined })),
      };
    case "waiting":
      /* Parked on a machine rather than a person: mid-run, one node gated, and
         no worker held. The status is `waiting`, not `awaiting-approval` — the
         whole point is that nobody has been asked to do anything. */
      return {
        ...base, status: "waiting", finishedAt: null, durationMs: null,
        nodes: nodes.map((n, i) => ({
          ...n,
          state: i < mid ? "committed" : i === mid ? "gated" : "pending",
          error: undefined,
        })),
      };
    case "cancelled":
      return {
        ...base, status: "cancelled",
        nodes: nodes.map((n, i) => ({
          ...n,
          state: i < mid ? "committed" : "skipped",
          error: undefined,
        })),
      };
    default:
      return base;
  }
}
