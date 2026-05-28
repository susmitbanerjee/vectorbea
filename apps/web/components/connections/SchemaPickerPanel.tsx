"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Key,
  Loader2,
  Table2,
  AlertCircle,
  CheckSquare,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SchemaPreviewResult, SchemaTable, SchemaColumn } from "@/lib/repository/connections";
import { previewDatabaseSchema, previewSavedConnectionSchema } from "@/lib/repository/connections";

interface Props {
  /** ID of a saved connection — when provided, secrets are resolved server-side */
  connectionId?: string;
  /** Connection string to preview (sent over TLS, never stored by this component) */
  plaintextSecret?: string;
  dbType?: string;
  username?: string;
  host?: string;
  port?: number;
  database?: string;
  /** Called when the user confirms their table/column selections */
  onSelect?: (selection: SchemaSelection) => void;
}

export interface SchemaSelection {
  schema: string;
  table: string;
  tableType: "TABLE" | "VIEW";
  columns: SchemaColumn[];
  allowedSchemas: string[];
  allowedTables: string[];
}

export function SchemaPickerPanel({
  connectionId,
  plaintextSecret,
  dbType,
  username,
  host,
  port,
  database,
  onSelect,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SchemaPreviewResult | null>(null);

  // Drill-down state
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set());
  const [openTables, setOpenTables] = useState<Set<string>>(new Set());

  // Selection state
  const [selectedTable, setSelectedTable] = useState<SchemaTable | null>(null);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());

  async function handleFetch() {
    if (!connectionId && !plaintextSecret && !host) {
      setError("Select a connection or enter connection details first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedTable(null);
    setSelectedCols(new Set());
    try {
      const data = connectionId
        ? await previewSavedConnectionSchema(connectionId)
        : await previewDatabaseSchema({
            dbType: dbType ?? "",
            plaintextSecret: plaintextSecret || undefined,
            username: username || undefined,
            host: host || undefined,
            port: port || undefined,
            database: database || undefined,
          });
      setResult(data);
      // Auto-expand first schema
      if (data.schemas.length > 0) {
        setOpenSchemas(new Set([data.schemas[0]]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect to database");
    } finally {
      setLoading(false);
    }
  }

  function toggleSchema(schema: string) {
    setOpenSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema); else next.add(schema);
      return next;
    });
  }

  function toggleTable(key: string) {
    setOpenTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectTable(table: SchemaTable) {
    setSelectedTable(table);
    setSelectedCols(new Set(table.columns.map((c) => c.name)));
  }

  function toggleCol(col: string) {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  }

  function handleConfirm() {
    if (!selectedTable || !result) return;
    const cols = selectedTable.columns.filter((c) => selectedCols.has(c.name));
    onSelect?.({
      schema: selectedTable.schema,
      table: selectedTable.table,
      tableType: selectedTable.tableType,
      columns: cols,
      allowedSchemas: result.schemas,
      allowedTables: result.tables.map((t) => `${t.schema}.${t.table}`),
    });
  }

  const tablesBySchema = result
    ? result.tables.reduce<Record<string, SchemaTable[]>>((acc, t) => {
        (acc[t.schema] ??= []).push(t);
        return acc;
      }, {})
    : {};

  return (
    <div className="rounded-xl border border-border/30 bg-muted/20 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary/70" />
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Explore Schema
          </span>
          {result && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {result.tables.length} tables
            </span>
          )}
        </div>
        <button
          onClick={handleFetch}
          disabled={loading}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all",
            "bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {loading ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Connecting…</>
          ) : result ? (
            <><Database className="h-3 w-3" /> Refresh</>
          ) : (
            <><Database className="h-3 w-3" /> Connect & Browse</>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Schema tree */}
      {result && (
        <div className="flex gap-3" style={{ minHeight: 220 }}>
          {/* Left: schema/table tree */}
          <div className="w-56 shrink-0 overflow-y-auto rounded-lg border border-border/30 bg-background">
            {result.schemas.length === 0 ? (
              <p className="p-3 text-[11px] text-muted-foreground">No accessible schemas found.</p>
            ) : (
              result.schemas.map((schema) => (
                <div key={schema}>
                  {/* Schema row */}
                  <button
                    onClick={() => toggleSchema(schema)}
                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-muted/40 transition-colors"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {openSchemas.has(schema)
                      ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    }
                    <Database className="h-3 w-3 shrink-0 text-blue-500" />
                    <span className="truncate">{schema}</span>
                    <span className="ml-auto text-[9px] text-muted-foreground/60">
                      {tablesBySchema[schema]?.length ?? 0}
                    </span>
                  </button>

                  {/* Tables under this schema */}
                  {openSchemas.has(schema) && (tablesBySchema[schema] ?? []).map((t) => {
                    const key = `${t.schema}.${t.table}`;
                    const isSelected = selectedTable?.schema === t.schema && selectedTable?.table === t.table;
                    return (
                      <div key={key}>
                        <button
                          onClick={() => { toggleTable(key); selectTable(t); }}
                          className={cn(
                            "flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-[11px] transition-colors",
                            isSelected
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted/40 text-muted-foreground",
                          )}
                        >
                          {openTables.has(key)
                            ? <ChevronDown className="h-3 w-3 shrink-0" />
                            : <ChevronRight className="h-3 w-3 shrink-0" />
                          }
                          {t.tableType === "VIEW"
                            ? <Eye className="h-3 w-3 shrink-0 text-purple-400" />
                            : <Table2 className="h-3 w-3 shrink-0 text-green-500" />
                          }
                          <span className="truncate">{t.table}</span>
                          {t.rowCountEstimate !== null && (
                            <span className="ml-auto text-[9px] text-muted-foreground/50 shrink-0">
                              ~{t.rowCountEstimate.toLocaleString()}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Right: column picker */}
          <div className="flex-1 min-w-0 overflow-y-auto rounded-lg border border-border/30 bg-background">
            {!selectedTable ? (
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground/50 p-6 text-center">
                Select a table on the left to see its columns
              </div>
            ) : (
              <div>
                {/* Table header */}
                <div className="sticky top-0 flex items-center justify-between border-b border-border/20 bg-muted/30 px-3 py-2">
                  <div>
                    <p className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
                      {selectedTable.schema}.{selectedTable.table}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {selectedTable.columns.length} columns · {selectedTable.tableType}
                      {selectedTable.rowCountEstimate !== null && ` · ~${selectedTable.rowCountEstimate.toLocaleString()} rows`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedCols(new Set(selectedTable.columns.map((c) => c.name)))}
                      className="text-[10px] text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-muted-foreground/30">·</span>
                    <button
                      onClick={() => setSelectedCols(new Set())}
                      className="text-[10px] text-muted-foreground hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>

                {/* Column rows */}
                <div className="divide-y divide-border/10">
                  {selectedTable.columns.map((col) => {
                    const checked = selectedCols.has(col.name);
                    return (
                      <button
                        key={col.name}
                        onClick={() => toggleCol(col.name)}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                          checked ? "bg-primary/5" : "hover:bg-muted/30",
                        )}
                      >
                        {checked
                          ? <CheckSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                          : <Square className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              "text-[11px] font-medium truncate",
                              checked ? "text-primary" : "text-muted-foreground",
                            )}>
                              {col.name}
                            </span>
                            {col.isPrimaryKey && (
                              <span title="Primary key">
                                <Key className="h-2.5 w-2.5 shrink-0 text-amber-500" />
                              </span>
                            )}
                            {!col.nullable && (
                              <span className="text-[9px] text-red-400/70 font-medium">required</span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground/50 shrink-0 font-mono">
                          {col.dataType}{col.maxLength ? `(${col.maxLength})` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm selection */}
      {selectedTable && selectedCols.size > 0 && onSelect && (
        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[11px] text-primary">
            <span className="font-semibold">{selectedCols.size}</span> columns selected from{" "}
            <span className="font-semibold">{selectedTable.schema}.{selectedTable.table}</span>
          </p>
          <button
            onClick={handleConfirm}
            className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Use this table →
          </button>
        </div>
      )}
    </div>
  );
}
