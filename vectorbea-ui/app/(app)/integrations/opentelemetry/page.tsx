"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Copy,
  ExternalLink,
  Radio,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg border border-[#E7DED1] bg-[#1a1a1a] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-xs text-gray-400">{language}</span>
        <button
          onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-gray-200 leading-relaxed">{code}</pre>
    </div>
  );
}

export default function OpenTelemetryIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";
  const host = typeof window !== "undefined" ? window.location.origin : "https://your-vectorbea-instance.com";

  const otlpEndpoint = `${host}/api/ingest/otel`;

  const collectorYaml = `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 100

  # Add VectorBea workspace context
  attributes:
    actions:
      - key: vectorbea.workspace_id
        value: "${workspaceId || "<YOUR_WORKSPACE_ID>"}"
        action: insert

exporters:
  otlphttp/vectorbea:
    endpoint: "${host}/api/ingest/otel"
    headers:
      x-vectorbea-ingest-token: "<YOUR_INGEST_TOKEN>"
    compression: gzip

  # Keep your existing exporter
  otlp/existing:
    endpoint: "your-existing-collector:4317"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, attributes]
      exporters: [otlphttp/vectorbea, otlp/existing]`;

  const pythonExample = `from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

# Add VectorBea as an OTLP exporter
vectorbea_exporter = OTLPSpanExporter(
    endpoint="${host}/api/ingest/otel/v1/traces",
    headers={
        "x-vectorbea-ingest-token": "<YOUR_INGEST_TOKEN>",
    },
)

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(vectorbea_exporter))
trace.set_tracer_provider(provider)

# Instrument your AI calls
tracer = trace.get_tracer("my-ai-service")

with tracer.start_as_current_span("agent-run") as span:
    span.set_attribute("vectorbea.capability_name", "my-agent")
    span.set_attribute("vectorbea.workspace_id", "${workspaceId || "<WORKSPACE_ID>"}")
    span.set_attribute("gen_ai.system", "openai")
    span.set_attribute("gen_ai.request.model", "gpt-4o")
    # ... your AI logic`;

  const attributeMapping = [
    { otel: "vectorbea.capability_name", alt: "gen_ai.system + service.name", maps_to: "AI system name" },
    { otel: "vectorbea.workspace_id", alt: "resource attribute", maps_to: "Workspace routing" },
    { otel: "gen_ai.request.model", alt: "llm.model", maps_to: "Model name" },
    { otel: "gen_ai.system", alt: "llm.vendor", maps_to: "Provider (openai, anthropic…)" },
    { otel: "gen_ai.usage.input_tokens", alt: "llm.usage.prompt_tokens", maps_to: "Input token count" },
    { otel: "gen_ai.usage.output_tokens", alt: "llm.usage.completion_tokens", maps_to: "Output token count" },
    { otel: "vectorbea.environment", alt: "deployment.environment", maps_to: "Environment (prod/staging)" },
    { otel: "vectorbea.outcome_status", alt: "otel.status_code", maps_to: "Run outcome (success/failed)" },
  ];

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="OpenTelemetry Integration"
        subtitle="Route OTLP traces to VectorBea for continuous AI governance evidence"
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        {/* What it does */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Radio className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">Send OTLP traces to VectorBea</h3>
                <p className="mt-1 text-sm text-gray-600">
                  If your AI system already emits OpenTelemetry traces, you can route them to VectorBea as
                  an additional OTLP exporter — no changes to your AI code required. VectorBea maps
                  standard OTel semantic conventions and VectorBea-specific attributes to governance evidence.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Works with any OTel SDK</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Collector fan-out</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> No duplicate instrumentation</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Endpoint */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">OTLP endpoint</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">HTTP/Protobuf</p>
                <div className="flex items-center gap-2 rounded-lg border border-[#E7DED1] bg-[#F8F5EF] px-3 py-2 font-mono text-xs">
                  <span className="flex-1 truncate">{host}/api/ingest/otel/v1/traces</span>
                  <button onClick={() => void navigator.clipboard.writeText(`${host}/api/ingest/otel/v1/traces`)}><Copy className="h-3 w-3 text-gray-400" /></button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">gRPC (via collector)</p>
                <div className="flex items-center gap-2 rounded-lg border border-[#E7DED1] bg-[#F8F5EF] px-3 py-2 font-mono text-xs">
                  <span className="flex-1 truncate">{host.replace("https://", "").replace("http://", "")}:4317</span>
                  <button onClick={() => void navigator.clipboard.writeText(otlpEndpoint)}><Copy className="h-3 w-3 text-gray-400" /></button>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">
                All requests require the header <code className="rounded bg-amber-100 px-1">x-vectorbea-ingest-token: &lt;YOUR_TOKEN&gt;</code> or <code className="rounded bg-amber-100 px-1">Authorization: Bearer &lt;TOKEN&gt;</code>. Manage tokens in <a href="/settings/sdk" className="underline">SDK settings</a>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Collector config */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">OpenTelemetry Collector config</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">
              The recommended pattern is to fan-out from your existing collector — add VectorBea as an
              additional exporter alongside your Jaeger, Tempo, or Datadog backend:
            </p>
            <CodeBlock code={collectorYaml} language="yaml" />
          </CardContent>
        </Card>

        {/* SDK direct export */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Direct SDK export (Python)</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-gray-600">If you prefer SDK-level export without a collector:</p>
            <CodeBlock code={pythonExample} language="python" />
          </CardContent>
        </Card>

        {/* Attribute mapping */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Attribute mapping</CardTitle>
              <Badge className="bg-blue-100 text-blue-700 text-xs">Auto-mapped</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E7DED1] bg-[#F8F5EF]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">OTel attribute</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Alternative</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {attributeMapping.map((row, i) => (
                    <tr key={i} className="border-b border-[#E7DED1] last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-blue-700">{row.otel}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.alt}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{row.maps_to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Links */}
        <div className="flex gap-3">
          <a href="https://opentelemetry.io/docs/collector/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <BookOpen className="h-4 w-4" />
            OTel Collector docs
            <ExternalLink className="h-3 w-3" />
          </a>
          <a href="https://opentelemetry.io/docs/specs/semconv/gen-ai/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <BookOpen className="h-4 w-4" />
            GenAI semantic conventions
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

      </div>
    </div>
  );
}
