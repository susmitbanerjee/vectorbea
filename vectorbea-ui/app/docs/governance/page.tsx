export const metadata = {
  title: "Governance - VectorBea Docs",
};

import {
  DocsCallout,
  DocsCard,
  DocsCardGrid,
  DocsPage,
  DocsSection,
  DocsTable,
} from "@/components/docs/docs-primitives";

export default function GovernanceDocsPage() {
  return (
    <DocsPage
      eyebrow="Governance"
      title="Governance, policy packs, and production controls"
      lede="VectorBea connects reliability, workflow evidence, incidents, policy checks, and privacy controls so teams can govern production AI systems with deterministic evidence rather than relying on a fuzzy judge loop"
    >
      <DocsSection
        id="governance-scope"
        title="What governance includes"
        description="Governance in VectorBea covers more than rule storage. It ties incidents, blocked rollouts, approvals, privacy, and policy packs back to the capability and workflow traces that produced them."
      >
        <DocsCardGrid>
          <DocsCard
            title="Incidents and verification"
            description="Track production failures, link them back to workflow traces, and verify fixes through regression runs before closing the loop"
          />
          <DocsCard
            title="Policy packs"
            description="Apply sector specific deterministic rules for BFSI, healthcare, pharma, retail, software support, travel, and general AI governance"
          />
          <DocsCard
            title="Approvals and audit"
            description="Require human approval for high risk rollouts and keep an audit history of critical governance actions"
          />
          <DocsCard
            title="Privacy controls"
            description="Mask obvious secrets, configure redaction rules, and restrict raw capture based on workspace policy"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection
        id="policy-packs"
        title="Policy Pack plan behavior"
        description="Policy pack preview and apply access are intentionally different so evaluation teams can inspect sector packs before upgrading."
      >
        <DocsTable
          headers={["Plan", "Preview system packs", "Apply system packs", "Custom workspace packs"]}
          rows={[
            ["Free", "Yes", "No", "No"],
            ["Plus", "Yes", "No", "No"],
            ["Pro", "Yes", "Yes", "If enabled in product"],
            ["Enterprise", "Yes", "Yes", "Yes, with future locked-pack controls"],
          ]}
        />
        <DocsCallout title="Important gating note">
          Free and Plus preview is expected and should remain available. Apply
          stays locked to Pro and Enterprise. That lets teams understand what a
          policy pack would enforce before they move to a higher control tier
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="sector-packs"
        title="Sector policy packs"
        description="VectorBea ships with system packs that reflect common enterprise risk controls by domain."
      >
        <DocsCardGrid>
          <DocsCard
            title="Retail"
            description="Examples include refund eligibility checks before refund creation, inventory checks before promise, and approval rules for high discounts"
          />
          <DocsCard
            title="BFSI and insurance"
            description="Examples include PII masking, high risk transaction checks, evidence for eligibility decisions, and mandatory human review for sensitive flows"
          />
          <DocsCard
            title="Healthcare and pharma"
            description="Examples include escalation for emergency symptoms, restrictions on diagnosis or medication change advice, and approved-source requirements"
          />
          <DocsCard
            title="Software and travel"
            description="Examples include secret exposure prevention, destructive action approval, booking availability checks, and verified customer-contact checks"
          />
        </DocsCardGrid>
      </DocsSection>
    </DocsPage>
  );
}
