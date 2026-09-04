"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { formatCost, formatDuration } from "~/lib/format";
import { VersionGraph } from "~/components/app/workflows/graph-canvas";
import { NODE_MARKS } from "~/components/icons/nodes";
import { CONNECTIONS } from "~/mocks/fixtures";
import {
  TEMPLATES, COMMUNITY_TEMPLATES, ALL_TEMPLATES, readiness, estimate, templateById,
  CATEGORY_LABEL, DIFFICULTY_LABEL, DIFFICULTY_HELP,
  type Template, type TemplateCategory, type Difficulty,
} from "~/mocks/templates";

/* ══════════════════════════════════════════════════════════════════════════════
   TEMPLATES

   The existing information design — category, difficulty, runtime, integrations
   — is kept, because it is the right set of facts. What is added is the one
   thing that decides whether a template is usable at all: what you do not have.

   "Needs Postgres, Slack, HubSpot" is a list you have to check yourself.
   "You have Postgres and Slack connected; this also needs HubSpot" is the
   adoption cost, stated before the click.
══════════════════════════════════════════════════════════════════════════════ */

const CATEGORIES: (TemplateCategory | "all")[] = [
  "all", "billing", "support", "growth", "data", "engineering", "operations",
];

const DIFFICULTIES: (Difficulty | "all")[] = ["all", "starter", "intermediate", "advanced"];

export function TemplatesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const category = (params.get("category") ?? "all") as TemplateCategory | "all";
  const difficulty = (params.get("difficulty") ?? "all") as Difficulty | "all";
  const query = params.get("q") ?? "";
  const previewId = params.get("preview");
  const useId = params.get("use");

  const setParams = React.useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  }, [params, pathname, router]);

  const [search, setSearch] = React.useState(query);
  React.useEffect(() => { setSearch(query); }, [query]);

  const matches = React.useCallback((template: Template) => {
    if (category !== "all" && template.category !== category) return false;
    if (difficulty !== "all" && template.difficulty !== difficulty) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [template.name, template.summary, ...template.integrations, ...template.nodes.map((n) => n.name)]
      .join(" ").toLowerCase().includes(needle);
  }, [category, difficulty, search]);

  const firstParty = TEMPLATES.filter(matches);
  const community = COMMUNITY_TEMPLATES.filter(matches);

  const preview = previewId ? templateById(previewId) ?? null : null;
  const using = useId ? templateById(useId) ?? null : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Build"
        title="Templates"
        description="Working workflows you can adopt whole. Each one says what it needs before you commit to it."
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href={"/workflows/new/architect" as Route}>Describe your own</Link>
          </Button>
        }
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setParams({ q: search })}
            onKeyDown={(e) => { if (e.key === "Enter") setParams({ q: search }); }}
            placeholder="Search templates"
            aria-label="Search templates"
            className="h-8 max-w-xs text-body-sm"
          />
          <Select
            options={DIFFICULTIES.map((d) => ({ value: d, label: d === "all" ? "Any difficulty" : DIFFICULTY_LABEL[d] }))}
            value={difficulty}
            onValueChange={(v) => setParams({ difficulty: v })}
            aria-label="Difficulty"
          />
        </div>

        <div role="group" aria-label="Category" className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <button
                key={c}
                onClick={() => setParams({ category: c })}
                aria-pressed={active}
                className={cn(
                  "font-ui text-caption rounded-full border px-2.5 py-1",
                  "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  active
                    ? "bg-accent-subtle border-accent-border text-accent"
                    : "bg-surface-raised border-subtle text-fg-secondary hover:border-default",
                )}
              >
                {c === "all" ? "All" : CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>

        {firstParty.length === 0 && community.length === 0 ? (
          <EmptyState onClear={() => { setSearch(""); setParams({ q: null, category: null, difficulty: null }); }} />
        ) : null}

        {firstParty.length > 0 ? (
          <section>
            <Text variant="eyebrow" tone="muted" className="mb-2 block">Vectorbea templates</Text>
            <TemplateGrid templates={firstParty} onPreview={(id) => setParams({ preview: id })} onUse={(id) => setParams({ use: id })} />
          </section>
        ) : null}

        {community.length > 0 ? (
          <section className="mt-2">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <Text variant="eyebrow" tone="muted">Community</Text>
              <Text variant="caption" tone="muted">
                Contributed by other workspaces. Read the graph before adopting one — they are not reviewed.
              </Text>
            </div>
            <TemplateGrid templates={community} onPreview={(id) => setParams({ preview: id })} onUse={(id) => setParams({ use: id })} />
          </section>
        ) : null}
      </div>

      <PreviewModal
        template={preview}
        onClose={() => setParams({ preview: null })}
        onUse={(id) => setParams({ preview: null, use: id })}
      />
      <UseFlow template={using} onClose={() => setParams({ use: null })} />
    </PageContainer>
  );
}

/* ── Cards ────────────────────────────────────────────────────────────────── */

function TemplateGrid({
  templates, onPreview, onUse,
}: {
  templates: Template[];
  onPreview: (id: string) => void;
  onUse: (id: string) => void;
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {templates.map((template) => (
        <li key={template.id}>
          <TemplateCard template={template} onPreview={() => onPreview(template.id)} onUse={() => onUse(template.id)} />
        </li>
      ))}
    </ul>
  );
}

function TemplateCard({
  template, onPreview, onUse,
}: {
  template: Template;
  onPreview: () => void;
  onUse: () => void;
}) {
  const state = readiness(template);
  const est = estimate(template);

  return (
    <article className="bg-surface-raised border-subtle hover:border-default flex h-full flex-col gap-2.5 rounded-lg border p-3 transition-colors duration-fast">
      <header>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Text variant="body-sm" tone="primary" className="font-medium">{template.name}</Text>
          <span className="border-subtle text-fg-muted font-ui rounded-xs border px-1 text-[10px]">
            {CATEGORY_LABEL[template.category]}
          </span>
        </div>
        <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{template.summary}</Text>
      </header>

      <dl className="flex flex-wrap gap-x-4 gap-y-1">
        <Fact label="Difficulty" value={DIFFICULTY_LABEL[template.difficulty]} title={DIFFICULTY_HELP[template.difficulty]} />
        <Fact label="Runtime" value={formatDuration(template.runtimeMs)} />
        <Fact label="Per run" value={formatCost(est.costPerRunUsd)} />
        <Fact label="Steps" value={String(template.nodes.length)} />
      </dl>

      {/* The adoption cost, stated. */}
      <div
        className={cn(
          "rounded-sm border px-2 py-1.5",
          state.ready ? "border-status-success-border bg-status-success-subtle"
            : state.missing.length > 0 ? "border-status-waiting-border bg-status-waiting-subtle"
              : "border-status-failed-border bg-status-failed-subtle",
        )}
      >
        <Text
          variant="caption"
          tone="inherit"
          className={cn(
            "block leading-snug",
            state.ready ? "text-status-success" : state.missing.length > 0 ? "text-status-waiting" : "text-status-failed",
          )}
        >
          {state.sentence}
        </Text>
      </div>

      {template.author ? (
        <Text variant="caption" tone="disabled" className="block">
          {template.author} · used by {template.usageCount.toLocaleString("en-GB")} workspaces
        </Text>
      ) : (
        <Text variant="caption" tone="disabled" className="block">
          Used by {template.usageCount.toLocaleString("en-GB")} workspaces
        </Text>
      )}

      <footer className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onPreview}>Preview</Button>
        <Button size="sm" variant="primary" onClick={onUse}>Use template</Button>
      </footer>
    </article>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <dt><Text variant="caption" tone="disabled" className="text-[10px]">{label}</Text></dt>
      <dd><Text variant="caption" tone="secondary" tabular>{value}</Text></dd>
    </div>
  );
}

/* ── Preview ──────────────────────────────────────────────────────────────── */

function PreviewModal({
  template, onClose, onUse,
}: {
  template: Template | null;
  onClose: () => void;
  onUse: (id: string) => void;
}) {
  if (!template) return null;
  const state = readiness(template);
  const est = estimate(template);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-surface-base border-subtle shadow-3 flex max-h-[90dvh] w-[min(60rem,calc(100vw-2rem))] flex-col rounded-lg border",
          )}
        >
          <header className="border-subtle flex items-start gap-3 border-b px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title asChild>
                <Text variant="heading-sm" tone="max" as="h2">{template.name}</Text>
              </Dialog.Title>
              <Text variant="body-sm" tone="secondary" className="mt-1 block">{template.summary}</Text>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" iconOnly aria-label="Close">
                <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                </svg>
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-4">
              <section>
                <Text variant="eyebrow" tone="muted" className="mb-1.5 block">The graph</Text>
                <VersionGraph nodes={template.nodes} label={`${template.name} graph`} height={220} />
              </section>

              <section>
                <Text variant="eyebrow" tone="muted" className="mb-1.5 block">What each step does</Text>
                <ol className="grid gap-1.5">
                  {template.nodes.map((node, i) => {
                    const entry = NODE_MARKS.find((m) => m.type === node.kind);
                    const Icon = entry?.Icon;
                    return (
                      <li key={node.id} className="border-subtle flex gap-2 rounded-md border p-2">
                        <span className="border-subtle bg-surface-hover text-fg-secondary grid size-5 shrink-0 place-items-center rounded-xs border">
                          {Icon ? <Icon size={11} aria-hidden="true" /> : i + 1}
                        </span>
                        <span className="min-w-0">
                          <Text variant="body-sm" tone="primary" className="block">{node.name}</Text>
                          <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{node.purpose}</Text>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>

              <div className="grid gap-4 md:grid-cols-2">
                <section>
                  <Text variant="eyebrow" tone="muted" className="mb-1.5 block">Connections it needs</Text>
                  <ul className="grid gap-1.5">
                    {state.requirements.map((req) => (
                      <li key={req.provider} className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            req.status === "connected" ? "bg-status-success"
                              : req.status === "unhealthy" ? "bg-status-waiting" : "bg-fg-disabled",
                          )}
                          aria-hidden="true"
                        />
                        <Text variant="body-sm" tone="primary" className="capitalize">{req.provider}</Text>
                        <Text variant="caption" tone="muted" className="min-w-0 truncate">{req.detail}</Text>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <Text variant="eyebrow" tone="muted" className="mb-1.5 block">Cost and gates</Text>
                  <dl className="grid gap-1">
                    <Row label="Estimated per run" value={formatCost(est.costPerRunUsd)} />
                    <Row label="Estimated duration" value={formatDuration(est.durationMs)} />
                    <Row label="Agents created" value={String(est.agentCount)} />
                    <Row label="Tool calls" value={String(est.toolCount)} />
                    <Row
                      label="Approval gates"
                      value={est.gates.length === 0 ? "None" : est.gates.join(", ")}
                    />
                  </dl>
                  {est.gates.length === 0 ? (
                    <Text variant="caption" tone="inherit" className="text-status-waiting mt-1.5 block leading-snug">
                      No gates — every step runs unattended once published.
                    </Text>
                  ) : null}
                </section>
              </div>
            </div>
          </div>

          <footer className="border-subtle flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
            <Text variant="caption" tone="muted">{state.sentence}</Text>
            <Button variant="primary" size="sm" onClick={() => onUse(template.id)}>Use this template</Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd><Text variant="caption" tone="secondary" tabular className="text-right">{value}</Text></dd>
    </div>
  );
}

/* ── Use flow ─────────────────────────────────────────────────────────────── */

const USE_STEPS = ["Where", "Connections", "Name", "Review"] as const;

function UseFlow({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const [step, setStep] = React.useState(0);
  const [environment, setEnvironment] = React.useState("staging");
  const [name, setName] = React.useState("");
  const [created, setCreated] = React.useState(false);

  React.useEffect(() => {
    if (template) { setStep(0); setName(template.name.toLowerCase().replace(/\s+/g, "-")); setCreated(false); }
  }, [template]);

  if (!template) return null;
  const state = readiness(template);
  const blocked = state.missing.length > 0;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-surface-overlay border-subtle shadow-3 flex max-h-[90dvh] w-[min(38rem,calc(100vw-2rem))] flex-col rounded-lg border p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">Use {template.name}</Text>
          </Dialog.Title>

          <ol className="mt-3 flex flex-wrap items-center gap-1.5">
            {USE_STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "font-ui text-caption rounded-full border px-2 py-0.5",
                    i === step ? "border-accent-border bg-accent-subtle text-accent"
                      : i < step ? "border-status-success-border text-status-success"
                        : "border-subtle text-fg-disabled",
                  )}
                >
                  {label}
                </span>
                {i < USE_STEPS.length - 1 ? <span className="text-fg-disabled" aria-hidden="true">›</span> : null}
              </li>
            ))}
          </ol>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {created ? (
              <div>
                <Text variant="body-sm" tone="inherit" className="text-status-success block">
                  {name} created as a draft in {environment}
                </Text>
                <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
                  Nothing runs until you publish it. Its version 1 is recorded and its graph is
                  written exactly as previewed.
                </Text>
              </div>
            ) : step === 0 ? (
              <div className="grid gap-2">
                <Text variant="body-sm" tone="secondary" className="block">
                  Where should this be created? Staging first is the safe default — a template is
                  somebody else&apos;s workflow until you have watched it run once.
                </Text>
                <Select
                  options={[
                    { value: "staging", label: "Staging" },
                    { value: "development", label: "Development" },
                    { value: "production", label: "Production" },
                  ]}
                  value={environment}
                  onValueChange={setEnvironment}
                  aria-label="Environment"
                />
              </div>
            ) : step === 1 ? (
              <div className="grid gap-2">
                <Text variant="body-sm" tone="secondary" className="block">
                  {state.sentence}
                </Text>
                <ul className="grid gap-1.5">
                  {state.requirements.map((req) => (
                    <li key={req.provider} className="border-subtle flex flex-wrap items-center gap-2 rounded-md border p-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          req.status === "connected" ? "bg-status-success"
                            : req.status === "unhealthy" ? "bg-status-waiting" : "bg-fg-disabled",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <Text variant="body-sm" tone="primary" className="block capitalize">{req.provider}</Text>
                        <Text variant="caption" tone="muted" className="block">{req.detail}</Text>
                      </span>
                      {req.status === "missing" ? (
                        <Button asChild size="xs" variant="primary">
                          <Link href={"/connections" as Route}>Connect</Link>
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : step === 2 ? (
              <div className="grid gap-2">
                <Text variant="body-sm" tone="secondary" className="block">
                  Name it. Lowercase with hyphens reads best in run history.
                </Text>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-body-sm" />
              </div>
            ) : (
              <div className="grid gap-3">
                <VersionGraph nodes={template.nodes} label={`${template.name} graph`} height={180} />
                <dl className="grid gap-1">
                  <Row label="Name" value={name} />
                  <Row label="Environment" value={environment} />
                  <Row label="Steps" value={String(template.nodes.length)} />
                  <Row label="Estimated per run" value={formatCost(estimate(template).costPerRunUsd)} />
                </dl>
                <Text variant="caption" tone="muted" className="block leading-snug">
                  Created as a draft. Publishing is a separate, guarded step.
                </Text>
              </div>
            )}
          </div>

          <div className="border-subtle mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            {created ? (
              <>
                <span />
                <Button asChild variant="primary" size="sm">
                  <Link href={"/workflows" as Route}>Open it</Link>
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                  Back
                </Button>
                <span className="flex items-center gap-2">
                  {step === 1 && blocked ? (
                    <Text variant="caption" tone="muted">
                      {state.missing.length} connection{state.missing.length === 1 ? "" : "s"} missing
                    </Text>
                  ) : null}
                  {step < USE_STEPS.length - 1 ? (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={step === 1 && blocked}
                      onClick={() => setStep((s) => s + 1)}
                    >
                      Continue
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => setCreated(true)}>
                      Create as draft
                    </Button>
                  )}
                </span>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="border-subtle grid place-items-center rounded-lg border border-dashed px-4 py-14">
      <div className="max-w-[34rem] text-center">
        <Text variant="heading-sm" tone="max" as="p" className="block">No templates match</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block">
          Search covers names, summaries, integrations and step names. If nothing here fits, describe
          what you want instead and let the Architect draft it.
        </Text>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button>
          <Button asChild variant="primary" size="sm">
            <Link href={"/workflows/new/architect" as Route}>Describe your own</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
