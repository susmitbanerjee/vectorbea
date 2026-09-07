import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { LegalPage, LegalSection, LegalP, LegalList, LegalNote } from "@/components/marketing/legal";
import { createMetadata, SITE } from "@/lib/seo";
import { SUBPROCESSORS_REVIEWED } from "@/lib/marketing/subprocessors";

/* ══════════════════════════════════════════════════════════════════════════════
   DATA PROCESSING ADDENDUM.

   ── WHY A PLATFORM LIKE THIS NEEDS ONE BEFORE IT TAKES MONEY ────────────────
   Any EU or UK customer putting personal data through a workflow is a controller
   using us as a processor, and Article 28 requires that relationship to be in
   writing before it starts. Without a DPA they cannot lawfully use the product,
   which makes this document a sales blocker as much as a legal one.

   ── THE SUBPROCESSOR LIST IS INCORPORATED, NOT SUMMARISED ───────────────────
   Section 5 points at the published list rather than restating it. A restatement
   is a second copy that drifts, and a DPA whose subprocessor annex disagrees with
   the live page is worse than one with no annex at all.
══════════════════════════════════════════════════════════════════════════════ */

const EFFECTIVE = "7 September 2026";

export const metadata: Metadata = createMetadata({
  title: "Data Processing Addendum",
  description:
    "The Article 28 terms under which Vectorbea processes personal data on a customer's behalf: "
    + "scope, security, subprocessors, transfers, deletion and audit.",
  path: "/legal/dpa",
});

export default function DpaPage() {
  return (
    <LegalPage
      title="Data Processing Addendum"
      intro="This addendum forms part of the Terms of Service and governs our processing of personal data on your behalf. Where it conflicts with the Terms, this addendum wins for that processing."
      effective={EFFECTIVE}
      path="/legal/dpa"
    >
      <LegalNote>
        This addendum is offered as-is and has not been reviewed by counsel. If your organisation
        requires a signed DPA on your own paper, or Standard Contractual Clauses executed as a
        separate instrument, contact us before you begin processing.
      </LegalNote>

      <div className="mt-8 space-y-8">
        <LegalSection n="1" title="Roles">
          <LegalP>
            You are the controller of the personal data you put through the service. We are the
            processor, and act only on your documented instructions — your use of the service, and
            the workflows you build, ARE those instructions.
          </LegalP>
          <LegalP>
            For your own account data — the email address you signed up with, your sign-in
            metadata — we are the controller, and the{" "}
            <Link href={"/legal/privacy" as Route} className="underline" style={{ color: "#006B45" }}>
              Privacy Policy
            </Link>{" "}
            applies.
          </LegalP>
        </LegalSection>

        <LegalSection n="2" title="Scope of the processing">
          <LegalP>
            <strong>Subject matter.</strong> Executing the workflows you define, and recording what
            each run did.
          </LegalP>
          <LegalP>
            <strong>Duration.</strong> For the term of your agreement, plus the retention window your
            plan grants for run data.
          </LegalP>
          <LegalP>
            <strong>Nature and purpose.</strong> Storage, transmission, execution of workflow steps,
            calls to model providers and to systems you connect, and the recording of an execution
            history for you to inspect.
          </LegalP>
          <LegalP>
            <strong>Categories of data.</strong> Whatever your workflows process. We do not restrict
            it and cannot predict it. It commonly includes identifiers, contact details, message
            content and business records.
          </LegalP>
          <LegalP>
            <strong>Data subjects.</strong> Whoever your workflows are about — your customers, your
            employees, your users.
          </LegalP>
          <LegalNote>
            The service is not designed for special-category data under Article 9, nor for data
            subject to HIPAA, PCI-DSS or equivalent sectoral regimes. We hold no certification
            against any of them and offer no BAA. Do not put that data through the service.
          </LegalNote>
        </LegalSection>

        <LegalSection n="3" title="Our obligations">
          <LegalList
            items={[
              "Process only on your instructions, and tell you if we believe an instruction breaches data protection law.",
              "Keep everyone with access under a duty of confidentiality.",
              "Implement the technical and organisational measures in section 4.",
              "Assist you with data subject requests, and with your obligations under Articles 32 to 36, to the extent the service allows.",
              "Delete or return personal data at the end of the agreement, as section 7 sets out.",
              "Make available the information you reasonably need to demonstrate compliance with Article 28.",
            ]}
          />
        </LegalSection>

        <LegalSection n="4" title="Security measures">
          <LegalP>The measures actually implemented, stated as what they are:</LegalP>
          <LegalList
            items={[
              "TLS for data in transit.",
              "AES-256-GCM encryption at rest for connection secrets, with the workspace id bound into the authenticated data so a ciphertext moved between tenants fails to decrypt rather than decrypting for the wrong one.",
              "Workspace scoping enforced at the same boundary for every resource lookup — agents, tools, rosters, runs — failing closed if the check itself errors.",
              "Role-based authorisation enforced server-side, denying writes by default.",
              "An append-only audit log for privileged actions.",
              "Sanitisation at the write boundary, so raw provider responses, stack traces and connection secrets do not reach the event store, the span writer or payload storage.",
              "Retention enforced by deletion rather than by a read-time filter, so expired data is not merely hidden.",
            ]}
          />
          <LegalNote>
            None of this has been independently audited. We hold no SOC 2 or ISO 27001
            certification, and we have no penetration test report to share. If your procurement
            requires one, the honest answer today is that we cannot satisfy it.
          </LegalNote>
        </LegalSection>

        <LegalSection n="5" title="Subprocessors">
          <LegalP>
            You give general authorisation for us to engage subprocessors. The current list is
            published at{" "}
            <Link href={"/legal/subprocessors" as Route} className="underline" style={{ color: "#006B45" }}>
              /legal/subprocessors
            </Link>{" "}
            and is incorporated into this addendum by reference. It names every third party this
            system sends data to, including the model providers, and states what is sent to each. It
            was last verified against the code on {SUBPROCESSORS_REVIEWED}.
          </LegalP>
          <LegalP>
            We will give at least 30 days&apos; notice by email before adding a subprocessor. If you
            reasonably object on data protection grounds within that period, you may terminate the
            affected part of the service and receive a pro-rated refund of prepaid fees.
          </LegalP>
          <LegalP>
            We impose data protection obligations on each subprocessor no less protective than these,
            and remain liable for their performance.
          </LegalP>
        </LegalSection>

        <LegalSection n="6" title="International transfers">
          <LegalP>
            Processing is primarily in the United States. Where we transfer personal data from the
            EEA, UK or Switzerland, we rely on the European Commission&apos;s Standard Contractual
            Clauses (Decision 2021/914), incorporated here by reference — Module Two where you are a
            controller and we are your processor, and Module Three where you are yourself a
            processor. The UK Addendum applies to UK transfers.
          </LegalP>
          <LegalP>
            The optional clauses are not selected; the governing law and forum are those of Ireland
            for the EU clauses; and the annexes are populated by sections 2, 4 and 5 of this
            addendum together with the published subprocessor list.
          </LegalP>
        </LegalSection>

        <LegalSection n="7" title="Deletion and return">
          <LegalP>
            Run data is deleted automatically when its retention window expires. On termination, we
            delete your workspace data within 30 days. Before then you may export your workflows and
            run history through the API or by asking us.
          </LegalP>
          <LegalP>
            Backups are overwritten on their own cycle; personal data in a backup is deleted within
            35 days of the primary deletion.
          </LegalP>
        </LegalSection>

        <LegalSection n="8" title="Incidents">
          <LegalP>
            We will notify you without undue delay, and in any event within 72 hours, of becoming
            aware of a personal data breach affecting your data. The notice will describe what
            happened, which data was affected as far as we can establish, what we have done, and what
            we recommend you do.
          </LegalP>
        </LegalSection>

        <LegalSection n="9" title="Audit">
          <LegalP>
            We will answer reasonable written questions about our processing, once a year, at no
            charge. We do not currently have an audit report to provide in place of that, and we do
            not offer on-site inspection.
          </LegalP>
        </LegalSection>

        <LegalSection n="10" title="Contact">
          <LegalP>
            Data protection enquiries:{" "}
            <a href={`mailto:${SITE.contactEmail}`} className="underline" style={{ color: "#006B45" }}>
              {SITE.contactEmail}
            </a>
            .
          </LegalP>
        </LegalSection>
      </div>
    </LegalPage>
  );
}
