import { BillingDashboard } from "@/components/billing/billing-dashboard";

export const dynamic = "force-dynamic";

export default function AnalyticsUsagePage() {
  return <BillingDashboard mode="usage" />;
}
