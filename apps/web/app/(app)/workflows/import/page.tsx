"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, CheckCircle2, Code2, ExternalLink, GitBranch, Terminal, Upload, Zap } from "lucide-react";
import { toast } from "sonner";

type ImportMode = "langgraph" | "temporal" | "sdk" | "endpoint";

const MODES: { mode: ImportMode; label: string; icon: React.ElementType; color: string; description: string; capability: string }[] = [
  {
    mode: "langgraph",
    label: "LangGraph",
    icon: GitBranch,
    color: "#A78BFA",
    description: "Import a LangGraph graph definition. Vectorbee converts nodes to agents, edges to handoffs, and tools to the tool registry.",
    capability: "Full replay if converted to native DAG · Partial if custom nodes remain external",
  },
  {
    mode: "temporal",
    label: "Temporal",
    icon: Zap,
    color: "#38BDF8",
    description: "Register a Temporal namespace and workflow type. Vectorbee ingests history events and shows run timelines.",
    capability: "Observability + partial replay · Native replay stays in Temporal unless migrated",
  },
  {
    mode: "sdk",
    label: "Vectorbee SDK",
    icon: Code2,
    color: "#34D399",
    description: "Add the Vectorbee SDK to your existing code. Push structured events and checkpoints to Vectorbee.",
    capability: "Observability + partial replay if checkpoints submitted",
  },
  {
    mode: "endpoint",
    label: "HTTP Endpoint",
    icon: Terminal,
    color: "#94A3B8",
    description: "Register an HTTP endpoint. Vectorbee triggers it on schedule. Limited mode — no step-level replay without SDK.",
    capability: "Trigger only · No step replay unless events are submitted",
  },
];

export default function ImportWorkflowPage() {
  const [selected, setSelected] = useState<ImportMode>("langgraph");
  const [lgInput, setLgInput] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [sdkApiKey] = useState("vb_sk_••••••••••••••••");

  const mode = MODES.find((m) => m.mode === selected)!;
  const Icon = mode.icon;

  function handleImport() {
    if (selected === "endpoint" && !endpointUrl.trim()) {
      toast.error("Endpoint URL is required.");
      return;
    }
    toast.info("Import coming soon — connect to your backend to enable.");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-8">
      {/* Back */}
      <Link href={"/workflows" as never} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" />
        Workflows
      </Link>

      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Import Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring existing workflows into Vectorbee for observability, control, and (where supported) replay.
        </p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MODES.map((m) => {
          const MIcon = m.icon;
          return (
            <button
              key={m.mode}
              type="button"
              onClick={() => setSelected(m.mode)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                selected === m.mode ? "" : "border-border/60 hover:border-border"
              }`}
              style={{
                background: selected === m.mode ? "var(--surface-2)" : "var(--surface-1)",
                borderColor: selected === m.mode ? `${m.color}50` : undefined,
                boxShadow: selected === m.mode ? `0 0 0 2px ${m.color}20` : undefined,
              }}
            >
              <MIcon className="h-5 w-5" style={{ color: m.color }} />
              <span className="text-[12px] font-semibold" style={{ color: selected === m.mode ? m.color : undefined }}>
                {m.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode detail */}
      <div className="rounded-xl border border-border/60 p-5 space-y-5" style={{ background: "var(--surface-1)" }}>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${mode.color}15`, border: `1px solid ${mode.color}25` }}>
            <Icon className="h-4.5 w-4.5" style={{ color: mode.color }} />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold">{mode.label}</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">{mode.description}</p>
          </div>
        </div>

        <div className="rounded-lg border px-4 py-3 text-[12px]" style={{ background: `${mode.color}08`, borderColor: `${mode.color}20`, color: mode.color }}>
          <span className="font-semibold">Capability: </span>
          {mode.capability}
        </div>

        {/* LangGraph */}
        {selected === "langgraph" && (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Graph Definition (JSON or Python stub)</p>
            <textarea
              rows={10}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={`# Paste your LangGraph graph spec or JSON definition\n{\n  "nodes": [\n    { "id": "fetch_data", "type": "function", "func": "fetch_customer_data" },\n    { "id": "analyze",   "type": "function", "func": "analyze_risk" }\n  ],\n  "edges": [\n    { "from": "fetch_data", "to": "analyze" }\n  ]\n}`}
              value={lgInput}
              onChange={(e) => setLgInput(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Vectorbee will map nodes → agents, edges → handoffs, and extract tool calls into the tool registry.
            </p>
          </div>
        )}

        {/* Temporal */}
        {selected === "temporal" && (
          <div className="space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Temporal Connection</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Namespace</label>
                <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" placeholder="default" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Workflow Type</label>
                <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" placeholder="CustomerRenewalWorkflow" />
              </div>
              <div className="col-span-2">
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Temporal Host</label>
                <input className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" placeholder="localhost:7233" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Vectorbee will poll the Temporal history API to ingest events and display run timelines. Native replay stays in Temporal unless the workflow is migrated.
            </p>
          </div>
        )}

        {/* SDK */}
        {selected === "sdk" && (
          <div className="space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">SDK Setup</p>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Install</label>
              <code className="block w-full rounded-lg border border-border bg-muted/30 px-4 py-3 font-mono text-[12px]">
                npm install @vectorbee/sdk
              </code>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Your API Key</label>
              <code className="block w-full rounded-lg border border-border bg-muted/30 px-4 py-3 font-mono text-[12px] text-sky-400">
                {sdkApiKey}
              </code>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Usage example</label>
              <pre className="w-full overflow-x-auto rounded-lg border border-border bg-muted/30 px-4 py-3 font-mono text-[11px] leading-5 text-muted-foreground">
{`import { VectorbeeSdk } from "@vectorbee/sdk";

const vb = new VectorbeeSdk({ apiKey: "${sdkApiKey}" });
const run = await vb.startRun({ workflowId: "wf-renewal-intelligence" });

// Emit events from your code
await vb.emit(run.id, { type: "AGENT_STARTED", agentName: "DataFetcher" });
await vb.checkpoint(run.id, { stepId: "step-1", state: { ... } });
await vb.emit(run.id, { type: "RUN_SUCCEEDED" });`}
              </pre>
            </div>
            <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 px-4 py-3">
              <p className="text-[12px] font-semibold text-teal-400 mb-1">Events ingestion endpoint</p>
              <code className="font-mono text-[11px] text-teal-300">POST https://app.vectorbee.io/api/ingest/events</code>
            </div>
          </div>
        )}

        {/* Endpoint */}
        {selected === "endpoint" && (
          <div className="space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Endpoint Configuration</p>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-[12px] font-semibold text-amber-400 mb-1">Limited mode</p>
              <p className="text-[12px] text-amber-400/80">
                Trigger only — Vectorbee will call your endpoint on schedule, but cannot inspect internal steps. Add the SDK to unlock step-level visibility and replay.
              </p>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Endpoint URL *</label>
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="https://your-service.com/api/run"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Method</label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none">
                  <option>POST</option>
                  <option>GET</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Auth header</label>
                <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Bearer ••••" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Link
          href={"/workflows" as never}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleImport}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          {selected === "sdk" ? "Generate API Key" : selected === "endpoint" ? "Register Endpoint" : "Import Workflow"}
        </button>
      </div>
    </div>
  );
}
