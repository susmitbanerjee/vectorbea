"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IntegrationConnection } from "@/lib/server/integrations";
import { useWorkspace } from "@/lib/workspace-context";

const TYPE_LABELS: Record<string, string> = {
  sidecar: "Sidecar",
  opentelemetry: "OpenTelemetry",
  sdk: "SDK",
  direct_api: "Direct API",
  llm_provider: "LLM Provider",
  mcp_server: "MCP Server",
  rag_pipeline: "RAG Pipeline",
  classification_system: "Classification",
  extraction_system: "Extraction",
  skill_runtime: "Skill Runtime",
  ci_cd: "CI/CD",
  manual_upload: "Manual Upload",
  langgraph: "LangGraph",
  custom_webhook: "Custom Webhook",
};

function HealthBadge({ health }: { health: string }) {
  if (health === "healthy") return <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="h-3 w-3" />Healthy</Badge>;
  if (health === "degraded") return <Badge className="bg-amber-100 text-amber-800 gap-1"><AlertTriangle className="h-3 w-3" />Degraded</Badge>;
  if (health === "failing") return <Badge className="bg-red-100 text-red-800 gap-1"><XCircle className="h-3 w-3" />Failing</Badge>;
  return <Badge className="bg-gray-100 text-gray-500 gap-1"><Circle className="h-3 w-3" />Unknown</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, string> = {
    connected: "bg-green-100 text-green-800",
    configured: "bg-blue-100 text-blue-800",
    not_configured: "bg-gray-100 text-gray-500",
    error: "bg-red-100 text-red-700",
    disabled: "bg-gray-100 text-gray-400",
  };
  const labels: Record<string, string> = {
    connected: "Connected", configured: "Configured",
    not_configured: "Not configured", error: "Error", disabled: "Disabled",
  };
  return <Badge className={m[status] ?? "bg-gray-100 text-gray-500"}>{labels[status] ?? status}</Badge>;
}

export default function IntegrationHealthPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string; detail: string | null } | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations?workspaceId=${workspaceId}`);
      if (res.ok) {
        const d = await res.json() as { connections: IntegrationConnection[] };
        setConnections(d.connections ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function testConnection(id: string) {
    setTesting(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/${id}/test?workspaceId=${workspaceId}`, { method: "POST" });
      const data = await res.json() as { ok?: boolean; message?: string; detail?: string | null; error?: string };
      setTestResult({
        id,
        ok: data.ok ?? false,
        message: data.message ?? data.error ?? "Test completed",
        detail: data.detail ?? null,
      });
      await load();
    } finally {
      setTesting(null);
    }
  }

  const healthyCount = connections.filter(c => c.healthStatus === "healthy").length;
  const degradedCount = connections.filter(c => c.healthStatus === "degraded").length;
  const failingCount = connections.filter(c => c.healthStatus === "failing").length;
  const unknownCount = connections.filter(c => !["healthy","degraded","failing"].includes(c.healthStatus ?? "")).length;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Integration Health"
        subtitle="Real-time status of all configured evidence source connections"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2 border-[#E7DED1]">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        {/* Summary cards */}
        {!loading && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Healthy", count: healthyCount, icon: CheckCircle2, iconClass: "text-green-600", bg: "bg-green-50" },
              { label: "Degraded", count: degradedCount, icon: AlertTriangle, iconClass: "text-amber-500", bg: "bg-amber-50" },
              { label: "Failing", count: failingCount, icon: XCircle, iconClass: "text-red-500", bg: "bg-red-50" },
              { label: "Unknown", count: unknownCount, icon: Circle, iconClass: "text-gray-400", bg: "bg-gray-50" },
            ].map((s) => (
              <Card key={s.label} className="border-[#E7DED1] bg-white">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.bg}`}>
                    <s.icon className={`h-5 w-5 ${s.iconClass}`} />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-[#111111]">{s.count}</p>
                    <p className="text-xs text-gray-500">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Test result banner */}
        {testResult && (
          <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            testResult.ok
              ? "border-green-200 bg-green-50 text-green-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}>
            {testResult.ok
              ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              : <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium">{testResult.message}</p>
              {testResult.detail && <p className="text-xs mt-0.5 opacity-80">{testResult.detail}</p>}
            </div>
            <button onClick={() => setTestResult(null)} className="text-xs opacity-60 hover:opacity-100 flex-shrink-0">✕</button>
          </div>
        )}

        {/* Connection list */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">All connections</CardTitle>
          </CardHeader>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Activity className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-700">No integrations configured</p>
              <p className="text-xs text-gray-500 mt-1">Connect evidence sources to see health status.</p>
              <a href="/integrations/overview" className="mt-4 inline-block rounded-lg bg-[#111111] px-4 py-2 text-sm text-white hover:bg-black">
                Add integrations
              </a>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E7DED1] bg-[#F8F5EF]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Connection</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Health</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Last seen</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c) => (
                    <tr key={c.id} className="border-b border-[#E7DED1] last:border-0 hover:bg-[#F8F5EF]/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#111111]">{c.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{c.id.slice(0, 8)}…</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{TYPE_LABELS[c.integrationType] ?? c.integrationType}</td>
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3"><HealthBadge health={c.healthStatus ?? "unknown"} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleString() : "Never"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-3 text-xs border-[#E7DED1]"
                          disabled={testing === c.id}
                          onClick={() => void testConnection(c.id)}
                        >
                          {testing === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
