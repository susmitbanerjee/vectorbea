export const metadata = {
  title: "SDK and Ingestion - VectorBea Docs",
};

import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-border/70 bg-stone-950 px-4 py-4 text-sm leading-7 text-stone-100 shadow-sm">
      <code>{code}</code>
    </pre>
  );
}

export default function SdkAndIngestionDocsPage() {
  return (
    <DocsPage
      eyebrow="SDK and Ingestion"
      title="Instrument agents, tools, and MCP workflows with the right production transport"
      lede="VectorBea supports Direct API, SDK, Sidecar, and OpenTelemetry integration modes. For enterprise production workloads, the recommended path is SDK or OpenTelemetry emitting semantic workflow events locally into the VectorBea sidecar, which batches, redacts, buffers, and forwards telemetry to the backend"
    >
      <DocsSection
        id="integration-modes"
        title="Integration modes"
        description="Use the direct API for quick testing, and move to Sidecar for production-grade transport."
      >
        <DocsTable
          headers={["Mode", "Best for", "Recommendation"]}
          rows={[
            ["Direct API", "Quick local testing and one-off debugging", "Testing only"],
            ["SDK", "Capturing agent, tool, MCP, and business outcome semantics", "Use with Sidecar in production"],
            ["Sidecar", "Enterprise production ingestion with local transport, buffering, retry, and redaction", "Recommended"],
            ["OpenTelemetry", "Teams already emitting standard traces", "Use with Sidecar when possible"],
          ]}
        />
        <DocsCallout title="Recommended enterprise path">
          SDK or OpenTelemetry emits semantic agent workflow events locally.
          The VectorBea sidecar receives them over localhost or UDS, batches and
          redacts them, forwards them with an ingest token, and the backend turns
          them into execution graphs, workflow maps, regressions, governance, and ROI.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="what-it-does"
        title="What this section covers"
        description="This page explains ingestion mechanics and integration patterns. Workspace specific token management remains available in the SDK setup page inside the app."
      >
        <DocsCardGrid>
          <DocsCard
            title="SDK instrumentation"
            description="Capture agent runs, tool calls, MCP calls, handoffs, and workflow outcomes directly from your service code"
          />
          <DocsCard
            title="Sidecar based ingestion"
            description="Capture workflow telemetry locally through the VectorBea sidecar without sending production agent traffic directly from the app to the hosted backend"
          />
          <DocsCard
            title="Trace schema"
            description="Represent agent runs as ordered workflow events with model calls, tool spans, outcomes, costs, and governance metadata"
          />
          <DocsCard
            title="Operational safety"
            description="Authenticate writes with workspace scoped ingest tokens and redact secrets before traces are stored"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="capture-model"
        title="How agent traces are represented"
        description="VectorBea is designed for production AI systems that do more than return text. A workflow trace can include model calls, tools, MCP steps, retries, policy checks, and final outcomes."
      >
        <DocsTable
          headers={["Trace element", "What it captures", "Why it matters"]}
          rows={[
            ["Agent run", "Capability, version, environment, start and finish state", "Lets teams measure workflow success and regression by version"],
            ["LLM call", "Provider, model, prompt version, latency, token counts, estimated cost", "Supports provider comparison, ROI analysis, and failure attribution"],
            ["Tool call", "Tool name, arguments, results, errors", "Enables deterministic workflow validation and incident debugging"],
            ["MCP tool call", "MCP server, tool, arguments, results, failures", "Makes agent workflow correctness visible across MCP boundaries"],
            ["Outcome event", "Success, human handoff, blocked, timeout, partial success", "Powers business outcome checks and automation success reporting"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="proxy-vs-sdk"
        title="How proxy and SDK capture differ"
        description="Most teams use both. The proxy or sidecar captures model traffic cleanly, while SDK spans describe internal workflow logic and tool behavior."
      >
        <DocsCardGrid>
          <DocsCard
            title="Proxy or sidecar captures"
            description="Provider, model, request timing, token usage, prompt version context, and output metadata for model traffic"
          />
          <DocsCard
            title="SDK captures"
            description="Agent run boundaries, tool spans, MCP spans, retrieval steps, retries, human handoffs, and deterministic workflow evidence"
          />
        </DocsCardGrid>
        <DocsCallout title="Recommended production pattern">
          Use SDK plus Sidecar together when you want both semantic workflow
          correctness and production-safe transport. Sidecar is the preferred
          enterprise path because it handles local ingestion, batching, retry,
          redaction, and fail-open behavior without making your application call
          the VectorBea cloud directly on every workflow step
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="sidecar"
        title="Sidecar as the enterprise production path"
        description="The existing Kotlin GraalVM sidecar is the recommended enterprise ingestion layer for production agent workloads."
      >
        <DocsCardGrid>
          <DocsCard
            title="Why use Sidecar"
            description="Low latency local ingestion, batching, retry, buffering, redaction, fail-open behavior, and production-safe backend forwarding through an ingest token"
          />
          <DocsCard
            title="Where it runs"
            description="Next to your agent service in Docker or Kubernetes, communicating locally over localhost or a shared Unix domain socket"
          />
        </DocsCardGrid>
        <CodeBlock
          code={`App or SDK
  ↓ local HTTP or UDS
VectorBea Sidecar
  ↓ batched forward with ingest token
VectorBea Backend
  ↓
workflow map, execution graph, regression, safety gates, governance, ROI`}
        />
        <CodeBlock
          code={`VECTORBEA_INGEST_URL=https://your-vectorbea-domain/api/ingest/traces
VECTORBEA_INGEST_TOKEN=your_generated_ingest_token
VECTORBEA_SERVICE_NAME=refund-agent
VECTORBEA_ENVIRONMENT=production
VECTORBEA_SOCKET_PATH=/var/run/vectorbea/vectorbea.sock
VECTORBEA_LOCAL_HTTP_PORT=8686`}
        />
      </DocsSection>

      <DocsSection
        id="kubernetes"
        title="Kubernetes sidecar pattern"
        description="Run the sidecar in the same pod as the agent service and share a socket volume when you want UDS transport."
      >
        <CodeBlock
          code={`volumes:
  - name: vectorbea-socket
    emptyDir: {}

containers:
  - name: app
    volumeMounts:
      - name: vectorbea-socket
        mountPath: /var/run/vectorbea

  - name: vectorbea-sidecar
    image: vectorbea/vectorbea-proxy:latest
    env:
      - name: VECTORBEA_INGEST_URL
        value: https://your-vectorbea-domain/api/ingest/traces
      - name: VECTORBEA_INGEST_TOKEN
        valueFrom: ...
      - name: VECTORBEA_SERVICE_NAME
        value: refund-agent
      - name: VECTORBEA_SOCKET_PATH
        value: /var/run/vectorbea/vectorbea.sock
    volumeMounts:
      - name: vectorbea-socket
        mountPath: /var/run/vectorbea`}
        />
      </DocsSection>

      <DocsSection
        id="token-format"
        title="Ingest token format and compatibility"
        description="VectorBea currently keeps the existing vb_li_ token prefix for backward compatibility. Existing deployments may already depend on that format."
      >
        <DocsCardGrid>
          <DocsCard
            title="Current supported format"
            description="Workspace scoped ingest tokens are currently issued with the vb_li_ prefix"
          />
          <DocsCard
            title="Compatibility expectation"
            description="Existing vb_li_ tokens remain supported. A future additive prefix may be introduced, but current deployments should not be forced into a breaking token migration"
          />
        </DocsCardGrid>
        <DocsCallout title="Operator note">
          The ingestion API accepts the current workspace ingest token format and
          the SDK page uses the token generated for your workspace. Do not hardcode
          assumptions about future prefixes into downstream systems
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="authentication"
        title="How ingestion authentication works"
        description="Ingestion accepts a workspace scoped token through either the Authorization header or the dedicated ingest-token header."
      >
        <DocsTable
          headers={["Header", "Expected value", "Notes"]}
          rows={[
            ["Authorization", "Bearer your_generated_ingest_token", "Preferred format for SDKs, sidecars, and backend services"],
            ["x-vectorbea-ingest-token", "your_generated_ingest_token", "Supported for environments that cannot easily set Bearer auth"],
          ]}
        />
        <CodeBlock
          code={`curl -X POST https://your-vectorbea-domain/api/ingest/traces \\
  -H "Authorization: Bearer $VECTORBEA_INGEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "events": [] }'`}
        />
      </DocsSection>

      <DocsSection
        id="sdk-config"
        title="Example environment and SDK configuration"
        description="Use the generated token from your workspace settings. Do not expose it in browser bundles or mobile apps."
      >
        <CodeBlock
          code={`VECTORBEA_INGEST_TOKEN=your_generated_ingest_token
VECTORBEA_INGEST_URL=https://your-vectorbea-domain/api/ingest/traces`}
        />
        <CodeBlock
          code={`VectorBea.init({
  ingestUrl: "https://your-vectorbea-domain/api/ingest/traces",
  ingestToken: process.env.VECTORBEA_INGEST_TOKEN,
  environment: "production",
  serviceName: "refund-agent"
})`}
        />
      </DocsSection>

      <DocsSection
        id="otel"
        title="How OpenTelemetry mapping fits"
        description="If you already emit OpenTelemetry spans, you can map agent and tool spans into VectorBea event types before posting them to the ingestion endpoint."
      >
        <DocsTable
          headers={["OpenTelemetry span", "VectorBea event", "Typical use"]}
          rows={[
            ["agent.run", "agent_run_started and agent_run_finished", "Overall workflow lifecycle"],
            ["llm.call", "llm_call", "Model request and response telemetry"],
            ["tool.call", "tool_call", "Internal tool invocation"],
            ["mcp.tool.call", "mcp_tool_call", "MCP server tool execution"],
            ["human.handoff", "human_handoff", "Escalation into operator flow"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="redaction-and-fail-open"
        title="Redaction and fail open behavior"
        description="Security and reliability controls are part of ingestion, not an afterthought."
      >
        <DocsCardGrid>
          <DocsCard
            title="Redaction"
            description="Provider keys, authorization headers, obvious secrets, and configured sensitive fields can be masked before trace storage"
          />
          <DocsCard
            title="Fail open"
            description="SDK and ingestion clients can be configured so application workflows continue if VectorBea is temporarily unreachable"
          />
        </DocsCardGrid>
        <DocsCallout title="Security guidance">
          Use ingest tokens only from backend services, sidecars, proxies, or
          other secure server environments. Rotate tokens if they are leaked.
          Revoked tokens can no longer write traces. Raw token values are shown
          only once after creation or rotation
        </DocsCallout>
      </DocsSection>
    </DocsPage>
  );
}
