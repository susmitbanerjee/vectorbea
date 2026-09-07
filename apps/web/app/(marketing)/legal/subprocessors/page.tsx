import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { LegalPage, LegalSection, LegalP, LegalNote } from "@/components/marketing/legal";
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
        <Link href={"/legal/dpa" as Route} className="underline" style={{ color: "#006B45" }}>
          Data Processing Addendum
        </Link>
        . We give at least 30 days&apos; notice before adding to it. To be notified, write to{" "}
        <a href={`mailto:${SITE.contactEmail}`} className="underline" style={{ color: "#006B45" }}>
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

            <div className="overflow-x-auto rounded-[12px] border bg-white" style={{ borderColor: "#E0E3E6" }}>
              <table className="w-full min-w-[700px] border-collapse text-left">
                <thead>
                  <tr style={{ borderBottom: "1px solid #E0E3E6" }}>
                    {["Subprocessor", "What it does", "What it receives", "Where"].map((head) => (
                      <th
                        key={head}
                        scope="col"
                        className="px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.name} style={{ borderBottom: "1px solid #ECEEEF" }}>
                      <th scope="row" className="px-4 py-3 align-top font-normal">
                        <span className="block text-[13.5px] font-medium text-[#0B0D0F]">
                          {row.name}
                        </span>
                        {row.optional ? (
                          <span
                            className="mt-1 inline-block rounded-[5px] px-1.5 py-0.5 text-[11px]"
                            style={{ background: "#F3F4F5", color: "#6B7280" }}
                          >
                            {row.optional}
                          </span>
                        ) : null}
                      </th>
                      <td className="px-4 py-3 align-top text-[13px] leading-[1.55] text-[#4B5563]">
                        {row.purpose}
                      </td>
                      <td className="px-4 py-3 align-top text-[13px] leading-[1.55] text-[#4B5563]">
                        {row.dataProcessed}
                        {row.note ? (
                          <span className="mt-1 block text-[12px] leading-[1.5] text-[#9CA3AF]">
                            {row.note}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-[13px] leading-[1.55] text-[#6B7280]">
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
