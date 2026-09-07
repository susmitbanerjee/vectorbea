import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { LegalPage, LegalSection, LegalP, LegalList, LegalNote } from "~/components/marketing/legal";
import { createMetadata, SITE } from "@/lib/seo";

/* ══════════════════════════════════════════════════════════════════════════════
   TERMS OF SERVICE.

   ── WHY THIS EXISTS BEFORE ANY MONEY IS TAKEN ───────────────────────────────
   A paid product with no terms has no agreed limitation of liability, no stated
   basis for suspension, no acceptable-use rule, and nothing that survives
   termination. Every one of those gaps favours whoever has more lawyers, and
   that is not us.

   ── WHAT IS DELIBERATELY NOT PROMISED HERE ──────────────────────────────────
   Availability. There is no SLA, and this document says so in the same words the
   pricing page does rather than leaving the absence to be inferred. Writing "we
   will use commercially reasonable efforts to keep the Service available" reads
   like a commitment and is not one; a plain "no uptime commitment" is both
   truthful and clearer to the reader.

   This is a template drafted against what the product actually does. It has not
   been reviewed by counsel, and the page says so.
══════════════════════════════════════════════════════════════════════════════ */

const EFFECTIVE = "7 September 2026";

export const metadata: Metadata = createMetadata({
  title: "Terms of Service",
  description:
    "The agreement governing use of Vectorbea: what the service is, what you are responsible for, "
    + "what we commit to, and what happens on termination.",
  path: "/legal/terms",
});

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms govern your use of Vectorbea. They are written to be read, so where a clause limits what you get, it says so plainly rather than at length."
      effective={EFFECTIVE}
      path="/legal/terms"
    >
      <LegalNote>
        Vectorbea is early-stage software. This document has been drafted against what the product
        actually does, but it has not been reviewed by counsel. If your organisation needs a
        negotiated agreement before you can use the service, say so and we will work from yours.
      </LegalNote>

      <div className="mt-8 space-y-8">
        <LegalSection n="1" title="The agreement">
          <LegalP>
            These terms are between you — or the organisation you are acting for — and Vectorbea.
            By creating an account or using the service you accept them. If you are accepting on
            behalf of an organisation, you confirm you are authorised to bind it.
          </LegalP>
          <LegalP>
            The{" "}
            <Link href={"/legal/privacy" as Route} className="text-accent underline">
              Privacy Policy
            </Link>{" "}
            and, where you process personal data through the service, the{" "}
            <Link href={"/legal/dpa" as Route} className="text-accent underline">
              Data Processing Addendum
            </Link>{" "}
            form part of this agreement.
          </LegalP>
        </LegalSection>

        <LegalSection n="2" title="What the service is">
          <LegalP>
            Vectorbea is a hosted platform for building and running automated workflows, including
            workflows that call large language models. You define workflows; we execute them,
            record what happened, and make that record available to you.
          </LegalP>
          <LegalP>
            The service calls third parties on your behalf — model providers, and any system you
            connect. Those calls are made with credentials you supply. We do not control what those
            third parties do with what we send them, and their own terms govern that.
          </LegalP>
        </LegalSection>

        <LegalSection n="3" title="Your account and your content">
          <LegalList
            items={[
              "You are responsible for the security of your account credentials and for everything done under your account.",
              "You own your workflows, your inputs and your outputs. We claim no ownership of them.",
              "You grant us the licence necessary to host, process, transmit and display that content in order to operate the service for you — and nothing beyond that.",
              "We do not use your workflow content to train models.",
            ]}
          />
        </LegalSection>

        <LegalSection n="4" title="Acceptable use">
          <LegalP>You may not use the service to:</LegalP>
          <LegalList
            items={[
              "Break the law, or help someone else break it.",
              "Send content you have no right to send, or that infringes someone else's rights.",
              "Attack, overload or probe our infrastructure, or anyone else's through ours.",
              "Circumvent a quota, a rate limit, or a plan restriction.",
              "Generate content that harms people — including targeted harassment, fraud, or material that sexually exploits children.",
            ]}
          />
          <LegalP>
            We may suspend an account that is doing any of these, without notice where the harm is
            ongoing. We will tell you why, and restore access when it stops.
          </LegalP>
        </LegalSection>

        <LegalSection n="5" title="Plans, limits and payment">
          <LegalP>
            Each plan carries limits — runs, tokens, agents, concurrency and retention — published
            on the{" "}
            <Link href={"/pricing" as Route} className="text-accent underline">
              pricing page
            </Link>
            . Those numbers are the values the platform enforces. Limits resolve from the billing
            account that owns a workspace, not from the plan of the person using it.
          </LegalP>
          <LegalP>
            Paid plans are billed in advance for the period stated at purchase. Fees are
            non-refundable except where the law requires otherwise. We may change prices with at
            least 30 days&apos; notice before your next renewal; the change never applies to a
            period you have already paid for.
          </LegalP>
          <LegalP>
            If a payment fails, we restrict the account rather than downgrading its plan. Your
            retention window is unchanged while an account is past due, because a late card must
            never cause your history to be deleted.
          </LegalP>
        </LegalSection>

        <LegalSection n="6" title="Availability">
          <LegalNote>
            There is no service level agreement. We do not commit to an uptime percentage, a
            response time, or a maintenance window, and we do not publish an uptime figure. If your
            use requires a contractual availability commitment, this is not yet the right product
            for you — tell us and we will say honestly whether that is changing.
          </LegalNote>
          <LegalP>
            We may change, suspend or discontinue parts of the service. Where a change removes
            something you rely on, we will give reasonable notice and, where we can, a way to export
            what you would lose.
          </LegalP>
        </LegalSection>

        <LegalSection n="7" title="Data retention and deletion">
          <LegalP>
            Runs, events, traces and payloads are retained for the window your plan grants, and are
            then <strong>deleted</strong> — removed from the database, not hidden behind a filter.
            Deleted data cannot be restored.
          </LegalP>
          <LegalP>
            Moving to a plan with a shorter window is honoured at the old window for a grace period
            before the shorter one takes effect, so a downgrade does not remove history before you
            have had the chance to export it.
          </LegalP>
          <LegalP>
            On termination we delete your workspace data within 30 days, except where we are
            required to keep something longer by law. Ask before then and we will help you export.
          </LegalP>
        </LegalSection>

        <LegalSection n="8" title="Confidentiality and security">
          <LegalP>
            Connection secrets you store are encrypted at rest with AES-256-GCM, bound
            cryptographically to your workspace, and are never returned by the API or written to
            logs.
          </LegalP>
          <LegalNote>
            We hold no SOC 2, ISO 27001 or equivalent certification, and no third-party security
            audit has been performed. We describe the controls we have implemented; we do not claim
            they have been independently verified, because they have not.
          </LegalNote>
        </LegalSection>

        <LegalSection n="9" title="Warranties and liability">
          <LegalP>
            The service is provided &ldquo;as is&rdquo;. To the fullest extent the law allows, we
            disclaim implied warranties of merchantability, fitness for a particular purpose and
            non-infringement.
          </LegalP>
          <LegalP>
            Model output is generated by third-party systems and can be wrong, biased or fabricated.
            You are responsible for deciding what to do with it. Where an output drives a
            consequential action, use an approval gate — the product provides them for this reason.
          </LegalP>
          <LegalP>
            Neither party is liable for indirect, incidental, special or consequential damages, or
            for lost profits or lost data, arising from this agreement. Our total liability is
            limited to the fees you paid in the twelve months before the claim. Nothing here limits
            liability that cannot lawfully be limited.
          </LegalP>
        </LegalSection>

        <LegalSection n="10" title="Termination">
          <LegalP>
            You may stop using the service and close your account at any time. We may terminate for
            a material breach that is not cured within 30 days of notice, or immediately for a
            breach of section 4.
          </LegalP>
          <LegalP>
            Sections 3 (your content), 7 (retention), 9 (liability) and this section survive
            termination.
          </LegalP>
        </LegalSection>

        <LegalSection n="11" title="Changes and contact">
          <LegalP>
            We will give at least 30 days&apos; notice of a material change to these terms, by email
            to the account owner. Continuing to use the service after a change takes effect means you
            accept it.
          </LegalP>
          <LegalP>
            Questions about these terms: <a href={`mailto:${SITE.contactEmail}`} className="text-accent underline">{SITE.contactEmail}</a>.
          </LegalP>
        </LegalSection>
      </div>
    </LegalPage>
  );
}
