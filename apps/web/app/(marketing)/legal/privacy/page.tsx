import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { LegalPage, LegalSection, LegalP, LegalList, LegalNote } from "~/components/marketing/legal";
import { createMetadata, SITE } from "@/lib/seo";

/* ══════════════════════════════════════════════════════════════════════════════
   PRIVACY POLICY.

   ── WRITTEN FROM THE CODE, NOT FROM A TEMPLATE ──────────────────────────────
   Every category below corresponds to something this system actually stores:
   `users` and `workspace_members` for account data, `runs`/`run_events`/
   `run_spans`/payload storage for run data, `encrypted_secrets` for credentials,
   `audit_log` for governance. A privacy policy assembled from a template
   describes a product that does not exist, which is worse than no policy — it
   tells a reader they have been informed when they have not.

   ── THE PROMPT IS THE HARD PART, AND IT IS SAID PLAINLY ─────────────────────
   The single most consequential fact about a platform that runs agents is that
   whatever the customer puts into a workflow gets sent to a model provider. Most
   AI privacy policies bury that under "we may share data with service providers
   to operate the Service". It is section 4 here, in its own words.
══════════════════════════════════════════════════════════════════════════════ */

const EFFECTIVE = "7 September 2026";

export const metadata: Metadata = createMetadata({
  title: "Privacy Policy",
  description:
    "What Vectorbea collects, why, where it goes, how long it is kept, and how to get it deleted. "
    + "Written from what the system actually stores.",
  path: "/legal/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What we collect, why we have it, who else sees it, and how long it stays. Every category below corresponds to something the system actually stores."
      effective={EFFECTIVE}
      path="/legal/privacy"
    >
      <div className="space-y-8">
        <LegalSection n="1" title="Who this is about">
          <LegalP>
            Vectorbea provides a hosted workflow platform. For your account, we are the controller.
            For the data you put THROUGH a workflow — inputs, outputs, and anything a step reads —
            we are a processor acting on your instructions, and the{" "}
            <Link href={"/legal/dpa" as Route} className="text-accent underline">
              Data Processing Addendum
            </Link>{" "}
            governs.
          </LegalP>
        </LegalSection>

        <LegalSection n="2" title="What we collect">
          <LegalP>
            <strong>Account data.</strong> Your email address, your name if you give one, your
            workspace memberships and role, and authentication metadata — sign-in times, session
            tokens, password reset state. Passwords are handled by our authentication provider and
            we never see them.
          </LegalP>
          <LegalP>
            <strong>Workflow data.</strong> The workflows you build, every version of them, the
            agents and tools you register, and the connections you configure.
          </LegalP>
          <LegalP>
            <strong>Run data.</strong> For each run: an immutable event timeline, execution spans,
            node inputs and outputs, tool call requests and responses, model prompts and completions,
            token counts, timings, retries and errors. This is the record that makes a run
            debuggable, and it necessarily contains whatever your workflow processed.
          </LegalP>
          <LegalP>
            <strong>Credentials.</strong> API keys and connection strings you store are encrypted at
            rest with AES-256-GCM, bound cryptographically to your workspace. They are never
            returned by the API, never written to logs, and are decrypted only in memory at the
            moment a step needs them.
          </LegalP>
          <LegalP>
            <strong>Operational data.</strong> Request logs, error traces and usage counters, used to
            run the service, enforce quotas and bill accurately.
          </LegalP>
        </LegalSection>

        <LegalSection n="3" title="Why we have it">
          <LegalList
            items={[
              "To provide the service you asked for — running workflows is the whole product.",
              "To let you debug: the run record is the reason a failure can be explained rather than guessed at.",
              "To enforce quotas and bill accurately.",
              "To keep the service secure and to investigate abuse.",
              "To contact you about your account, and about material changes to these documents.",
            ]}
          />
          <LegalP>
            In the EEA and UK, our lawful bases are performance of a contract for the first three,
            and legitimate interests for security and service communications.
          </LegalP>
        </LegalSection>

        <LegalSection n="4" title="Model providers see what your workflow sends them">
          <LegalNote>
            When a workflow calls a model, the assembled prompt is sent to that model provider. The
            prompt contains whatever your workflow put in it — including the run&apos;s input and any
            data an earlier step fetched. If that includes personal data, that personal data goes to
            the provider.
          </LegalNote>
          <LegalP>
            The call is made from our infrastructure using the API key you supplied on the
            connection. That means you are the account holder with that provider, and{" "}
            <em>their</em> agreement with you governs how long they retain the request and whether it
            may be used for training. We do not override it and cannot see it.
          </LegalP>
          <LegalP>
            Every provider we can reach is named on the{" "}
            <Link href={"/legal/subprocessors" as Route} className="text-accent underline">
              subprocessor list
            </Link>
            , alongside what is sent to each.
          </LegalP>
        </LegalSection>

        <LegalSection n="5" title="Who else we share with">
          <LegalP>
            Only the subprocessors on our published list, each for the purpose stated there. We do
            not sell personal data, we do not share it for advertising, and we do not use your
            workflow content to train models.
          </LegalP>
          <LegalP>
            We may disclose data where legally required. Where we are permitted to tell you, we
            will.
          </LegalP>
        </LegalSection>

        <LegalSection n="6" title="How long it is kept">
          <LegalP>
            Run data is retained for the window your plan grants — currently between 3 and 365 days
            depending on the plan and the surface — and is then <strong>deleted</strong>. Deletion
            means removed from the database, not hidden behind a filter; there is no flag that brings
            it back. The exact windows are on the{" "}
            <Link href={"/pricing" as Route} className="text-accent underline">
              pricing page
            </Link>
            .
          </LegalP>
          <LegalP>
            Account data is kept while your account exists. After you close it, we delete your
            workspace data within 30 days, except anything we must keep for legal or accounting
            reasons.
          </LegalP>
        </LegalSection>

        <LegalSection n="7" title="Where it is processed">
          <LegalP>
            Primarily in the United States, on the infrastructure named in the subprocessor list.
            One model provider (Mistral) is in France, and a custom model connection sends data
            wherever you point it. Transfers out of the EEA and UK rely on Standard Contractual
            Clauses where applicable.
          </LegalP>
        </LegalSection>

        <LegalSection n="8" title="Your rights">
          <LegalList
            items={[
              "Access — ask for a copy of what we hold about you.",
              "Correction — have inaccurate data fixed.",
              "Deletion — have your account and its data removed.",
              "Portability — receive your workflows and run history in a machine-readable form.",
              "Objection and restriction, where the law provides them.",
            ]}
          />
          <LegalP>
            Write to{" "}
            <a href={`mailto:${SITE.contactEmail}`} className="text-accent underline">
              {SITE.contactEmail}
            </a>{" "}
            and we will answer within 30 days. If you are exercising a right on behalf of someone
            whose data went through a workflow you run, address it to your own organisation first —
            for that data, they are the controller and we act on their instructions.
          </LegalP>
        </LegalSection>

        <LegalSection n="9" title="Security, stated honestly">
          <LegalP>
            Data is encrypted in transit with TLS. Connection secrets are encrypted at rest with
            AES-256-GCM and bound to their workspace, so a ciphertext moved between tenants fails to
            decrypt rather than decrypting for the wrong one. Cross-workspace access is refused at
            the same boundary for every resource type, and fails closed if the check itself errors.
            Privileged actions are recorded in an audit log.
          </LegalP>
          <LegalNote>
            We hold no SOC 2, ISO 27001 or equivalent certification, and no third-party security
            audit has been performed. Everything above describes controls we implemented; none of it
            has been independently verified.
          </LegalNote>
        </LegalSection>

        <LegalSection n="10" title="Children">
          <LegalP>
            The service is not for anyone under 16. We do not knowingly collect their data; tell us
            if you believe we have and we will delete it.
          </LegalP>
        </LegalSection>

        <LegalSection n="11" title="Changes and contact">
          <LegalP>
            We will give at least 30 days&apos; notice of a material change, by email to the account
            owner. Questions:{" "}
            <a href={`mailto:${SITE.contactEmail}`} className="text-accent underline">
              {SITE.contactEmail}
            </a>
            .
          </LegalP>
        </LegalSection>
      </div>
    </LegalPage>
  );
}
