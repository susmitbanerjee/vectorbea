export const metadata = {
  title: "Security - VectorBea Docs",
};

import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
} from "@/components/docs/docs-primitives";

export default function SecurityPage() {
  return (
    <DocsPage
      eyebrow="Security"
      title="Security and deployment controls for enterprise environments"
      lede="VectorBea is designed to help teams separate prompt governance from runtime execution while preserving the network, privacy, and access boundaries enterprise environments already depend on"
    >
      <DocsSection
        id="network"
        title="Network model"
        description="The sidecar only requires outbound connectivity to the control plane, which keeps the deployment model compatible with strict firewall policies."
      >
        <DocsCardGrid>
          <DocsCard
            title="Outbound HTTPS only"
            description="Sidecars initiate the connection to VectorBea. There is no requirement for inbound access into the customer environment"
          />
          <DocsCard
            title="Local application path"
            description="Your service fetches prompts locally from the sidecar, which reduces exposure and keeps latency predictable"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="data"
        title="Data boundary"
        description="The runtime boundary is intentionally narrow so teams can adopt VectorBea without moving sensitive application traffic into a third-party control plane."
      >
        <DocsCardGrid>
          <DocsCard
            title="Secrets stay local"
            description="Model provider credentials and application secrets remain in the customer environment"
          />
          <DocsCard
            title="Prompt delivery stays local"
            description="Applications fetch prompts from the sidecar, not directly from the hosted control plane on every request"
          />
          <DocsCard
            title="Control-plane metadata"
            description="The hosted platform stores governance state, publication metadata, deployment inventory, and billing state"
          />
          <DocsCard
            title="Auditable activity"
            description="Operational metadata can be reviewed centrally without forcing model execution into the hosted platform"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="tokens"
        title="Token model"
        description="VectorBea separates user access from deployment access so the runtime footprint remains controlled."
      >
        <DocsCardGrid>
          <DocsCard
            title="Workspace API keys"
            description="Used by application and control-plane integrations where workspace-level access is appropriate"
          />
          <DocsCard
            title="Sidecar tokens"
            description="Issued per registered sidecar so runtime deployments stay scoped to the workspace that owns them"
          />
        </DocsCardGrid>
        <DocsCallout title="Why the distinction matters">
          Separating user, workspace, and sidecar credentials makes it easier to
          rotate runtime access independently from human access and keeps deployment
          incidents easier to isolate
        </DocsCallout>
      </DocsSection>
    </DocsPage>
  );
}
