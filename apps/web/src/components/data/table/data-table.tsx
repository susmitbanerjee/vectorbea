"use client";

import * as React from "react";
import {
  useTable,
  coreCellsFeature, coreColumnsFeature, coreHeadersFeature,
  coreRowModelsFeature, coreRowsFeature, coreTablesFeature,
  columnOrderingFeature, columnPinningFeature, columnSizingFeature,
  columnVisibilityFeature,
  type ColumnDef as TanstackColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { DENSITY_ROW_HEIGHT, type Density, type TablePreferences } from "./table-state";

/* ══════════════════════════════════════════════════════════════════════════════
   <DataTable> — P06 Part B.

   TanStack Table v9 owns the COLUMN model — ordering, visibility, sizing and
   pinning are resolved by `getVisibleLeafColumns()` rather than by three
   overlapping bits of local state. TanStack Virtual owns the rows.

   v9, not the v8 API. v9.1.2 is `latest` on npm, and its feature-plugin
   architecture is the reason to use it here: you opt into exactly the features
   the table needs, so a run list does not ship pagination, grouping, faceting
   and cell-spanning code it will never call.

   ROWS ARRIVE FILTERED AND SORTED. Both happen in the page, above this
   component, and neither goes through a TanStack row model. That is a real
   split, not an oversight:

   · Filtering is a predicate compiled from the query language. Re-expressing
     `since:24h cost:>0.01` as per-column filterFns would put a second copy of
     the parser inside the table.
   · Sorting is one comparator over an array we already own. The row models
     allocate a Row wrapper per data row on rebuild; at 10,000 rows that is
     10,000 allocations against a 100ms filter budget.

   This is the same shape as server-side filtering and sorting, which is how
   this page will work once P12 lands the real API — so the split is also the
   one that survives the switch.

   RENDERING is <div role="grid">, not <table>. A real <table> cannot have a
   virtualised body — you cannot absolutely position <tr> inside <tbody> without
   breaking the table layout algorithm, and the transform alternatives fight the
   sticky header. The ARIA grid roles carry the semantics the element names
   would have.
══════════════════════════════════════════════════════════════════════════════ */

/** Stable identity, so the table option never looks changed. */
const EMPTY_DATA: never[] = [];

const FEATURES = {
  coreCellsFeature, coreColumnsFeature, coreHeadersFeature,
  coreRowModelsFeature, coreRowsFeature, coreTablesFeature,
  columnOrderingFeature, columnPinningFeature, columnSizingFeature,
  columnVisibilityFeature,
};

export interface DataColumn<T extends RowData> {
  id: string;
  header: React.ReactNode;
  width: number;
  minWidth?: number;
  cell: (row: T, index: number) => React.ReactNode;
  /** Right-align with tabular figures — rule 7. */
  numeric?: boolean;
  /** Value the sorter compares. Omit to make the column unsortable. */
  sortValue?: (row: T) => string | number;
  /** Never hidden or reordered: selection and row actions. */
  locked?: boolean;
  /** Width of the skeleton bar, so loading matches the real content. */
  skeletonWidth?: number;
}

export type TableStatus = "ready" | "loading" | "empty" | "no-results" | "error";

export interface DataTableProps<T extends RowData> {
  rows: T[];
  columns: DataColumn<T>[];
  rowId: (row: T) => string;
  preferences: TablePreferences;
  onPreferencesChange: (next: Partial<TablePreferences>) => void;

  status?: TableStatus;
  renderState?: (status: Exclude<TableStatus, "ready">) => React.ReactNode;

  sort: { id: string; desc: boolean }[];
  onSortChange: (next: { id: string; desc: boolean }[]) => void;

  isSelected?: (id: string) => boolean;
  onToggleSelect?: (id: string, index: number, shiftKey: boolean) => void;
  onToggleSelectAll?: (ids: string[]) => void;

  onOpenRow?: (row: T, event: { metaKey: boolean; ctrlKey: boolean }) => void;
  onRetryRow?: (row: T) => void;
  onRowHover?: (row: T | null, element: HTMLElement | null) => void;

  height?: number;
  className?: string;
  label: string;
  /** Singular row noun for the footer count. `[singular, plural]`. */
  noun?: [string, string];
}

export function DataTable<T extends RowData>({
  rows, columns, rowId, preferences, onPreferencesChange,
  status = "ready", renderState,
  sort, onSortChange,
  isSelected, onToggleSelect, onToggleSelectAll,
  onOpenRow, onRetryRow, onRowHover,
  height = 620, className, label, noun = ["run", "runs"],
}: DataTableProps<T>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = React.useState(0);
  const rowHeight = DENSITY_ROW_HEIGHT[preferences.density];

  /* ── Column defs for TanStack ───────────────────────────────────────────── */
  const byId = React.useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  const tanstackColumns = React.useMemo<TanstackColumnDef<typeof FEATURES, T, unknown>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: column.sortValue
          ? (row: T) => column.sortValue!(row)
          : () => "",
        header: () => column.header,
        size: column.width,
        minSize: column.minWidth ?? 64,
        enableHiding: !column.locked,
      })) as TanstackColumnDef<typeof FEATURES, T, unknown>[],
    [columns],
  );

  const table = useTable<typeof FEATURES, T>({
    features: FEATURES,
    // Deliberately EMPTY. We consume the column model only — ordering,
    // visibility, sizing, pinning — and rows are rendered by the virtualiser
    // from `rows` directly. Handing 10,000 items to a table whose row model is
    // never read still costs a row-model construction per render: measured at
    // 33ms per scroll frame, which is exactly two missed vsyncs and the reason
    // this said 30fps.
    data: EMPTY_DATA as T[],
    columns: tanstackColumns,
    getRowId: (row: T) => rowId(row),
    state: {
      columnOrder: preferences.columnOrder,
      columnVisibility: preferences.columnVisibility,
      columnSizing: preferences.columnSizing,
      columnPinning: preferences.columnPinning,
    },
    onColumnOrderChange: (updater: unknown) => {
      const next = typeof updater === "function" ? updater(preferences.columnOrder) : updater;
      onPreferencesChange({ columnOrder: next });
    },
    onColumnVisibilityChange: (updater: unknown) => {
      const next =
        typeof updater === "function" ? updater(preferences.columnVisibility) : updater;
      onPreferencesChange({ columnVisibility: next });
    },
    onColumnSizingChange: (updater: unknown) => {
      const next = typeof updater === "function" ? updater(preferences.columnSizing) : updater;
      onPreferencesChange({ columnSizing: next });
    },
  });

  /* Visible, ordered leaf columns come from the table so ordering, pinning and
     visibility are resolved in one place rather than three.

     Keyed on the joined ids, NOT on the array. getVisibleLeafColumns() returns
     a fresh array every render, so depending on its identity invalidated this
     memo on every scroll frame — which made `visible`, `widths` and
     `gridTemplate` new objects, which made the memoised row's props new, which
     made the memo never hit. Measured cost of that one dependency: a 100ms
     median frame at 10,000 rows. */
  const visibleKey = table.getVisibleLeafColumns().map((c) => c.id).join(",");
  const visible = React.useMemo(
    () => visibleKey.split(",").map((id) => byId.get(id)).filter(Boolean) as DataColumn<T>[],
    [visibleKey, byId],
  );

  const widths = React.useMemo(
    () => visible.map((c) => preferences.columnSizing[c.id] ?? c.width),
    [visible, preferences.columnSizing],
  );
  const gridTemplate = widths.map((w) => `${w}px`).join(" ");
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);

  /* ── Virtualiser ────────────────────────────────────────────────────────── */
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    // 12 rows of headroom. Lower and a fast flick on a 120Hz display shows
    // blank bands; higher and we lay out rows nobody will see.
    overscan: 12,
    getItemKey: (index) => rowId(rows[index]),
  });

  // Density is a preference, so the measurement cache must be dropped when it
  // changes or every row keeps its previous height.
  React.useEffect(() => { virtualizer.measure(); }, [rowHeight, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const orderedIds = React.useMemo(() => rows.map(rowId), [rows, rowId]);

  /* ── Keyboard ───────────────────────────────────────────────────────────── */
  const moveCursor = React.useCallback(
    (delta: number) => {
      setCursor((current) => {
        const next = Math.min(rows.length - 1, Math.max(0, current + delta));
        virtualizer.scrollToIndex(next, { align: "auto" });
        return next;
      });
    },
    [rows.length, virtualizer],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const row = rows[cursor];
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); moveCursor(1); break;
      case "ArrowUp": event.preventDefault(); moveCursor(-1); break;
      case "PageDown": event.preventDefault(); moveCursor(10); break;
      case "PageUp": event.preventDefault(); moveCursor(-10); break;
      case "Home": event.preventDefault(); setCursor(0); virtualizer.scrollToIndex(0); break;
      case "End": event.preventDefault(); setCursor(rows.length - 1); virtualizer.scrollToIndex(rows.length - 1); break;
      case "Enter":
        if (row) { event.preventDefault(); onOpenRow?.(row, { metaKey: event.metaKey, ctrlKey: event.ctrlKey }); }
        break;
      case " ":
        if (row) { event.preventDefault(); onToggleSelect?.(rowId(row), cursor, event.shiftKey); }
        break;
      case "r":
        if (row && !event.metaKey && !event.ctrlKey) { event.preventDefault(); onRetryRow?.(row); }
        break;
    }
  };

  /* ── Column resize ──────────────────────────────────────────────────────── */
  const resizeRef = React.useRef<{ id: string; startX: number; startWidth: number } | null>(null);

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      const min = byId.get(drag.id)?.minWidth ?? 64;
      const next = Math.max(min, drag.startWidth + (e.clientX - drag.startX));
      onPreferencesChange({
        columnSizing: { ...preferences.columnSizing, [drag.id]: Math.round(next) },
      });
    };
    const onUp = () => { resizeRef.current = null; document.body.style.cursor = ""; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [byId, onPreferencesChange, preferences.columnSizing]);

  const toggleSort = (id: string, additive: boolean) => {
    const existing = sort.find((s) => s.id === id);
    const next = additive ? sort.filter((s) => s.id !== id) : [];
    if (!existing) next.push({ id, desc: false });
    else if (!existing.desc) next.push({ id, desc: true });
    // A third click clears it — how you undo a sort without having to remember
    // what the previous one was.
    onSortChange(next);
  };

  const allVisibleSelected =
    orderedIds.length > 0 && isSelected !== undefined && orderedIds.every((id) => isSelected(id));
  const showRows = status === "ready" && rows.length > 0;

  return (
    <div className={cn("border-subtle bg-surface-raised overflow-hidden rounded-lg border", className)}>
      <div
        ref={scrollRef}
        role="grid"
        aria-label={label}
        aria-rowcount={rows.length}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ height }}
        className={cn(
          "relative overflow-auto outline-none focus-visible:focus-ring",
          // Narrow and deliberate: `paint layout` is safe on a scroller.
          // `contain: strict` adds size containment, which collapses a
          // max-height scroll region to zero.
          "[contain:paint_layout]",
        )}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          role="row"
          className={cn(
            "bg-surface-sunken border-subtle sticky top-0 z-10 grid border-b",
            "text-fg-muted font-ui text-eyebrow uppercase",
          )}
          style={{ gridTemplateColumns: gridTemplate, minWidth: totalWidth }}
        >
          {visible.map((column, i) => {
            const active = sort.find((s) => s.id === column.id);
            const sortIndex = sort.findIndex((s) => s.id === column.id);
            return (
              <div
                key={column.id}
                role="columnheader"
                aria-sort={active ? (active.desc ? "descending" : "ascending") : undefined}
                className={cn("relative flex h-8 items-center gap-1 px-2", column.numeric && "justify-end")}
              >
                {column.id === "select" && onToggleSelectAll ? (
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() => onToggleSelectAll(orderedIds)}
                    aria-label={allVisibleSelected ? "Deselect all rows" : "Select all rows"}
                    className="accent-accent size-3.5 rounded-xs outline-none focus-visible:focus-ring"
                  />
                ) : column.sortValue ? (
                  <button
                    onClick={(e) => toggleSort(column.id, e.shiftKey)}
                    title="Click to sort. Shift-click to add a second sort."
                    className={cn(
                      "-mx-1 flex items-center gap-1 rounded-xs px-1 py-0.5",
                      "hover:text-fg-primary transition-colors duration-fast",
                      "outline-none focus-visible:focus-ring",
                      active && "text-fg-primary",
                    )}
                  >
                    <span className="truncate">{column.header}</span>
                    <SortGlyph state={active ? (active.desc ? "desc" : "asc") : null} />
                    {sort.length > 1 && sortIndex >= 0 ? (
                      <span className="font-code tabular text-[9px]">{sortIndex + 1}</span>
                    ) : null}
                  </button>
                ) : (
                  <span className="truncate">{column.header}</span>
                )}

                {i < visible.length - 1 ? (
                  <span
                    role="separator"
                    aria-label={`Resize ${column.id}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      resizeRef.current = { id: column.id, startX: e.clientX, startWidth: widths[i] };
                      document.body.style.cursor = "col-resize";
                    }}
                    className={cn(
                      "absolute right-0 top-0 h-full w-2 translate-x-1 cursor-col-resize",
                      "after:bg-fg-disabled after:absolute after:left-1/2 after:top-1.5 after:h-5 after:w-px",
                      "after:opacity-0 after:transition-opacity after:duration-fast hover:after:opacity-100",
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        {showRows ? (
          <div style={{ height: virtualizer.getTotalSize(), minWidth: totalWidth }} className="relative">
            {items.map((item) => (
              <TableRow
                key={item.key}
                row={rows[item.index]}
                index={item.index}
                size={item.size}
                start={item.start}
                columns={visible}
                gridTemplate={gridTemplate}
                selected={isSelected?.(rowId(rows[item.index])) ?? false}
                cursored={cursor === item.index}
                onOpen={onOpenRow}
                onHover={onRowHover}
                onCursor={setCursor}
              />
            ))}
          </div>
        ) : (
          <div className="grid place-items-center px-4 py-16" style={{ minHeight: height - 80 }}>
            {status === "ready" ? null : renderState?.(status)}
          </div>
        )}

        {status === "loading" ? (
          <SkeletonRows columns={visible} widths={widths} rowHeight={rowHeight} gridTemplate={gridTemplate} />
        ) : null}
      </div>

      <div className="border-subtle bg-surface-sunken flex items-center justify-between border-t px-3 py-1.5">
        <Text variant="caption" tone="muted">
          {status === "loading" ? "Loading…" : (
            <>
              <span className="tabular">{rows.length.toLocaleString("en-GB")}</span>{" "}
              {rows.length === 1 ? noun[0] : noun[1]}
            </>
          )}
        </Text>
        <DensityToggle
          value={preferences.density}
          onChange={(density) => onPreferencesChange({ density })}
        />
      </div>
    </div>
  );
}

/* ── Row ──────────────────────────────────────────────────────────────────── */

/**
 * Memoised, and that is the single reason this table holds its frame budget.
 *
 * The virtualiser produces a new `getVirtualItems()` array on every scroll
 * frame, which re-renders DataTable. Inline, that reconciled all ~30 visible
 * rows every frame — and each Runs row contains a Checkpoint Ribbon, which is
 * an SVG that recomputes a clip path per node. Measured at 10,000 rows that was
 * a 100ms median frame: 10fps.
 *
 * With the row memoised, a scroll frame reconciles only the rows that actually
 * entered or left the window — typically one or two. `columns` and the
 * callbacks are stable identities from the caller's useMemo/useCallback, so the
 * comparison holds.
 */
const TableRow = React.memo(function TableRow<T extends RowData>({
  row, index, size, start, columns, gridTemplate, selected, cursored,
  onOpen, onHover, onCursor,
}: {
  row: T;
  index: number;
  size: number;
  start: number;
  columns: DataColumn<T>[];
  gridTemplate: string;
  selected: boolean;
  cursored: boolean;
  onOpen?: (row: T, e: { metaKey: boolean; ctrlKey: boolean }) => void;
  onHover?: (row: T | null, el: HTMLElement | null) => void;
  onCursor: (index: number) => void;
}) {
  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      aria-selected={selected}
      data-cursor={cursored ? "" : undefined}
      onMouseEnter={(e) => onHover?.(row, e.currentTarget)}
      onMouseLeave={() => onHover?.(null, null)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-row-stop]")) return;
        onCursor(index);
        onOpen?.(row, { metaKey: e.metaKey, ctrlKey: e.ctrlKey });
      }}
      className={cn(
        "border-subtle absolute left-0 top-0 grid w-full cursor-pointer items-center border-b",
        "transition-colors duration-instant hover:bg-surface-hover",
        selected && "bg-surface-selected",
        "data-[cursor]:bg-surface-active",
      )}
      style={{
        gridTemplateColumns: gridTemplate,
        height: size,
        // Transform, not `top` — rule 9, and the only version that stays on the
        // compositor through a fast scroll.
        transform: `translateY(${start}px)`,
      }}
    >
      {columns.map((column) => (
        <div
          key={column.id}
          role="gridcell"
          className={cn("flex min-w-0 items-center px-2", column.numeric && "justify-end")}
        >
          {column.cell(row, index)}
        </div>
      ))}
    </div>
  );
}) as <T extends RowData>(props: {
  row: T; index: number; size: number; start: number;
  columns: DataColumn<T>[]; gridTemplate: string;
  selected: boolean; cursored: boolean;
  onOpen?: (row: T, e: { metaKey: boolean; ctrlKey: boolean }) => void;
  onHover?: (row: T | null, el: HTMLElement | null) => void;
  onCursor: (index: number) => void;
}) => React.ReactElement;

/* ── Loading ──────────────────────────────────────────────────────────────── */

function SkeletonRows<T extends RowData>({
  columns, widths, rowHeight, gridTemplate,
}: {
  columns: DataColumn<T>[];
  widths: number[];
  rowHeight: number;
  gridTemplate: string;
}) {
  return (
    <div aria-hidden="true" className="absolute inset-x-0 top-8">
      {Array.from({ length: 14 }, (_, r) => (
        <div
          key={r}
          className="border-subtle grid items-center border-b"
          style={{ gridTemplateColumns: gridTemplate, height: rowHeight }}
        >
          {columns.map((column, i) => (
            <div key={column.id} className="px-2">
              <span
                data-motion="decorative"
                className="bg-surface-active block h-2.5 rounded-xs motion-safe:animate-[ink-fade-in_1.4s_ease-in-out_infinite_alternate]"
                style={{ width: Math.min(widths[i] - 16, column.skeletonWidth ?? widths[i] * 0.6) }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────────── */

function SortGlyph({ state }: { state: "asc" | "desc" | null }) {
  return (
    <svg viewBox="0 0 8 10" aria-hidden="true" className="size-2 shrink-0">
      <path d="M4 0L7 4H1z" fill="currentColor" opacity={state === "asc" ? 1 : state === null ? 0.28 : 0.14} />
      <path d="M4 10L1 6h6z" fill="currentColor" opacity={state === "desc" ? 1 : state === null ? 0.28 : 0.14} />
    </svg>
  );
}

const DENSITIES: { id: Density; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "default", label: "Default" },
  { id: "compact", label: "Compact" },
];

function DensityToggle({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <div role="group" aria-label="Row density" className="flex items-center gap-0.5">
      {DENSITIES.map((d) => (
        <button
          key={d.id}
          onClick={() => onChange(d.id)}
          aria-pressed={value === d.id}
          title={d.label}
          className={cn(
            "rounded-xs px-1.5 py-1 outline-none focus-visible:focus-ring",
            "transition-colors duration-fast",
            value === d.id ? "bg-surface-active text-fg-primary" : "text-fg-disabled hover:text-fg-primary",
          )}
        >
          <DensityGlyph density={d.id} />
          <span className="sr-only">{d.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Three bars, three gaps — the control looks like what it does. */
function DensityGlyph({ density }: { density: Density }) {
  const gap = density === "comfortable" ? 3.4 : density === "default" ? 2.4 : 1.6;
  return (
    <svg viewBox="0 0 12 10" aria-hidden="true" className="size-3">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1} y={1.6 + i * gap} width={10} height={1.1} rx={0.4} fill="currentColor" />
      ))}
    </svg>
  );
}
