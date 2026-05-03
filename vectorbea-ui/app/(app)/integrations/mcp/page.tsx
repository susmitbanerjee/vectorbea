"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

interface McpTrace {
  id: string;
  created_at: string;
  model: string | null;
  provider: string | null;
  outcome_status: string | null;
  metadata: {
    mcpServers?: string[];
    serviceName?: string;
  } | null;
}

function CodeBlock({ code, language = "json" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg border border-[#E7DED1] bg-[#1a1a1a] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-xs text-gray-400">{language}</span>
        <button onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors">
          <Copy className="h-3 w-3" />{copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-gray-200 leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

export default function McpIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";
  const host = typeof window !== "undefined" ? window.location.origin : "https://your-vectorbea-instance.com";

  const [traces, setTraces] = useState<McpTrace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/workflow-traces?workspaceId=${workspaceId}&hasMcp=true&limit=10`);
      if (res.ok) {
        const d = await res.json() as { traces?: McpTrace[] };
        setTraces(d.traces ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  const sdkExample = `import vectorbea

vectorbea.init(
    ingest_token="<YOUR_TOKEN>",
    workspace_id="${workspaceId || "<WORKSPACE_ID>"}",
)

# MCP tool calls are automatically captured when you use
# the VectorBea SDK alongside an MCP client
@vectorbea.trace(capability_name="mcp-agent")
def run_with_mcp(query: str):
    # Your MCP client calls are detected automatically
    result = mcp_client.call_tool("my-tool", {"input": query})
    return result`;

  const otelExample = `# When emitting OpenTelemetry spans, tag MCP calls with:
span.set_attribute("vectorbea.step_type", "mcp_tool_call")
span.set_attribute("mcp.server_name", "my-mcp-server")
span.set_attribute("mcp.tool_name", "get_data")
span.set_attribute("mcp.tool_arguments", '{"key": "value"}')`;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="MCP Server Integration"
        subtitle="Capture tool call evidence from Model Context Protocol servers"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2 border-[#E7DED1]">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">MCP tool calls as governance evidence</h3>
                <p className="mt-1 text-sm text-gray-600">
                  VectorBea automatically detects MCP tool calls within agent traces. When an agent calls
                  an MCP server tool, VectorBea records the server name, tool name, arguments, result, and
                  latency — creating a tool-call audit trail for governance.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Auto-detected from SDK</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> OTel attribute mapping</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Per-tool audit trail</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">SDK instrumentation</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">
              The VectorBea SDK automatically captures MCP calls when used with any MCP client.
              No additional configuration required:
            </p>
            <CodeBlock code={sdkExample} language="python" />
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">OpenTelemetry attribute mapping</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">If emitting OTel spans directly, tag MCP steps with these attributes:</p>
            <CodeBlock code={otelExample} language="python" />
          </CardContent>
        </Card>

        {/* Recent MCP traces */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Recent MCP traces</CardTitle>
          </CardHeader>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          ) : traces.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Package className="h-8 w-8 text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">No MCP traces received yet</p>
              <p className="text-xs text-gray-400 mt-1">Instrument your MCP agent and run it to see traces here.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E7DED1]">
              {traces.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <p className="text-sm font-medium text-[#111111]">
                      {t.metadata?.serviceName ?? t.provider ?? "Unknown agent"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(t.created_at).toLocaleString()}
                      {t.metadata?.mcpServers?.length ? ` · ${t.metadata.mcpServers.join(", ")}` : ""}
                    </p>
                  </div>
                  {t.outcome_status && (
                    <Badge className={t.outcome_status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                      {t.outcome_status}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
