// Billing is not implemented — Vectorbea is private beta with manual onboarding.
// Redirect to beta usage/limits page.
import { redirect } from "next/navigation";
export default function BillingPage() {
  redirect("/settings/usage");
}
