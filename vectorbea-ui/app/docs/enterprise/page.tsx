export const metadata = {
  title: "Enterprise - VectorBea Docs",
};

import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

export default function EnterprisePage() {
  return (
    <DocsPage
      eyebrow="Enterprise"
      title="Built for governance, isolation, and real deployment boundaries"
      lede="VectorBea is designed for organizations that need prompt lifecycle control, workspace isolation, and deployment patterns that fit existing security and procurement processes"
    >
      <DocsSection
        id="operating-model"
        title="Operating model"
        description="Enterprise teams usually need autonomy for delivery teams and control for platform owners. VectorBea is structured to give both."
      >
        <DocsTable
          headers={["Layer", "What it governs", "Typical owner"]}
          rows={[
            ["Organization", "Billing, seat policy, and top-level administration", "Platform or engineering leadership"],
            ["Workspace", "Prompt inventory, sidecars, audit visibility, and team membership", "Product or service team"],
            ["Prompt version", "Draft, review, publish, and rollback workflow", "Editors and maintainers"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="rbac"
        title="Workspace-scoped RBAC"
        description="Access stays close to the work. Users can be an admin in one workspace, an editor in another, and completely absent from the rest."
      >
        <DocsCardGrid>
          <DocsCard
            title="Admin"
            description="Manages members, keys, sidecars, and workspace-level settings"
          />
          <DocsCard
            title="Editor"
            description="Creates prompts, publishes versions, and iterates safely inside the assigned workspace"
          />
          <DocsCard
            title="Viewer"
            description="Reads prompts, deployment status, and audit visibility without write access"
          />
          <DocsCard
            title="Scoped access"
            description="Workspace membership is the boundary. Teams do not inherit access simply because they belong to the same organization"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="isolation"
        title="Isolation and enforcement"
        description="Enterprise isolation has to be more than a visual boundary in the UI. VectorBea enforces the workspace boundary in the persistence layer and in the runtime surface."
      >
        <DocsCardGrid>
          <DocsCard
            title="Workspace isolation"
            description="Prompt inventory, audit logs, and deployments remain scoped to the workspace where they were created"
          />
          <DocsCard
            title="Database enforcement"
            description="Row-level security keeps unauthorized reads and writes from succeeding even if a client or route overreaches"
          />
          <DocsCard
            title="Deployment scoping"
            description="Sidecar tokens are issued per workspace so runtime access aligns with the same organizational boundary"
          />
          <DocsCard
            title="Operational visibility"
            description="Audit logs and infrastructure status stay attributable to the team and environment that generated them"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="security"
        title="Security posture"
        description="The product is designed to fit common enterprise review questions about residency, network topology, and execution boundaries."
      >
        <DocsCardGrid>
          <DocsCard
            title="No inbound requirement"
            description="The sidecar communicates over outbound HTTPS, which avoids opening inbound firewall paths into customer networks"
          />
          <DocsCard
            title="Runtime stays local"
            description="Applications call the sidecar locally and continue to use their existing model providers and secret stores"
          />
          <DocsCard
            title="Governance in the control plane"
            description="Publication history, membership, and operational inventory stay visible without moving model traffic into the hosted platform"
          />
          <DocsCard
            title="Auditable change path"
            description="Teams can review what changed, when it was published, and which version served a given request"
          />
        </DocsCardGrid>
        <DocsCallout title="Procurement-friendly architecture">
          Enterprise buyers typically need a clean answer to one question: where does
          the runtime data go. With VectorBea, runtime traffic and secrets stay in
          the customer environment while the hosted platform manages policy and
          metadata
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="billing"
        title="Seat-aware governance"
        description="Billing is tied to active users and workspaces instead of abstract infrastructure units, which keeps financial controls aligned with real platform usage."
      >
        <DocsTable
          headers={["Control", "Why it matters"]}
          rows={[
            ["Per-seat Team plan", "Matches how engineering organizations allocate software access and procurement budgets"],
            ["Workspace-aware growth", "Lets teams expand deployments without flattening every cost into infrastructure spend"],
            ["Organization visibility", "Gives platform owners a single place to review usage and capacity trends"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="recommended-model"
        title="Recommended enterprise model"
        description="A clean starting point is usually enough to support both smaller teams and large platform rollouts."
      >
        <ol className="space-y-3 text-sm leading-7 text-muted-foreground">
          <li>1. Create one organization per business entity or tenant boundary</li>
          <li>2. Create one workspace per team, environment, or risk boundary</li>
          <li>3. Register sidecars close to each service boundary that needs prompt delivery</li>
          <li>4. Restrict editor access to the teams that actively own those prompts</li>
          <li>5. Use publication and audit trails as the operational path into production</li>
        </ol>
      </DocsSection>
    </DocsPage>
  );
}
