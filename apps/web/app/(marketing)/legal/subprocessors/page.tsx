import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { LegalPage, LegalSection, LegalP, LegalNote } from "~/components/marketing/legal";
import { createMetadata, SITE } from "@/lib/seo";
import { byCategory, CATEGORY_LABEL, SUBPROCESSORS_REVIEWED } from "@/lib/marketing/subprocessors";

/* ══════════════════════════════════════════════════════════════════════════════
   SUBPROCESSORS.

   Rendered from `@/lib/marketing/subprocessors`, where each entry carries the
   file that makes the call. That is the discipline: a row without evidence does
   not belong, and code that calls something with no row makes this page — and
   the DPA that incorporates it — false.
══════════════════════════════════════════════════════════════════════════════ */

export const metadata: Metadata = createMetadata({
  title: "Subprocessors",
  description:
    "Every third party Vectorbea sends data to, what each receives, and where it is processed — "
    + "including the model providers.",
  path: "/legal/subprocessors",
});

export default function SubprocessorsPage() {
  const groups = byCategory();

  return (
    <LegalPage
      title="Subprocessors"
      intro="Every third party this system sends data to, what each one receives, and where. Model providers are on this list, because a prompt is customer data and we are the ones sending it."
      effective={`${SUBPROCESSORS_REVIEWED} (last verified against the code)`}
      path="/legal/subprocessors"
    >
      <LegalP>
        This list is incorporated into the{" "}
        <Link href={"/legal/dpa" as Route} className="text-accent underline">
          Data Processing Addendum
        </Link>
        . We give at least 30 days&apos; notice before adding to it. To be notified, write to{" "}
        <a href={`mailto:${SITE.contactEmail}`} className="text-accent underline">
          {SITE.contactEmail}
        </a>
        .
      </LegalP>

      <div className="mt-8 space-y-10">
        {groups.map((group, index) => (
          <LegalSection
            key={group.category}
            n={String(index + 1)}
            title={CATEGORY_LABEL[group.category]}
          >
            {group.category === "model-provider" ? (
              <LegalNote>
                A model call sends the assembled prompt — which contains whatever your workflow put
                in it — to the provider. The request is made from our infrastructure, so the provider
                is our subprocessor and is named here. Because it is made with the API key YOU
                supplied, your own agreement with that provider governs retention and training.
              </LegalNote>
            ) : null}

            {/* Tokens, not hex: this page moved onto the current design system
                with the rest of the legal set, and a table still painted in the
                previous palette is exactly the seam a reader notices. */}
            <div className="border-subtle bg-surface-raised overflow-x-auto rounded-md border">
              <table className="w-full min-w-[700px] border-collapse text-left">
                <thead>
                  <tr className="border-subtle border-b">
                    {["Subprocessor", "What it does", "What it receives", "Where"].map((head) => (
                      <th
                        key={head}
                        scope="col"
                        className="font-ui text-eyebrow text-fg-muted px-4 py-2.5 uppercase"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.name} className="border-subtle border-b last:border-b-0">
                      <th scope="row" className="px-4 py-3 align-top font-normal">
                        <span className="font-ui text-body-sm text-fg-primary block">
                          {row.name}
                        </span>
                        {row.optional ? (
                          <span className="bg-surface-sunken text-fg-muted font-ui text-caption mt-1 inline-block rounded-xs px-1.5 py-0.5">
                            {row.optional}
                          </span>
                        ) : null}
                      </th>
                      <td className="font-ui text-body-sm text-fg-secondary px-4 py-3 align-top leading-snug">
                        {row.purpose}
                      </td>
                      <td className="font-ui text-body-sm text-fg-secondary px-4 py-3 align-top leading-snug">
                        {row.dataProcessed}
                        {row.note ? (
                          <span className="font-ui text-caption text-fg-muted mt-1 block leading-snug">
                            {row.note}
                          </span>
                        ) : null}
                      </td>
                      <td className="font-ui text-body-sm text-fg-muted px-4 py-3 align-top leading-snug">
                        {row.location}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LegalSection>
        ))}
      </div>

      <div className="mt-10">
        <LegalSection n={String(groups.length + 1)} title="What is not on this list">
          <LegalP>
            Any system YOU connect — a database, an HTTP API, an MCP server — receives whatever your
            workflow sends it. Those are not our subprocessors: you chose them, you hold the
            credentials, and we have no relationship with them. They are your subprocessors, and
            belong on your own list.
          </LegalP>
          <LegalP>
            Third-party analytics, advertising and session-replay services. We use none, on the
            product or on the marketing site. The product does record its own product-usage events
            — which page was opened, which feature was used — but those go to our own systems, not
            to a vendor, and the client is forbidden from sending prompt content or model output.
            That is first-party processing covered by the Privacy Policy, not a subprocessor.
          </LegalP>
        </LegalSection>
      </div>
    </LegalPage>
  );
}
