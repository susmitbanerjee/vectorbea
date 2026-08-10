import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createMetadata } from "@/lib/seo";

// The /docs page is a client component (self-contained reference). This server
// layout owns its indexable metadata + canonical without changing the page.
export const metadata: Metadata = createMetadata({
  title: "Documentation",
  description:
    "Vectorbea documentation: how durable execution, long-running workflows, connections, agents, tools, approvals, workflows and schedules work — plus a first-workflow guide.",
  path: "/docs",
});

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
