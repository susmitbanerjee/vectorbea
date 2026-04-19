export const metadata = {
  title: "Architecture - VectorBea Docs",
};

import { ArchitectureDiagram } from "@/components/docs/architecture-diagram";
import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

export default function ArchitecturePage() {
  return (
    <DocsPage
      eyebrow="Architecture"
      title="How VectorBea separates governance from execution"
      lede="VectorBea runs as a two-plane system: a hosted control plane for prompt governance and a local sidecar inside your environment for low-latency delivery, audit capture, and privacy-preserving execution"
    >
      <DocsSection
        id="overview"
        title="The two-plane model"
        description="The product is designed for teams with their own services, networks, and deployment pipelines. The hosted platform manages state and policy while your application continues to run where it already lives."
      >
        <DocsCardGrid>
          <DocsCard
            title="Control plane"
            description="VectorBea hosts the dashboard, publication workflow, access control, billing state, and deployment inventory"
          />
          <DocsCard
            title="Data plane"
            description="Your application talks to a local VectorBea Sidecar running inside your VPC, cluster, or host environment"
          />
        </DocsCardGrid>
        <DocsCallout title="What stays local">
          Prompt fetches resolve from the local sidecar, model traffic stays in your
          environment, and your application code does not need to embed prompt text
          directly in source
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="boundary"
        title="System boundary"
        description="This is the operating boundary external teams should design around when integrating VectorBea into an existing stack."
      >
        <ArchitectureDiagram />
      </DocsSection>

      <DocsSection
        id="responsibilities"
        title="What each side is responsible for"
        description="The cleanest deployments keep prompt governance in the control plane and runtime execution in the customer environment."
      >
        <DocsTable
          headers={["Layer", "Primary responsibility", "Examples"]}
          rows={[
            [
              "VectorBea control plane",
              "Govern prompts, memberships, publication state, billing, and deployment visibility",
              "Next.js dashboard, Supabase-backed state, prompt versions, RBAC",
            ],
            [
              "VectorBea Sidecar",
              "Serve prompts locally, emit audits, and keep a narrow outbound connection to the control plane",
              "GET /v1/prompts/{name}, POST /v1/audit, 30s heartbeats",
            ],
            [
              "Customer application",
              "Call the sidecar instead of hardcoding prompt text in code",
              "Python services, Node backends, worker jobs, AI microservices",
            ],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="components"
        title="Components in the current build"
        description="The runtime is intentionally small: one hosted control plane, one sidecar container per environment, and a thin SDK in the caller."
      >
        <DocsTable
          headers={["Component", "Runtime", "What it does"]}
          rows={[
            [
              "Control plane (vectorbea-ui)",
              "Next.js 15 + Supabase",
              "Dashboard, prompt publication, workspace RBAC, heartbeat and audit ingest endpoints",
            ],
            [
              "Sidecar (vectorbea-proxy)",
              "GraalVM native-image Kotlin, single container",
              "Prompt fetch with in-memory cache, audit batch dispatch, heartbeat with live CPU/memory/latency, HTTP on :8080 plus optional Unix sockets for REST and gRPC",
            ],
            [
              "Client SDK",
              "Python (pip install vectorbea)",
              "Calls the local sidecar over HTTP or UDS; no direct control plane dependency at runtime",
            ],
          ]}
        />
        <DocsCallout title="One container, not two">
          The sidecar is a single native binary. Prompt syncing, heartbeats, and
          audit flushing all run inside the proxy process — there is no separate
          agent container, shared volume, or Docker socket mount to operate.
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="network-model"
        title="Network model"
        description="VectorBea is designed to fit enterprise firewall and residency constraints with the smallest possible network surface."
      >
        <DocsCardGrid>
          <DocsCard
            title="Outbound only"
            description="Your sidecar initiates HTTPS connections to the control plane. VectorBea does not need inbound access into your network."
          />
          <DocsCard
            title="Local fetch path"
            description="Applications fetch prompts from localhost or a same-cluster sidecar endpoint, which keeps hot-path latency local."
          />
          <DocsCard
            title="No runtime prompt editing in code"
            description="Prompt publication happens in the dashboard. Your services keep the same fetch call while the published version changes behind it."
          />
          <DocsCard
            title="Privacy boundary"
            description="The hosted platform manages policy and metadata. Runtime traffic and secrets remain inside the customer environment."
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="runtime-flow"
        title="Runtime request flow"
        description="A typical production request keeps the latency-sensitive work close to the calling service."
      >
        <ol className="space-y-3 text-sm leading-7 text-muted-foreground">
          <li>1. The application requests a published prompt by name from the local sidecar over HTTP on :8080 or a Unix socket</li>
          <li>2. The sidecar serves from its in-memory cache, or fetches once from the control plane and caches the result</li>
          <li>3. The application renders the prompt with request-specific variables and calls its model provider directly — model traffic never crosses the VectorBea boundary</li>
          <li>4. The sidecar batches audit events and posts them to the control plane, and emits a heartbeat with CPU, memory, and average latency every 30 seconds</li>
        </ol>
      </DocsSection>

      <DocsSection
        id="design-principle"
        title="Why the architecture matters"
        description="The architecture is opinionated because enterprise AI systems usually fail at the boundaries between product teams, platform teams, and security teams."
      >
        <DocsCallout title="The design principle">
          The Enterprise AI Infrastructure Platform manages prompt governance in the
          cloud while the VectorBea Sidecar keeps execution close to your services,
          so teams can ship faster without giving up privacy, network control, or
          operational clarity
        </DocsCallout>
      </DocsSection>
    </DocsPage>
  );
}
