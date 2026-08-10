import type { ReactNode } from "react";

// OAuth/invite callback pages — utility flows, never indexable.
export const metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
