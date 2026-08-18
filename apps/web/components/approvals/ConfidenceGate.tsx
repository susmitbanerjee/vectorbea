"use client";

/**
 * The confidence gate (P13) — the demo surface.
 *
 * §6 calls this "the single most compelling thing in a demo", and the reason is
 * specific: it is the moment the audience sees the system *decline to be confident*
 * and ask for help, with the evidence attached.
 *
 * Four things have to be true for that to land, and they drive the whole layout:
 *
 *   1. **The score is visible and explained in one glance.** A ring plus the weak
 *      signal named in words. Not a number a reviewer has to interpret.
 *   2. **Output sits beside source, with verified spans highlighted.** The reviewer
 *      checks the claim against the evidence without leaving the screen — and the
 *      unverifiable value is visibly the one with no highlight.
 *   3. **The consequence of approving is stated before the button.** "This will send
 *      an email" changes the decision, and finding out afterwards is a support
 *      ticket.
 *   4. **Correcting is as easy as approving.** If fixing the value is harder than
 *      waving it through, reviewers wave it through.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CornerUpLeft, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";

interface Component {
  name: string;
  value: number | null;
  weight: number;
  contribution: number;
  present: boolean;
  description: string;
}

interface GatePayload {
  approvalId: string;
  runId: string;
  nodeId: string;
  title?: string;
  message?: string;
  riskLevel?: string;
  confidence: {
    score: number | null;
    components: Component[];
    weakestSignal: string | null;
    explanation: string | null;
    thresholds?: Record<string, number>;
  };
  output?: unknown;
  source?: unknown;
  evidence?: Record<string, { span?: string; verified?: boolean; level?: string }>;
  history?: {
    typicalScore?: number | null;
    timesGated?: number;
    approvalRate?: number | null;
    note?: string;
  };
  nextAction?: {
    nextNodes?: string[];
    sideEffectNodes?: string[];
    hasSideEffects?: boolean;
    warning?: string | null;
  };
  actions?: Array<{ id: string; label: string; effect: string }>;
}

interface Props {
  approvalId: string;
  onDecided?: (action: string) => void;
}

/** Human labels for the signal names the scorer emits. */
const SIGNAL_LABELS: Record<string, string> = {
  assertions_passed: "Business rules",
  citations_verified: "Citations verified",
  logprob_certainty: "Model certainty",
  self_consistency: "Sample agreement",
  critic_verdict: "Reviewing model",
  distribution_match: "Similar to usual output",
  schema_valid: "Output structure",
};

export function ConfidenceGate({ approvalId, onDecided }: Props) {
  const [gate, setGate] = useState<GatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch<GatePayload>(`/api/approvals/${approvalId}/gate`);
        if (!cancelled) {
          setGate(r);
          setCorrectionText(JSON.stringify(r.output ?? {}, null, 2));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [approvalId]);

  const decide = useCallback(async (action: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/approvals/${approvalId}/decide`, {
        method: "POST",
        json: {
          action,
          reason: reason || undefined,
          correctedOutput: action === "approve_with_correction"
            ? JSON.parse(correctionText) : undefined,
        },
      });
      onDecided?.(action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [approvalId, reason, correctionText, onDecided]);

  const correctionValid = useMemo(() => {
    if (!correcting) return true;
    try { JSON.parse(correctionText); return true; } catch { return false; }
  }, [correcting, correctionText]);

  if (error && !gate) return <div className="p-4 text-[12px] text-[#B91C1C]">{error}</div>;
  if (!gate) return <div className="p-4 text-[12px] text-[#6B7280]">Loading…</div>;

  const score = gate.confidence.score ?? 0;
  const pct = Math.round(score * 100);
  const sourceText = typeof gate.source === "string"
    ? gate.source : JSON.stringify(gate.source ?? {}, null, 2);

  return (
    <div className="space-y-4 p-4">
      {/* ── Score and the reason for it ──────────────────────────────── */}
      <section className="flex items-start gap-4">
        <ConfidenceRing value={score} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-[#111827]">
            {gate.title ?? `Low confidence on '${gate.nodeId}'`}
          </h2>
          {/* The explanation, not the number, is what a reviewer acts on. */}
          <p className="mt-0.5 text-[12.5px] leading-[1.55] text-[#4B5563]">
            {gate.confidence.explanation ?? gate.message}
          </p>
          {gate.history?.note && (
            <p className="mt-1.5 text-[11.5px] text-[#6B7280]">
              {gate.history.typicalScore != null && (
                <>This agent normally scores{" "}
                  <span className="font-semibold tabular-nums">
                    {Math.round(gate.history.typicalScore * 100)}%
                  </span>. </>
              )}
              {gate.history.note}
            </p>
          )}
        </div>
      </section>

      {/* ── Why this score — the breakdown ───────────────────────────── */}
      <section>
        <h3 className="mb-1.5 text-[12px] font-semibold text-[#111827]">Why {pct}%</h3>
        <ul className="space-y-1">
          {gate.confidence.components.map((c) => (
            <li key={c.name} className="flex items-center gap-2 text-[11.5px]">
              <span className={cn("w-40 shrink-0",
                c.name === gate.confidence.weakestSignal
                  ? "font-semibold text-[#B45309]" : "text-[#4B5563]")}>
                {SIGNAL_LABELS[c.name] ?? c.name}
              </span>
              {c.present ? (
                <>
                  <span className="h-1.5 w-28 overflow-hidden rounded-full bg-[#E5E7EB]">
                    <span
                      className={cn("block h-full rounded-full",
                        (c.value ?? 0) >= 0.9 ? "bg-[#047857]"
                          : (c.value ?? 0) >= 0.6 ? "bg-[#B45309]" : "bg-[#B91C1C]")}
                      style={{ width: `${Math.round((c.value ?? 0) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular-nums text-[#6B7280]">
                    {Math.round((c.value ?? 0) * 100)}%
                  </span>
                </>
              ) : (
                // Absent signals are shown, not hidden — "why wasn't this used?" is a
                // question the breakdown must be able to answer.
                <span className="text-[#9CA3AF]">not measured</span>
              )}
              <span className="truncate text-[#9CA3AF]">{c.description}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Output beside source, spans highlighted ──────────────────── */}
      <section className="grid grid-cols-2 gap-3">
        <div>
          <h3 className="mb-1 text-[12px] font-semibold text-[#111827]">
            {correcting ? "Your correction" : "What the agent produced"}
          </h3>
          {correcting ? (
            <textarea
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              rows={12}
              spellCheck={false}
              className={cn(
                "w-full rounded-[8px] border p-2 font-mono text-[11.5px] outline-none",
                correctionValid ? "border-[#047857]" : "border-[#FCA5A5] bg-[#FEF2F2]",
              )}
            />
          ) : (
            <pre className="max-h-72 overflow-auto rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-2 font-mono text-[11.5px] leading-[1.5]">
              {JSON.stringify(gate.output ?? {}, null, 2)}
            </pre>
          )}
          {correcting && !correctionValid && (
            <p className="mt-1 text-[11.5px] text-[#B91C1C]">That is not valid JSON.</p>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-[12px] font-semibold text-[#111827]">
            The source, with verified quotes highlighted
          </h3>
          <div className="max-h-72 overflow-auto rounded-[8px] border border-[#E5E7EB] bg-white p-2 font-mono text-[11.5px] leading-[1.6]">
            <HighlightedSource text={sourceText} evidence={gate.evidence} />
          </div>
          {/* The absence of a highlight IS the finding. Said explicitly, because a
              reviewer scanning for green will not notice what is missing. */}
          {gate.confidence.weakestSignal === "citations_verified" && (
            <p className="mt-1 text-[11.5px] text-[#B45309]">
              A value in the output has no highlighted source — the agent could not
              point at where it came from.
            </p>
          )}
        </div>
      </section>

      {/* ── Consequence, before the buttons ──────────────────────────── */}
      {gate.nextAction?.hasSideEffects && (
        <div className="flex items-start gap-2 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] p-2.5">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[#B45309]" />
          <p className="text-[11.5px] leading-[1.5] text-[#92400E]">{gate.nextAction.warning}</p>
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <section className="space-y-2 border-t border-[#E5E7EB] pt-3">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required when rejecting or sending back)"
          className="w-full rounded-[7px] border border-[#E5E7EB] px-2 py-1.5 text-[12px] outline-none focus:border-[#047857]"
        />
        <div className="flex flex-wrap gap-2">
          {!correcting ? (
            <>
              <button type="button" disabled={busy} onClick={() => decide("approve")}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#047857] px-3 text-[12px] font-semibold text-white disabled:opacity-40">
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
              <button type="button" disabled={busy} onClick={() => setCorrecting(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#047857] px-3 text-[12px] font-semibold text-[#047857] disabled:opacity-40">
                <Pencil className="h-3.5 w-3.5" /> Approve with correction
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || !correctionValid}
                onClick={() => decide("approve_with_correction")}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#047857] px-3 text-[12px] font-semibold text-white disabled:opacity-40">
                <Check className="h-3.5 w-3.5" /> Save correction and continue
              </button>
              <button type="button" disabled={busy} onClick={() => setCorrecting(false)}
                className="inline-flex h-8 items-center rounded-[8px] border border-[#E5E7EB] px-3 text-[12px] font-medium text-[#4B5563]">
                Cancel
              </button>
            </>
          )}
          <button type="button" disabled={busy || !reason} onClick={() => decide("send_back")}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E5E7EB] px-3 text-[12px] font-medium text-[#4B5563] disabled:opacity-40">
            <CornerUpLeft className="h-3.5 w-3.5" /> Send back for retry
          </button>
          <button type="button" disabled={busy || !reason} onClick={() => decide("reject")}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#FCA5A5] px-3 text-[12px] font-medium text-[#B91C1C] disabled:opacity-40">
            <X className="h-3.5 w-3.5" /> Reject
          </button>
        </div>
        {/* What each button does, in the same words the API returns. */}
        {gate.actions && (
          <p className="text-[11px] leading-[1.5] text-[#9CA3AF]">
            {gate.actions.find((a) => a.id === (correcting ? "approve_with_correction" : "approve"))?.effect}
          </p>
        )}
        {error && <p className="text-[11.5px] text-[#B91C1C]">{error}</p>}
      </section>
    </div>
  );
}

/**
 * The ring.
 *
 * Colour maps to the routing band, not to a gradient: the reviewer should see the
 * same three categories the system used to decide, so the visual and the policy
 * agree.
 */
function ConfidenceRing({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const colour = value >= 0.9 ? "#047857" : value >= 0.7 ? "#B45309" : "#B91C1C";

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#E5E7EB" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={colour} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[14px] font-semibold tabular-nums"
        style={{ color: colour }}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * Highlight the verified spans inside the source.
 *
 * Offsets are not recomputed here. The spans come from `evidence`, which the worker
 * produced from the same verification that decided the score — re-deriving them in
 * the browser would risk the highlight disagreeing with the decision, which is
 * exactly the kind of subtle inconsistency that destroys trust in a demo.
 */
function HighlightedSource({
  text, evidence,
}: { text: string; evidence?: Record<string, { span?: string; verified?: boolean; level?: string }> }) {
  const spans = useMemo(() => {
    const found: Array<{ start: number; end: number; field: string; level?: string }> = [];
    for (const [field, e] of Object.entries(evidence ?? {})) {
      if (!e?.span || e.verified === false) continue;
      const at = text.indexOf(e.span);
      if (at >= 0) found.push({ start: at, end: at + e.span.length, field, level: e.level });
    }
    // Sorted and de-overlapped so two citations quoting adjacent text do not
    // produce nested marks the browser renders unpredictably.
    return found.sort((a, b) => a.start - b.start)
      .filter((s, i, arr) => i === 0 || s.start >= arr[i - 1].end);
  }, [text, evidence]);

  if (spans.length === 0) return <span className="whitespace-pre-wrap">{text}</span>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, s.start)}</span>);
    parts.push(
      <mark key={`m${i}`} title={`Cited for '${s.field}'${s.level === "FUZZY" ? " (approximate match)" : ""}`}
        className={cn("rounded px-0.5",
          s.level === "FUZZY" ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#D1FAE5] text-[#065F46]")}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    cursor = s.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);

  return <span className="whitespace-pre-wrap">{parts}</span>;
}
