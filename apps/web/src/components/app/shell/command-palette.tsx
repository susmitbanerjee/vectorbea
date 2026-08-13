"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useTheme } from "next-themes";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Kbd } from "~/components/ui/kbd";
import { fuzzyRank, highlightRuns, looksLikeId } from "~/lib/fuzzy";
import {
  PALETTE_ENTITIES, RECENT_ENTITY_IDS,
  type PaletteEntity, type PaletteEntityType, type EnvironmentId,
} from "~/mocks/shell";
import {
  FanOutIcon, DurableRunIcon, AgentBrainIcon, ToolCallIcon, LeaseIcon,
  WorkerIcon, ReplayIcon, CheckpointIcon, CommitBoundaryIcon, BlastRadiusIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   COMMAND PALETTE

   Design §1 problem 4: zero keyboard surface "disqualifies it against
   Datadog/Linear-class tooling instantly". This is the fix, and it is treated as
   a feature rather than a search box.

   What makes it more than a filtered list:

   NESTED CONTEXTS. Typing "run " (with the space) scopes every subsequent
   keystroke to runs. The scope is a real mode with a chip in the input and
   Backspace-at-empty to leave it, so an operator can narrow before they know the
   name of the thing they want.

   ID PASTE. Pasting a run UUID offers to jump straight there. Operators arrive
   with ids from alerts, tickets and logs constantly, and the alternative is
   navigating to Runs and pasting into a filter.

   COMMANDS, not just navigation. "Retry last failed run", "Switch to staging",
   "Toggle theme" — the palette does things, it does not only go places.
══════════════════════════════════════════════════════════════════════════════ */

const TYPE_ICON: Record<PaletteEntityType, IconComponent> = {
  workflow: FanOutIcon,
  run: DurableRunIcon,
  agent: AgentBrainIcon,
  tool: ToolCallIcon,
  connection: LeaseIcon,
  setting: WorkerIcon,
};

const TYPE_LABEL: Record<PaletteEntityType, string> = {
  workflow: "Workflows",
  run: "Runs",
  agent: "Agents",
  tool: "Tools",
  connection: "Connections",
  setting: "Settings",
};

/** Scopes reachable by typing "<name> ". */
const SCOPES: { keyword: string; type: PaletteEntityType }[] = [
  { keyword: "run", type: "run" },
  { keyword: "workflow", type: "workflow" },
  { keyword: "agent", type: "agent" },
  { keyword: "tool", type: "tool" },
  { keyword: "connection", type: "connection" },
];

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  icon: IconComponent;
  keywords?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environment: EnvironmentId;
  onEnvironmentChange: (env: EnvironmentId) => void;
  onOpenShortcuts: () => void;
}

export function CommandPalette({
  open, onOpenChange, environment, onEnvironmentChange, onOpenShortcuts,
}: CommandPaletteProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<PaletteEntityType | null>(null);
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Reset on close so the palette always opens in a known state.
  React.useEffect(() => {
    if (!open) { setQuery(""); setScope(null); setActive(0); }
  }, [open]);

  const go = React.useCallback((href: Route) => {
    onOpenChange(false);
    router.push(href);
  }, [onOpenChange, router]);

  const commands = React.useMemo<Command[]>(() => [
    {
      id: "cmd_create_workflow", title: "Create workflow", icon: FanOutIcon,
      keywords: "new build", run: () => go("/workflows/new" as Route),
    },
    {
      id: "cmd_retry_failed", title: "Retry last failed run",
      subtitle: "run_01JBQZ8XK4 · renewals-daily, failed at node 8 of 12",
      icon: ReplayIcon, keywords: "rerun replay", run: () => go("/runs" as Route),
    },
    {
      id: "cmd_open_runs", title: "Open Runs", icon: DurableRunIcon,
      keywords: "list", run: () => go("/runs" as Route),
    },
    {
      id: "cmd_control", title: "Open Control", icon: CheckpointIcon,
      keywords: "overview dashboard home", run: () => go("/control" as Route),
    },
    {
      id: "cmd_incidents", title: "Open Incidents", icon: BlastRadiusIcon,
      keywords: "failures clusters", run: () => go("/incidents" as Route),
    },
    {
      id: "cmd_triggers", title: "Open Triggers", icon: CommitBoundaryIcon,
      keywords: "schedules webhooks cron", run: () => go("/triggers" as Route),
    },
    ...(["production", "staging", "development"] as EnvironmentId[])
      .filter((e) => e !== environment)
      .map((e) => ({
        id: `cmd_env_${e}`,
        title: `Switch to ${e}`,
        subtitle: e === "production" ? "Asks for confirmation" : undefined,
        icon: WorkerIcon,
        keywords: "environment env",
        run: () => { onOpenChange(false); onEnvironmentChange(e); },
      })),
    {
      id: "cmd_theme", title: "Toggle theme",
      subtitle: resolvedTheme === "dark" ? "Currently dark" : "Currently light",
      icon: WorkerIcon, keywords: "dark light appearance",
      run: () => { setTheme(resolvedTheme === "dark" ? "light" : "dark"); onOpenChange(false); },
    },
    {
      id: "cmd_shortcuts", title: "Keyboard shortcuts", icon: WorkerIcon,
      keywords: "keys help", run: () => { onOpenChange(false); onOpenShortcuts(); },
    },
  ], [go, environment, onEnvironmentChange, onOpenChange, onOpenShortcuts, resolvedTheme, setTheme]);

  /* ── Scope detection ──────────────────────────────────────────────────────
     Typing "run " enters the runs scope and clears the query. Handled on change
     rather than on keydown so it also fires for paste and IME input. */
  const handleChange = (value: string) => {
    if (!scope) {
      const match = SCOPES.find((s) => value.toLowerCase() === `${s.keyword} `);
      if (match) { setScope(match.type); setQuery(""); return; }
    }
    setQuery(value);
  };

  const trimmed = query.trim();
  const idPaste = looksLikeId(trimmed) ? trimmed : null;

  /* ── Results ─────────────────────────────────────────────────────────── */
  const sections = React.useMemo(() => {
    const pool = scope ? PALETTE_ENTITIES.filter((e) => e.type === scope) : PALETTE_ENTITIES;

    // Empty query: recents (or everything in the scope).
    if (!trimmed) {
      if (scope) {
        return [{ label: TYPE_LABEL[scope], items: pool.map((e) => ({ entity: e, matches: [] as number[] })) }];
      }
      const recents = RECENT_ENTITY_IDS
        .map((id) => PALETTE_ENTITIES.find((e) => e.id === id))
        .filter((e): e is PaletteEntity => Boolean(e));
      return [
        { label: "Recent", items: recents.map((e) => ({ entity: e, matches: [] as number[] })) },
        { label: "Commands", commands },
      ];
    }

    const ranked = fuzzyRank(pool, trimmed, (e) => `${e.title} ${e.subtitle ?? ""}`);
    const byType = new Map<PaletteEntityType, { entity: PaletteEntity; matches: number[] }[]>();
    for (const r of ranked) {
      const list = byType.get(r.item.type) ?? [];
      // Matches were computed against title+subtitle; only highlight within title.
      list.push({ entity: r.item, matches: r.matches.filter((m) => m < r.item.title.length) });
      byType.set(r.item.type, list);
    }

    const entitySections = [...byType.entries()].map(([type, items]) => ({
      label: TYPE_LABEL[type],
      items: items.slice(0, 6),
    }));

    const rankedCommands = scope
      ? []
      : fuzzyRank(commands, trimmed, (c) => `${c.title} ${c.keywords ?? ""}`).map((r) => r.item).slice(0, 5);

    return [
      ...(rankedCommands.length ? [{ label: "Commands", commands: rankedCommands }] : []),
      ...entitySections,
    ];
  }, [trimmed, scope, commands]);

  /** Flattened, in render order, for keyboard traversal. */
  type Row =
    | { kind: "entity"; entity: PaletteEntity; matches: number[] }
    | { kind: "command"; command: Command }
    | { kind: "id"; value: string };

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (idPaste) out.push({ kind: "id", value: idPaste });
    for (const section of sections) {
      if ("commands" in section && section.commands) {
        for (const c of section.commands) out.push({ kind: "command", command: c });
      }
      if ("items" in section && section.items) {
        for (const i of section.items) out.push({ kind: "entity", entity: i.entity, matches: i.matches });
      }
    }
    return out;
  }, [sections, idPaste]);

  React.useEffect(() => { setActive(0); }, [trimmed, scope]);

  const execute = React.useCallback((row: Row) => {
    if (row.kind === "command") row.command.run();
    else if (row.kind === "entity") go(row.entity.href);
    else go(`/runs/${row.value}` as Route);
  }, [go]);

  const move = (delta: number) => {
    setActive((a) => {
      const next = Math.max(0, Math.min(rows.length - 1, a + delta));
      listRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(rows.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[active]; if (row) execute(row); }
    else if (e.key === "Backspace" && query === "" && scope) { e.preventDefault(); setScope(null); }
  };

  let rowIndex = -1;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay fixed inset-0 bg-surface-canvas/70 backdrop-blur-[2px]" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            // Focus the input, not the dialog — typing must work immediately.
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            "motion-overlay z-modal fixed",
            "bg-surface-overlay border-subtle shadow-3 border",
            // Full-screen sheet on mobile…
            "inset-0 h-full w-full rounded-none",
            // …centred panel from sm up. `left`/`right` must BOTH be reset here:
            // `inset-0` compiles to left AND right, so overriding only `left`
            // leaves right:0 pinning the panel to the full width, and adding
            // -translate-x-1/2 then drags it half off-screen. The translate is
            // scoped to sm for the same reason.
            "sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-[12vh] sm:-translate-x-1/2",
            "sm:h-auto sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-lg",
            "flex flex-col overflow-hidden",
          )}
        >
          <VisuallyHidden.Root>
            <Dialog.Title>Search and commands</Dialog.Title>
            <Dialog.Description>
              Search workflows, runs, agents, tools and connections, or run a command.
            </Dialog.Description>
          </VisuallyHidden.Root>

          {/* ── Input row ─────────────────────────────────────────────── */}
          <div className="border-subtle flex items-center gap-2 border-b px-3 py-2.5">
            <svg viewBox="0 0 16 16" className="text-fg-muted size-4 shrink-0" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
              <path d="m10.2 10.2 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>

            {scope ? (
              <span className={cn(
                "bg-accent-subtle text-accent border-accent-border",
                "inline-flex shrink-0 items-center gap-1 rounded-xs border px-1.5 py-0.5",
                "font-ui text-caption",
              )}>
                {TYPE_LABEL[scope]}
                <button
                  type="button"
                  onClick={() => setScope(null)}
                  aria-label={`Leave ${TYPE_LABEL[scope]} scope`}
                  className="hover:text-fg-primary outline-none"
                >
                  <svg viewBox="0 0 16 16" className="size-2.5" fill="none" aria-hidden="true">
                    <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ) : null}

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={scope ? `Search ${TYPE_LABEL[scope].toLowerCase()}…` : "Search or run a command…"}
              aria-label="Search or run a command"
              aria-controls="palette-results"
              aria-activedescendant={rows[active] ? `palette-row-${active}` : undefined}
              // The palette IS a text field; global shortcuts must not fire here.
              data-no-shortcuts
              className={cn(
                "font-ui text-body text-fg-primary placeholder:text-fg-muted",
                "min-w-0 flex-1 bg-transparent outline-none",
              )}
            />

            <Kbd keys="esc" className="hidden shrink-0 sm:inline-flex" />
          </div>

          {/* ── Results ───────────────────────────────────────────────── */}
          <div
            ref={listRef}
            id="palette-results"
            role="listbox"
            aria-label="Results"
            className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:max-h-96"
          >
            {rows.length === 0 ? (
              <p className="font-ui text-body-sm text-fg-muted px-3 py-8 text-center">
                Nothing matches “{trimmed}”. Try a shorter term, or press{" "}
                <Kbd keys="esc" /> to close.
              </p>
            ) : (
              <>
                {idPaste ? (
                  (() => {
                    rowIndex += 1;
                    const index = rowIndex;
                    return (
                      <>
                        <SectionLabel>Identifier</SectionLabel>
                        <PaletteRow
                          index={index}
                          active={index === active}
                          onSelect={() => execute({ kind: "id", value: idPaste })}
                          onHover={() => setActive(index)}
                          icon={DurableRunIcon}
                          title={`Open run ${idPaste}`}
                          subtitle="Jump straight to this run"
                          mono
                        />
                      </>
                    );
                  })()
                ) : null}

                {sections.map((section) => (
                  <div key={section.label} className="mb-1 last:mb-0">
                    <SectionLabel>{section.label}</SectionLabel>

                    {"commands" in section && section.commands
                      ? section.commands.map((c) => {
                          rowIndex += 1;
                          const index = rowIndex;
                          return (
                            <PaletteRow
                              key={c.id}
                              index={index}
                              active={index === active}
                              onSelect={() => execute({ kind: "command", command: c })}
                              onHover={() => setActive(index)}
                              icon={c.icon}
                              title={c.title}
                              subtitle={c.subtitle}
                            />
                          );
                        })
                      : null}

                    {"items" in section && section.items
                      ? section.items.map(({ entity, matches }) => {
                          rowIndex += 1;
                          const index = rowIndex;
                          return (
                            <PaletteRow
                              key={entity.id}
                              index={index}
                              active={index === active}
                              onSelect={() => execute({ kind: "entity", entity, matches })}
                              onHover={() => setActive(index)}
                              icon={TYPE_ICON[entity.type]}
                              title={entity.title}
                              subtitle={entity.subtitle}
                              matches={matches}
                              mono={entity.type === "run"}
                            />
                          );
                        })
                      : null}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* ── Footer hints ──────────────────────────────────────────── */}
          <div className="border-subtle text-fg-muted hidden items-center gap-4 border-t px-3 py-2 sm:flex">
            <span className="font-ui text-caption flex items-center gap-1"><Kbd keys="up" /><Kbd keys="down" /> navigate</span>
            <span className="font-ui text-caption flex items-center gap-1"><Kbd keys="enter" /> select</span>
            <span className="font-ui text-caption flex items-center gap-1">
              type <span className="font-code">run</span> then space to scope
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-ui text-eyebrow text-fg-muted px-2 py-1 uppercase">{children}</p>;
}

function PaletteRow({
  index, active, onSelect, onHover, icon: Glyph, title, subtitle, matches, mono,
}: {
  index: number;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
  icon: IconComponent;
  title: string;
  subtitle?: string;
  matches?: number[];
  mono?: boolean;
}) {
  const runs = matches && matches.length ? highlightRuns(title, matches) : [{ text: title, hit: false }];

  return (
    <div
      id={`palette-row-${index}`}
      data-row={index}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-xs px-2 py-2",
        "transition-colors duration-instant",
        active && "bg-surface-hover",
      )}
    >
      <Glyph size={16} aria-hidden="true" className={cn("shrink-0", active ? "text-accent" : "text-fg-muted")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", mono ? "font-code text-mono-sm" : "font-ui text-body-sm", "text-fg-primary")}>
          {runs.map((run, i) =>
            run.hit ? (
              <mark key={i} className="bg-transparent text-accent font-semibold">{run.text}</mark>
            ) : (
              <React.Fragment key={i}>{run.text}</React.Fragment>
            ),
          )}
        </span>
        {subtitle ? (
          <span className="font-ui text-caption text-fg-muted block truncate">{subtitle}</span>
        ) : null}
      </span>
      {active ? <Kbd keys="enter" className="shrink-0" /> : null}
    </div>
  );
}
