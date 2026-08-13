"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Kbd } from "~/components/ui/kbd";
import { Button } from "~/components/ui/button";
import { Wordmark } from "~/components/app/shell/wordmark";
import { fuzzyRank, highlightRuns } from "~/lib/fuzzy";
import { DOCS_NAV, DOCS_PAGES, docsPath, getDocsPage, type DocsPageMeta, type TocEntry } from "~/content/docs/registry";
import { DOCS_BODIES } from "~/content/docs/bodies";
import { WasThisHelpful } from "./primitives";

/* ══════════════════════════════════════════════════════════════════════════════
   DOCS SHELL — three columns.

   Left: the whole information architecture, always visible, so a reader can see
   what else exists. Centre: a 68ch measure (§8), because a docs page that spans
   a 1920px monitor is unreadable. Right: on-this-page, scroll-spied.

   PRINT is a real output here. Enterprise buyers print the security and
   durability pages to circulate them, so the print stylesheet drops both rails,
   the search, the feedback widget and the anchors, and lets the content run full
   width. See the print: variants throughout.

   Takes a slug rather than the page object. The routes are Server Components,
   and a page object carrying its body component could not cross the boundary as
   a prop — functions are not serialisable. A string can.
══════════════════════════════════════════════════════════════════════════════ */

const VERSIONS = ["v1.4 (current)", "v1.3", "v1.2"];

export function DocsShell({ slug }: { slug: string }) {
  const page = getDocsPage(slug);
  const Body = DOCS_BODIES[slug];
  // Resolution happens outside the stateful component so the hooks below are
  // never conditional.
  if (!page || !Body) throw new Error(`Unknown docs slug: ${slug}`);
  return <DocsShellInner page={page} Body={Body} />;
}

function DocsShellInner({
  page, Body,
}: {
  page: DocsPageMeta;
  Body: React.ComponentType;
}) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string>(page.toc[0]?.id ?? "");
  const [progress, setProgress] = React.useState(0);

  const flat = React.useMemo(() => DOCS_NAV.flatMap((g) => g.items), []);
  const index = flat.findIndex((p) => p.slug === page.slug);
  const previous = index > 0 ? flat[index - 1] : null;
  const nextPage = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;

  /* ── Scroll spy ─────────────────────────────────────────────────────────── */
  React.useEffect(() => {
    if (page.toc.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Take the topmost heading currently in the band, so the rail does not
        // jump backwards when several are visible at once.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -70% 0px" },
    );
    for (const entry of page.toc) {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [page.toc, page.slug]);

  /* ── Reading progress ───────────────────────────────────────────────────── */
  React.useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [page.slug]);

  /* ── ⌘K ─────────────────────────────────────────────────────────────────── */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="bg-surface-base text-fg-primary font-ui min-h-dvh">
      {/* Reading progress. Transform-only, so it never triggers layout. */}
      <div
        aria-hidden="true"
        className="bg-accent fixed inset-x-0 top-0 z-sticky h-0.5 origin-left print:hidden"
        style={{ transform: `scaleX(${progress})` }}
      />

      <header className="bg-surface-base border-subtle sticky top-0 z-sticky border-b print:hidden">
        <div className="mx-auto flex w-full max-w-[100rem] items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="rounded-sm outline-none focus-visible:focus-ring">
            <Wordmark />
          </Link>
          <Text variant="caption" tone="muted" className="hidden sm:block">Docs</Text>

          <div className="ml-auto flex items-center gap-2">
            <label className="sr-only" htmlFor="docs-version">Documentation version</label>
            <select
              id="docs-version"
              defaultValue={VERSIONS[0]}
              className={cn(
                "bg-surface-sunken border-default text-fg-secondary font-ui text-caption",
                "h-7 rounded-sm border px-2 outline-none focus-visible:focus-ring",
              )}
            >
              {VERSIONS.map((v) => <option key={v}>{v}</option>)}
            </select>

            <button
              onClick={() => setSearchOpen(true)}
              className={cn(
                "bg-surface-sunken border-default text-fg-muted font-ui text-caption",
                "hidden h-7 items-center gap-2 rounded-sm border px-2 sm:flex",
                "hover:border-strong hover:text-fg-secondary transition-colors duration-fast",
                "outline-none focus-visible:focus-ring w-44",
              )}
            >
              <span className="flex-1 text-left">Search docs…</span>
              <Kbd keys="mod+k" />
            </button>

            <Button asChild size="sm" variant="primary">
              <Link href={"/signup" as never}>Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[100rem] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem] print:block print:max-w-none print:px-0">
        {/* ── Section nav ─────────────────────────────────────────────── */}
        <nav aria-label="Documentation sections" className="hidden lg:block print:hidden">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-8">
            {DOCS_NAV.map((group) => (
              <div key={group.label} className="mb-5">
                <Text variant="eyebrow" tone="muted" className="mb-1.5 block">{group.label}</Text>
                <ul className="grid gap-px">
                  {group.items.map((item) => {
                    const active = item.slug === page.slug;
                    return (
                      <li key={item.slug}>
                        <Link
                          href={docsHref(item.slug)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "font-ui text-body-sm block rounded-sm px-2 py-1",
                            "transition-colors duration-fast outline-none focus-visible:focus-ring",
                            active
                              ? "bg-surface-active text-fg-max font-medium"
                              : "text-fg-secondary hover:bg-surface-hover hover:text-fg-primary",
                          )}
                        >
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        {/* ── Content ─────────────────────────────────────────────────── */}
        <main className="min-w-0">
          {/* The 68ch measure (§8) belongs to the TEXT, not to the column.
              Applying it to the article clamped everything to 548px, which is
              narrower than a three-column comparison table — so tables clipped
              instead of reading. Figures, tables and code samples now use the
              full content column; paragraphs, lists and headings keep the
              measure. */}
          <article
            className={cn(
              "[&_h1]:max-w-(--container-prose)",
              "[&_h2]:max-w-(--container-prose) [&_h3]:max-w-(--container-prose)",
              "[&_p]:max-w-(--container-prose) [&_ul]:max-w-(--container-prose)",
              "[&_ol]:max-w-[calc(var(--container-prose)+2.75rem)]",
              "print:[&_*]:max-w-none",
            )}
          >
            <Text variant="eyebrow" tone="accent" className="mb-2 block">{page.section}</Text>
            <Text variant="display-md" tone="max" as="h1" className="block text-balance">
              {page.title}
            </Text>

            {/* `description` is the metadata and search summary; the body's own
                <Lead> is the on-page opener. Rendering both put the same
                sentence on screen twice. */}
            <Body />

            <WasThisHelpful slug={page.slug} />

            {/* Previous / next */}
            <nav aria-label="Page navigation" className="border-subtle mt-8 grid gap-3 border-t pt-6 sm:grid-cols-2 print:hidden">
              {previous ? (
                <Link
                  href={docsHref(previous.slug)}
                  className="border-subtle hover:bg-surface-hover rounded-md border p-3 outline-none transition-colors duration-fast focus-visible:focus-ring"
                >
                  <Text variant="caption" tone="muted" className="block">Previous</Text>
                  <Text variant="body-sm" tone="primary" className="block">{previous.title}</Text>
                </Link>
              ) : <span />}
              {nextPage ? (
                <Link
                  href={docsHref(nextPage.slug)}
                  className="border-subtle hover:bg-surface-hover rounded-md border p-3 text-right outline-none transition-colors duration-fast focus-visible:focus-ring"
                >
                  <Text variant="caption" tone="muted" className="block">Next</Text>
                  <Text variant="body-sm" tone="primary" className="block">{nextPage.title}</Text>
                </Link>
              ) : null}
            </nav>
          </article>
        </main>

        {/* ── On this page ────────────────────────────────────────────── */}
        <aside className="hidden xl:block print:hidden">
          {page.toc.length > 0 ? (
            <div className="sticky top-20">
              <Text variant="eyebrow" tone="muted" className="mb-2 block">On this page</Text>
              <ul className="border-subtle grid border-l">
                {page.toc.map((entry) => (
                  <TocLink key={entry.id} entry={entry} active={activeId === entry.id} />
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>

      <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function TocLink({ entry, active }: { entry: TocEntry; active: boolean }) {
  return (
    <li>
      <a
        href={`#${entry.id}`}
        className={cn(
          "font-ui text-caption -ml-px block border-l-2 py-1 pl-3",
          "transition-colors duration-fast outline-none focus-visible:focus-ring",
          entry.depth === 3 && "pl-6",
          active
            ? "border-accent text-fg-primary font-medium"
            : "border-transparent text-fg-muted hover:text-fg-primary",
        )}
      >
        {entry.title}
      </a>
    </li>
  );
}

export function docsHref(slug: string): Route {
  return docsPath(slug) as Route;
}

/* ── Search ───────────────────────────────────────────────────────────────── */

function DocsSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);

  React.useEffect(() => { if (!open) { setQuery(""); setActive(0); } }, [open]);

  /**
   * The index is built from the registry: page titles, descriptions and every
   * heading. Headings matter most — a reader searching "idempotency" wants the
   * section, not the page it happens to live on.
   */
  const entries = React.useMemo(
    () =>
      DOCS_PAGES.flatMap((p) => [
        { slug: p.slug, hash: "", title: p.title, context: p.description ?? p.section, kind: "page" as const },
        ...p.toc.map((t) => ({
          slug: p.slug, hash: `#${t.id}`, title: t.title, context: p.title, kind: "heading" as const,
        })),
      ]),
    [],
  );

  const results = React.useMemo(() => {
    if (!query.trim()) return entries.filter((e) => e.kind === "page").slice(0, 8).map((item) => ({ item, matches: [] as number[] }));
    return fuzzyRank(entries, query.trim(), (e) => `${e.title} ${e.context}`)
      .slice(0, 12)
      .map((r) => ({ item: r.item, matches: r.matches.filter((m) => m < r.item.title.length) }));
  }, [query, entries]);

  React.useEffect(() => { setActive(0); }, [query]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "motion-overlay z-modal fixed",
            "bg-surface-overlay border-subtle shadow-3 border",
            "inset-0 h-full w-full rounded-none",
            "sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-[12vh] sm:-translate-x-1/2",
            "sm:h-auto sm:w-[min(36rem,calc(100vw-2rem))] sm:rounded-lg",
            "flex flex-col overflow-hidden",
          )}
        >
          <VisuallyHidden.Root>
            <Dialog.Title>Search documentation</Dialog.Title>
          </VisuallyHidden.Root>

          <div className="border-subtle flex items-center gap-2 border-b px-3 py-2.5">
            <svg viewBox="0 0 16 16" className="text-fg-muted size-4 shrink-0" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
              <path d="m10.2 10.2 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the documentation…"
              aria-label="Search the documentation"
              data-no-shortcuts
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === "Enter") {
                  const hit = results[active];
                  if (hit) window.location.assign(`${docsHref(hit.item.slug)}${hit.item.hash}`);
                }
              }}
              // focus-visible:focus-ring is not optional decoration here. The
              // legacy `:focus-visible` in app/globals.css is an unscoped global
              // that paints the pre-revamp green ring on anything that does not
              // declare its own — success green indicating focus, which rule 11
              // forbids. Declaring ours wins from the utilities layer.
              className={cn(
                "font-ui text-body text-fg-primary placeholder:text-fg-muted",
                "min-w-0 flex-1 rounded-xs bg-transparent outline-none focus-visible:focus-ring",
              )}
            />
            <Kbd keys="esc" />
          </div>

          <div role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:max-h-96">
            {results.length === 0 ? (
              <p className="font-ui text-body-sm text-fg-muted px-3 py-8 text-center">
                Nothing matches “{query}”. Try a concept — checkpoint, lease, mapping, BYOK.
              </p>
            ) : (
              results.map((r, i) => {
                const runs = r.matches.length ? highlightRuns(r.item.title, r.matches) : [{ text: r.item.title, hit: false }];
                return (
                  <Link
                    key={`${r.item.slug}${r.item.hash}`}
                    href={`${docsHref(r.item.slug)}${r.item.hash}` as Route}
                    onClick={() => onOpenChange(false)}
                    onMouseMove={() => setActive(i)}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xs px-2 py-2",
                      "outline-none focus-visible:focus-ring",
                      i === active && "bg-surface-hover",
                    )}
                  >
                    <span className={cn(
                      "font-code text-[10px] rounded-xs border px-1 py-0.5 shrink-0",
                      r.item.kind === "page"
                        ? "border-accent-border text-accent"
                        : "border-subtle text-fg-muted",
                    )}>
                      {r.item.kind === "page" ? "page" : "§"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-ui text-body-sm text-fg-primary block truncate">
                        {runs.map((run, j) =>
                          run.hit
                            ? <mark key={j} className="bg-transparent text-accent font-semibold">{run.text}</mark>
                            : <React.Fragment key={j}>{run.text}</React.Fragment>,
                        )}
                      </span>
                      <span className="font-ui text-caption text-fg-muted block truncate">{r.item.context}</span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
