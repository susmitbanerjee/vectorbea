import { BillingDashboard } from "@/components/billing/billing-dashboard";

export const dynamic = "force-dynamic";

export default function SettingsUsagePage() {
  return <BillingDashboard mode="usage" />;
}
