import type { Metadata } from "next";
import { createMetadata } from "@/lib/seo";
import { DocsShell } from "~/components/docs/docs-shell";
import { getDocsPage } from "~/content/docs/registry";

const page = getDocsPage("introduction")!;

export const metadata: Metadata = createMetadata({
  title: "Documentation",
  description: page.description,
  path: "/docs",
});

export default function DocsIndexPage() {
  return <DocsShell slug="introduction" />;
}
