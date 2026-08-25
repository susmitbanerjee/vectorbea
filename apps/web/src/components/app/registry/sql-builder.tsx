"use client";

import * as React from "react";
import { ArrowClockwise, Warning, Table as TableIcon, Eye } from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Combobox } from "~/components/ui/combobox";
import { Checkbox } from "~/components/ui/choice";
import { Spinner } from "~/components/ui/spinner";
import { ModalNote, ModalSection } from "~/components/ui/modal";
import type { SchemaPreviewResult, SchemaTable, SchemaColumn } from "~/lib/api/client";

/* ══════════════════════════════════════════════════════════════════════════════
   BUILD THE STATEMENT WITHOUT WRITING ONE

   Registering a database tool used to mean typing SQL into a textarea and then
   hand-writing two JSON Schema documents to describe its parameters and its
   result. That asks the operator to know three things at once — the shape of a
   database they may not have designed, this product's placeholder convention,
   and JSON Schema — and it is the reason database tools were the ones people
   got wrong.

   Everything on this panel is DERIVED FROM THE DATABASE ITSELF. The connection
   is introspected (`information_schema` only, structure and never rows), and
   from the real tables and real columns the panel produces:

     - the SQL statement,
     - the ordered bind parameters,
     - the input schema, from the parameters,
     - the output schema, from the selected columns.

   PARAMETERS ARE BOUND, NEVER INTERPOLATED. Generated statements use `$1..$n`
   positional placeholders with an ordered `config.parameters` map, which is the
   path `ToolNodeExecutor` turns into real JDBC `setObject` binds (see
   `DbReadNodeExecutor`). The alternative the executor also supports — `{{ name }}`
   — is textual substitution into the SQL string, and nothing generated here uses
   it. A value chosen from a dropdown can still contain an apostrophe.

   IDENTIFIERS ARE QUOTED, AND THEY ARE NOT USER TEXT. Schema, table and column
   names are always taken from the introspection result rather than typed, so the
   only free text that reaches the statement is a new table's name on CREATE
   TABLE — which is validated against a strict identifier pattern before it can
   be used.

   THE SQL IS SHOWN, NOT HIDDEN. The operator does not have to write it; they do
   have to be able to read what they are about to register.
══════════════════════════════════════════════════════════════════════════════ */

export type SqlOperation = "read" | "insert" | "update" | "delete" | "create_table";

const OPERATIONS: { value: SqlOperation; label: string; description: string; writes: boolean }[] = [
  { value: "read", label: "Read rows", description: "Select columns, optionally filtered.", writes: false },
  { value: "insert", label: "Insert a row", description: "Add one row, with values passed in.", writes: true },
  { value: "update", label: "Update rows", description: "Change chosen columns on matching rows.", writes: true },
  { value: "delete", label: "Delete rows", description: "Remove rows matching a filter.", writes: true },
  { value: "create_table", label: "Create a table", description: "Define a new table and its columns.", writes: true },
];

/** Comparisons offered on a filter. `IS NULL` takes no parameter. */
const OPERATORS: { value: FilterOp; label: string; takesValue: boolean }[] = [
  { value: "eq", label: "equals", takesValue: true },
  { value: "neq", label: "is not", takesValue: true },
  { value: "gt", label: "is greater than", takesValue: true },
  { value: "gte", label: "is at least", takesValue: true },
  { value: "lt", label: "is less than", takesValue: true },
  { value: "lte", label: "is at most", takesValue: true },
  { value: "like", label: "contains", takesValue: true },
  { value: "in", label: "is any of", takesValue: true },
  { value: "is_null", label: "is empty", takesValue: false },
  { value: "not_null", label: "is not empty", takesValue: false },
];

export type FilterOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "is_null" | "not_null";

export interface Filter {
  id: string;
  column: string;
  op: FilterOp;
}

export interface NewColumn {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

/** Types offered when defining a new table. Postgres spellings. */
const NEW_COLUMN_TYPES = [
  "uuid", "text", "varchar(255)", "integer", "bigint", "numeric(12,2)",
  "boolean", "date", "timestamptz", "jsonb",
];

export interface SqlBuilderValue {
  operation: SqlOperation;
  table: string | null;          // "schema.table"
  columns: string[];             // read: projected · insert/update: written
  filters: Filter[];
  limit: string;
  newTableName: string;
  newColumns: NewColumn[];
}

export const EMPTY_BUILDER: SqlBuilderValue = {
  operation: "read",
  table: null,
  columns: [],
  filters: [],
  limit: "100",
  newTableName: "",
  newColumns: [
    { id: "c0", name: "id", type: "uuid", nullable: false, primaryKey: true },
  ],
};

/* ── Generation ─────────────────────────────────────────────────────────────
   Pure, and exported so it can be tested without rendering anything. */

export interface GeneratedSql {
  sql: string;
  /** Ordered — the key order IS the `$1..$n` order. */
  parameters: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  writes: boolean;
  /** Why nothing could be generated yet, in the operator's terms. */
  problem: string | null;
}

/** Postgres identifier quoting. Doubling `"` is the escape. */
function quoteIdent(raw: string): string {
  return `"${raw.replace(/"/g, '""')}"`;
}

function quoteQualified(qualified: string): string {
  return qualified.split(".").map(quoteIdent).join(".");
}

/** A parameter name safe to use as a JSON Schema property and an input binding. */
function paramName(column: string, suffix?: string): string {
  const base = column.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "value";
  return suffix ? `${base}_${suffix}` : base;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** JSON Schema type for a Postgres type, for the generated input schema. */
function jsonTypeFor(dataType: string): string {
  const t = dataType.toLowerCase();
  if (/int|serial/.test(t)) return "integer";
  if (/numeric|decimal|real|double|float/.test(t)) return "number";
  if (/bool/.test(t)) return "boolean";
  if (/json/.test(t)) return "object";
  return "string";
}

export function generateSql(
  value: SqlBuilderValue,
  table: SchemaTable | null,
): GeneratedSql {
  const empty: GeneratedSql = {
    sql: "", parameters: [], inputSchema: {}, outputSchema: {}, writes: false, problem: null,
  };

  const spec = OPERATIONS.find((o) => o.value === value.operation)!;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const parameters: string[] = [];

  const columnByName = new Map((table?.columns ?? []).map((c) => [c.name, c]));

  /** Register a bind parameter and its input-schema property. */
  const bind = (column: string, suffix: string | undefined, description: string): string => {
    const name = paramName(column, suffix);
    const col = columnByName.get(column);
    properties[name] = {
      type: col ? jsonTypeFor(col.dataType) : "string",
      description,
    };
    required.push(name);
    parameters.push(name);
    return `$${parameters.length}`;
  };

  /* ── CREATE TABLE ─────────────────────────────────────────────────────── */
  if (value.operation === "create_table") {
    const name = value.newTableName.trim();
    if (!name) return { ...empty, writes: true, problem: "Name the table you want to create." };
    if (!IDENTIFIER.test(name)) {
      return {
        ...empty,
        writes: true,
        problem: "A table name must start with a letter or underscore and contain only letters, numbers and underscores.",
      };
    }
    const defined = value.newColumns.filter((c) => c.name.trim());
    if (defined.length === 0) return { ...empty, writes: true, problem: "Add at least one column." };
    const bad = defined.find((c) => !IDENTIFIER.test(c.name.trim()));
    if (bad) {
      return { ...empty, writes: true, problem: `"${bad.name.trim()}" is not a valid column name.` };
    }
    const duplicate = defined.find(
      (c, i) => defined.findIndex((o) => o.name.trim().toLowerCase() === c.name.trim().toLowerCase()) !== i,
    );
    if (duplicate) {
      return { ...empty, writes: true, problem: `The column "${duplicate.name.trim()}" is defined twice.` };
    }

    const keys = defined.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name.trim()));
    const lines = defined.map((c) => {
      const parts = [quoteIdent(c.name.trim()), c.type];
      if (!c.nullable) parts.push("NOT NULL");
      return `  ${parts.join(" ")}`;
    });
    if (keys.length > 0) lines.push(`  PRIMARY KEY (${keys.join(", ")})`);

    const schema = value.table ? value.table.split(".")[0] : "public";
    return {
      sql: `CREATE TABLE IF NOT EXISTS ${quoteIdent(schema)}.${quoteIdent(name)} (\n${lines.join(",\n")}\n)`,
      parameters: [],
      inputSchema: { type: "object", properties: {}, required: [] },
      outputSchema: { type: "object", properties: {}, description: "No rows are returned." },
      writes: true,
      problem: null,
    };
  }

  /* Every other operation needs a table. */
  if (!value.table || !table) {
    return { ...empty, writes: spec.writes, problem: "Choose the table this tool works with." };
  }
  const target = quoteQualified(value.table);

  /** Shared WHERE construction. */
  const whereClause = (): { text: string; problem: string | null } => {
    const usable = value.filters.filter((f) => f.column);
    if (usable.length === 0) return { text: "", problem: null };
    const parts = usable.map((f) => {
      const col = quoteIdent(f.column);
      switch (f.op) {
        case "is_null": return `${col} IS NULL`;
        case "not_null": return `${col} IS NOT NULL`;
        case "like": return `${col} ILIKE '%' || ${bind(f.column, undefined, `Matches ${f.column}`)} || '%'`;
        case "in": return `${col} = ANY(${bind(f.column, "list", `Values of ${f.column} to match`)})`;
        default: {
          const symbol = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op];
          return `${col} ${symbol} ${bind(f.column, undefined, `Filters on ${f.column}`)}`;
        }
      }
    });
    return { text: ` WHERE ${parts.join(" AND ")}`, problem: null };
  };

  /* ── READ ─────────────────────────────────────────────────────────────── */
  if (value.operation === "read") {
    const projected = value.columns.length > 0 ? value.columns : [];
    if (projected.length === 0) {
      return { ...empty, problem: "Choose at least one field to read." };
    }
    const where = whereClause();
    const limit = Number(value.limit);
    const limitValid = Number.isInteger(limit) && limit > 0;

    const outProps: Record<string, unknown> = {};
    for (const name of projected) {
      const col = columnByName.get(name);
      outProps[name] = { type: col ? jsonTypeFor(col.dataType) : "string" };
    }

    return {
      sql:
        `SELECT ${projected.map(quoteIdent).join(", ")}\n`
        + `FROM ${target}${where.text}`
        + (limitValid ? `\nLIMIT ${limit}` : ""),
      parameters,
      inputSchema: { type: "object", properties, required },
      outputSchema: {
        type: "object",
        properties: {
          rows: { type: "array", items: { type: "object", properties: outProps } },
        },
      },
      writes: false,
      problem: limitValid || !value.limit.trim()
        ? null
        : "The row limit must be a whole number above zero.",
    };
  }

  /* ── INSERT ───────────────────────────────────────────────────────────── */
  if (value.operation === "insert") {
    const written = value.columns;
    if (written.length === 0) {
      return { ...empty, writes: true, problem: "Choose which fields this tool sets." };
    }
    const placeholders = written.map((c) => bind(c, undefined, `Value for ${c}`));
    const returning = (table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name));
    return {
      sql:
        `INSERT INTO ${target} (${written.map(quoteIdent).join(", ")})\n`
        + `VALUES (${placeholders.join(", ")})`
        + (returning.length > 0 ? `\nRETURNING ${returning.map(quoteIdent).join(", ")}` : ""),
      parameters,
      inputSchema: { type: "object", properties, required },
      outputSchema: {
        type: "object",
        properties: Object.fromEntries(
          returning.map((name) => [name, { type: jsonTypeFor(columnByName.get(name)?.dataType ?? "text") }]),
        ),
      },
      writes: true,
      problem: null,
    };
  }

  /* ── UPDATE ───────────────────────────────────────────────────────────── */
  if (value.operation === "update") {
    const written = value.columns;
    if (written.length === 0) {
      return { ...empty, writes: true, problem: "Choose which fields this tool updates." };
    }
    // SET binds first so `$1..$n` follow the order the clauses appear in.
    const sets = written.map((c) => `${quoteIdent(c)} = ${bind(c, undefined, `New value for ${c}`)}`);
    const where = whereClause();
    if (!where.text) {
      return {
        ...empty,
        writes: true,
        problem: "Add a filter. Without one this updates every row in the table.",
      };
    }
    return {
      sql: `UPDATE ${target}\nSET ${sets.join(", ")}${where.text}`,
      parameters,
      inputSchema: { type: "object", properties, required },
      outputSchema: { type: "object", properties: { rowsAffected: { type: "integer" } } },
      writes: true,
      problem: null,
    };
  }

  /* ── DELETE ───────────────────────────────────────────────────────────── */
  const where = whereClause();
  if (!where.text) {
    return {
      ...empty,
      writes: true,
      problem: "Add a filter. Without one this deletes every row in the table.",
    };
  }
  return {
    sql: `DELETE FROM ${target}${where.text}`,
    parameters,
    inputSchema: { type: "object", properties, required },
    outputSchema: { type: "object", properties: { rowsAffected: { type: "integer" } } },
    writes: true,
    problem: null,
  };
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

export interface SqlBuilderProps {
  value: SqlBuilderValue;
  onChange: (next: SqlBuilderValue) => void;
  schema: SchemaPreviewResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** False when no database connection has been chosen yet. */
  hasConnection: boolean;
  generated: GeneratedSql;
}

export function SqlBuilder({
  value, onChange, schema, loading, error, onRetry, hasConnection, generated,
}: SqlBuilderProps) {
  const set = <K extends keyof SqlBuilderValue>(key: K, next: SqlBuilderValue[K]) =>
    onChange({ ...value, [key]: next });

  // A fresh `[]` every render would re-run every memo that depends on it.
  const tables = React.useMemo(() => schema?.tables ?? [], [schema]);
  const selected = React.useMemo(
    () => tables.find((t) => `${t.schema}.${t.table}` === value.table) ?? null,
    [tables, value.table],
  );

  const isCreate = value.operation === "create_table";
  const needsColumns = value.operation === "read" || value.operation === "insert" || value.operation === "update";
  const needsFilters = value.operation === "read" || value.operation === "update" || value.operation === "delete";

  /* Writing to a view fails at execution time with a message from the database
     rather than from us, so it is refused where the choice is made. */
  const viewWarning = selected?.tableType === "VIEW" && value.operation !== "read";

  return (
    <>
      <ModalSection
        title="What should this tool do?"
        description="The statement, its parameters and both schemas are generated from your database. You do not write SQL."
      >
        <Select
          options={OPERATIONS.map((o) => ({ value: o.value, label: o.label, description: o.description }))}
          value={value.operation}
          onValueChange={(next) => {
            // Column selections mean something different per operation, so they
            // do not survive the switch — carrying them over silently produced
            // an UPDATE that set the primary key.
            onChange({ ...value, operation: next as SqlOperation, columns: [], filters: [] });
          }}
          aria-label="Operation"
        />
      </ModalSection>

      {!hasConnection ? (
        <ModalNote tone="info" title="Choose a connection first">
          The tables offered here are read from the database this tool runs against. Pick the
          connection on the previous step and they will appear.
        </ModalNote>
      ) : loading ? (
        <div className="border-subtle bg-surface-sunken flex items-center gap-2 rounded-sm border p-3">
          <Spinner className="size-4" />
          <Text variant="body-sm" tone="secondary">Reading the database structure…</Text>
        </div>
      ) : error ? (
        <ModalNote tone="danger" title="The database structure could not be read">
          <div className="grid gap-2">
            <span>{error}</span>
            <div>
              <Button size="xs" variant="secondary" onClick={onRetry} iconLeft={<Icon icon={ArrowClockwise} decorative />}>
                Try again
              </Button>
            </div>
          </div>
        </ModalNote>
      ) : tables.length === 0 ? (
        <ModalNote tone="warning" title="No tables were found">
          The connection works, but this database has no tables the credential can see. Create a
          table below, or grant the connection&rsquo;s role access to the schema you meant.
        </ModalNote>
      ) : null}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {hasConnection && !loading && !error && tables.length > 0 ? (
        <ModalSection
          title={isCreate ? "Where should it be created?" : "Which table?"}
          description={
            isCreate
              ? "The new table is created in this table's schema."
              : `${tables.length} table${tables.length === 1 ? "" : "s"} found in ${schema?.databaseName ?? "this database"}.`
          }
        >
          <Combobox
            options={tables.map((t) => ({
              value: `${t.schema}.${t.table}`,
              label: `${t.schema}.${t.table}`,
              description: `${t.tableType === "VIEW" ? "View" : "Table"} · ${t.columns.length} column${t.columns.length === 1 ? "" : "s"}${
                t.rowCountEstimate != null ? ` · ~${t.rowCountEstimate.toLocaleString()} rows` : ""
              }`,
            }))}
            value={value.table}
            onValueChange={(next) => onChange({ ...value, table: next, columns: [], filters: [] })}
            placeholder="Search tables…"
            emptyMessage="No table matches that name."
          />
          {viewWarning ? (
            <ModalNote tone="danger" title="A view cannot be written to">
              {selected?.schema}.{selected?.table} is a view. Choose the underlying table, or switch
              the operation back to Read.
            </ModalNote>
          ) : null}
        </ModalSection>
      ) : null}

      {/* ── Columns ───────────────────────────────────────────────────────── */}
      {selected && needsColumns ? (
        <ModalSection
          title={
            value.operation === "read" ? "Which fields should it return?"
              : value.operation === "insert" ? "Which fields does it set?"
                : "Which fields does it update?"
          }
          description={
            value.operation === "read"
              ? "Each becomes a property on the tool's output."
              : "Each becomes a parameter an agent must supply."
          }
        >
          <ColumnChecklist
            columns={selected.columns}
            value={value.columns}
            onChange={(next) => set("columns", next)}
            operation={value.operation}
          />
        </ModalSection>
      ) : null}

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      {selected && needsFilters ? (
        <ModalSection
          title={value.operation === "read" ? "Narrow the rows (optional)" : "Which rows?"}
          description={
            value.operation === "read"
              ? "Each filter becomes a parameter. With none, the statement reads up to the row limit."
              : "Each filter becomes a parameter. At least one is required so the statement cannot touch every row."
          }
        >
          <FilterList
            columns={selected.columns}
            filters={value.filters}
            onChange={(next) => set("filters", next)}
            suggestPrimaryKey={value.operation !== "read"}
          />
        </ModalSection>
      ) : null}

      {/* ── Limit ─────────────────────────────────────────────────────────── */}
      {selected && value.operation === "read" ? (
        <ModalSection title="Row limit" description="Caps what one call can pull back.">
          <Field label="Maximum rows">
            <Input
              value={value.limit}
              onChange={(e) => set("limit", e.target.value)}
              inputMode="numeric"
              className="max-w-[10rem]"
            />
          </Field>
        </ModalSection>
      ) : null}

      {/* ── New table ─────────────────────────────────────────────────────── */}
      {isCreate ? (
        <NewTableEditor
          name={value.newTableName}
          columns={value.newColumns}
          onNameChange={(next) => set("newTableName", next)}
          onColumnsChange={(next) => set("newColumns", next)}
        />
      ) : null}

      {/* ── The statement ─────────────────────────────────────────────────── */}
      <ModalSection
        title="The statement this registers"
        description="Generated from your choices. Values are bound as parameters, never pasted into the SQL."
      >
        {generated.problem ? (
          <div className="border-subtle bg-surface-sunken flex items-start gap-2 rounded-sm border p-3">
            <Icon icon={Warning} className="text-status-waiting mt-px shrink-0" decorative />
            <Text variant="body-sm" tone="secondary">{generated.problem}</Text>
          </div>
        ) : (
          <>
            <pre
              className={cn(
                "border-subtle bg-surface-sunken overflow-x-auto rounded-sm border p-3",
                "font-code text-mono-sm text-fg-primary whitespace-pre",
              )}
            >
              {generated.sql}
            </pre>
            {generated.parameters.length > 0 ? (
              <Text variant="caption" tone="muted" className="mt-1.5 block">
                {generated.parameters.length} parameter
                {generated.parameters.length === 1 ? "" : "s"}:{" "}
                {generated.parameters.map((p, i) => `$${i + 1} ${p}`).join(" · ")}
              </Text>
            ) : (
              <Text variant="caption" tone="muted" className="mt-1.5 block">
                Takes no parameters.
              </Text>
            )}
          </>
        )}
      </ModalSection>
    </>
  );
}

/* ── Column checklist ───────────────────────────────────────────────────── */

function ColumnChecklist({
  columns, value, onChange, operation,
}: {
  columns: SchemaColumn[];
  value: string[];
  onChange: (next: string[]) => void;
  operation: SqlOperation;
}) {
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((c) => c !== name) : [...value, name]);

  /* Generated keys cannot be inserted or updated by hand — offering them
     produces a statement the database rejects. */
  const disabledFor = (col: SchemaColumn): string | null => {
    if (operation === "update" && col.isPrimaryKey) return "Primary key";
    if (operation === "insert" && col.isPrimaryKey && col.defaultValue) return "Generated";
    return null;
  };

  return (
    <div className="grid gap-px">
      <div className="mb-1 flex items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onChange(columns.filter((c) => !disabledFor(c)).map((c) => c.name))}
        >
          Select all
        </Button>
        <Button size="xs" variant="ghost" onClick={() => onChange([])} disabled={value.length === 0}>
          Clear
        </Button>
        <Text variant="caption" tone="muted" className="ml-auto">
          {value.length} of {columns.length} selected
        </Text>
      </div>

      <ul className="border-subtle divide-subtle max-h-64 divide-y overflow-y-auto rounded-sm border">
        {columns.map((col) => {
          const blocked = disabledFor(col);
          return (
            <li key={col.name} className="flex items-center gap-2 px-2 py-1.5">
              <Checkbox
                checked={value.includes(col.name)}
                onCheckedChange={() => toggle(col.name)}
                disabled={Boolean(blocked)}
                aria-label={col.name}
              />
              <span className="min-w-0 flex-1">
                <span className="font-code text-mono-sm text-fg-primary block truncate">
                  {col.name}
                </span>
                <span className="font-ui text-caption text-fg-muted block truncate">
                  {col.dataType}
                  {col.nullable ? "" : " · required"}
                  {col.defaultValue ? ` · default ${col.defaultValue}` : ""}
                </span>
              </span>
              {col.isPrimaryKey ? (
                <span className="font-ui border-subtle text-fg-muted rounded-xs border px-1 text-[9px] uppercase">
                  key
                </span>
              ) : null}
              {blocked ? (
                <Text variant="caption" tone="muted">{blocked}</Text>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Filters ────────────────────────────────────────────────────────────── */

let filterSeq = 0;

function FilterList({
  columns, filters, onChange, suggestPrimaryKey,
}: {
  columns: SchemaColumn[];
  filters: Filter[];
  onChange: (next: Filter[]) => void;
  suggestPrimaryKey: boolean;
}) {
  const primaryKey = columns.find((c) => c.isPrimaryKey);

  const add = (column?: string) =>
    onChange([
      ...filters,
      { id: `f${filterSeq++}`, column: column ?? columns[0]?.name ?? "", op: "eq" },
    ]);

  return (
    <div className="grid gap-1.5">
      {filters.map((filter) => {
        const spec = OPERATORS.find((o) => o.value === filter.op)!;
        return (
          <div key={filter.id} className="flex flex-wrap items-center gap-1.5">
            <Select
              options={columns.map((c) => ({ value: c.name, label: c.name, description: c.dataType }))}
              value={filter.column}
              onValueChange={(next) =>
                onChange(filters.map((f) => (f.id === filter.id ? { ...f, column: next } : f)))
              }
              size="sm"
              className="min-w-[10rem] flex-1"
              aria-label="Filter column"
            />
            <Select
              options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
              value={filter.op}
              onValueChange={(next) =>
                onChange(filters.map((f) => (f.id === filter.id ? { ...f, op: next as FilterOp } : f)))
              }
              size="sm"
              className="min-w-[9rem]"
              aria-label="Comparison"
            />
            <span className="font-ui text-caption text-fg-muted min-w-[6rem] flex-1">
              {spec.takesValue ? "value passed in at run time" : "no value needed"}
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onChange(filters.filter((f) => f.id !== filter.id))}
            >
              Remove
            </Button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="secondary" onClick={() => add()} disabled={columns.length === 0}>
          Add a filter
        </Button>
        {/* The primary key is the filter that makes a write touch exactly one
            row, so it is one click rather than three. */}
        {suggestPrimaryKey && primaryKey && !filters.some((f) => f.column === primaryKey.name) ? (
          <Button size="xs" variant="ghost" onClick={() => add(primaryKey.name)}>
            Filter by {primaryKey.name}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ── New table ──────────────────────────────────────────────────────────── */

let columnSeq = 100;

function NewTableEditor({
  name, columns, onNameChange, onColumnsChange,
}: {
  name: string;
  columns: NewColumn[];
  onNameChange: (next: string) => void;
  onColumnsChange: (next: NewColumn[]) => void;
}) {
  const patch = (id: string, next: Partial<NewColumn>) =>
    onColumnsChange(columns.map((c) => (c.id === id ? { ...c, ...next } : c)));

  return (
    <ModalSection
      title="The table to create"
      description="Names must start with a letter or underscore and contain only letters, numbers and underscores."
    >
      <Field label="Table name" required>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="customers"
          spellCheck={false}
        />
      </Field>

      <div className="mt-2 grid gap-1.5">
        {columns.map((col) => (
          <div key={col.id} className="flex flex-wrap items-center gap-1.5">
            <Input
              value={col.name}
              onChange={(e) => patch(col.id, { name: e.target.value })}
              placeholder="column_name"
              className="min-w-[9rem] flex-1"
              spellCheck={false}
              aria-label="Column name"
            />
            <Select
              options={NEW_COLUMN_TYPES.map((t) => ({ value: t, label: t }))}
              value={col.type}
              onValueChange={(next) => patch(col.id, { type: next })}
              size="sm"
              className="min-w-[9rem]"
              aria-label="Column type"
            />
            <Checkbox
              checked={col.primaryKey}
              onCheckedChange={(v) =>
                // A key column is necessarily present, so the two controls are
                // not independent and the UI should not pretend otherwise.
                patch(col.id, { primaryKey: v === true, nullable: v === true ? false : col.nullable })
              }
            >
              Key
            </Checkbox>
            <Checkbox
              checked={!col.nullable}
              disabled={col.primaryKey}
              onCheckedChange={(v) => patch(col.id, { nullable: v !== true })}
            >
              Required
            </Checkbox>
            <Button
              size="xs"
              variant="ghost"
              disabled={columns.length === 1}
              onClick={() => onColumnsChange(columns.filter((c) => c.id !== col.id))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="xs"
            variant="secondary"
            onClick={() =>
              onColumnsChange([
                ...columns,
                { id: `c${columnSeq++}`, name: "", type: "text", nullable: true, primaryKey: false },
              ])
            }
          >
            Add a column
          </Button>
        </div>
      </div>
    </ModalSection>
  );
}

/* ── Structure browser ──────────────────────────────────────────────────── */

/**
 * A read-only view of what was found, so the operator can confirm they are
 * pointed at the database they think they are before registering anything.
 */
export function SchemaBrowser({ schema }: { schema: SchemaPreviewResult }) {
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className="border-subtle divide-subtle divide-y rounded-sm border">
      {schema.tables.map((t) => {
        const key = `${t.schema}.${t.table}`;
        const expanded = open === key;
        return (
          <div key={key}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : key)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left",
                "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
              )}
              aria-expanded={expanded}
            >
              <Icon icon={t.tableType === "VIEW" ? Eye : TableIcon} className="text-fg-muted" decorative />
              <span className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 truncate">{key}</span>
              <Text variant="caption" tone="muted">{t.columns.length} cols</Text>
            </button>
            {expanded ? (
              <ul className="bg-surface-sunken grid gap-px px-2 pb-2">
                {t.columns.map((c) => (
                  <li key={c.name} className="flex items-center gap-2 py-0.5">
                    <span className="font-code text-mono-sm text-fg-secondary min-w-0 flex-1 truncate">
                      {c.name}
                    </span>
                    <Text variant="caption" tone="muted">{c.dataType}</Text>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
