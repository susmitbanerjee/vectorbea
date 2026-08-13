import type { ReactNode } from "react";

/**
 * Pass-through. Metadata now lives on each page so every docs URL gets its own
 * title, description and canonical — a single layout-level `metadata` export
 * would give fourteen pages one shared title.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
