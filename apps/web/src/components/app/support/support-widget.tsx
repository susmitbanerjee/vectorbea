"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, CheckCircle, Lifebuoy, PaperPlaneTilt, X } from "@phosphor-icons/react/dist/ssr";
import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Icon } from "~/components/ui/icon";
import { Input, Textarea } from "~/components/ui/input";
import { Segmented } from "~/components/ui/option-card";
import { Select } from "~/components/ui/select";
import { Text } from "~/components/ui/text";
import { LocalTime } from "~/components/ui/local-time";
import { ReplyBox, SupportThread, type ThreadMessage } from "./support-thread";

/* ══════════════════════════════════════════════════════════════════════════════
   SUPPORT WIDGET — report an issue, and see what happened to earlier reports.

   Rebuilt on the token layer: it was the last surface in the app shell drawn
   with hard-coded hex, so in the dark theme it was a white card on a dark app.
   Same endpoints and the same fields as before; impact now starts at Medium so
   the form needs one less decision.
══════════════════════════════════════════════════════════════════════════════ */

const CATEGORIES = [
  { value: "bug", label: "Something is broken" },
  { value: "workflow_failure", label: "A workflow run failed" },
  { value: "connection_issue", label: "Connection problem" },
  { value: "access_problem", label: "Access or sign-in" },
  { value: "billing", label: "Billing or limits" },
  { value: "other", label: "Something else" },
];

type Impact = "low" | "medium" | "high" | "critical";
const IMPACTS: { value: Impact; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

interface MyTicket {
  ticket_number: string;
  subject: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

interface TicketDetail {
  ticket: MyTicket & { message: string; resolved_at: string | null };
  messages: ThreadMessage[];
}

type View = "form" | "mine" | "done" | "ticket";

const TICKET_PARAM = "support";

export function SupportWidget() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<View>("form");
  const [category, setCategory] = React.useState("");
  const [impact, setImpact] = React.useState<Impact>("medium");
  const [subject, setSubject] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [filed, setFiled] = React.useState<string | null>(null);
  const [mine, setMine] = React.useState<MyTicket[] | null>(null);
  const [mineError, setMineError] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);

  // A link from a support email: /control?support=VB-XXXXXX opens that report.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const number = url.searchParams.get(TICKET_PARAM);
    if (!number || !/^VB-[A-Z0-9]{4,12}$/i.test(number)) return;
    setSelected(number.toUpperCase());
    setView("ticket");
    setOpen(true);
    url.searchParams.delete(TICKET_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [pathname]);

  React.useEffect(() => {
    if (!open || view !== "mine" || mine !== null) return;
    let cancelled = false;
    fetch("/api/support", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { tickets?: MyTicket[] }) => { if (!cancelled) setMine(d.tickets ?? []); })
      .catch(() => { if (!cancelled) { setMine([]); setMineError(true); } });
    return () => { cancelled = true; };
  }, [open, view, mine]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The builder canvas has its own floating chrome.
  if (/\/workflows\/[^/]+\/builder/.test(pathname ?? "")) return null;

  async function submit() {
    setError(null);
    if (!category) return setError("Choose what happened.");
    if (subject.trim().length < 4) return setError("Add a subject of at least 4 characters.");
    if (details.trim().length < 10) return setError("Add a few more details.");
    setSending(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category, severity: impact, subject: subject.trim(), message: details.trim(), pagePath: pathname,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ticket?: { ticketNumber?: string } };
      if (!res.ok) return setError(data.error ?? "Your report could not be sent. Try again.");
      setFiled(data.ticket?.ticketNumber ?? null);
      setView("done");
      setMine(null);
      setMineError(false);
      setCategory(""); setImpact("medium"); setSubject(""); setDetails("");
    } catch {
      setError("You appear to be offline. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setView("form"); setError(null); }}
        aria-label={open ? "Close support" : "Report an issue"}
        aria-expanded={open}
        title={open ? "Close" : "Report an issue"}
        className={cn(
          "z-modal fixed bottom-5 right-5 grid size-11 place-items-center rounded-full",
          "bg-accent text-fg-on-accent shadow-3",
          "transition-transform duration-fast hover:scale-105 active:scale-95 motion-reduce:transition-none",
          "outline-none focus-visible:focus-ring",
        )}
      >
        <Icon icon={open ? X : Lifebuoy} size="md" decorative />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Support"
          className={cn(
            "z-modal fixed bottom-20 right-5 flex w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden",
            "bg-surface-overlay border-subtle shadow-3 rounded-lg border",
            "motion-overlay",
          )}
        >
          <header className="border-subtle flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <Text variant="eyebrow" tone="muted" className="block">Support</Text>
              <Text variant="heading-sm" tone="max" className="block">
                {view === "mine" || view === "ticket" ? "My reports" : "Report an issue"}
              </Text>
            </div>
            <Segmented
              label="Support view"
              value={view === "done" ? "form" : view === "ticket" ? "mine" : view}
              onValueChange={(v) => { setView(v as View); setError(null); }}
              options={[{ value: "form", label: "New" }, { value: "mine", label: "My reports" }]}
              className="w-auto"
            />
          </header>

          <div className="max-h-[62vh] overflow-y-auto p-4">
            {view === "done" ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Icon icon={CheckCircle} size="xl" weight="bold" className="text-status-success" decorative />
                <Text variant="body" tone="max" className="font-medium">Report sent</Text>
                <Text variant="body-sm" tone="secondary" className="max-w-[260px]">
                  {filed ? <>Your reference is <span className="font-code">{filed}</span>. </> : null}
                  We&apos;ll reply by email.
                </Text>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => setView("mine")}>
                  View my reports
                </Button>
              </div>
            ) : null}

            {view === "form" ? (
              <form
                className="grid gap-3"
                onSubmit={(e) => { e.preventDefault(); void submit(); }}
              >
                <Field label="What happened?" required>
                  <Select
                    value={category}
                    onValueChange={setCategory}
                    placeholder="Choose a category"
                    options={CATEGORIES}
                  />
                </Field>
                <Field label="Impact">
                  <Segmented label="Impact" value={impact} onValueChange={setImpact} options={IMPACTS} />
                </Field>
                <Field label="Subject" required>
                  <Input
                    value={subject}
                    maxLength={200}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Run stuck at approval step"
                  />
                </Field>
                <Field label="Details" required description="The page you are on is included. Never paste keys or passwords.">
                  <Textarea
                    value={details}
                    maxLength={10000}
                    minRows={4}
                    maxRows={10}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="What you did, what you expected, and what happened. A run link helps."
                  />
                </Field>
                {error ? (
                  <Text variant="body-sm" tone="inherit" role="alert" className="border-status-failed-border bg-status-failed-subtle text-status-failed block rounded-sm border px-3 py-2">
                    {error}
                  </Text>
                ) : null}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={sending}
                  loadingLabel="Sending"
                  iconLeft={<Icon icon={PaperPlaneTilt} size="sm" decorative />}
                >
                  Send report
                </Button>
              </form>
            ) : null}

            {view === "mine" ? (
              mine === null ? (
                <div className="grid gap-2" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="bg-surface-sunken h-16 animate-pulse rounded-md motion-reduce:animate-none" />
                  ))}
                </div>
              ) : mineError ? (
                <Text variant="body-sm" tone="secondary" className="block py-8 text-center">
                  Your reports could not be loaded. Try again shortly.
                </Text>
              ) : mine.length === 0 ? (
                <Text variant="body-sm" tone="muted" className="block py-8 text-center">No reports yet.</Text>
              ) : (
                <ul className="grid gap-2">
                  {mine.map((t) => (
                    <li key={t.ticket_number}>
                      <button
                        type="button"
                        onClick={() => { setSelected(t.ticket_number); setView("ticket"); }}
                        className={cn(
                          "border-subtle bg-surface-raised w-full cursor-pointer rounded-md border p-3 text-left",
                          "hover:bg-surface-hover active:bg-surface-active transition-colors duration-fast",
                          "outline-none focus-visible:focus-ring",
                        )}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <Text variant="body-sm" tone="max" className="min-w-0 font-medium">{t.subject}</Text>
                          <StatusChip status={t.status} />
                        </span>
                        <Text variant="caption" tone="muted" className="mt-0.5 block">
                          <span className="font-code">{t.ticket_number}</span> · <LocalTime at={t.created_at} format="short" />
                        </Text>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}

            {view === "ticket" && selected ? (
              <TicketView
                key={selected}
                ticketNumber={selected}
                onBack={() => { setView("mine"); setSelected(null); }}
                onStatus={() => setMine(null)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function TicketView({
  ticketNumber,
  onBack,
  onStatus,
}: {
  ticketNumber: string;
  onBack: () => void;
  onStatus: () => void;
}) {
  const [detail, setDetail] = React.useState<TicketDetail | null>(null);
  const [failed, setFailed] = React.useState<"missing" | "error" | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/support/tickets/${encodeURIComponent(ticketNumber)}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) throw new Error("missing");
        if (!r.ok) throw new Error("error");
        return (await r.json()) as TicketDetail;
      })
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e: Error) => { if (!cancelled) setFailed(e.message === "missing" ? "missing" : "error"); });
    return () => { cancelled = true; };
  }, [ticketNumber]);

  async function comment(body: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/support/tickets/${encodeURIComponent(ticketNumber)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string; message?: ThreadMessage };
      if (!res.ok || !data.message) return data.error ?? "Your comment could not be sent. Try again.";
      const message = data.message;
      setDetail((d) => d && {
        ticket: { ...d.ticket, status: data.status ?? d.ticket.status },
        messages: [...d.messages, message],
      });
      if (data.status && data.status !== detail?.ticket.status) onStatus();
      return null;
    } catch {
      return "You appear to be offline. Try again.";
    }
  }

  const back = (
    <Button size="xs" variant="ghost" onClick={onBack} iconLeft={<Icon icon={ArrowLeft} size="sm" decorative />}>
      All reports
    </Button>
  );

  if (failed) {
    return (
      <div className="grid gap-3">
        <div>{back}</div>
        <Text variant="body-sm" tone="secondary" className="block py-6 text-center">
          {failed === "missing" ? "This report was not found on your account." : "This report could not be loaded. Try again shortly."}
        </Text>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <div>{back}</div>
        <div className="bg-surface-sunken h-6 w-2/3 animate-pulse rounded-sm motion-reduce:animate-none" />
        <div className="bg-surface-sunken h-20 animate-pulse rounded-md motion-reduce:animate-none" />
      </div>
    );
  }

  const { ticket, messages } = detail;
  return (
    <div className="grid gap-3">
      <div>{back}</div>
      <div>
        <div className="flex items-start justify-between gap-2">
          <Text variant="body" tone="max" className="min-w-0 font-medium">{ticket.subject}</Text>
          <StatusChip status={ticket.status} />
        </div>
        <Text variant="caption" tone="muted" className="mt-0.5 block">
          <span className="font-code">{ticket.ticket_number}</span> · <LocalTime at={ticket.created_at} format="short" />
        </Text>
      </div>
      <SupportThread
        viewer="customer"
        messages={[
          { id: "original", author_type: "customer", author_name: null, body: ticket.message, created_at: ticket.created_at },
          ...(ticket.admin_note && !messages.some((m) => m.body === ticket.admin_note)
            ? [{ id: "note", author_type: "support" as const, author_name: "Support", body: ticket.admin_note, created_at: ticket.resolved_at ?? ticket.created_at }]
            : []),
          ...messages,
        ]}
      />
      <ReplyBox
        label="Add a comment"
        placeholder={ticket.status === "RESOLVED" ? "Still happening? Comment to reopen." : "Add a comment"}
        sendLabel={ticket.status === "RESOLVED" ? "Reopen and send" : "Send"}
        onSend={comment}
      />
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const resolved = status === "RESOLVED";
  return (
    <span
      className={cn(
        "font-ui text-caption shrink-0 rounded-full border px-2 py-0.5",
        resolved
          ? "border-status-success-border bg-status-success-subtle text-status-success"
          : "border-status-waiting-border bg-status-waiting-subtle text-status-waiting",
      )}
    >
      {resolved ? "Resolved" : "Open"}
    </span>
  );
}
