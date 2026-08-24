"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { overlaySurface, overlayMotion } from "~/components/ui/select";
import { fuzzyRank } from "~/lib/fuzzy";
import type { Workspace } from "~/mocks/shell";
import { PatternedInitial } from "./workspace-mark";

/**
 * <WorkspaceSwitcher> — the top of the sidebar.
 *
 * Search is present from the first keystroke because platform teams routinely
 * run a dozen workspaces; a switcher that only lists them is a scroll exercise.
 * Recents come first when the query is empty, since switching is overwhelmingly
 * a return to somewhere you just were.
 *
 * Fully keyboard operable: ↑/↓ move, Enter selects, Escape closes, and typing
 * filters without ever leaving the input.
 */
export interface WorkspaceSwitcherProps {
  workspace: Workspace;
  /**
   * Every workspace the user can reach, from the API.
   *
   * Passed in rather than imported. The switcher used to read the fixture list
   * directly, which is how "Acme Platform" appeared above real data on a real
   * workspace — the one place in the shell guaranteed to be seen on every
   * screen.
   */
  workspaces: Workspace[];
  onWorkspaceChange: (id: string) => void;
  collapsed?: boolean;
}

export function WorkspaceSwitcher({
  workspace, workspaces, onWorkspaceChange, collapsed = false,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const results = React.useMemo(() => {
    // No "Recent" group any more: recency was a fixture constant, and there is
    // no endpoint that records which workspaces this user visited last.
    const others = workspaces.filter((w) => w.id !== workspace.id);
    if (!query.trim()) {
      return others.length ? [{ label: "All workspaces", items: others }] : [];
    }
    const ranked = fuzzyRank(others, query, (w) => w.name).map((r) => r.item);
    return ranked.length ? [{ label: "Results", items: ranked }] : [];
  }, [query, workspace.id, workspaces]);

  const flat = React.useMemo(() => results.flatMap((g) => g.items), [results]);

  React.useEffect(() => { setActive(0); }, [query]);

  const commit = (id: string) => {
    onWorkspaceChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}
    >
      <PopoverPrimitive.Trigger
        className={cn(
          "group flex w-full items-center gap-2 rounded-sm p-1.5",
          "transition-colors duration-fast outline-none",
          "hover:bg-surface-hover focus-visible:focus-ring",
          collapsed && "justify-center",
        )}
        aria-label={`Workspace: ${workspace.name}. Switch workspace.`}
      >
        <PatternedInitial name={workspace.name} />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="font-ui text-body-sm text-fg-primary block truncate font-medium">
                {workspace.name}
              </span>
              <MemberCount count={workspace.members} />
            </span>
            <svg viewBox="0 0 16 16" className="text-fg-muted size-3.5 shrink-0" fill="none" aria-hidden="true">
              <path d="M5.5 6.5 8 4l2.5 2.5M5.5 9.5 8 12l2.5-2.5" stroke="currentColor" strokeWidth="1.4"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        )}
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
          className={cn(overlaySurface, overlayMotion, "z-popover w-72")}
        >
          <div className="border-subtle border-b p-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workspaces…"
              aria-label="Search workspaces"
              className={cn(
                "font-ui text-body-sm text-fg-primary placeholder:text-fg-muted",
                "w-full bg-transparent px-1.5 py-1 outline-none",
              )}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); const w = flat[active]; if (w) commit(w.id); }
              }}
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {results.length === 0 ? (
              <p className="font-ui text-caption text-fg-muted px-2 py-3">
                No workspace matches “{query}”. Try a shorter term.
              </p>
            ) : (
              results.map((group) => (
                <div key={group.label} className="mb-1 last:mb-0">
                  <p className="font-ui text-eyebrow text-fg-muted px-2 py-1 uppercase">{group.label}</p>
                  {group.items.map((w) => {
                    const index = flat.indexOf(w);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onMouseEnter={() => setActive(index)}
                        onClick={() => commit(w.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left",
                          "transition-colors duration-instant outline-none",
                          index === active && "bg-surface-hover",
                        )}
                      >
                        <PatternedInitial name={w.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="font-ui text-body-sm text-fg-primary block truncate">{w.name}</span>
                          <MemberCount count={w.members} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="border-subtle border-t p-1">
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-xs px-2 py-1.5",
                "font-ui text-body-sm text-fg-secondary",
                "transition-colors duration-instant outline-none",
                "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
              )}
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Create workspace
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * The headcount, or nothing.
 *
 * An unknown count renders no line at all rather than "0 members". The zero was
 * not a real reading — `/api/me` does not return a count, and `?? 0` turned the
 * absence into an assertion that the workspace was empty, which is exactly the
 * kind of number somebody trusts because it looks like every other number on
 * the screen.
 */
function MemberCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="font-ui text-caption text-fg-muted block">
      <span className="tabular">{count}</span> {count === 1 ? "member" : "members"}
    </span>
  );
}
