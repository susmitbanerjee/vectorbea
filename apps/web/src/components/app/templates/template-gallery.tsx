"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { toast } from "sonner";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { NODE_MARKS } from "~/components/icons/nodes";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import {
  EntitlementProvider, useEntitlements, upgradeReason,
} from "~/lib/entitlements/use-entitlements";
import { isEnabled, describeFlag } from "~/lib/flags";
import {
  TEMPLATES, PATTERN_LABEL, CATEGORY_LABEL, DIFFICULTY_LABEL,
  type WorkflowTemplate, type TemplatePattern,
} from "~/lib/workflows/templates/catalog";
import {
  installTemplate, missingPrerequisites, TemplateInstallError,
} from "~/lib/workflows/templates/install";

/* ══════════════════════════════════════════════════════════════════════════════
   THE TEMPLATE GALLERY.

   ── WHAT A TEMPLATE CARD HAS TO ANSWER BEFORE THE CLICK ─────────────────────
   Not "what is this" — the name does that. The three questions that decide
   whether somebody adopts a template are what it NEEDS, what it COSTS, and what
   they will have to change. All three used to live on the other side of an
   install, which is why template galleries get browsed and not used.

   So the readiness line is computed against the workspace's REAL connections and
   its REAL plan, and it is on the card, not behind it. "You have a model
   connection; this is ready to run" and "this needs a model connection, and you
   have none" are different sentences and the second one is actionable.

   ── UNAVAILABLE IS SHOWN, NOT HIDDEN ────────────────────────────────────────
   A template gated by the plan or by a runtime flag stays in the list with its
   documentation readable and its install button disabled. Somebody on Free
   should be able to read exactly what the supervisor pattern would give them —
   that is the argument for the upgrade, and hiding it makes the argument
   impossible to have.
══════════════════════════════════════════════════════════════════════════════ */

export function TemplateGallery() {
  return (
    <EntitlementProvider>
      <Gallery />
    </EntitlementProvider>
  );
}

type PatternFilter = TemplatePattern | "all";

const PATTERNS: PatternFilter[] = [
  "all", "single-agent", "supervisor", "router", "review", "approval", "batch",
];

function Gallery() {
  const api = useApi();
  const router = useRouter();
  const scope = useScope();
  const plan = useEntitlements();

  const [query, setQuery] = React.useState("");
  const [pattern, setPattern] = React.useState<PatternFilter>("all");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [installing, setInstalling] = React.useState<string | null>(null);

  const keyScope = { workspaceId: scope.workspaceId, environmentId: null };
  const connections = useApiQuery({
    queryKey: queryKeys.connections.list(keyScope, { page: 1, pageSize: 200 }),
    queryFn: () => api.connections.list({ ...keyScope, page: 1, pageSize: 200 }),
    enabled: Boolean(scope.workspaceId),
  });
  const connectionItems = connections.data?.items ?? [];

  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      if (pattern !== "all" && t.pattern !== pattern) return false;
      if (!needle) return true;
      return [t.name, t.summary, t.doc.whatItDoes, PATTERN_LABEL[t.pattern]]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [query, pattern]);

  const install = async (template: WorkflowTemplate) => {
    if (installing) return;
    setInstalling(template.id);
    try {
      const result = await installTemplate(api, {
        template,
        connections: connectionItems,
        scope: keyScope,
      });

      /* Skipped optional tools are surfaced on the way OUT, not swallowed. The
         template still runs; it runs with one fewer step, and knowing that
         before the first run is the difference between a missing feature and a
         bug report. */
      if (result.skippedTools.length > 0) {
        toast.warning(
          `Installed without ${result.skippedTools.map((t) => t.name).join(", ")}.`,
          { description: result.skippedTools.map((t) => t.withoutIt).join(" ") },
        );
      } else {
        toast.success(`${template.name} is installed and ready to run.`);
      }
      router.push(`/workflows/${result.workflowId}/builder` as Route);
    } catch (error) {
      if (error instanceof TemplateInstallError) {
        const partial = error.created.agentIds.length > 0 || error.created.workflowId
          ? ` ${describePartial(error)}`
          : "";
        toast.error(error.message, {
          description: `The install stopped at the ${error.step} step.${partial}`,
        });
      } else {
        toast.error(
          error instanceof Error ? error.message : "The template could not be installed.",
        );
      }
    } finally {
      setInstalling(null);
    }
  };

  const open = openId ? TEMPLATES.find((t) => t.id === openId) ?? null : null;

  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        description="Each one runs end to end once this workspace has one model connection. Nothing here needs an hour of setup before it does anything."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates"
          aria-label="Search templates"
          className="h-8 max-w-64"
        />
        <Select
          options={PATTERNS.map((p) => ({
            value: p,
            label: p === "all" ? "Every pattern" : PATTERN_LABEL[p],
          }))}
          value={pattern}
          onValueChange={(v) => setPattern(v as PatternFilter)}
          aria-label="Filter by pattern"
        />
      </div>

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((template) => (
          <li key={template.id}>
            <TemplateCard
              template={template}
              connections={connectionItems}
              connectionsLoading={connections.isPending}
              plan={plan}
              installing={installing === template.id}
              disabled={installing !== null}
              onOpen={() => setOpenId(template.id)}
              onInstall={() => void install(template)}
            />
          </li>
        ))}
      </ul>

      {shown.length === 0 ? (
        <Text variant="body-sm" tone="muted" className="block py-8">
          No template matches “{query}”. The catalogue is six patterns, not a directory — if the
          shape you want is not here, build it on the canvas.
        </Text>
      ) : null}

      {open ? (
        <TemplateDoc
          template={open}
          connections={connectionItems}
          plan={plan}
          installing={installing === open.id}
          onClose={() => setOpenId(null)}
          onInstall={() => void install(open)}
        />
      ) : null}
    </PageContainer>
  );
}

/* ── Availability ─────────────────────────────────────────────────────────── */

interface Availability {
  ready: boolean;
  /** Sentences, in the order they block. */
  blockers: string[];
  /** True when the blocker is a plan rather than a missing connection. */
  planBlocked: boolean;
}

/**
 * Whether this workspace can install and run this template.
 *
 * THREE KINDS OF BLOCKER, AND THEY ARE DIFFERENT SENTENCES: a missing
 * connection (fix it in two minutes), a plan that does not include the feature
 * (fix it with money), and a runtime flag that is off (fix it by asking an
 * operator, and no amount of money helps). Collapsing them into "unavailable"
 * sends everybody to support.
 */
function availabilityOf(
  template: WorkflowTemplate,
  connections: Parameters<typeof missingPrerequisites>[1],
  plan: ReturnType<typeof useEntitlements>,
): Availability {
  const blockers = missingPrerequisites(template, connections);

  /* Runtime first: a workspace can be on a plan without teams AND in a
     deployment with teams switched off, and offering the upgrade there would
     sell somebody something the executor still refuses. */
  for (const flag of template.requiresFlags) {
    if (!isEnabled(flag)) {
      blockers.push(
        `${describeFlag(flag).description} is not switched on in this deployment. `
        + describeFlag(flag).blockedBy,
      );
    }
  }

  let planBlocked = false;
  if (!plan.unknown) {
    for (const key of template.requiresFeatures) {
      if (!plan.has(key)) {
        planBlocked = true;
        blockers.push(upgradeReason(plan, key));
      }
    }
  }

  return { ready: blockers.length === 0, blockers, planBlocked };
}

/* ── Card ─────────────────────────────────────────────────────────────────── */

function TemplateCard({
  template, connections, connectionsLoading, plan, installing, disabled, onOpen, onInstall,
}: {
  template: WorkflowTemplate;
  connections: Parameters<typeof missingPrerequisites>[1];
  connectionsLoading: boolean;
  plan: ReturnType<typeof useEntitlements>;
  installing: boolean;
  disabled: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  const availability = availabilityOf(template, connections, plan);

  return (
    <article className="border-subtle bg-surface-raised flex h-full flex-col rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Text variant="label" tone="primary" className="block">{template.name}</Text>
          <Text variant="caption" tone="muted" className="mt-0.5 block">
            {PATTERN_LABEL[template.pattern]} · {CATEGORY_LABEL[template.category]} ·{" "}
            {DIFFICULTY_LABEL[template.difficulty]}
          </Text>
        </div>
      </div>

      <Text variant="body-sm" tone="secondary" className="mt-2 block leading-snug">
        {template.summary}
      </Text>

      {/* The shape, as the node marks it is built from. Cheaper to read than a
          node count and it distinguishes two templates with the same length. */}
      <div className="mt-3 flex items-center gap-1">
        {shapeOf(template).map((kind, i) => {
          const entry = NODE_MARKS.find((m) => m.type === kind);
          const Icon = entry?.Icon;
          return (
            <span
              key={i}
              className="border-subtle bg-surface-hover text-fg-muted grid size-5 shrink-0 place-items-center rounded-xs border"
              title={kind}
            >
              {Icon ? <Icon size={11} aria-hidden="true" /> : null}
            </span>
          );
        })}
      </div>

      <Text variant="caption" tone="muted" className="mt-3 block">
        {template.doc.costPerRun.range} a run
      </Text>

      <div className="mt-auto pt-3">
        {connectionsLoading ? (
          <Text variant="caption" tone="muted" className="block">Checking this workspace…</Text>
        ) : availability.ready ? (
          <Text variant="caption" tone="secondary" className="text-status-success block">
            Ready to run in this workspace
          </Text>
        ) : (
          <Text variant="caption" tone="secondary" className="block leading-snug">
            {availability.blockers[0]}
          </Text>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <Button
            size="sm"
            variant="primary"
            onClick={onInstall}
            loading={installing}
            disabled={disabled || !availability.ready || connectionsLoading}
            title={availability.ready ? "Creates the agents and the workflow, then opens the canvas" : availability.blockers[0]}
          >
            {installing ? "Installing…" : "Use this template"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpen}>
            What it does
          </Button>
        </div>
      </div>
    </article>
  );
}

/** The node kinds a template builds, in order, for the shape strip. */
function shapeOf(template: WorkflowTemplate): string[] {
  /* Built with empty refs: `build` only reads ids to write them into config, and
     the KINDS are what this needs. Calling it is cheaper and more honest than a
     hand-maintained second list that drifts from the graph. */
  const graph = template.build({ agents: {}, tools: {}, llmConnectionId: null, notifyEmail: "" });
  return graph.nodes.map((n) => n.node.kind);
}

/* ── The documentation panel ──────────────────────────────────────────────── */

function TemplateDoc({
  template, connections, plan, installing, onClose, onInstall,
}: {
  template: WorkflowTemplate;
  connections: Parameters<typeof missingPrerequisites>[1];
  plan: ReturnType<typeof useEntitlements>;
  installing: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  const availability = availabilityOf(template, connections, plan);

  // Escape closes. A panel that can only be dismissed by finding the button is
  // a panel people avoid opening.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-modal flex justify-end" role="dialog" aria-modal="true" aria-label={template.name}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="bg-surface-overlay/60 absolute inset-0"
      />
      <div className="border-subtle bg-surface-base relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l">
        <header className="border-subtle bg-surface-base sticky top-0 flex items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <Text variant="label" tone="primary" className="block">{template.name}</Text>
            <Text variant="caption" tone="muted" className="mt-0.5 block">
              {PATTERN_LABEL[template.pattern]} · {DIFFICULTY_LABEL[template.difficulty]}
            </Text>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </header>

        <div className="grid gap-4 p-4">
          <DocSection title="What it does">
            <Text variant="body-sm" tone="secondary" className="block leading-relaxed">
              {template.doc.whatItDoes}
            </Text>
          </DocSection>

          <DocSection title="What it needs">
            <ul className="grid gap-1.5">
              {template.doc.whatItNeeds.map((need, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-fg-disabled mt-1.5 size-1 shrink-0 rounded-full bg-current" aria-hidden="true" />
                  <Text variant="body-sm" tone="secondary" className="leading-snug">{need}</Text>
                </li>
              ))}
            </ul>
            {!availability.ready ? (
              <div
                className={cn(
                  "mt-2 rounded-sm border px-2 py-1.5",
                  availability.planBlocked
                    ? "border-accent-border bg-accent-subtle"
                    : "border-status-waiting-border bg-status-waiting-subtle",
                )}
              >
                {availability.blockers.map((blocker, i) => (
                  <Text key={i} variant="caption" tone="secondary" className="block leading-snug">
                    {blocker}
                  </Text>
                ))}
              </div>
            ) : null}
          </DocSection>

          <DocSection title="What a run costs">
            <Text variant="body-sm" tone="secondary" className="block">
              {template.doc.costPerRun.range}
            </Text>
            <Text variant="caption" tone="muted" className="mt-1 block">What moves it:</Text>
            <ul className="mt-0.5 grid gap-1">
              {template.doc.costPerRun.drivers.map((driver, i) => (
                <li key={i}>
                  <Text variant="caption" tone="secondary" className="leading-snug">{driver}</Text>
                </li>
              ))}
            </ul>
            <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
              Ceiling: {template.doc.costPerRun.ceiling} A run that breaches it ends in
              CeilingExceeded, which names the limit it hit rather than reading as a failure.
            </Text>
          </DocSection>

          <DocSection title="What to change first">
            <ol className="grid gap-2">
              {template.doc.changeFirst.map((change, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-code text-fg-muted mt-px shrink-0 text-[10px] tabular">{i + 1}</span>
                  <span className="min-w-0">
                    <Text variant="body-sm" tone="primary" className="block">{change.where}</Text>
                    <Text variant="caption" tone="secondary" className="block leading-snug">{change.why}</Text>
                  </span>
                </li>
              ))}
            </ol>
          </DocSection>

          <DocSection title="When to reach for this pattern">
            <Text variant="body-sm" tone="secondary" className="block leading-relaxed">
              {template.doc.patternNote}
            </Text>
          </DocSection>

          <DocSection title="Sample input">
            <pre className="border-subtle bg-surface-sunken text-fg-secondary font-code overflow-x-auto rounded-sm border p-2 text-[11px] leading-relaxed">
              {JSON.stringify(template.sampleInput, null, 2)}
            </pre>
            <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
              The first run works with this, so the first thing you see is output rather than a
              validation error.
            </Text>
          </DocSection>
        </div>

        <footer className="border-subtle bg-surface-base sticky bottom-0 border-t p-4">
          <Button
            fullWidth
            variant="primary"
            onClick={onInstall}
            loading={installing}
            disabled={!availability.ready}
          >
            {installing ? "Installing…" : "Use this template"}
          </Button>
          {!availability.ready ? (
            <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
              {availability.blockers[0]}
            </Text>
          ) : (
            <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
              Creates {template.agents.length} agent{template.agents.length === 1 ? "" : "s"} and the
              workflow, then opens the canvas.
            </Text>
          )}
        </footer>
      </div>
    </div>
  );
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <Text variant="eyebrow" tone="muted" className="mb-1.5 block">{title}</Text>
      {children}
    </section>
  );
}

/** What survived a failed install, so the message can say it rather than imply it. */
function describePartial(error: TemplateInstallError): string {
  const parts: string[] = [];
  if (error.created.agentIds.length > 0) {
    parts.push(`${error.created.agentIds.length} agent${error.created.agentIds.length === 1 ? "" : "s"}`);
  }
  if (error.created.toolIds.length > 0) {
    parts.push(`${error.created.toolIds.length} tool${error.created.toolIds.length === 1 ? "" : "s"}`);
  }
  if (error.created.workflowId) parts.push("the workflow");
  if (parts.length === 0) return "";
  return `${parts.join(" and ")} were created and left in place — delete them if you do not want them.`;
}
