export const metadata = {
  title: "Operations and Migrations - VectorBea Docs",
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

export default function OperationsAndMigrationsDocsPage() {
  return (
    <DocsPage
      eyebrow="Operations"
      title="Operations and migrations for governance and ingestion changes"
      lede="Apply staging first, validate ingestion and governance paths, then promote the same schema changes to production. This page keeps the migration order, verification checks, and operator expectations in one place"
    >
      <DocsSection
        id="required-migrations"
        title="Required migrations"
        description="Operators should apply these migrations in order when enabling the governance and ingest-token work that powers incidents, policy packs, approvals, privacy controls, and SDK trace ingestion."
      >
        <DocsTable
          headers={["Order", "Migration file", "Purpose"]}
          rows={[
            ["1", "20260506_governance_incidents_controls.sql", "Adds governance, incidents, policy packs, approval workflow, audit events, and privacy control tables"],
            ["2", "20260508_ingest_tokens.sql", "Adds workspace scoped ingest tokens for SDK, sidecar, proxy, and agent trace ingestion authentication"],
          ]}
        />
      </DocsSection>

      <DocsSection
        id="verification-checklist"
        title="Verification checklist"
        description="After applying both migrations, verify the core runtime and governance flows before promoting the change to production."
      >
        <DocsCardGrid>
          <DocsCard
            title="Schema checks"
            description="Confirm ingest token, policy pack, incident, and audit tables exist before testing the UI"
          />
          <DocsCard
            title="Ingestion checks"
            description="Create a token, send a test trace, confirm token auth succeeds, and confirm revoked tokens fail"
          />
          <DocsCard
            title="Governance checks"
            description="Confirm the Policy Packs page loads, incidents pages load, and audit history records new actions"
          />
          <DocsCard
            title="Plan checks"
            description="Free and Plus should preview policy packs only, while Pro and Enterprise can apply them"
          />
        </DocsCardGrid>
        <CodeBlock
          code={`select to_regclass('vectorbea.ingest_tokens');
select to_regclass('vectorbea.policy_packs');
select to_regclass('vectorbea.ai_incidents');
select to_regclass('vectorbea.audit_events');`}
        />
      </DocsSection>

      <DocsSection
        id="policy-pack-gating"
        title="Policy Pack plan behavior"
        description="The current gating behavior is intentional and should remain in place."
      >
        <DocsTable
          headers={["Plan", "Preview system packs", "Apply packs to capabilities"]}
          rows={[
            ["Free", "Yes", "No"],
            ["Plus", "Yes", "No"],
            ["Pro", "Yes", "Yes"],
            ["Enterprise", "Yes", "Yes"],
          ]}
        />
        <DocsCallout title="Expected operator outcome">
          If a Free or Plus workspace can preview system packs but cannot apply
          them, the system is behaving correctly. If a Pro workspace cannot apply
          packs, verify the latest code and migrations are deployed rather than
          falling back to older feature assumptions
        </DocsCallout>
      </DocsSection>

      <DocsSection
        id="deployment-guidance"
        title="Deployment guidance"
        description="Schema changes that touch governance and ingestion should be validated on a staging environment first."
      >
        <ol className="space-y-3 text-sm leading-7 text-muted-foreground">
          <li>1. Apply the migrations to staging in the order shown above</li>
          <li>2. Verify SDK token creation, rotation, and revocation in staging</li>
          <li>3. Verify trace ingestion with a workspace token succeeds</li>
          <li>4. Verify the Policy Packs page loads and locked preview behavior is correct</li>
          <li>5. Verify governance pages such as incidents and audit history load cleanly</li>
          <li>6. Promote the same migrations to production after validation completes</li>
        </ol>
      </DocsSection>

      <DocsSection
        id="rollback-note"
        title="Rollback note"
        description="No destructive rollback script is documented here."
      >
        <DocsCallout title="Safe rollback posture">
          Handle rollback through database backups, manual migration review, and a
          controlled release process. Do not run ad hoc destructive SQL in
          production as a substitute for a rollback plan
        </DocsCallout>
      </DocsSection>
    </DocsPage>
  );
}
