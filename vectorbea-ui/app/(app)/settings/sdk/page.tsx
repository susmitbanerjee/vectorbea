"use client";

import { useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  RefreshCw,
  Shield,
  Zap,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ code, lang = "python" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div className="relative rounded-xl border border-[#E7DED1] bg-[#1C1917] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#2D2A26]">
        <span className="text-[10px] font-mono text-[#78716C] uppercase tracking-wider">{lang}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 text-[11px] text-[#78716C] hover:text-white transition-colors"
        >
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-[#4ADE80]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[12px] leading-relaxed text-[#E7E5E4] font-mono whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, icon: Icon, badge, children }: {
  title: string;
  icon: React.ElementType;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Card className="border-[#E7DED1] bg-white">
      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-[#EFF6FF] p-1.5"><Icon className="h-4 w-4 text-[#2563EB]" /></div>
          <CardTitle className="text-sm text-[#111111] flex-1">{title}</CardTitle>
          {badge && <Badge className="bg-[#F3F4F6] text-[#374151] text-[10px]">{badge}</Badge>}
          {open ? <ChevronDown className="h-4 w-4 text-[#9CA3AF]" /> : <ChevronRight className="h-4 w-4 text-[#9CA3AF]" />}
        </div>
      </CardHeader>
      {open && <CardContent className="space-y-4 text-sm text-[#374151]">{children}</CardContent>}
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SdkPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [showToken, setShowToken] = useState(false);
  const ingestUrl = typeof window !== "undefined" ? `${window.location.origin}/api/ingest/traces` : "https://app.vectorbea.com/api/ingest/traces";
  const placeholderToken = "vb_ingest_••••••••••••••••";

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="SDK & Ingest" subtitle="Connect your AI agents, tools, and MCP workflows to VectorBea" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8 max-w-4xl">

        {/* Quick-start callout */}
        <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-5 py-4 flex gap-4 items-start">
          <Zap className="h-5 w-5 text-[#2563EB] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#1E3A8A] text-sm mb-1">Three ways to send traces</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-[#1E40AF]">
              <li><span className="font-medium">SDK instrumentation</span> — wrap agent calls directly in Python/TypeScript</li>
              <li><span className="font-medium">Proxy / sidecar mode</span> — route LLM traffic through VectorBea&apos;s proxy; tool calls added via SDK</li>
              <li><span className="font-medium">OpenTelemetry spans</span> — map OTEL spans to VectorBea&apos;s span schema and POST to the ingest endpoint</li>
            </ol>
          </div>
        </div>

        {/* Ingest endpoint + token */}
        <Section title="Ingest endpoint" icon={KeyRound} badge="REST">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-[#374151] mb-1.5">Endpoint URL</p>
              <div className="flex items-center gap-2 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 font-mono text-xs text-[#111111]">
                <span className="flex-1 break-all">{ingestUrl}</span>
                <button type="button" onClick={() => void navigator.clipboard.writeText(ingestUrl)}>
                  <Copy className="h-3.5 w-3.5 text-[#9CA3AF] hover:text-[#2563EB]" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[#374151] mb-1.5">Workspace ingest token</p>
              <div className="flex items-center gap-2 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 font-mono text-xs text-[#111111]">
                <span className="flex-1">{showToken && activeWorkspaceId ? `vb_ingest_${activeWorkspaceId.replace(/-/g, "").slice(0, 16)}` : placeholderToken}</span>
                <button type="button" onClick={() => setShowToken((v) => !v)} className="text-[#9CA3AF] hover:text-[#2563EB]">
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button type="button" title="Rotate token (coming soon)" className="text-[#9CA3AF] hover:text-[#2563EB]">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[#9CA3AF]">Pass as <code className="bg-[#F3F4F6] px-1 rounded">x-vectorbea-token</code> request header. Never expose in client-side code.</p>
            </div>
          </div>
        </Section>

        {/* Python SDK */}
        <Section title="Python SDK — agent instrumentation" icon={Code2} badge="Python">
          <p className="text-xs text-[#6B7280]">Install: <code className="bg-[#F3F4F6] px-1 rounded">pip install vectorbea-sdk</code> (coming soon — use direct HTTP below in the meantime)</p>
          <CodeBlock lang="python" code={`import vectorbea

# Initialise once at application startup
vb = vectorbea.init(
    ingest_url="${ingestUrl}",
    ingest_token="vb_ingest_YOUR_TOKEN",
    workspace_id="${activeWorkspaceId ?? "YOUR_WORKSPACE_ID"}",
    environment="production",
    service_name="refund-agent",
    capture_inputs=True,
    capture_outputs=True,
    redact_secrets=True,   # strips keys: api_key, token, password, bearer…
    sample_rate=1.0,
    fail_open=True,        # if VectorBea is down, agent continues uninterrupted
)

# Start a root trace for one agent run
trace = vb.start_agent_run(
    capability_id="YOUR_CAPABILITY_ID",
    capability_version="v2",
    agent_name="RefundPolicyAgent",
    user_id=request.user_id,
    metadata={"channel": "web", "order_id": order_id},
)

# Instrument an LLM call
with trace.llm_call(provider="openai", model="gpt-4o-mini") as span:
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )
    span.record(
        input=messages,
        output=response.choices[0].message.content,
        tokens={"prompt": response.usage.prompt_tokens,
                "completion": response.usage.completion_tokens},
        cost_estimate=0.0004,
    )

# Instrument a tool call
with trace.tool_call(tool_name="checkRefundEligibility") as span:
    result = check_refund_eligibility(order_id=order_id)
    span.record(arguments={"order_id": order_id}, result=result)

# Instrument an MCP tool call
with trace.mcp_tool_call(server_name="shopify-mcp", tool_name="getOrder") as span:
    order = mcp_client.call("shopify-mcp", "getOrder", {"order_id": order_id})
    span.record(arguments={"order_id": order_id}, result=order)

# Finish the trace
trace.finish(
    final_response=agent_reply,
    outcome_status="success",
)
`} />
        </Section>

        {/* Direct HTTP / batch payload */}
        <Section title="Direct HTTP — batch event payload" icon={Layers} badge="JSON">
          <p className="text-xs text-[#6B7280]">
            POST a batch of typed events to <code className="bg-[#F3F4F6] px-1 rounded">/api/ingest/traces</code>.
            Returns <code className="bg-[#F3F4F6] px-1 rounded">202 Accepted</code> immediately.
          </p>
          <CodeBlock lang="json" code={`POST /api/ingest/traces
x-vectorbea-token: vb_ingest_YOUR_TOKEN
Content-Type: application/json

{
  "trace_id": "run_abc123",
  "workspace_id": "${activeWorkspaceId ?? "YOUR_WORKSPACE_ID"}",
  "capability_id": "YOUR_CAPABILITY_ID",
  "capability_version_id": "YOUR_VERSION_ID",
  "environment": "production",
  "user_id": "user_xyz",
  "events": [
    {
      "type": "agent_run_started",
      "timestamp": "2026-05-07T10:00:00Z",
      "metadata": { "user_input": "Refund my order #12345" }
    },
    {
      "type": "llm_call",
      "span_id": "span_1",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "input": "Classify intent for: Refund my order #12345",
      "output": "refund_request",
      "latency_ms": 320,
      "cost_estimate": 0.0002
    },
    {
      "type": "tool_call",
      "span_id": "span_2",
      "tool_name": "checkRefundEligibility",
      "arguments": { "order_id": "12345" },
      "result": { "eligible": true, "reason": "within_policy" },
      "latency_ms": 85,
      "status": "success"
    },
    {
      "type": "mcp_tool_call",
      "span_id": "span_3",
      "tool_name": "createRefund",
      "mcp_server_name": "shopify-mcp",
      "arguments": { "order_id": "12345", "amount": 49.99 },
      "result": { "refund_id": "ref_xyz", "status": "processed" },
      "latency_ms": 210,
      "status": "success"
    },
    {
      "type": "final_response",
      "final_response": "Your refund of $49.99 has been processed.",
      "outcome_status": "success"
    },
    {
      "type": "agent_run_finished",
      "timestamp": "2026-05-07T10:00:02Z"
    }
  ]
}`} />
          <p className="text-xs text-[#6B7280]">
            Response: <code className="bg-[#F3F4F6] px-1 rounded">{"{ \"accepted\": true, \"traceId\": \"uuid\" }"}</code>
          </p>
        </Section>

        {/* Proxy vs SDK */}
        <Section title="Proxy vs SDK responsibilities" icon={Activity}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4 space-y-2">
              <p className="font-semibold text-[#111111] text-xs">Proxy / Sidecar captures</p>
              <ul className="space-y-1 text-xs text-[#6B7280]">
                {["LLM provider (OpenAI, Anthropic…)", "Model name", "Prompt name + version", "Request & response bodies", "Latency", "Token counts + cost estimate"].map((item) => (
                  <li key={item} className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-[#16A34A] shrink-0" />{item}</li>
                ))}
              </ul>
              <p className="text-[11px] text-[#9CA3AF] pt-1 italic">Does NOT see internal tool calls unless SDK spans are also sent</p>
            </div>
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4 space-y-2">
              <p className="font-semibold text-[#111111] text-xs">SDK captures</p>
              <ul className="space-y-1 text-xs text-[#6B7280]">
                {["Agent root trace (start / finish)", "Tool call spans with arguments + results", "MCP tool call spans", "RAG retrieval spans", "Human handoff events", "Error events with stack context"].map((item) => (
                  <li key={item} className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-[#16A34A] shrink-0" />{item}</li>
                ))}
              </ul>
              <p className="text-[11px] text-[#9CA3AF] pt-1 italic">Best production setup: Proxy + SDK together</p>
            </div>
          </div>
        </Section>

        {/* Security + redaction */}
        <Section title="Security & secret redaction" icon={Shield}>
          <p className="text-xs text-[#6B7280]">
            VectorBea automatically redacts the following keys from all payloads before storage. You should also set{" "}
            <code className="bg-[#F3F4F6] px-1 rounded">redact_secrets=True</code> in the SDK to redact before sending.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {["authorization", "api_key", "apikey", "password", "secret", "token", "bearer", "private_key", "client_secret", "access_token", "refresh_token", "ssn", "credit_card"].map((key) => (
              <code key={key} className="rounded-md bg-[#FEF2F2] border border-[#FECACA] px-2 py-0.5 text-[11px] text-[#991B1B] font-mono">{key}</code>
            ))}
          </div>
          <p className="text-xs text-[#6B7280]">
            Bearer tokens matching <code className="bg-[#F3F4F6] px-1 rounded">Bearer [token]</code> in string values are also replaced with{" "}
            <code className="bg-[#F3F4F6] px-1 rounded">[REDACTED]</code>.
          </p>
        </Section>

        {/* SDK config reference */}
        <Section title="SDK configuration reference" icon={Code2} badge="Config">
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E7DED1]">
                  <th className="text-left py-2 pr-4 font-semibold text-[#374151]">Option</th>
                  <th className="text-left py-2 pr-4 font-semibold text-[#374151]">Default</th>
                  <th className="text-left py-2 font-semibold text-[#374151]">Description</th>
                </tr>
              </thead>
              <tbody className="text-[#6B7280]">
                {[
                  ["ingest_url", "required", "VectorBea ingest endpoint URL"],
                  ["ingest_token", "required", "Workspace ingest token (x-vectorbea-token)"],
                  ["workspace_id", "required", "Your VectorBea workspace ID"],
                  ["environment", `"production"`, "Tag traces with deployment env"],
                  ["capture_inputs", "true", "Include LLM prompt inputs in traces"],
                  ["capture_outputs", "true", "Include LLM outputs in traces"],
                  ["redact_secrets", "true", "Strip sensitive keys before sending"],
                  ["sample_rate", "1.0", "Fraction of traces to send (0.0–1.0)"],
                  ["fail_open", "true", "If VectorBea is unavailable, continue silently"],
                  ["batch_size", "50", "Max events per HTTP request"],
                  ["flush_interval_ms", "5000", "How often to flush the local event buffer"],
                ].map(([opt, def, desc]) => (
                  <tr key={opt} className="border-b border-[#F1ECE3]">
                    <td className="py-2 pr-4 font-mono text-[#111111]">{opt}</td>
                    <td className="py-2 pr-4 font-mono text-[#6B7280]">{def}</td>
                    <td className="py-2">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* OpenTelemetry */}
        <Section title="OpenTelemetry span mapping" icon={Activity} badge="OTEL">
          <p className="text-xs text-[#6B7280]">
            VectorBea maps standard OTEL span names to its trace model. Use these span names when emitting
            from an OpenTelemetry-instrumented agent (not all OTEL exporters are supported yet):
          </p>
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E7DED1]">
                  <th className="text-left py-2 pr-4 font-semibold text-[#374151]">OTEL span name</th>
                  <th className="text-left py-2 font-semibold text-[#374151]">VectorBea event type</th>
                </tr>
              </thead>
              <tbody className="text-[#6B7280]">
                {[
                  ["agent.run", "agent_run_started / agent_run_finished"],
                  ["llm.call", "llm_call"],
                  ["tool.call", "tool_call"],
                  ["mcp.tool.call", "mcp_tool_call"],
                  ["rag.retrieve", "rag_retrieve"],
                  ["rag.rerank", "rerank"],
                  ["response.final", "final_response"],
                  ["human.handoff", "human_handoff"],
                ].map(([otel, vb]) => (
                  <tr key={otel} className="border-b border-[#F1ECE3]">
                    <td className="py-2 pr-4 font-mono text-[#2563EB]">{otel}</td>
                    <td className="py-2 font-mono text-[#111111]">{vb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

      </div>
    </div>
  );
}
