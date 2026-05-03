"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SidecarConnection {
  id: string;
  display_name: string | null;
  status: string;
  health_status: string;
  last_seen_at: string | null;
  config: Record<string, unknown>;
  events_last_24h: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    connected: { label: "Connected", className: "bg-green-100 text-green-800" },
    configured: { label: "Configured", className: "bg-blue-100 text-blue-800" },
    not_configured: { label: "Not configured", className: "bg-gray-100 text-gray-600" },
    error: { label: "Error", className: "bg-red-100 text-red-700" },
    disabled: { label: "Disabled", className: "bg-gray-100 text-gray-400" },
  };
  const s = map[status] ?? map.not_configured;
  return <Badge className={s.className}>{s.label}</Badge>;
}

function HealthIcon({ health }: { health: string }) {
  if (health === "healthy") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (health === "degraded") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (health === "failing") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Circle className="h-4 w-4 text-gray-400" />;
}

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="relative rounded-lg border border-[#E7DED1] bg-[#1a1a1a] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-xs text-gray-400">{language}</span>
        <button onClick={copy} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors">
          <Copy className="h-3 w-3" />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-gray-200 leading-relaxed">{code}</pre>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SidecarIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const [connections, setConnections] = useState<SidecarConnection[]>([]);
  const [ingestToken, setIngestToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    try {
      const [connRes, tokenRes] = await Promise.all([
        fetch(`/api/integrations?workspaceId=${workspaceId}&type=sidecar`),
        fetch(`/api/settings/ingest-tokens?workspaceId=${workspaceId}&limit=1`),
      ]);
      if (connRes.ok) {
        const d = await connRes.json() as { connections: SidecarConnection[] };
        setConnections(d.connections ?? []);
      }
      if (tokenRes.ok) {
        const d = await tokenRes.json() as { tokens?: Array<{ token: string }> };
        if (d.tokens && d.tokens.length > 0) setIngestToken(d.tokens[0].token);
      }
    } finally {
      setLoading(false);
    }
  }

  async function testConnection(id: string) {
    setTesting(id);
    try {
      await fetch(`/api/integrations/${id}/test?workspaceId=${workspaceId}`, { method: "POST" });
      await load();
    } finally {
      setTesting(null);
    }
  }

  const token = ingestToken ?? "<YOUR_INGEST_TOKEN>";
  const host = typeof window !== "undefined" ? window.location.origin : "https://your-vectorbea-instance.com";

  const dockerCompose = `version: "3.8"
services:
  vectorbea-sidecar:
    image: vectorbea/sidecar:latest
    environment:
      VECTORBEA_INGEST_URL: ${host}/api/ingest/traces
      VECTORBEA_INGEST_TOKEN: ${token}
      VECTORBEA_WORKSPACE_ID: ${workspaceId || "<YOUR_WORKSPACE_ID>"}
      SIDECAR_PORT: "4318"
    ports:
      - "4318:4318"
    restart: unless-stopped`;

  const k8sYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: vectorbea-sidecar
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vectorbea-sidecar
  template:
    metadata:
      labels:
        app: vectorbea-sidecar
    spec:
      containers:
        - name: sidecar
          image: vectorbea/sidecar:latest
          env:
            - name: VECTORBEA_INGEST_URL
              value: "${host}/api/ingest/traces"
            - name: VECTORBEA_INGEST_TOKEN
              valueFrom:
                secretKeyRef:
                  name: vectorbea-secrets
                  key: ingest-token
            - name: VECTORBEA_WORKSPACE_ID
              value: "${workspaceId || "<YOUR_WORKSPACE_ID>"}"
          ports:
            - containerPort: 4318`;

  const curlTest = `curl -X POST ${host}/api/ingest/traces \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "events": [{
      "type": "agent_run_started",
      "timestamp": "${new Date().toISOString()}",
      "metadata": { "capability_name": "my-agent" }
    },{
      "type": "agent_run_completed",
      "timestamp": "${new Date().toISOString()}",
      "metadata": { "outcome_status": "success" }
    }]
  }'`;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Sidecar Integration"
        subtitle="Deploy the VectorBea sidecar to capture AI evidence at the infrastructure layer"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2 border-[#E7DED1]">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        {/* What is the sidecar */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Server className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">Infrastructure-layer evidence collection</h3>
                <p className="mt-1 text-sm text-gray-600">
                  The VectorBea sidecar runs alongside your AI system as a lightweight process or container.
                  It intercepts traces at the network layer — no SDK changes required. Every agent run,
                  tool call, and LLM interaction is captured and forwarded as governance evidence.
                </p>
                <div className="mt-3 flex gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> No code changes</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> OpenTelemetry compatible</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Zero latency overhead</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active connections */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : connections.length > 0 ? (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="border-b border-[#E7DED1] pb-4">
              <CardTitle className="text-base font-semibold">Active sidecar connections</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {connections.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-[#E7DED1] px-6 py-4 last:border-0">
                  <div className="flex items-center gap-3">
                    <HealthIcon health={c.health_status} />
                    <div>
                      <p className="font-medium text-[#111111]">{c.display_name ?? "Sidecar"}</p>
                      <p className="text-xs text-gray-500">
                        {c.last_seen_at ? `Last seen ${new Date(c.last_seen_at).toLocaleString()}` : "Never seen"}
                        {" · "}
                        {c.events_last_24h} events / 24h
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={c.status} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#E7DED1]"
                      disabled={testing === c.id}
                      onClick={() => void testConnection(c.id)}
                    >
                      {testing === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {/* Ingest token */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Ingest token</CardTitle>
              <a href="/settings/sdk" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                Manage tokens <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {ingestToken ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Use this token to authenticate the sidecar with VectorBea.</p>
                <div className="flex items-center gap-2 rounded-lg border border-[#E7DED1] bg-[#F8F5EF] px-4 py-3 font-mono text-sm">
                  <span className="flex-1 truncate">{ingestToken}</span>
                  <button onClick={() => void navigator.clipboard.writeText(ingestToken)} className="text-gray-400 hover:text-gray-700">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                No ingest token found.{" "}
                <a href="/settings/sdk" className="text-blue-600 hover:underline">Create one in SDK settings</a>.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deployment: Docker Compose */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Deploy with Docker Compose</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">Add the sidecar as a service alongside your AI workloads:</p>
            <CodeBlock code={dockerCompose} language="yaml" />
            <p className="text-xs text-gray-500">Then run: <code className="rounded bg-gray-100 px-1">docker compose up -d</code></p>
          </CardContent>
        </Card>

        {/* Deployment: Kubernetes */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Deploy on Kubernetes</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">Deploy as a Deployment in your cluster. Store your token in a Secret:</p>
            <CodeBlock code={`kubectl create secret generic vectorbea-secrets \\\n  --from-literal=ingest-token="${token}"`} language="bash" />
            <CodeBlock code={k8sYaml} language="yaml" />
            <p className="text-xs text-gray-500">Apply with: <code className="rounded bg-gray-100 px-1">kubectl apply -f sidecar-deployment.yaml</code></p>
          </CardContent>
        </Card>

        {/* Test your connection */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Test your connection</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">Send a test trace directly to the ingest endpoint to verify everything is wired up:</p>
            <CodeBlock code={curlTest} language="bash" />
            <p className="text-xs text-gray-500">A 202 response confirms the trace was accepted. Check the <a href="/governance/audit" className="text-blue-600 hover:underline">audit log</a> or AI system traces to see it appear.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
