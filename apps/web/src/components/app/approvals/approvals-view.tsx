"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/input";
import { Radio, RadioGroup } from "~/components/ui/choice";
import { GateCard } from "./gate-card";
import { GATES, REJECT_REASONS, bulkApprovable, type GateView } from "~/mocks/governance";
import { GateApprovedIcon } from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   APPROVALS

   A gate is a human taking responsibility for an automated decision. Every
   choice on this screen follows from that: resolved values not placeholders,
   evidence one click away, a mandatory reason on reject, and a bulk control that
   refuses more often than it agrees.
══════════════════════════════════════════════════════════════════════════════ */

type TabId = "pending" | "approved" | "rejected" | "all";

const TABS: { id: TabId; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

export function ApprovalsView({ frozen: frozenProp }: { frozen?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const frozen = frozenProp ?? params.get("frozen") === "1";

  const tab = (params.get("tab") ?? "pending") as TabId;
  const setTab = (next: TabId) => {
    const p = new URLSearchParams(params.toString());
    p.set("tab", next);
    router.replace(`${pathname}?${p.toString()}` as never, { scroll: false });
  };

  const [gates, setGates] = React.useState<GateView[]>(GATES);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = React.useState(0);
  const [rejecting, setRejecting] = React.useState<GateView | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const counts = React.useMemo(() => ({
    pending: gates.filter((g) => g.status === "pending").length,
    approved: gates.filter((g) => g.status === "approved").length,
    rejected: gates.filter((g) => g.status === "rejected").length,
    all: gates.length,
  }), [gates]);

  const visible = React.useMemo(
    () => (tab === "all" ? gates : gates.filter((g) => g.status === tab)),
    [gates, tab],
  );

  React.useEffect(() => { setCursor(0); }, [tab]);

  const selectedGates = React.useMemo(
    () => gates.filter((g) => selected.has(g.id) && g.status === "pending"),
    [gates, selected],
  );
  const guard = bulkApprovable(selectedGates);

  const decide = React.useCallback(
    (id: string, status: GateView["status"], reason?: string) => {
      setGates((current) =>
        current.map((g) =>
          g.id === id
            ? {
                ...g,
                status,
                decidedBy: "you",
                decidedAt: Date.now(),
                decisionReason: reason,
                audit: [
                  ...g.audit,
                  {
                    at: Date.now(),
                    actor: "you",
                    action: status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Changes requested",
                    reason,
                    // The context is snapshotted at decision time, so the audit
                    // records what was actually on screen rather than what the
                    // values happen to be when someone reads it later.
                    contextSnapshot: g.context,
                  },
                ],
              }
            : g,
        ),
      );
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    },
    [],
  );

  /* ── Keyboard: j/k move, a approve, r reject, Enter expand ──────────────── */
  React.useEffect(() => {
    if (frozen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const gate = visible[cursor];

      if (e.key === "j") { e.preventDefault(); setCursor((c) => Math.min(visible.length - 1, c + 1)); }
      else if (e.key === "k") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === "a" && gate?.status === "pending") { e.preventDefault(); decide(gate.id, "approved"); }
      else if (e.key === "r" && gate?.status === "pending") { e.preventDefault(); setRejecting(gate); }
      else if (e.key === "Enter" && gate) {
        e.preventDefault();
        setExpanded((s) => { const n = new Set(s); if (n.has(gate.id)) n.delete(gate.id); else n.add(gate.id); return n; });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, cursor, decide, frozen]);

  React.useEffect(() => {
    const gate = visible[cursor];
    if (!gate) return;
    document.querySelector(`[data-gate="${gate.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cursor, visible]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Observe"
        title="Approvals"
        description="Gates waiting on a person, with the values the decision rests on and the evidence behind them."
        actions={
          selectedGates.length > 0 ? (
            <Button size="sm" variant="primary" onClick={() => setBulkOpen(true)}>
              Approve {selectedGates.length} selected
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label="Approval status" className="border-subtle mb-3 flex gap-0.5 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "font-ui text-body-sm -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
              tab === t.id
                ? "border-accent text-fg-max"
                : "border-transparent text-fg-muted hover:text-fg-primary",
            )}
          >
            {t.label}
            <span className={cn("font-code tabular text-[11px]", tab === t.id ? "text-accent" : "text-fg-disabled")}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {selectedGates.length > 1 && !guard.ok ? (
        <div className="border-status-waiting-border bg-status-waiting-subtle mb-3 rounded-md border px-3 py-2">
          <Text variant="caption" tone="inherit" className="text-status-waiting">
            Bulk approve blocked: {guard.reason}
          </Text>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="grid gap-3">
          {visible.map((gate, i) => (
            <GateCard
              key={gate.id}
              gate={gate}
              selected={selected.has(gate.id)}
              cursored={i === cursor}
              expanded={expanded.has(gate.id)}
              onToggleSelect={() =>
                setSelected((s) => { const n = new Set(s); if (n.has(gate.id)) n.delete(gate.id); else n.add(gate.id); return n; })
              }
              onToggleExpand={() =>
                setExpanded((s) => { const n = new Set(s); if (n.has(gate.id)) n.delete(gate.id); else n.add(gate.id); return n; })
              }
              onApprove={() => decide(gate.id, "approved")}
              onReject={() => setRejecting(gate)}
              onRequestChanges={() => decide(gate.id, "changes-requested", "Returned to the workflow for more context.")}
              onReassign={() => undefined}
              onExtendSla={() => undefined}
            />
          ))}
        </div>
      )}

      <RejectDialog
        gate={rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => {
          if (rejecting) decide(rejecting.id, "rejected", reason);
          setRejecting(null);
        }}
      />

      <BulkDialog
        open={bulkOpen}
        gates={selectedGates}
        guard={guard}
        onClose={() => setBulkOpen(false)}
        onConfirm={() => {
          for (const g of selectedGates) decide(g.id, "approved", "Bulk approved — identical criteria.");
          setBulkOpen(false);
        }}
      />
    </PageContainer>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

/**
 * Pending-empty is an achievement, not an absence. Everyone who was waiting on a
 * person got one.
 */
function EmptyState({ tab }: { tab: TabId }) {
  if (tab !== "pending") {
    return (
      <div className="border-subtle rounded-lg border border-dashed p-8 text-center">
        <Text variant="body-sm" tone="secondary">
          No {tab === "all" ? "" : tab} gates to show.
        </Text>
      </div>
    );
  }

  return (
    <div className="border-status-success-border bg-status-success-subtle rounded-lg border p-8 text-center">
      <GateApprovedIcon size={26} aria-hidden="true" className="text-status-success mx-auto" />
      <Text variant="heading-sm" tone="max" as="p" className="mt-2 block">Nobody is waiting on you</Text>
      <Text variant="body-sm" tone="secondary" className="mx-auto mt-1.5 block max-w-[46ch]">
        Every gate has a decision. Runs that reach an approval will appear here and hold — they
        consume no compute while they wait, so nothing is burning while the queue is empty.
      </Text>
    </div>
  );
}

/* ── Reject ───────────────────────────────────────────────────────────────── */

/**
 * A reason is REQUIRED. A rejection with no reason strands the run and tells the
 * next person nothing — and on a gate that exists for accountability, an
 * unexplained no is the one outcome that defeats the purpose.
 */
function RejectDialog({
  gate, onClose, onConfirm,
}: {
  gate: GateView | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [preset, setPreset] = React.useState(REJECT_REASONS[0]);
  const [detail, setDetail] = React.useState("");

  React.useEffect(() => {
    if (gate) { setPreset(REJECT_REASONS[0]); setDetail(""); }
  }, [gate]);

  const reason = detail.trim() ? `${preset} — ${detail.trim()}` : preset;

  return (
    <Dialog.Root open={gate !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-lg p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">Reject this decision</Text>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              {gate?.workflowName} · {gate?.nodeName}. The run stops here and the reason goes back to
              whoever requested it.
            </Text>
          </Dialog.Description>

          <div className="mt-4">
            <Text variant="label" tone="primary" className="mb-2 block">Reason (required)</Text>
            <RadioGroup value={preset} onValueChange={setPreset} aria-label="Rejection reason">
              {REJECT_REASONS.map((r) => <Radio key={r} value={r}>{r}</Radio>)}
            </RadioGroup>
          </div>

          <div className="mt-3">
            <Textarea
              minRows={2}
              maxRows={5}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Anything the requester needs to know to fix it (optional)"
              aria-label="Additional detail"
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild><Button size="sm" variant="secondary">Cancel</Button></Dialog.Close>
            <Button size="sm" variant="danger" onClick={() => onConfirm(reason)}>Reject gate</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Bulk ─────────────────────────────────────────────────────────────────── */

/**
 * Lists every gate included. Not a count — the actual list, because the whole
 * risk of bulk approve is approving something you did not know was in the set.
 */
function BulkDialog({
  open, gates, guard, onClose, onConfirm,
}: {
  open: boolean;
  gates: GateView[];
  guard: { ok: boolean; reason: string };
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-[min(34rem,calc(100vw-2rem))] sm:rounded-lg p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">
              Approve {gates.length} {gates.length === 1 ? "gate" : "gates"}
            </Text>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              {guard.ok
                ? "These gates share a workflow, a gate node and a risk tier. Approving them here records the same decision against each, with your name on all of them."
                : guard.reason}
            </Text>
          </Dialog.Description>

          <ul className="border-subtle mt-3 max-h-56 overflow-y-auto rounded-md border">
            {gates.map((g) => (
              <li key={g.id} className="border-subtle flex flex-wrap items-baseline gap-2 border-b px-2.5 py-2 last:border-b-0">
                <Text variant="caption" tone="primary" className="font-code shrink-0">{g.id}</Text>
                <Text variant="caption" tone="secondary" className="min-w-0 flex-1 truncate">
                  {g.workflowName} · {g.nodeName}
                </Text>
                <Text variant="caption" tone="muted" className="shrink-0">{g.risk}</Text>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild><Button size="sm" variant="secondary">Cancel</Button></Dialog.Close>
            <Button size="sm" variant="primary" disabled={!guard.ok} onClick={onConfirm}>
              Approve {gates.length} {gates.length === 1 ? "gate" : "gates"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
