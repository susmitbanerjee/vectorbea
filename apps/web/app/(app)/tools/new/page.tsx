"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Save, TestTube } from "lucide-react";
import { toast } from "sonner";

import type { RiskLevel, ToolType, RetryPolicy } from "@/types/platform";
import type { Connection } from "@/types/connections";
import { CONNECTION_TOOL_COMPAT } from "@/types/connections";
import { createTool, getCompatibleConnectionsForTool } from "@/lib/repository";
import { SchemaPickerPanel, type SchemaSelection } from "@/components/connections/SchemaPickerPanel";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOL_TYPES: { type: ToolType; label: string }[] = [
  { type: "http",            label: "HTTP" },
  { type: "mcp_tool",        label: "MCP" },
  { type: "database_read",   label: "Database (Read)" },
  { type: "database_write",  label: "Database (Write)" },
  { type: "email",           label: "Email" },
  { type: "crm",             label: "CRM" },
  { type: "custom_function", label: "Custom Function" },
];

const RISK_LEVELS: { level: RiskLevel; label: string; description: string; color: string }[] = [
  { level: "low",      label: "Low",      description: "Never modifies state. Safe to retry freely.",           color: "#059669" },
  { level: "medium",   label: "Medium",   description: "Writes that are easy to undo or idempotent.",           color: "#D97706" },
  { level: "high",     label: "High",     description: "Modifies important data. Requires care on retry.",      color: "#EA580C" },
  { level: "critical", label: "Critical", description: "Cannot be undone. Payments, sends, deletions.",         color: "#DC2626" },
];

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">
      {label}
    </p>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-medium text-[#374151]">
        {label}{required && <span className="ml-0.5 text-[#DC2626]">*</span>}
      </label>
      {children}
    </div>
  );
}

import { inputCls, selectCls, selectCompactCls } from "@/lib/ui/field-styles";
const monoCls = `${inputCls} h-auto py-2 font-mono text-[12px]`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewToolPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [compatibleConnections, setCompatibleConnections] = useState<Connection[]>([]);

  // Basic info
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ToolType>("http");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");
  const [connectionId, setConnectionId] = useState<string>("");

  // HTTP config
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [bodyTemplate, setBodyTemplate] = useState("");

  // DB config (database_read / database_write)
  const [sqlTemplate, setSqlTemplate] = useState("");
  const [dbMaxRows, setDbMaxRows] = useState("100");
  const [dbRequireApproval, setDbRequireApproval] = useState(false);
  const [schemaSelection, setSchemaSelection] = useState<SchemaSelection | null>(null);

  // Schema
  const [inputSchema, setInputSchema] = useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [outputSchema, setOutputSchema] = useState('{\n  "type": "object",\n  "properties": {}\n}');

  // Options
  const [timeout, setTimeout_] = useState("10000");
  const [idempotent, setIdempotent] = useState(true);

  // Retry policy
  const [retryAttempts, setRetryAttempts] = useState("3");
  const [retryBackoff, setRetryBackoff] = useState<RetryPolicy["backoffType"]>("exponential");
  const [retryBackoffMs, setRetryBackoffMs] = useState("1000");

  function handleSchemaSelect(sel: SchemaSelection) {
    setSchemaSelection(sel);
    const cols = sel.columns.map((c) => c.name);
    if (type === "database_read") {
      const colList = cols.join(", ");
      setSqlTemplate(`SELECT ${colList}\nFROM ${sel.schema}.${sel.table}\nWHERE {{filter}}\nLIMIT {{limit}}`);
      const properties: Record<string, unknown> = {
        filter: { type: "string", description: "SQL WHERE clause condition, e.g. status = 'active'" },
        limit:  { type: "integer", default: 50, description: "Max rows to return" },
      };
      setInputSchema(JSON.stringify({ type: "object", properties }, null, 2));
      const outProps: Record<string, unknown> = {};
      sel.columns.forEach((c) => { outProps[c.name] = { type: "string", description: c.dataType }; });
      setOutputSchema(JSON.stringify({ type: "object", properties: { rows: { type: "array", items: { type: "object", properties: outProps } } } }, null, 2));
    } else {
      const colList = cols.join(", ");
      const placeholders = cols.map((c) => `{{${c}}}`).join(", ");
      setSqlTemplate(`INSERT INTO ${sel.schema}.${sel.table} (${colList})\nVALUES (${placeholders})`);
      const properties: Record<string, unknown> = {};
      sel.columns.forEach((c) => { properties[c.name] = { type: "string", description: c.dataType }; });
      setInputSchema(JSON.stringify({ type: "object", properties, required: sel.columns.filter((c) => !c.nullable && !c.isPrimaryKey).map((c) => c.name) }, null, 2));
      setOutputSchema(JSON.stringify({ type: "object", properties: { rowsAffected: { type: "integer" } } }, null, 2));
    }
  }

  // Reload compatible connections when type changes
  useEffect(() => {
    void getCompatibleConnectionsForTool(type).then((conns) => {
      setCompatibleConnections(conns);
      setConnectionId(conns.length > 0 && conns[0] ? conns[0].id : "");
    });
  }, [type]);

  const needsConnection = (CONNECTION_TOOL_COMPAT[type]?.length ?? 0) > 0;

  async function handleCreate() {
    if (!name.trim()) { toast.error("Tool name is required."); return; }
    if (type === "http" && !url.trim()) { toast.error("URL is required for HTTP tools."); return; }
    if ((type === "database_read" || type === "database_write") && !sqlTemplate.trim()) {
      toast.error("SQL template is required for database tools."); return;
    }
    setSaving(true);
    try {
      let parsedInput = {};
      let parsedOutput = {};
      let parsedHeaders: Record<string, string> = {};
      try { parsedInput = JSON.parse(inputSchema) as Record<string, unknown>; } catch { toast.error("Invalid input schema JSON."); setSaving(false); return; }
      try { parsedOutput = JSON.parse(outputSchema) as Record<string, unknown>; } catch { toast.error("Invalid output schema JSON."); setSaving(false); return; }
      try { parsedHeaders = JSON.parse(headers) as Record<string, string>; } catch { toast.error("Invalid headers JSON."); setSaving(false); return; }

      const retryPolicy: RetryPolicy = {
        maxAttempts: parseInt(retryAttempts) || 3,
        backoffType: retryBackoff,
        backoffMs: parseInt(retryBackoffMs) || 1000,
      };

      const selectedConn = compatibleConnections.find(c => c.id === connectionId);
      const tool = await createTool({
        name: name.trim(),
        description: description.trim(),
        type,
        riskLevel,
        timeoutMs: parseInt(timeout) || 10000,
        idempotent,
        inputSchema: parsedInput,
        outputSchema: parsedOutput,
        retryPolicy,
        authConnectionRef: connectionId || null,
        connectionId: connectionId || null,
        connectionName: selectedConn?.name ?? null,
        httpConfig: type === "http"
          ? { method, url: url.trim(), headers: parsedHeaders, bodyTemplate: bodyTemplate || undefined }
          : undefined,
        dbConfig: (type === "database_read" || type === "database_write")
          ? {
              sqlTemplate: sqlTemplate.trim(),
              ...(type === "database_read" ? { maxRows: parseInt(dbMaxRows) || 100 } : {}),
              ...(type === "database_write" ? { requireApproval: dbRequireApproval } : {}),
            }
          : undefined,
      });
      toast.success("Tool registered.");
      router.push(`/tools/${tool.id}` as never);
    } catch {
      toast.error("Failed to register tool.");
    } finally {
      setSaving(false);
    }
  }

  function handleTest() {
    setTesting(true);
    setTimeout(() => {
      setTesting(false);
      toast.info("Test is mocked — connect to a real backend to enable live tool testing.");
    }, 1200);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-7 lg:px-8">
      {/* Breadcrumb */}
      <Link href={"/tools" as never} className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B7280] transition-colors hover:text-[#0B0D0F]">
        <ArrowLeft className="h-3.5 w-3.5" />
        Tool Registry
      </Link>

      <div className="pb-1">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Tools</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-[-0.01em] text-[#0B0D0F]">
          New Tool
        </h1>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Register a tool that agents can call during workflow execution.
        </p>
      </div>

      {/* ── Tool Info ────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
        <SectionHeader label="Tool Info" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" required>
            <input className={monoCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="crm-api.getRenewalAccounts" />
          </Field>
          <Field label="Type">
            <select className={selectCls} value={type} onChange={(e) => setType(e.target.value as ToolType)}>
              {TOOL_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Description">
              <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Retrieves renewal accounts from CRM with upcoming dates." />
            </Field>
          </div>
        </div>
      </section>

      {/* ── Risk Level ───────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
        <SectionHeader label="Risk Level" />
        <div className="grid grid-cols-2 gap-2">
          {RISK_LEVELS.map((r) => (
            <button
              key={r.level}
              type="button"
              onClick={() => setRiskLevel(r.level)}
              className="rounded-[10px] border bg-white p-3 text-left transition-all hover:border-[#C9CED4]"
              style={{
                background: riskLevel === r.level ? `${r.color}0D` : "#FFFFFF",
                borderColor: riskLevel === r.level ? r.color : "#E0E3E6",
              }}
            >
              <p className="text-[12.5px] font-semibold" style={{ color: riskLevel === r.level ? r.color : "#0B0D0F" }}>
                {r.label}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-[1.5] text-[#6B7280]">{r.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── HTTP Config ──────────────────────────────────────────────── */}
      {type === "http" && (
        <section className="space-y-4 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
          <SectionHeader label="HTTP Config" />
          <div className="flex gap-3">
            <select
              className={`w-24 shrink-0 font-mono ${selectCompactCls}`}
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
            </select>
            <input
              className={`flex-1 ${monoCls}`}
              placeholder="https://api.example.com/v2/endpoint"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <Field label="Headers (JSON)">
            <textarea rows={3} className={`resize-none ${monoCls}`} value={headers} onChange={(e) => setHeaders(e.target.value)} />
          </Field>
          {(method === "POST" || method === "PUT" || method === "PATCH") && (
            <Field label="Body template (JSON / Handlebars)">
              <textarea
                rows={4}
                className={`resize-none ${monoCls}`}
                value={bodyTemplate}
                onChange={(e) => setBodyTemplate(e.target.value)}
                placeholder={'{"customerId": "{{customerId}}"}'}
              />
            </Field>
          )}
        </section>
      )}

      {/* ── Connection ───────────────────────────────────────────────── */}
      {needsConnection && (
        <section className="space-y-3 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
          <SectionHeader label="Connection" />
          {compatibleConnections.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-[#D7DBE0] bg-[#FAFBFB] py-5">
              <p className="text-[12.5px] font-semibold text-[#0B0D0F]">No compatible connections found</p>
              <p className="text-[12px] text-[#6B7280]">Add a connection of the correct type before registering this tool.</p>
              <Link
                href={"/connections/new" as never}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#9CCFBB] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#006B45] transition-colors hover:bg-[#E6F4EF]"
              >
                Add Connection
              </Link>
            </div>
          ) : (
            <Field label="Connection" required>
              <select
                className={selectCls}
                value={connectionId}
                onChange={(e) => { setConnectionId(e.target.value); setSchemaSelection(null); }}
              >
                <option value="">None</option>
                {compatibleConnections.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[#9CA3AF]">
                Only connections compatible with this tool type are shown.{" "}
                <Link href={"/connections" as never} className="font-medium text-[#007F4E] hover:underline">Manage connections</Link>
              </p>
            </Field>
          )}
        </section>
      )}

      {/* ── DB Config ────────────────────────────────────────────────── */}
      {(type === "database_read" || type === "database_write") && (
        <section className="space-y-4 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
          <SectionHeader label="Database Config" />

          {/* Schema picker — shown when a database connection is selected */}
          {connectionId ? (
            <div className="space-y-1.5">
              <p className="text-[12.5px] font-medium text-[#374151]">Browse schema</p>
              <p className="text-[11.5px] text-[#6B7280]">
                Select a table and columns — the SQL template and schemas will be generated automatically.
                {schemaSelection && (
                  <span className="ml-1 font-semibold text-[#007F4E]">
                    ✓ {schemaSelection.schema}.{schemaSelection.table} ({schemaSelection.columns.length} columns)
                  </span>
                )}
              </p>
              <SchemaPickerPanel
                connectionId={connectionId}
                onSelect={handleSchemaSelect}
              />
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#ECEEEF] bg-[#FAFBFB] p-3 text-[12px] text-[#6B7280]">
              Select a database connection above to browse its schema and auto-generate the SQL template.
            </div>
          )}

          <Field label="SQL Template" required>
            <textarea
              rows={5}
              className={`resize-y ${monoCls} text-[12px]`}
              value={sqlTemplate}
              onChange={(e) => setSqlTemplate(e.target.value)}
              placeholder={
                type === "database_read"
                  ? "SELECT id, name, email FROM users WHERE status = {{status}} LIMIT 50"
                  : "INSERT INTO llm_answers (fact, answer, created_at)\nVALUES ({{fact}}, {{answer}}, now())"
              }
            />
            <p className="mt-1.5 text-[11.5px] text-[#6B7280]">
              Use <code className="rounded border border-[#E0E3E6] bg-[#F7F8F9] px-1 py-0.5 font-mono text-[10.5px] text-[#374151]">{"{{paramName}}"}</code> for parameters that agents will fill at runtime. They map to <code className="rounded border border-[#E0E3E6] bg-[#F7F8F9] px-1 py-0.5 font-mono text-[10.5px] text-[#374151]">$1, $2…</code> in SQL-appearance order.
            </p>
          </Field>

          {type === "database_read" && (
            <Field label="Max rows returned">
              <input
                type="number"
                min="1"
                max="10000"
                className={inputCls}
                value={dbMaxRows}
                onChange={(e) => setDbMaxRows(e.target.value)}
              />
            </Field>
          )}

          {type === "database_write" && (
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-[#007F4E]"
                checked={dbRequireApproval}
                onChange={(e) => setDbRequireApproval(e.target.checked)}
              />
              <div>
                <p className="text-[12.5px] font-medium text-[#0B0D0F]">Require human approval before writing</p>
                <p className="text-[11.5px] text-[#6B7280]">Workflow will pause and wait for approval before executing this SQL</p>
              </div>
            </label>
          )}
        </section>
      )}

      {/* ── Schema ───────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
        <SectionHeader label="Input / Output Schema" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Input Schema (JSON Schema)">
            <textarea rows={7} className={`resize-none ${monoCls} text-[11px]`} value={inputSchema} onChange={(e) => setInputSchema(e.target.value)} />
          </Field>
          <Field label="Output Schema (JSON Schema)">
            <textarea rows={7} className={`resize-none ${monoCls} text-[11px]`} value={outputSchema} onChange={(e) => setOutputSchema(e.target.value)} />
          </Field>
        </div>
      </section>

      {/* ── Retry Policy ─────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
        <SectionHeader label="Retry Policy" />
        <div className="grid grid-cols-3 gap-4">
          <Field label="Max attempts">
            <input type="number" min="0" max="10" className={inputCls} value={retryAttempts} onChange={(e) => setRetryAttempts(e.target.value)} />
          </Field>
          <Field label="Backoff type">
            <select className={selectCls} value={retryBackoff} onChange={(e) => setRetryBackoff(e.target.value as RetryPolicy["backoffType"])}>
              <option value="exponential">Exponential</option>
              <option value="fixed">Fixed</option>
            </select>
          </Field>
          <Field label="Backoff base (ms)">
            <input type="number" min="0" className={inputCls} value={retryBackoffMs} onChange={(e) => setRetryBackoffMs(e.target.value)} />
          </Field>
        </div>
      </section>

      {/* ── Options ──────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
        <SectionHeader label="Options" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Timeout (ms)">
            <input type="number" className={inputCls} value={timeout} onChange={(e) => setTimeout_(e.target.value)} />
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" className="h-4 w-4 rounded accent-[#007F4E]" checked={idempotent} onChange={(e) => setIdempotent(e.target.checked)} />
              <div>
                <p className="text-[12.5px] font-medium text-[#0B0D0F]">Idempotent</p>
                <p className="text-[11.5px] text-[#6B7280]">Safe to call multiple times with same args</p>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pb-8 pt-1">
        {type === "http" && (
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !url.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F7F8F9] disabled:opacity-50"
          >
            {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}
            Test
          </button>
        )}
        <Link
          href={"/tools" as never}
          className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[13px] font-medium text-[#6B7280] transition-colors hover:bg-[#F7F8F9] hover:text-[#0B0D0F]"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={saving || !name.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[#0B0D0F] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#23272B] disabled:opacity-50"
        >
          {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Register Tool
        </button>
      </div>
    </div>
  );
}
