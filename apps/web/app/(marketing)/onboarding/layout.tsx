import type { ReactNode } from "react";

// Post-signup onboarding flow — private, not indexable.
export const metadata = {
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
