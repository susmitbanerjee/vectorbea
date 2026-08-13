"use client";

import * as React from "react";

/* ══════════════════════════════════════════════════════════════════════════════
   TABLE STATE — persisted per table, per user.

   Split from the table component because two different kinds of state live on a
   table and they must not be stored the same way:

   PREFERENCES (column widths, order, visibility, pinning, density) belong to the
   person. They persist to localStorage and are NOT in the URL — nobody wants to
   send a colleague a link that also re-orders their columns.

   VIEW (query, sort, selection, time range) belongs to the question being asked.
   That goes in the URL so it is shareable, which is the whole point of a saved
   view.
══════════════════════════════════════════════════════════════════════════════ */

export type Density = "comfortable" | "default" | "compact";

/** §8 lattice: 44 / 36 / 28. */
export const DENSITY_ROW_HEIGHT: Record<Density, number> = {
  comfortable: 44,
  default: 36,
  compact: 28,
};

export interface TablePreferences {
  density: Density;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  columnSizing: Record<string, number>;
  /** v9 pins logically (start/end), so this survives an RTL locale. */
  columnPinning: { start: string[]; end: string[] };
}

export const DEFAULT_PREFERENCES: TablePreferences = {
  density: "default",
  columnOrder: [],
  columnVisibility: {},
  columnSizing: {},
  columnPinning: { start: [], end: [] },
};

function storageKey(tableId: string): string {
  return `vectorbea-table:${tableId}`;
}

/**
 * Reads after mount, never during render.
 *
 * Reading localStorage in the initialiser makes the server and the first client
 * render disagree, which React reports as a hydration error and Next renders as
 * a full-page crash overlay in dev. The one-frame default is the cost of not
 * having that.
 */
export function useTablePreferences(
  tableId: string,
  overrides?: Partial<TablePreferences>,
): [TablePreferences, (next: Partial<TablePreferences>) => void] {
  const initial = React.useMemo(
    () => ({ ...DEFAULT_PREFERENCES, ...overrides }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [prefs, setPrefs] = React.useState<TablePreferences>(initial);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(tableId));
      if (raw) setPrefs((current) => ({ ...current, ...JSON.parse(raw) }));
    } catch {
      // A corrupt or blocked store is not worth failing the page over; the
      // defaults are a perfectly good table.
    }
  }, [tableId]);

  const update = React.useCallback(
    (next: Partial<TablePreferences>) => {
      setPrefs((current) => {
        const merged = { ...current, ...next };
        try {
          window.localStorage.setItem(storageKey(tableId), JSON.stringify(merged));
        } catch {}
        return merged;
      });
    },
    [tableId],
  );

  return [prefs, update];
}

/* ── Selection ────────────────────────────────────────────────────────────── */

export interface SelectionApi {
  selected: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string, index: number, shiftKey: boolean) => void;
  toggleAll: (ids: string[]) => void;
  clear: () => void;
  count: number;
}

/**
 * Selection with shift-range.
 *
 * Held outside TanStack's own rowSelection feature because the range anchor has
 * to survive filtering and virtualisation: the row at index 40 after a filter is
 * not the row that was at index 40 before it, so an index-based anchor alone
 * silently selects the wrong range. Anchoring on the id and resolving the range
 * against the CURRENT ordered list is the only version that behaves.
 */
export function useSelection(orderedIds: string[]): SelectionApi {
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const anchorRef = React.useRef<string | null>(null);

  const toggle = React.useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      setSelected((current) => {
        const next = new Set(current);

        if (shiftKey && anchorRef.current) {
          const anchorIndex = orderedIds.indexOf(anchorRef.current);
          if (anchorIndex !== -1) {
            const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
            // Shift-click extends, it never deselects — matching every file
            // manager anyone has used.
            for (let i = from; i <= to; i += 1) next.add(orderedIds[i]);
            return next;
          }
        }

        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchorRef.current = id;
        return next;
      });
    },
    [orderedIds],
  );

  const toggleAll = React.useCallback((ids: string[]) => {
    setSelected((current) => {
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      if (allSelected) {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      }
      return new Set([...current, ...ids]);
    });
  }, []);

  const clear = React.useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const isSelected = React.useCallback((id: string) => selected.has(id), [selected]);

  return { selected, isSelected, toggle, toggleAll, clear, count: selected.size };
}
