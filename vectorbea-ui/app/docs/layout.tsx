import type { ReactNode } from "react";

import { DocsShell } from "@/components/docs/docs-shell";

export const metadata = {
  title: "VectorBea Docs",
  description: "Documentation for deploying and operating the VectorBea control plane and proxy.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsShell>{children}</DocsShell>;
}
