"use client";

import * as React from "react";
import {
  ArrowClockwise, ArrowLeft, CheckCircle, ArrowCounterClockwise, Lifebuoy, MagnifyingGlass, PaperPlaneTilt,
} from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner";
import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Icon } from "~/components/ui/icon";
import { Input, Textarea } from "~/components/ui/input";
import { Segmented } from "~/components/ui/option-card";
import { Text } from "~/components/ui/text";
import { LocalTime } from "~/components/ui/local-time";
import { StatusChip } from "./support-widget";
import { ReplyBox, SupportThread, type ThreadMessage } from "./support-thread";

/* ══════════════════════════════════════════════════════════════════════════════
   SUPPORT PORTAL (/support) — for support admins, across every workspace.

   Rebuilt on the token layer (it was hard-coded hex and light only). Same admin
   API; additions:

   · SPICEWORKS. When SPICEWORKS_HELPDESK_EMAIL is set, every new report is also
     sent to the Spiceworks help desk. The strip under the header says whether
     that is working and whether updates made in Spiceworks come back (two-way
     sync, SUPPORT_INBOUND_ADDRESS); each ticket shows whether it reached
     Spiceworks and can be sent again.
   · CONVERSATION. Customer comments, help desk updates and portal replies, in
     order. A reply here is emailed to the customer.
   · Times are in the viewer's time zone.
══════════════════════════════════════════════════════════════════════════════ */

interface Ticket {
  id: string;
  ticket_number: string;
  tenant_name: string | null;
  user_email: string;
  user_name: string | null;
  subject: string;
  message: string;
  status: "OPEN" | "RESOLVED";
  priority: "LOW" | "NORMAL" | "HIGH";
  category: string | null;
  admin_note: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
  forwarded_to?: string | null;
  forward_status?: "sent" | "failed" | null;
  forward_error?: string | null;
  forwarded_at?: string | null;
}

interface SpiceworksStatus {
  enabled: boolean;
  address: string | null;
  problem: string | null;
  sync?: { enabled: boolean; mailbox: string | null; problem: string | null };
}

type Filter = "all" | "open" | "resolved";

const PRIORITY_STYLE: Record<Ticket["priority"], string> = {
  LOW: "text-fg-muted",
  NORMAL: "text-fg-secondary",
  HIGH: "text-status-failed",
};
const PRIORITY_LABEL: Record<Ticket["priority"], string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High" };

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export function SupportPortal({ adminEmail, initialTicket }: { adminEmail: string; initialTicket?: string | null }) {
  const [tickets, setTickets] = React.useState<Ticket[] | null>(null);
  const [openCount, setOpenCount] = React.useState(0);
  const [listError, setListError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("open");
  const [query, setQuery] = React.useState("");
  const [search, setSearch] = React.useState("");

  const [selected, setSelected] = React.useState<string | null>(initialTicket ?? null);
  const [detail, setDetail] = React.useState<Ticket | null>(null);
  const [messages, setMessages] = React.useState<ThreadMessage[] | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);

  const [spiceworks, setSpiceworks] = React.useState<SpiceworksStatus | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadList = React.useCallback(async () => {
    setListError(null);
    setTickets(null);
    try {
      const qs = new URLSearchParams({ filter });
      if (search) qs.set("q", search);
      const res = await fetch(`/api/support/admin/tickets?${qs.toString()}`, { cache: "no-store" });
      const data = await readJson<{ tickets: Ticket[]; openCount: number }>(res);
      if (!res.ok) throw new Error(data.error ?? "");
      setTickets(data.tickets);
      setOpenCount(data.openCount ?? 0);
    } catch {
      setTickets([]);
      setListError("Tickets could not be loaded. Check the connection and try again.");
    }
  }, [filter, search]);

  React.useEffect(() => { void loadList(); }, [loadList]);

  React.useEffect(() => {
    fetch("/api/support/admin/integration", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { spiceworks?: SpiceworksStatus } | null) => setSpiceworks(d?.spiceworks ?? null))
      .catch(() => setSpiceworks(null));
  }, []);

  const openTicket = React.useCallback(async (ticketNumber: string, seed?: Ticket) => {
    setSelected(ticketNumber);
    setDetail(seed ?? null);
    setMessages(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("ticket", ticketNumber);
      window.history.replaceState(null, "", url.toString());
    } catch { /* address bar is cosmetic */ }
    try {
      const res = await fetch(`/api/support/admin/tickets/${encodeURIComponent(ticketNumber)}`, { cache: "no-store" });
      if (res.status === 404) { setDetail(null); setDetailError("This ticket no longer exists."); return; }
      const data = await readJson<{ ticket: Ticket; messages?: ThreadMessage[] | null }>(res);
      if (!res.ok) throw new Error(data.error ?? "");
      setDetail(data.ticket);
      setMessages(data.messages ?? []);
    } catch {
      if (!seed) setDetailError("This ticket could not be loaded.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  React.useEffect(() => {
    if (initialTicket) void openTicket(initialTicket);
  }, [initialTicket, openTicket]);

  const replace = (ticket: Ticket) => {
    setDetail(ticket);
    setTickets((prev) => prev?.map((t) => (t.ticket_number === ticket.ticket_number ? ticket : t)) ?? null);
  };

  return (
    <div className="bg-surface-base text-fg-primary min-h-screen">
      <header className="border-subtle bg-surface-raised flex h-14 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="bg-accent text-fg-on-accent grid size-7 place-items-center rounded-sm">
            <Icon icon={Lifebuoy} size="sm" decorative />
          </span>
          <Text variant="heading-sm" tone="max">Support</Text>
          <span className="border-subtle text-fg-muted font-ui text-caption rounded-full border px-2 py-0.5">Admin</span>
        </div>
        <div className="flex items-center gap-2">
          <Text variant="caption" tone="muted" className="hidden sm:inline">{adminEmail}</Text>
          <span className="border-status-waiting-border bg-status-waiting-subtle text-status-waiting font-ui text-caption tabular rounded-full border px-2 py-0.5">
            {openCount} open
          </span>
          <Button size="sm" variant="secondary" onClick={() => void loadList()} iconLeft={<Icon icon={ArrowClockwise} size="sm" decorative />}>
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <SpiceworksStrip status={spiceworks} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          {/* ── List ────────────────────────────────────────────────────────── */}
          <section className={cn("grid content-start gap-3", selected ? "hidden lg:grid" : "grid")} aria-label="Tickets">
            <Segmented
              label="Filter tickets"
              value={filter}
              onValueChange={setFilter}
              options={[{ value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }]}
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search number, email or subject"
              aria-label="Search tickets"
              prefix={<Icon icon={MagnifyingGlass} size="sm" decorative />}
            />

            {tickets === null ? (
              <div className="grid gap-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="bg-surface-sunken h-[4.5rem] animate-pulse rounded-md motion-reduce:animate-none" />
                ))}
              </div>
            ) : listError ? (
              <div className="border-status-failed-border bg-status-failed-subtle rounded-md border p-3">
                <Text variant="body-sm" tone="inherit" className="text-status-failed block">{listError}</Text>
                <Button size="xs" variant="secondary" className="mt-2" onClick={() => void loadList()}>Try again</Button>
              </div>
            ) : tickets.length === 0 ? (
              <div className="border-subtle rounded-md border border-dashed px-4 py-12 text-center">
                <Text variant="body-sm" tone="primary" className="block font-medium">No tickets</Text>
                <Text variant="caption" tone="muted" className="mt-1 block">
                  {search ? "Nothing matches that search." : "Reports from the app appear here."}
                </Text>
              </div>
            ) : (
              <ul className="grid gap-2">
                {tickets.map((t) => (
                  <li key={t.ticket_number}>
                    <button
                      type="button"
                      onClick={() => void openTicket(t.ticket_number, t)}
                      aria-current={selected === t.ticket_number}
                      className={cn(
                        "w-full rounded-md border p-3 text-left transition-colors duration-fast",
                        "outline-none focus-visible:focus-ring",
                        selected === t.ticket_number
                          ? "border-accent-border bg-surface-selected"
                          : "border-subtle bg-surface-raised hover:bg-surface-hover",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <Text variant="caption" tone="muted" className="font-code">{t.ticket_number}</Text>
                        <StatusChip status={t.status} />
                      </span>
                      <Text variant="body-sm" tone="max" className="mt-1 block truncate font-medium">{t.subject}</Text>
                      <Text variant="caption" tone="muted" className="mt-0.5 block truncate">
                        {t.user_name ?? t.user_email}{t.tenant_name ? ` · ${t.tenant_name}` : ""} · <LocalTime at={t.created_at} format="short" />
                      </Text>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Detail ──────────────────────────────────────────────────────── */}
          <section className={cn(selected ? "block" : "hidden lg:block")} aria-label="Ticket">
            {!selected ? (
              <div className="border-subtle grid min-h-[20rem] place-items-center rounded-lg border border-dashed">
                <Text variant="body-sm" tone="muted">Select a ticket.</Text>
              </div>
            ) : detailError && !detail ? (
              <div className="border-status-failed-border bg-status-failed-subtle rounded-lg border p-4">
                <Text variant="body-sm" tone="inherit" className="text-status-failed block">{detailError}</Text>
                <Button size="xs" variant="secondary" className="mt-2" onClick={() => { setSelected(null); setDetailError(null); }}>
                  Back to tickets
                </Button>
              </div>
            ) : !detail ? (
              <div className="bg-surface-sunken h-80 animate-pulse rounded-lg motion-reduce:animate-none" aria-busy="true" />
            ) : (
              <TicketDetail
                ticket={detail}
                messages={messages}
                onMessages={(add) => setMessages((prev) => [...(prev ?? []), ...add])}
                refreshing={loadingDetail}
                spiceworks={spiceworks}
                onBack={() => setSelected(null)}
                onChanged={(next, delta) => { replace(next); if (delta) setOpenCount((c) => Math.max(0, c + delta)); }}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/* ── Spiceworks status ────────────────────────────────────────────────────── */

function SpiceworksStrip({ status }: { status: SpiceworksStatus | null }) {
  const [testing, setTesting] = React.useState(false);
  if (!status) return null;

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/support/admin/integration", { method: "POST" });
      const data = await readJson<{ ok?: boolean }>(res);
      if (!res.ok) toast.error(data.error ?? "The test ticket could not be sent.");
      else toast.success("Test ticket sent. It should appear in Spiceworks within a minute.");
    } catch {
      toast.error("The test ticket could not be sent.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="border-subtle bg-surface-raised flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", status.enabled ? "bg-status-success" : "bg-fg-disabled")}
      />
      <div className="min-w-0 flex-1">
        <Text variant="body-sm" tone="primary" className="block font-medium">
          {status.enabled ? "Spiceworks connected" : "Spiceworks not connected"}
        </Text>
        <Text variant="caption" tone="muted" className="block truncate">
          {status.enabled
            ? <>New reports are sent to <span className="font-code">{status.address}</span>.</>
            : status.problem}
        </Text>
        {status.enabled && status.sync ? (
          <Text variant="caption" tone="muted" className="block truncate">
            {status.sync.enabled
              ? <>Comments and status changes sync back through <span className="font-code">{status.sync.mailbox}</span>.</>
              : <>Changes made in Spiceworks do not sync back. {status.sync.problem}</>}
          </Text>
        ) : null}
      </div>
      {status.enabled ? (
        <Button size="sm" variant="secondary" loading={testing} loadingLabel="Sending" onClick={() => void sendTest()}
          iconLeft={<Icon icon={PaperPlaneTilt} size="sm" decorative />}>
          Send test ticket
        </Button>
      ) : null}
    </div>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

function TicketDetail({
  ticket, messages, onMessages, refreshing, spiceworks, onBack, onChanged,
}: {
  ticket: Ticket;
  messages: ThreadMessage[] | null;
  onMessages: (add: ThreadMessage[]) => void;
  refreshing: boolean;
  spiceworks: SpiceworksStatus | null;
  onBack: () => void;
  onChanged: (ticket: Ticket, openDelta?: number) => void;
}) {
  const [note, setNote] = React.useState("");
  const [acting, setActing] = React.useState(false);
  const [forwarding, setForwarding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { setNote(""); setError(null); }, [ticket.ticket_number]);

  const act = async (action: "resolve" | "reopen") => {
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/admin/tickets/${encodeURIComponent(ticket.ticket_number)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, adminNote: note.trim() || undefined }),
      });
      const data = await readJson<{ ticket?: Ticket }>(res);
      if (!res.ok || !data.ticket) { setError(data.error ?? "The ticket could not be updated."); return; }
      const changed = data.ticket.status !== ticket.status;
      onChanged(data.ticket, changed ? (action === "resolve" ? -1 : 1) : 0);
      if (changed) {
        // The server records these after responding; mirror them so the thread is current.
        const at = new Date().toISOString();
        const written = note.trim();
        onMessages([
          ...(written ? [{ id: `local-note-${at}`, author_type: "support" as const, author_name: "Vectorbea Support", body: written, created_at: at }] : []),
          { id: `local-status-${at}`, author_type: "system", author_name: null, body: action === "resolve" ? "Marked resolved." : "Reopened.", created_at: at },
        ]);
      }
      setNote("");
      toast.success(action === "resolve" ? "Ticket resolved." : "Ticket reopened.");
    } catch {
      setError("You appear to be offline. Try again.");
    } finally {
      setActing(false);
    }
  };

  const reply = async (body: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/support/admin/tickets/${encodeURIComponent(ticket.ticket_number)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await readJson<{ message?: ThreadMessage | null }>(res);
      if (!res.ok || !data.message) return data.error ?? "The reply could not be sent.";
      onMessages([data.message]);
      toast.success("Reply sent.");
      return null;
    } catch {
      return "You appear to be offline. Try again.";
    }
  };

  const forward = async () => {
    setForwarding(true);
    try {
      const res = await fetch(`/api/support/admin/tickets/${encodeURIComponent(ticket.ticket_number)}/forward`, { method: "POST" });
      const data = await readJson<{ ticket?: Ticket | null }>(res);
      if (data.ticket) onChanged(data.ticket);
      if (!res.ok) toast.error(data.error ?? "The ticket could not be sent to Spiceworks.");
      else toast.success("Ticket sent to Spiceworks.");
    } catch {
      toast.error("The ticket could not be sent to Spiceworks.");
    } finally {
      setForwarding(false);
    }
  };

  return (
    <article className="border-subtle bg-surface-raised rounded-lg border">
      <div className="border-subtle border-b p-4 sm:p-5">
        <button
          type="button"
          onClick={onBack}
          className="text-fg-muted hover:text-fg-primary font-ui text-caption mb-3 flex items-center gap-1 rounded-xs outline-none focus-visible:focus-ring lg:hidden"
        >
          <Icon icon={ArrowLeft} size="xs" decorative /> All tickets
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="caption" tone="secondary" className="font-code">{ticket.ticket_number}</Text>
          <StatusChip status={ticket.status} />
          <Text variant="caption" tone="inherit" className={cn("font-medium", PRIORITY_STYLE[ticket.priority])}>
            {PRIORITY_LABEL[ticket.priority]} priority
          </Text>
          {ticket.category ? (
            <Text variant="caption" tone="muted" className="capitalize">{ticket.category.replace(/_/g, " ")}</Text>
          ) : null}
          {refreshing ? <span className="bg-fg-disabled size-1.5 animate-pulse rounded-full motion-reduce:animate-none" aria-label="Refreshing" /> : null}
        </div>
        <Text variant="heading-md" tone="max" as="h1" className="mt-2 block break-words">{ticket.subject}</Text>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label="From">
            {ticket.user_name ? <>{ticket.user_name} · </> : null}
            <a className="text-fg-link underline-offset-2 hover:underline" href={`mailto:${ticket.user_email}`}>{ticket.user_email}</a>
          </Fact>
          <Fact label="Workspace">{ticket.tenant_name ?? "Not recorded"}</Fact>
          <Fact label="Received"><LocalTime at={ticket.created_at} /></Fact>
          {ticket.status === "RESOLVED" ? (
            <Fact label="Resolved">
              {ticket.resolved_at ? <LocalTime at={ticket.resolved_at} /> : "—"}
              {ticket.resolved_by ? <> · {ticket.resolved_by}</> : null}
            </Fact>
          ) : null}
        </dl>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        {spiceworks?.address || ticket.forward_status ? (
          <ForwardRow ticket={ticket} canSend={Boolean(spiceworks?.enabled)} sending={forwarding} onSend={() => void forward()} />
        ) : null}

        <div className="grid gap-3">
          <Text variant="label" tone="secondary" className="block">Conversation</Text>
          <SupportThread
            viewer="support"
            messages={[
              { id: "original", author_type: "customer", author_name: ticket.user_name ?? ticket.user_email, body: ticket.message, created_at: ticket.created_at },
              ...(ticket.admin_note && !(messages ?? []).some((m) => m.body === ticket.admin_note)
                ? [{ id: "note", author_type: "support" as const, author_name: "Vectorbea Support", body: ticket.admin_note, created_at: ticket.resolved_at ?? ticket.created_at }]
                : []),
              ...(messages ?? []),
            ]}
          />
          {messages === null ? (
            <div className="bg-surface-sunken h-10 animate-pulse rounded-md motion-reduce:animate-none" aria-busy="true" />
          ) : null}
          <ReplyBox label="Reply to the customer" placeholder="Reply to the customer" sendLabel="Send reply" onSend={reply} />
        </div>

        <div className="border-subtle grid gap-3 border-t pt-4">
          <Field label={ticket.status === "OPEN" ? "Resolution note" : "Note"} description="Optional. Emailed to the customer with the status change.">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minRows={2}
              maxRows={6}
              maxLength={10000}
              placeholder="Fixed the connection and re-ran the workflow."
            />
          </Field>
          {error ? (
            <Text variant="body-sm" tone="inherit" role="alert" className="border-status-failed-border bg-status-failed-subtle text-status-failed block rounded-sm border px-3 py-2">
              {error}
            </Text>
          ) : null}
          <div className="flex justify-end">
            {ticket.status === "OPEN" ? (
              <Button variant="primary" loading={acting} loadingLabel="Resolving" onClick={() => void act("resolve")}
                iconLeft={<Icon icon={CheckCircle} size="sm" decorative />}>
                Resolve ticket
              </Button>
            ) : (
              <Button variant="secondary" loading={acting} loadingLabel="Reopening" onClick={() => void act("reopen")}
                iconLeft={<Icon icon={ArrowCounterClockwise} size="sm" decorative />}>
                Reopen ticket
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ForwardRow({
  ticket, canSend, sending, onSend,
}: {
  ticket: Ticket;
  canSend: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const state = ticket.forward_status ?? null;
  const tone =
    state === "sent" ? "border-status-success-border bg-status-success-subtle"
    : state === "failed" ? "border-status-failed-border bg-status-failed-subtle"
    : "border-subtle bg-surface-sunken";

  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-md border px-3 py-2.5", tone)}>
      <div className="min-w-0 flex-1">
        <Text
          variant="body-sm"
          tone="inherit"
          className={cn(
            "block font-medium",
            state === "sent" ? "text-status-success" : state === "failed" ? "text-status-failed" : "text-fg-primary",
          )}
        >
          {state === "sent" ? "Sent to Spiceworks" : state === "failed" ? "Not sent to Spiceworks" : "Not sent to Spiceworks yet"}
        </Text>
        <Text variant="caption" tone="secondary" className="block">
          {state === "sent" && ticket.forwarded_at ? <LocalTime at={ticket.forwarded_at} /> : null}
          {state === "failed" ? ticket.forward_error ?? "The email could not be sent." : null}
          {state === null ? "Reports filed before Spiceworks was connected are not sent automatically." : null}
        </Text>
      </div>
      {canSend && state !== "sent" ? (
        <Button size="sm" variant="secondary" loading={sending} loadingLabel="Sending" onClick={onSend}
          iconLeft={<Icon icon={PaperPlaneTilt} size="sm" decorative />}>
          {state === "failed" ? "Send again" : "Send to Spiceworks"}
        </Button>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd className="mt-0.5"><Text variant="body-sm" tone="primary" className="block break-words">{children}</Text></dd>
    </div>
  );
}
