"use client";

import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import {
  MagnifyingGlass, WarningCircle, CheckCircle, Sparkle, Users, Plus,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Tooltip } from "~/components/ui/tooltip";
import {
  Modal, ModalBody, ModalDivider, ModalFooter, ModalHeader, ModalNote, ModalSection,
} from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { useSearchParamWriter } from "~/lib/url/use-search-param-writer";
import { useSearchParams } from "next/navigation";
import type { SkillCatalogRow, SkillRow } from "~/lib/api/client";

/* ══════════════════════════════════════════════════════════════════════════════
   SKILLS

   ── WHAT A SKILL IS, SAID ONCE, HERE ────────────────────────────────────────
   A named, versioned bundle of instructions granted to an agent like a tool. It
   teaches competence and it CANNOT WIDEN ANYTHING — `validateToolAllowed` and
   `validateAgentAllowed` take no skill as input and would behave identically if
   the feature were deleted. The worst a malicious skill can do is waste a
   prompt (docs/SKILLS.md, invariant 21).

   That property is the reason this screen can be relaxed about installing from
   a library, and it is why the copy says it rather than leaving somebody to
   wonder what they are handing an agent.

   ── THE ONE THING THAT IS REFUSED ───────────────────────────────────────────
   Granting a skill whose required tools the agent does not hold. Not warned —
   REFUSED, at save, with the missing list. The reason is worth understanding
   before reading the code that renders it: a skill's instructions say "call the
   ticket tool with the account id". An agent holding that skill and not that
   tool does exactly what it was taught, is refused by the runtime (correctly),
   and presents as an agent that hallucinated a tool. It did not. Somebody
   granted it a bundle naming tools it does not have, and that was knowable the
   moment they pressed save.

   ── AND WHY INSTALLING ASKS FOR TOOLS ───────────────────────────────────────
   A library entry has no workspace, so it cannot name tool uuids. It names
   CAPABILITIES — "a way to post a message", "a way to read a ticket" — and
   installing binds each to one of your tools. That binding is the install's
   whole job, which is why the dialog is a list of capability-to-tool pickers
   and not a confirm button.
══════════════════════════════════════════════════════════════════════════════ */

export function SkillsView() {
  const api = useApi();
  const scope = useScope();
  const params = useSearchParams();
  const setParams = useSearchParamWriter();
  const queryClient = useQueryClient();

  const keyScope = { workspaceId: scope.workspaceId, environmentId: null };
  const readScope = React.useMemo(
    () => ({ workspaceId: scope.workspaceId, environmentId: null }),
    [scope.workspaceId],
  );
  const enabled = Boolean(scope.workspaceId);

  const installed = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "skills"] as const,
    queryFn: () => api.skills.list({ ...readScope, page: 1, pageSize: 100 }),
    enabled,
  });
  const catalog = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "skill-catalog"] as const,
    queryFn: () => api.skills.catalog(readScope),
    enabled,
  });
  const tools = useApiQuery({
    queryKey: queryKeys.tools.list(keyScope, { page: 1, pageSize: 200 }),
    queryFn: () => api.tools.list({ ...readScope, page: 1, pageSize: 200 }),
    enabled,
  });

  const [search, setSearch] = React.useState("");
  const installingSlug = params.get("install");

  const installedRows = installed.data?.items ?? [];
  const catalogRows = catalog.data?.items ?? [];
  const installedSlugs = new Set(installedRows.map((s) => s.slug));

  const needle = search.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

  const visibleCatalog = catalogRows.filter((entry) =>
    matches(`${entry.name} ${entry.summary ?? ""} ${entry.category ?? ""}`));
  const visibleInstalled = installedRows.filter((skill) =>
    matches(`${skill.name} ${skill.description ?? ""}`));

  const installing = installingSlug
    ? catalogRows.find((entry) => entry.slug === installingSlug) ?? null
    : null;

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.env(scope.workspaceId, null), "skills"],
    });
  }, [queryClient, scope.workspaceId]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Build"
        title="Skills"
        description="Named, versioned instructions granted to an agent like a tool. A skill teaches an agent how to do something — it can never let it do something new."
      />

      <div className="grid gap-4">
        <div className="max-w-md">
          <Field label="Search skills" labelHidden>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the library and your own"
              prefix={<Icon icon={MagnifyingGlass} size="sm" decorative />}
            />
          </Field>
        </div>

        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <Text variant="eyebrow" tone="muted">Installed in this workspace</Text>
            <Text variant="caption" tone="muted">
              Installing does not grant. Tick these on an agent&rsquo;s Skills tab — which can also
              install from the library without coming here.
            </Text>
          </div>

          {installed.isPending ? (
            <SkeletonGrid />
          ) : installed.error ? (
            <Notice tone="error">
              The installed skills could not be read. {installed.error.message}
            </Notice>
          ) : visibleInstalled.length === 0 ? (
            <Notice>
              {installedRows.length === 0
                ? "Nothing installed yet. Install one from the library below — it copies the bundle into this workspace, where you can edit and version it."
                : "None of your skills match that search."}
            </Notice>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleInstalled.map((skill) => (
                <InstalledCard
                  key={skill.id}
                  skill={skill}
                  onArchive={async () => {
                    await api.skills.archive(skill.id, readScope);
                    toast.success(`${skill.name} archived. Agents holding it keep the grant until you remove it.`);
                    await refresh();
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <Text variant="eyebrow" tone="muted">Library</Text>
            <Text variant="caption" tone="muted">
              First-party by construction — the table has no workspace column, so nothing a customer writes can reach it.
            </Text>
          </div>

          {catalog.isPending ? (
            <SkeletonGrid />
          ) : catalog.error ? (
            <Notice tone="error">The library could not be read. {catalog.error.message}</Notice>
          ) : visibleCatalog.length === 0 ? (
            <Notice>Nothing in the library matches that search.</Notice>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleCatalog.map((entry) => (
                <CatalogCard
                  key={entry.id}
                  entry={entry}
                  installed={installedSlugs.has(entry.slug)}
                  onInstall={() => setParams({ install: entry.slug })}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <SkillInstallDialog
        entry={installing}
        tools={tools.data?.items ?? []}
        toolsLoading={tools.isPending}
        onClose={() => setParams({ install: null })}
        onInstalled={async (skill) => {
          setParams({ install: null });
          toast.success(`${skill.name} installed. Grant it to an agent from that agent's Skills tab.`);
          await refresh();
        }}
      />
    </PageContainer>
  );
}

/* ── Cards ────────────────────────────────────────────────────────────────── */

function InstalledCard({ skill, onArchive }: { skill: SkillRow; onArchive: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);

  return (
    <article className="border-subtle bg-surface-raised flex flex-col rounded-lg border p-3.5">
      <div className="flex items-start justify-between gap-2">
        <Text variant="label" tone="primary" className="min-w-0">{skill.name}</Text>
        <span className="border-subtle text-fg-muted font-ui text-caption shrink-0 rounded-full border px-2 py-0.5">
          v{skill.currentVersion ?? 1}
        </span>
      </div>

      <Text variant="body-sm" tone="secondary" className="mt-1.5 block flex-1 leading-snug">
        {skill.description ?? "No description."}
      </Text>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Text variant="caption" tone="muted">
          {skill.provenance === "first_party" ? "From the library" : "Written here"}
        </Text>
        {skill.status !== "active" ? (
          <Text variant="caption" className="text-status-waiting">{skill.status}</Text>
        ) : null}
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          size="xs"
          variant="ghost"
          className="text-status-failed"
          loading={busy}
          onClick={() => {
            if (!window.confirm(
              `Archive ${skill.name}? Agents that hold it keep the grant — archiving stops it being granted to anyone new.`,
            )) return;
            setBusy(true);
            void onArchive()
              .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "That did not work."))
              .finally(() => setBusy(false));
          }}
        >
          Archive
        </Button>
      </div>
    </article>
  );
}

function CatalogCard({
  entry, installed, onInstall,
}: {
  entry: SkillCatalogRow;
  installed: boolean;
  onInstall: () => void;
}) {
  return (
    <article className="border-subtle bg-surface-raised flex flex-col rounded-lg border p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon icon={Sparkle} size="sm" decorative className="text-fg-muted shrink-0" />
          <Text variant="label" tone="primary" className="min-w-0">{entry.name}</Text>
        </span>
        {installed ? (
          <span className="border-status-success-border text-status-success font-ui text-caption shrink-0 rounded-full border px-2 py-0.5">
            Installed
          </span>
        ) : null}
      </div>

      <Text variant="body-sm" tone="secondary" className="mt-1.5 block flex-1 leading-snug">
        {entry.summary ?? "No summary."}
      </Text>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {entry.category ? <Text variant="caption" tone="muted">{entry.category}</Text> : null}
        <Text variant="caption" tone="muted" tabular>v{entry.version}</Text>
        {entry.requiredCapabilities.length > 0 ? (
          <Tooltip content={entry.requiredCapabilities.map((c) => c.label).join(", ")}>
            <span>
              <Text variant="caption" tone="secondary">
                needs {entry.requiredCapabilities.length} tool
                {entry.requiredCapabilities.length === 1 ? "" : "s"}
              </Text>
            </span>
          </Tooltip>
        ) : (
          <Text variant="caption" tone="muted">needs no tools</Text>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" variant={installed ? "secondary" : "primary"} onClick={onInstall}>
          {/* Re-installing is an UPGRADE, not a duplicate — the API adds a
              version to the existing row rather than creating a second, so
              every grant in the workspace follows it. */}
          {installed ? "Update to v" + entry.version : "Install"}
        </Button>
      </div>
    </article>
  );
}

/* ── Install ──────────────────────────────────────────────────────────────── */

/**
 * Installing a library entry into this workspace.
 *
 * Exported because the agent Skills tab reuses it verbatim. There is exactly
 * one install surface, so the capability-to-tool binding, the refusal copy and
 * the "a skill cannot widen anything" note cannot drift between the two places
 * somebody can install from.
 */
export function SkillInstallDialog({
  entry, tools, toolsLoading, onClose, onInstalled,
}: {
  entry: SkillCatalogRow | null;
  tools: contracts.Tool[];
  toolsLoading: boolean;
  onClose: () => void;
  onInstalled: (skill: SkillRow) => Promise<void>;
}) {
  const api = useApi();
  const scope = useScope();

  const [bindings, setBindings] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!entry) return;
    setBindings({});
    setError(null);
  }, [entry]);

  if (!entry) return null;

  const unbound = entry.requiredCapabilities.filter((cap) => !bindings[cap.key]);
  const ready = unbound.length === 0;

  async function install() {
    if (!entry) return;
    setSaving(true);
    setError(null);
    try {
      const skill = await api.skills.install(
        entry.slug,
        { version: entry.version, toolBindings: bindings },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
      await onInstalled(skill);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The skill was not installed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={(next) => { if (!next && !saving) onClose(); }} dismissible={!saving} size="lg">
      <ModalHeader
        eyebrow="Build · Skills"
        title={`Install ${entry.name}`}
        description={entry.summary ?? undefined}
        closeDisabled={saving}
      />
      <ModalBody>
        <div className="grid gap-4">
          <ModalSection title="What it teaches" description="The instructions composed into an agent's prompt when it holds this skill.">
            <pre className="border-subtle bg-surface-sunken max-h-56 overflow-auto rounded-sm border p-2.5">
              <code className="font-code text-mono-sm text-fg-secondary whitespace-pre-wrap">
                {entry.instructions}
              </code>
            </pre>
          </ModalSection>

          {entry.requiredCapabilities.length > 0 ? (
            <>
              <ModalDivider />
              <ModalSection
                title="Bind its tools"
                description="A library skill names what it needs to be able to DO; it cannot know the tool ids in your workspace. Pick one of yours for each."
              >
                {toolsLoading ? (
                  <span className="bg-surface-sunken block h-8 rounded-sm" aria-hidden />
                ) : tools.length === 0 ? (
                  <ModalNote tone="warning" title="This workspace has no tools">
                    A skill that names a tool cannot be installed until one exists. Register a tool
                    first — the skill is instructions about using it, not a substitute for it.
                  </ModalNote>
                ) : (
                  <div className="grid gap-3">
                    {entry.requiredCapabilities.map((cap) => (
                      <Field
                        key={cap.key}
                        label={cap.label}
                        required
                        description={cap.why}
                      >
                        <Select
                          value={bindings[cap.key] ?? ""}
                          onValueChange={(next) =>
                            setBindings((current) => ({ ...current, [cap.key]: next }))}
                          options={tools.map((tool) => ({
                            value: tool.id,
                            label: tool.name,
                            description: `${tool.type} · ${tool.riskLevel} risk`,
                          }))}
                          placeholder="Pick one of your tools"
                        />
                      </Field>
                    ))}
                  </div>
                )}
              </ModalSection>
            </>
          ) : (
            <ModalNote title="This skill needs no tools">
              It is instructions only. An agent holding it can do exactly what it could before —
              the skill changes how it works, never what it may call.
            </ModalNote>
          )}

          <ModalNote title="A skill cannot widen anything">
            Granting this never adds a tool, an agent it may delegate to, or an output schema. The
            grant check reads your database and takes no skill as input — so the worst a wrong skill
            can do is waste a prompt.
          </ModalNote>

          {error ? <ModalNote tone="danger" title="Not installed">{error}</ModalNote> : null}
        </div>
      </ModalBody>
      <ModalFooter
        hint={
          !ready && entry.requiredCapabilities.length > 0 ? (
            <span className="flex items-start gap-1.5">
              <Icon icon={WarningCircle} size="sm" decorative className="text-status-waiting mt-px" />
              <Text variant="caption" tone="muted" className="leading-snug">
                Pick a tool for {unbound.map((c) => c.label).join(", ")}.
              </Text>
            </span>
          ) : null
        }
      >
        <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          loadingLabel="Installing"
          disabled={!ready}
          onClick={() => void install()}
        >
          Install
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────────── */

function SkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="border-subtle bg-surface-raised rounded-lg border p-3.5">
          <span className="bg-surface-sunken block h-3.5 w-1/2 rounded-xs" />
          <span className="bg-surface-sunken mt-2 block h-3 w-full rounded-xs" />
          <span className="bg-surface-sunken mt-1.5 block h-3 w-3/4 rounded-xs" />
        </div>
      ))}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed px-4 py-8 text-center",
        tone === "error" ? "border-status-failed-border" : "border-subtle",
      )}
    >
      <Text variant="body-sm" tone="secondary" className="block leading-snug">{children}</Text>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE GRANT — rendered on an agent, not here.

   Exported so `agent-detail` can mount it beside the tool grants, which is
   where the decision is actually made: what this agent knows sits next to what
   this agent may do, and the refusal below is about the relationship between
   the two.

   ── WHY THIS TAB INSTALLS, AND DOES NOT JUST TICK BOXES ─────────────────────
   It used to render a checkbox per skill already installed in the workspace,
   and nothing else. In a workspace with none — which is every workspace on its
   first day — the whole tab was one sentence: "No skills installed in this
   workspace yet. Install one from Build → Skills, then grant it here." Not a
   link. A description of somewhere else to go, followed by a second screen that
   installs, followed by coming back here to tick the box.

   So the feature existed end to end and read as missing. Nobody walks three
   screens to find out what a skill does.

   The library is therefore ON this tab. Adding a skill to an agent is one
   gesture from the place you are already looking at that agent, the way adding
   one to an assistant is everywhere else people have met the idea. The two
   steps still happen — a workspace install, then a per-agent grant — because
   they are genuinely different acts with different blast radii, but the person
   performs one action and is told what both of them did.

   ── AND THE TWO STEPS CAN DISAGREE, SO THEY ARE REPORTED SEPARATELY ─────────
   Installing always works. GRANTING is refused when the skill names a tool the
   agent does not hold, which is the whole point of the feature (docs/SKILLS.md,
   invariant 21). So "installed, but not granted — this agent is missing X" is a
   real and common outcome, and collapsing it into one success toast would be a
   lie the operator discovers at iteration four of a production run.
══════════════════════════════════════════════════════════════════════════════ */

export function AgentSkillGrants({
  agentId, agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();

  const keyScope = { workspaceId: scope.workspaceId, environmentId: null };
  const readScope = React.useMemo(
    () => ({ workspaceId: scope.workspaceId, environmentId: null }),
    [scope.workspaceId],
  );
  const enabled = Boolean(scope.workspaceId && agentId);

  const grants = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "agent-skills", agentId] as const,
    queryFn: () => api.skills.grants(agentId, readScope),
    enabled,
  });
  const available = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "skills"] as const,
    queryFn: () => api.skills.list({ ...readScope, page: 1, pageSize: 100 }),
    enabled,
  });
  /*
   * The library is read HERE and not behind the "Add" click, so the button can
   * say how many there are and the empty state can name the first one. A panel
   * that opens onto a spinner is a panel people close.
   */
  const catalog = useApiQuery({
    queryKey: [...queryKeys.env(scope.workspaceId, null), "skill-catalog"] as const,
    queryFn: () => api.skills.catalog(readScope),
    enabled,
  });
  const tools = useApiQuery({
    queryKey: queryKeys.tools.list(keyScope, { page: 1, pageSize: 200 }),
    queryFn: () => api.tools.list({ ...readScope, page: 1, pageSize: 200 }),
    enabled,
  });

  const [saving, setSaving] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [browsing, setBrowsing] = React.useState(false);
  const [installing, setInstalling] = React.useState<SkillCatalogRow | null>(null);

  const held = new Set((grants.data?.items ?? []).map((g) => g.skillId));
  const skills = (available.data?.items ?? []).filter((s) => s.status === "active");
  const installedSlugs = new Set((available.data?.items ?? []).map((s) => s.slug));
  const libraryRows = catalog.data?.items ?? [];
  const uninstalled = libraryRows.filter((entry) => !installedSlugs.has(entry.slug));

  const refreshAll = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.env(scope.workspaceId, null), "agent-skills", agentId],
      }),
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.env(scope.workspaceId, null), "skills"],
      }),
    ]);
  }, [queryClient, scope.workspaceId, agentId]);

  /**
   * Replace this agent's whole grant set.
   *
   * `setGrants` is a PUT of the intended set, not a stream of adds and removes,
   * so every call sends everything that should be true afterwards. Returns
   * whether it was accepted, because the install flow needs to know.
   */
  async function setGrants(next: Set<string>): Promise<boolean> {
    setSaving(true);
    setRefusal(null);
    try {
      await api.skills.setGrants(agentId, [...next], readScope);
      await queryClient.invalidateQueries({
        queryKey: [...queryKeys.env(scope.workspaceId, null), "agent-skills", agentId],
      });
      return true;
    } catch (error) {
      /*
       * The refusal IS the feature, so it is rendered in place rather than as a
       * toast that scrolls away. `SkillToolsMissing` carries the missing tool
       * list, and the API's sentence already names them — printing it verbatim
       * beats paraphrasing a message written to be read.
       */
      setRefusal(error instanceof Error ? error.message : "The grant was refused.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const loading = grants.isPending || available.isPending;

  return (
    <div className="grid grid-cols-1 gap-3">
      {loading ? (
        <span className="bg-surface-sunken block h-16 rounded-sm" aria-hidden />
      ) : skills.length === 0 ? (
        <EmptyGrants
          agentName={agentName}
          libraryCount={uninstalled.length}
          onBrowse={() => setBrowsing(true)}
          disabled={!enabled}
        />
      ) : (
        <>
          <ul className="divide-subtle border-subtle divide-y rounded-md border">
            {skills.map((skill) => {
              const on = held.has(skill.id);
              return (
                <li key={skill.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 px-3 py-2.5",
                      "transition-colors duration-fast",
                      on ? "bg-surface-selected" : "hover:bg-surface-hover",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={saving}
                      onChange={() => {
                        const next = new Set(held);
                        if (on) next.delete(skill.id); else next.add(skill.id);
                        void setGrants(next);
                      }}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                      aria-label={`Grant ${skill.name} to ${agentName}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <Text variant="body-sm" tone="primary" className="font-medium">{skill.name}</Text>
                        <Text variant="caption" tone="muted" tabular>v{skill.currentVersion ?? 1}</Text>
                        {skill.provenance === "first_party" ? (
                          <Text variant="caption" tone="muted">from the library</Text>
                        ) : null}
                      </span>
                      <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
                        {skill.description ?? "No description."}
                      </Text>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {refusal ? <span /> : (
              <span className="flex items-center gap-1.5">
                <Icon icon={Users} size="sm" decorative className="text-fg-muted" />
                <Text variant="caption" tone="muted">
                  {held.size === 0
                    ? "No skills granted. This agent works from its own instructions alone."
                    : `${held.size} granted. They compose after this agent's own instructions and before its observations.`}
                </Text>
              </span>
            )}
            <Button
              size="xs"
              variant="secondary"
              disabled={!enabled}
              onClick={() => setBrowsing(true)}
              iconLeft={<Icon icon={Plus} size="sm" decorative />}
            >
              Add a skill
            </Button>
          </div>
        </>
      )}

      {refusal ? (
        <div className="border-status-failed-border bg-status-failed-subtle flex items-start gap-2 rounded-sm border p-2.5">
          <Icon icon={WarningCircle} size="sm" decorative className="text-status-failed mt-px shrink-0" />
          <div className="min-w-0">
            <Text variant="body-sm" tone="primary" className="block">This grant was refused</Text>
            <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
              {refusal}
            </Text>
            <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
              Refused rather than warned on purpose. A skill that tells an agent to call a tool it
              does not hold produces a run that fails at iteration four and reads as a model
              inventing a tool — which it did not. Grant the tool on this agent&rsquo;s Tool grants
              tab, then come back.
            </Text>
          </div>
        </div>
      ) : null}

      <SkillLibraryPanel
        open={browsing}
        agentName={agentName}
        entries={uninstalled}
        loading={catalog.isPending}
        error={catalog.error?.message ?? null}
        onClose={() => setBrowsing(false)}
        onPick={(entry) => { setBrowsing(false); setInstalling(entry); }}
      />

      <SkillInstallDialog
        entry={installing}
        tools={tools.data?.items ?? []}
        toolsLoading={tools.isPending}
        onClose={() => setInstalling(null)}
        onInstalled={async (skill) => {
          setInstalling(null);
          await refreshAll();
          /*
           * The grant is the reason somebody clicked, so it is attempted
           * immediately rather than left as a box to tick afterwards. It can
           * still be refused — that is the feature — and the two outcomes are
           * reported as the two different facts they are.
           */
          const granted = await setGrants(new Set([...held, skill.id]));
          if (granted) {
            toast.success(`${skill.name} installed and granted to ${agentName}.`);
          } else {
            toast.warning(
              `${skill.name} is installed in this workspace, but ${agentName} was not granted it.`,
            );
          }
        }}
      />
    </div>
  );
}

/**
 * The tab with nothing in it.
 *
 * The old version of this was a sentence pointing at another screen. What
 * replaced it names what a skill IS in one line — because somebody on this tab
 * may never have met the idea — and puts the library one click away instead of
 * one navigation away.
 */
function EmptyGrants({
  agentName, libraryCount, onBrowse, disabled,
}: {
  agentName: string;
  libraryCount: number;
  onBrowse: () => void;
  disabled: boolean;
}) {
  return (
    <div className="border-subtle grid place-items-center rounded-md border border-dashed px-4 py-8">
      <div className="max-w-[52ch] text-center">
        <Text variant="body-sm" tone="primary" className="block">
          {agentName} holds no skills
        </Text>
        <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
          A skill is a named, versioned set of instructions — how a competent person does this job,
          composed into the agent&rsquo;s prompt after its own instructions. It teaches; it can
          never let the agent do something it was not already allowed to do.
        </Text>
        <div className="mt-3">
          <Button
            variant="primary"
            size="sm"
            disabled={disabled}
            onClick={onBrowse}
            iconLeft={<Icon icon={Plus} size="sm" decorative />}
          >
            {libraryCount > 0 ? `Browse ${libraryCount} skills` : "Browse the library"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The library, as a picker.
 *
 * Deliberately NOT the full gallery from the Skills page. Somebody here has
 * already chosen the agent and is choosing the skill; category filters, archive
 * buttons and version management are the other screen's job. What this has to
 * answer is "what does this do" and "what does it need", which is what a person
 * weighs before adding a capability to something that spends money.
 */
function SkillLibraryPanel({
  open, agentName, entries, loading, error, onClose, onPick,
}: {
  open: boolean;
  agentName: string;
  entries: SkillCatalogRow[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPick: (entry: SkillCatalogRow) => void;
}) {
  const [search, setSearch] = React.useState("");

  React.useEffect(() => { if (open) setSearch(""); }, [open]);

  const needle = search.trim().toLowerCase();
  const shown = entries.filter((entry) =>
    !needle || `${entry.name} ${entry.summary ?? ""} ${entry.category ?? ""}`
      .toLowerCase().includes(needle));

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} size="lg">
      <ModalHeader
        eyebrow="Build · Skills"
        title={`Add a skill to ${agentName}`}
        description="Installing copies the bundle into this workspace and grants it to this agent in one step. Other agents are unaffected until you grant it to them too."
      />
      <ModalBody>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Search the library" labelHidden>
            <Input
              value={search}
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the library"
              prefix={<Icon icon={MagnifyingGlass} size="sm" decorative />}
            />
          </Field>

          {loading ? (
            <SkeletonGrid />
          ) : error ? (
            <ModalNote tone="danger" title="The library could not be read">{error}</ModalNote>
          ) : entries.length === 0 ? (
            <ModalNote title="Everything in the library is already installed">
              Close this and tick the ones {agentName} should hold. To write a skill of your own,
              go to Build → Skills.
            </ModalNote>
          ) : shown.length === 0 ? (
            <ModalNote title="Nothing matches that search">
              {entries.length} skill{entries.length === 1 ? "" : "s"} in the library.
            </ModalNote>
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {shown.map((entry) => (
                <li key={entry.id}>
                  <article className="border-subtle bg-surface-raised flex flex-wrap items-start gap-3 rounded-md border p-3">
                    <Icon icon={Sparkle} size="sm" decorative className="text-fg-muted mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <Text variant="body-sm" tone="primary" className="font-medium">{entry.name}</Text>
                        <Text variant="caption" tone="muted" tabular>v{entry.version}</Text>
                        {entry.category ? (
                          <Text variant="caption" tone="muted">{entry.category}</Text>
                        ) : null}
                      </span>
                      <Text variant="caption" tone="secondary" className="mt-0.5 block leading-snug">
                        {entry.summary ?? "No summary."}
                      </Text>
                      <Text variant="caption" tone="muted" className="mt-1 block">
                        {/* The adoption cost, before the click. A skill needing
                            two tools this agent lacks is a grant that will be
                            refused, and saying so here is cheaper than saying
                            so after the install. */}
                        {entry.requiredCapabilities.length === 0
                          ? "Needs no tools — instructions only."
                          : `Needs ${entry.requiredCapabilities.length} tool`
                            + `${entry.requiredCapabilities.length === 1 ? "" : "s"}: `
                            + entry.requiredCapabilities.map((c) => c.label).join(", ")}
                      </Text>
                    </div>
                    <Button size="xs" variant="primary" onClick={() => onPick(entry)}>
                      Add
                    </Button>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
}

/** Small helper so a caller can show the success tick without importing icons. */
export function GrantedTick() {
  return <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />;
}
