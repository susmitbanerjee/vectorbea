export const metadata = {
  title: "Integrations - VectorBea Docs",
};

import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

export default function IntegrationsPage() {
  return (
    <DocsPage
      eyebrow="Integrations"
      title="Connect VectorBea to the services you already run"
      lede="VectorBea is designed to slot into existing Python services, Node backends, worker jobs, and container platforms without forcing teams to rebuild their application architecture"
    >
      <DocsSection
        id="sdk-options"
        title="SDK and runtime options"
        description="The fastest path is to run the sidecar locally and point your application at the local endpoint. That pattern works across languages and deployment environments."
      >
        <DocsTable
          headers={["Integration path", "Best for", "Typical endpoint"]}
          rows={[
            ["Python SDK", "Backend services, workers, and AI orchestration jobs", "http://localhost:8080"],
            ["Node SDK", "API routes, service layers, and internal tools", "http://localhost:8080"],
            ["Raw HTTP", "Polyglot environments or custom runtimes", "GET /v1/prompts/{name}"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="deployment-patterns"
        title="Deployment patterns"
        description="Teams usually adopt one of these patterns depending on where the application already runs."
      >
        <DocsCardGrid>
          <DocsCard
            title="Local development"
            description="Run the sidecar with docker on your workstation and call localhost from your SDK or scripts"
          />
          <DocsCard
            title="Single-host container apps"
            description="Run the sidecar alongside your service with docker compose or another host-level process manager"
          />
          <DocsCard
            title="Kubernetes sidecar"
            description="Inject the sidecar into the same pod as the calling service to keep prompt fetches on the local network path"
          />
          <DocsCard
            title="Dedicated service per boundary"
            description="Use one sidecar deployment per team, environment, or risk boundary when stronger segmentation is needed"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="observability"
        title="Operational signals"
        description="The platform is most useful when teams can connect prompt delivery with application behavior and deployment health."
      >
        <DocsCardGrid>
          <DocsCard
            title="Audit visibility"
            description="Every prompt fetch and logged completion can be tied back to a prompt name, version, and environment context"
          />
          <DocsCard
            title="Infrastructure health"
            description="Heartbeat and deployment state show whether a sidecar is online, stale, or unavailable"
          />
          <DocsCard
            title="Latency awareness"
            description="P99 prompt delivery and downstream model timings can be reviewed without building a separate prompt-specific dashboard"
          />
          <DocsCard
            title="Team-level ownership"
            description="Workspace scoping keeps deployment and audit views aligned with the team that owns the service"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="workflow"
        title="Typical rollout workflow"
        description="Most teams adopt VectorBea in stages rather than all at once."
      >
        <ol className="space-y-3 text-sm leading-7 text-muted-foreground">
          <li>1. Create and publish prompts in a workspace</li>
          <li>2. Register a sidecar for the target environment</li>
          <li>3. Run the sidecar close to the calling service</li>
          <li>4. Replace hardcoded prompt strings with local prompt fetches</li>
          <li>5. Review audit data and publish new versions without changing application code</li>
        </ol>
        <DocsCallout title="Recommended default">
          If your team is deciding between several deployment models, start with one
          sidecar per service boundary and one workspace per team or environment.
          That gives the cleanest ownership model and keeps audit data easy to
          understand
        </DocsCallout>
      </DocsSection>
    </DocsPage>
  );
}
