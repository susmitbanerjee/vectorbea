import type { Metadata } from "next";
// The legacy HomeContent stays in the repo per CLAUDE.md; the route now renders
// the Ink & Iris landing page. Metadata and structured data are unchanged.
import { Landing } from "~/components/marketing/landing";
import { JsonLd } from "@/components/seo/json-ld";
import {
  SITE, createMetadata, organizationSchema, websiteSchema, softwareApplicationSchema,
} from "@/lib/seo";

// Homepage uses the exact site title (no "- Vectorbea" template) and is the
// canonical root. The visual is a client component (SSR'd, so fully crawlable);
// this server wrapper owns the metadata + structured data.
export const metadata: Metadata = createMetadata({
  title: SITE.defaultTitle,
  titleAbsolute: true,
  description: SITE.description,
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <JsonLd data={[organizationSchema(), websiteSchema(), softwareApplicationSchema()]} />
      <Landing />
    </>
  );
}
