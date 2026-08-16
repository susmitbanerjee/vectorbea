"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { DetailSheet, Section, Facts } from "~/components/app/registry/detail-sheet";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { EMPTY } from "~/lib/format";
import {
  AUDIT_EVENTS, AUDIT_CATEGORY_LABEL, AUDIT_RETENTION_DAYS,
  type AuditEvent, type AuditCategory,
} from "~/mocks/admin";

/* ══════════════════════════════════════════════════════════════════════════════
   AUDIT LOG

   The docs promise "a full audit trail" and no screen delivered it. Enterprise
   buyers ask on the first call, and what they are asking is narrower than it
   sounds: can you show me who changed this, when, from where, and what the
   value was before.

   IMMUTABILITY IS SHOWN, NOT CLAIMED. There is no delete, no edit, no bulk
   action, no row menu anywhere on this page — the absence is the design. A
   banner saying "immutable" beside a delete button would be worth nothing.
══════════════════════════════════════════════════════════════════════════════ */

const CATEGORIES: (AuditCategory | "all")[] = [
  "all", "auth", "workflow", "publish", "approval", "connection", "member", "settings", "destructive",
];

export function AuditView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const category = (params.get("category") ?? "all") as AuditCategory | "all";
  const result = params.get("result") ?? "all";
  const actor = params.get("actor") ?? "all";
  const environment = params.get("env") ?? "all";
  const openId = params.get("event");
  const [search, setSearch] = React.useState(params.get("q") ?? "");

  const setParams = React.useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  }, [params, pathname, router]);

  const actors = React.useMemo(
    () => [...new Set(AUDIT_EVENTS.map((e) => e.actor))].sort(),
    [],
  );

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return AUDIT_EVENTS.filter((event) => {
      if (category !== "all" && event.category !== category) return false;
      if (result !== "all" && event.result !== result) return false;
      if (actor !== "all" && event.actor !== actor) return false;
      if (environment !== "all" && event.environment !== environment) return false;
      if (!needle) return true;
      // Full text across every column, including the diff — "timeoutMs" should
      // find the publish that changed it.
      return [
        event.actor, event.action, event.target, event.environment ?? "", event.ip, event.result,
        ...(event.diff ?? []).flatMap((d) => [d.field, d.before, d.after]),
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [search, category, result, actor, environment]);

  const open = openId ? AUDIT_EVENTS.find((e) => e.id === openId) ?? null : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Audit log"
        description="Every change, who made it, and what the value was before. Append-only — nothing here can be edited or removed."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => exportAudit(rows, "csv")}>Export CSV</Button>
            <Button variant="secondary" size="sm" onClick={() => exportAudit(rows, "json")}>Export JSON</Button>
          </>
        }
      />

      <div className="grid gap-3">
        <RetentionNotice count={rows.length} />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setParams({ q: search })}
            placeholder="Search actions, targets, addresses and changed values"
            aria-label="Search the audit log"
            className="h-8 min-w-[18rem] flex-1 text-body-sm"
          />
          <Select
            options={[{ value: "all", label: "Any actor" }, ...actors.map((a) => ({ value: a, label: a }))]}
            value={actor}
            onValueChange={(v) => setParams({ actor: v })}
            aria-label="Actor"
          />
          <Select
            options={[
              { value: "all", label: "Any environment" },
              { value: "production", label: "Production" },
              { value: "staging", label: "Staging" },
              { value: "development", label: "Development" },
            ]}
            value={environment}
            onValueChange={(v) => setParams({ env: v })}
            aria-label="Environment"
          />
          <Select
            options={[
              { value: "all", label: "Any result" },
              { value: "success", label: "Success" },
              { value: "failure", label: "Failure" },
              { value: "denied", label: "Denied" },
            ]}
            value={result}
            onValueChange={(v) => setParams({ result: v })}
            aria-label="Result"
          />
        </div>

        <div role="group" aria-label="Category" className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => {
            const active = category === c;
            const count = c === "all" ? AUDIT_EVENTS.length : AUDIT_EVENTS.filter((e) => e.category === c).length;
            return (
              <button
                key={c}
                onClick={() => setParams({ category: c })}
                aria-pressed={active}
                disabled={count === 0}
                className={cn(
                  "font-ui text-caption inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                  "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  "disabled:opacity-40",
                  active
                    ? "bg-accent-subtle border-accent-border text-accent"
                    : "bg-surface-raised border-subtle text-fg-secondary hover:border-default",
                )}
              >
                {c === "all" ? "All" : AUDIT_CATEGORY_LABEL[c]}
                <span className="font-code text-fg-muted text-[10px] tabular">{count}</span>
              </button>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <EmptyState onClear={() => { setSearch(""); setParams({ q: null, category: null, actor: null, env: null, result: null }); }} />
        ) : (
          <div className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[62rem]">
              <caption className="sr-only">Audit events, newest first</caption>
              <thead>
                <tr className="border-subtle bg-surface-sunken text-fg-muted font-ui text-eyebrow border-b uppercase">
                  <th scope="col" className="px-3 py-2 text-left font-normal">When</th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">Actor</th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">Action</th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">Target</th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">Environment</th>
                  <th scope="col" className="px-3 py-2 text-left font-normal">IP</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr
                    key={event.id}
                    onClick={() => setParams({ event: event.id })}
                    className="border-subtle hover:bg-surface-hover cursor-pointer border-b transition-colors duration-instant last:border-b-0"
                  >
                    <td className="px-3 py-2">
                      <Text variant="caption" tone="secondary" tabular><RelativeTime iso={event.at} /></Text>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {event.actorType === "system" ? (
                          <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[9px] uppercase">sys</span>
                        ) : null}
                        <Text variant="caption" tone="secondary" className="truncate">{event.actor}</Text>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Text variant="body-sm" tone="primary" className="truncate">{event.action}</Text>
                        {event.diff ? (
                          <span
                            className="border-subtle text-fg-disabled font-code shrink-0 rounded-xs border px-1 text-[9px]"
                            title={`${event.diff.length} field${event.diff.length === 1 ? "" : "s"} changed`}
                          >
                            diff
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Text variant="caption" tone="secondary" className="truncate">{event.target}</Text>
                    </td>
                    <td className="px-3 py-2">
                      <Text variant="caption" tone={event.environment ? "secondary" : "disabled"}>
                        {event.environment ?? EMPTY}
                      </Text>
                    </td>
                    <td className="px-3 py-2">
                      <Text variant="mono-sm" tone="disabled">{event.ip}</Text>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ResultBadge result={event.result} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EventDetail event={open} onClose={() => setParams({ event: null })} />
    </PageContainer>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────────── */

function ResultBadge({ result }: { result: AuditEvent["result"] }) {
  return (
    <span
      className={cn(
        "font-ui text-caption inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5",
        result === "success" ? "text-status-success border-status-success-border bg-status-success-subtle"
          : result === "denied" ? "text-status-waiting border-status-waiting-border bg-status-waiting-subtle"
            : "text-status-failed border-status-failed-border bg-status-failed-subtle",
      )}
    >
      {result}
    </span>
  );
}

function RetentionNotice({ count }: { count: number }) {
  return (
    <div className="border-subtle bg-surface-raised flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <Text variant="body-sm" tone="primary" className="block">
          Append-only. {count} {count === 1 ? "event" : "events"} in the retained window.
        </Text>
        <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
          Your plan retains {AUDIT_RETENTION_DAYS} days. Nothing on this page can be edited or
          deleted, including by an Owner — export before the window closes if you need longer.
        </Text>
      </div>
      <Button asChild size="sm" variant="secondary">
        <Link href={"/settings/billing" as Route}>Extend retention</Link>
      </Button>
    </div>
  );
}

function EventDetail({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  if (!event) return null;

  return (
    <DetailSheet
      open
      onClose={onClose}
      title={event.action}
      subtitle={
        <>
          <Text variant="caption" tone="secondary">{event.actor}</Text>
          <Text variant="caption" tone="muted"><RelativeTime iso={event.at} /></Text>
          <Text variant="caption" tone="muted">{AUDIT_CATEGORY_LABEL[event.category]}</Text>
        </>
      }
      badges={<ResultBadge result={event.result} />}
      tabs={[{ id: "detail", label: "Detail" }]}
      activeTab="detail"
      onTabChange={() => {}}
    >
      <div className="grid gap-3 p-4">
        <Section title="Event">
          <Facts
            items={[
              { label: "Timestamp", value: `${new Date(event.at).toISOString().replace("T", " ").slice(0, 19)}Z` },
              { label: "Actor", value: `${event.actor}${event.actorType === "system" ? " (system)" : ""}` },
              { label: "Target", value: event.target },
              { label: "Environment", value: event.environment ?? "Not environment-scoped" },
              { label: "Source address", value: event.ip },
              { label: "Result", value: event.result },
            ]}
          />
          {event.targetHref ? (
            <div className="mt-2">
              <Button asChild size="xs" variant="secondary">
                <Link href={event.targetHref as Route}>Open the target</Link>
              </Button>
            </div>
          ) : null}
        </Section>

        {event.diff ? (
          <Section
            title="What changed"
            help="The value before and after. Secrets are recorded as changed without recording the value."
          >
            <dl className="grid gap-px">
              {event.diff.map((row) => (
                <div key={row.field} className="bg-surface-sunken grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] items-baseline gap-2 rounded-xs px-2 py-1.5">
                  <dt className="min-w-0">
                    <Text variant="mono-sm" tone="secondary" className="truncate" title={row.field}>{row.field}</Text>
                  </dt>
                  <dd className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                    <Text variant="mono-sm" tone="muted" className="break-all line-through decoration-1">{row.before}</Text>
                    <span className="text-fg-disabled shrink-0" aria-hidden="true">
                      <svg viewBox="0 0 12 8" className="h-2 w-3">
                        <path d="M0 4h9M6.5 1.5 9.5 4l-3 2.5" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <Text variant="mono-sm" tone="inherit" className="text-status-success break-all">{row.after}</Text>
                    <span className="sr-only">changed from {row.before} to {row.after}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : (
          <Section title="What changed">
            <Text variant="body-sm" tone="secondary">
              This event records an action rather than a configuration change, so there is no before
              and after to show.
            </Text>
          </Section>
        )}

        {event.result === "denied" ? (
          <Section title="Why it was denied" tone="warning">
            <Text variant="body-sm" tone="secondary">
              The actor did not hold the permission this action requires. The attempt is recorded
              whether or not it succeeded — a denied action is often the more interesting line.
            </Text>
          </Section>
        ) : null}
      </div>
    </DetailSheet>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="border-subtle grid place-items-center rounded-lg border border-dashed px-4 py-14">
      <div className="max-w-[34rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No events match</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Search covers changed values as well as actions, so a term like a field name finds the
          change that touched it. Widening the retention window needs a plan change rather than a
          filter.
        </Text>
        <div className="mt-4"><Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button></div>
      </div>
    </div>
  );
}

/* ── Export ───────────────────────────────────────────────────────────────── */

function exportAudit(events: AuditEvent[], format: "csv" | "json") {
  const content = format === "json"
    ? JSON.stringify(events, null, 2)
    : [
      "timestamp,actor,actor_type,category,action,target,environment,ip,result,changes",
      ...events.map((e) => [
        e.at, e.actor, e.actorType, e.category,
        `"${e.action.replace(/"/g, '""')}"`,
        `"${e.target.replace(/"/g, '""')}"`,
        e.environment ?? "", e.ip, e.result,
        `"${(e.diff ?? []).map((d) => `${d.field}: ${d.before} -> ${d.after}`).join("; ")}"`,
      ].join(",")),
    ].join("\n");

  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
