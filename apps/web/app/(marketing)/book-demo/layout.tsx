import type { ReactNode } from "react";

// Lead-capture form — thin, transactional content; keep it out of the index.
export const metadata = {
  title: "Book a demo",
  robots: { index: false, follow: false },
};

export default function BookDemoLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
