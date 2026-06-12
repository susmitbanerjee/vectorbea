"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LifeBuoy, Loader2, Send, X } from "lucide-react";
import { usePathname } from "next/navigation";

/**
 * Floating support widget — structured incident reporting, not free-form chat.
 * Users pick a category + severity, describe the issue, and can track the
 * status of their own reports. Reports notify the support admin by email.
 */

const CATEGORIES = [
  { value: "bug",              label: "Something is broken" },
  { value: "workflow_failure", label: "A workflow run failed" },
  { value: "connection_issue", label: "Connection problem" },
  { value: "access_problem",   label: "Access / sign-in issue" },
  { value: "billing",          label: "Billing / limits" },
  { value: "other",            label: "Something else" },
];
const SEVERITIES = [
  { value: "low",      label: "Low",      hint: "annoying" },
  { value: "medium",   label: "Medium",   hint: "blocks a task" },
  { value: "high",     label: "High",     hint: "blocks my work" },
  { value: "critical", label: "Critical", hint: "production down" },
];

const STATUS_CHIP: Record<string, { bg: string; fg: string; bd: string; label: string }> = {
  open:        { bg: "#FFFBEB", fg: "#92400E", bd: "#FDE68A", label: "Open" },
  in_progress: { bg: "#F0FDFA", fg: "#0F766E", bd: "#99F6E4", label: "In progress" },
  resolved:    { bg: "#E6F4EF", fg: "#006B45", bd: "#9CCFBB", label: "Resolved" },
  closed:      { bg: "#F3F4F5", fg: "#6B7280", bd: "#E0E3E6", label: "Closed" },
};

interface IncidentView {
  id: string; subject: string; status: string; severity: string;
  admin_note: string | null; created_at: string;
}

export function SupportWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"form" | "mine" | "done">("form");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mine, setMine] = useState<IncidentView[] | null>(null);

  useEffect(() => {
    if (open && view === "mine" && mine === null) {
      void fetch("/api/support/incidents")
        .then((r) => r.json())
        .then((d: { incidents?: IncidentView[] }) => setMine(d.incidents ?? []))
        .catch(() => setMine([]));
    }
  }, [open, view, mine]);

  // The builder canvas has its own floating chrome — keep the widget out of it
  if (/\/workflows\/[^/]+\/builder/.test(pathname ?? "")) return null;

  async function submit() {
    setError(null);
    if (!category) { setError("Pick what kind of issue this is."); return; }
    if (!severity) { setError("Pick how badly it affects you."); return; }
    if (subject.trim().length < 4) { setError("Add a short subject (at least 4 characters)."); return; }
    if (description.trim().length < 10) { setError("Describe the issue in a bit more detail."); return; }
    setSending(true);
    try {
      const res = await fetch("/api/support/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, severity, subject: subject.trim(), description: description.trim(), pagePath: pathname }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(data.error ?? "Could not file the report. Try again."); return; }
      setView("done");
      setMine(null); // refresh on next "mine" view
      setCategory(""); setSeverity(""); setSubject(""); setDescription("");
    } catch {
      setError("Network error — try again.");
    } finally {
      setSending(false);
    }
  }

  const selectCls = "h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white px-2.5 text-[12.5px] text-[#0B0D0F] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15";

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setView("form"); setError(null); }}
        title="Report an issue"
        className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#0B0D0F] text-white shadow-[0_8px_28px_rgba(11,13,15,0.3)] transition-transform hover:scale-105"
      >
        {open ? <X className="h-5 w-5" /> : <LifeBuoy className="h-5 w-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-[360px] max-w-[calc(100vw-40px)] overflow-hidden rounded-[14px] border border-[#E0E3E6] bg-white shadow-[0_24px_60px_rgba(11,13,15,0.18)]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#ECEEEF] px-4 py-3">
            <div>
              <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Support</p>
              <p className="text-[13.5px] font-bold text-[#0B0D0F]">Report an issue</p>
            </div>
            <div className="flex rounded-[7px] border border-[#E0E3E6] p-0.5">
              {(["form", "mine"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setView(v); setError(null); }}
                  className={`rounded-[5px] px-2 py-1 text-[11px] font-semibold transition-colors ${
                    (view === v || (view === "done" && v === "form"))
                      ? "bg-[#0B0D0F] text-white"
                      : "text-[#6B7280] hover:text-[#0B0D0F]"
                  }`}
                >
                  {v === "form" ? "New report" : "My reports"}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {view === "done" && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-[#007F4E]" />
                <p className="text-[14px] font-semibold text-[#0B0D0F]">Report filed</p>
                <p className="max-w-[260px] text-[12.5px] leading-[1.6] text-[#6B7280]">
                  Our team has been notified by email. Track the status under <b>My reports</b>.
                </p>
                <button type="button" onClick={() => setView("mine")} className="mt-2 text-[12.5px] font-semibold text-[#007F4E] hover:underline">
                  View my reports →
                </button>
              </div>
            )}

            {view === "form" && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">What happened?</label>
                  <select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Select a category…</option>
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">Impact</label>
                  <div className="grid grid-cols-4 gap-1">
                    {SEVERITIES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setSeverity(s.value)}
                        title={s.hint}
                        className={`rounded-[7px] border px-1 py-1.5 text-[11px] font-semibold transition-colors ${
                          severity === s.value
                            ? "border-[#007F4E] bg-[#E6F4EF] text-[#006B45]"
                            : "border-[#E0E3E6] bg-white text-[#6B7280] hover:border-[#C9CED4]"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">Subject</label>
                  <input
                    className={selectCls}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={160}
                    placeholder="Run stuck at approval gate"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">Details</label>
                  <textarea
                    className="w-full resize-none rounded-[8px] border border-[#E0E3E6] bg-white px-2.5 py-2 text-[12.5px] leading-[1.55] text-[#0B0D0F] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
                    rows={4}
                    maxLength={5000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What did you do, what did you expect, what happened instead? Run/workflow IDs help a lot."
                  />
                  <p className="mt-1 text-[10.5px] text-[#9CA3AF]">Current page is attached automatically. Never include API keys or secrets.</p>
                </div>
                {error && (
                  <p className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] font-medium text-[#B91C1C]">{error}</p>
                )}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={sending}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-[8px] bg-[#0B0D0F] text-[13px] font-semibold text-white transition-colors hover:bg-[#23272B] disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  File report
                </button>
              </div>
            )}

            {view === "mine" && (
              mine === null ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[#C9CED4]" /></div>
              ) : mine.length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-[#9CA3AF]">No reports yet.</p>
              ) : (
                <div className="space-y-2">
                  {mine.map((i) => {
                    const chip = STATUS_CHIP[i.status] ?? STATUS_CHIP.open!;
                    return (
                      <div key={i.id} className="rounded-[10px] border border-[#ECEEEF] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[12.5px] font-semibold text-[#0B0D0F]">{i.subject}</p>
                          <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ background: chip.bg, color: chip.fg, borderColor: chip.bd }}>
                            {chip.label}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-[#9CA3AF]">
                          {i.severity} · {new Date(i.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                        {i.admin_note && (
                          <p className="mt-1.5 rounded-[7px] bg-[#FAFBFB] px-2 py-1.5 text-[11.5px] leading-[1.5] text-[#4B5563]">
                            <span className="font-semibold text-[#0B0D0F]">Team:</span> {i.admin_note}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
