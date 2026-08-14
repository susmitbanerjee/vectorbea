"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";

/* ══════════════════════════════════════════════════════════════════════════════
   <DetailSheet> — the registry side panel.

   DEEP-LINKABLE, which is why the open record lives in the URL rather than in
   component state. The thing people do with a registry entry is send it to
   somebody: "this is the tool that keeps failing". A panel you cannot link to
   turns that into a set of instructions for reproducing a click.

   A SHEET, NOT A ROUTE. The table behind it is context — which agent is next to
   this one, what the fleet looks like — and pushing a full page throws that
   away for a record you are usually only glancing at.
══════════════════════════════════════════════════════════════════════════════ */

export function DetailSheet({
  open, onClose, title, subtitle, badges, actions, tabs, activeTab, onTabChange, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  tabs: { id: string; label: string; badge?: number }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/60 fixed inset-0 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "z-modal fixed inset-y-0 right-0 flex flex-col",
            "bg-surface-base border-subtle border-l shadow-3",
            "w-[min(46rem,100vw)]",
            // Transform only — a sheet that animates width reflows the table
            // behind it on every frame.
            "motion-safe:animate-[ink-drawer-in_200ms_var(--ease-standard)]",
          )}
        >
          <header className="border-subtle shrink-0 border-b px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Dialog.Title asChild>
                  <Text variant="heading-sm" tone="max" as="h2" className="block truncate">{title}</Text>
                </Dialog.Title>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">{subtitle}</div>
                {badges ? <div className="mt-2 flex flex-wrap items-center gap-2">{badges}</div> : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {actions}
                <Dialog.Close asChild>
                  <Button variant="ghost" size="sm" iconOnly aria-label="Close">
                    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                      <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                    </svg>
                  </Button>
                </Dialog.Close>
              </div>
            </div>
          </header>

          <div role="tablist" aria-label={`${title} sections`} className="border-subtle flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-3 py-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "font-ui text-caption flex shrink-0 items-center gap-1 rounded-sm px-2 py-1",
                  "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  activeTab === tab.id ? "bg-surface-active text-fg-primary" : "text-fg-muted hover:text-fg-primary",
                )}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 ? (
                  <span className="bg-status-failed text-fg-on-accent font-code rounded-full px-1 text-[9px] tabular">
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Section chrome, shared by both registries ────────────────────────────── */

export function Section({
  title, help, action, children, tone,
}: {
  title: string;
  help?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "error" | "warning";
}) {
  return (
    <section
      className={cn(
        "rounded-md border p-3",
        tone === "error" ? "border-status-failed-border bg-status-failed-subtle"
          : tone === "warning" ? "border-status-waiting-border bg-status-waiting-subtle"
            : "border-subtle bg-surface-raised",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <Text variant="label" tone="primary" className="block">{title}</Text>
          {help ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{help}</Text>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt><Text variant="caption" tone="muted">{item.label}</Text></dt>
          <dd className="min-w-0"><Text variant="body-sm" tone="primary" className="block truncate">{item.value}</Text></dd>
        </div>
      ))}
    </dl>
  );
}
