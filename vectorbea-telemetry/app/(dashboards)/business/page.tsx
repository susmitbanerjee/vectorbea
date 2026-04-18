import { Card, Divider, Title, Text } from "@tremor/react";
import {
  DollarSign,
  TrendingUp,
  Users,
  FileText,
  Building2,
  Percent,
} from "lucide-react";

import { KpiCard }          from "@/components/business/KpiCard";
import { ConversionGauge }  from "@/components/business/ConversionGauge";

import {
  getFinancialKPIs,
  getGrowthMetrics,
  getConversionRetention,
} from "@/lib/queries/business";

// Business KPIs don't need sub-minute freshness. Revalidate every 5 minutes
// to keep the dashboard responsive without hammering Supabase.
export const revalidate = 300;

function fmt(n: number, style: "currency" | "decimal" = "decimal") {
  if (style === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US").format(n);
}

export default async function BusinessPage() {
  const [financials, growth, conversion] = await Promise.all([
    getFinancialKPIs(),
    getGrowthMetrics(),
    getConversionRetention(),
  ]);

  const seatPrice = Number(process.env.SEAT_PRICE_USD ?? "19.99");

  return (
    <div className="px-6 py-6 space-y-8">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold text-white">Business & Growth</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Financial KPIs and cohort health · updates every 5 minutes
        </p>
      </div>

      {/* ── Financial KPIs ── */}
      <section>
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-gray-600">
          <DollarSign className="h-3.5 w-3.5" />
          Financial
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <KpiCard
            label="Monthly Recurring Revenue"
            value={fmt(financials.mrr, "currency")}
            sub={`${financials.paidSeats} seats × $${seatPrice}/mo`}
            accentClass="text-emerald-400"
          />
          <KpiCard
            label="Projected ARR"
            value={fmt(financials.arr, "currency")}
            sub="Annual billing · 20% discount baked in"
            accentClass="text-emerald-400"
          />
          <KpiCard
            label="Paid Organisations"
            value={fmt(financials.paidOrgs)}
            sub="Team plan"
            accentClass="text-blue-400"
          />
          <KpiCard
            label="Total Licensed Seats"
            value={fmt(financials.paidSeats)}
            sub="sum of max_seats on Team orgs"
          />
        </div>
      </section>

      {/* ── Growth ── */}
      <section>
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-gray-600">
          <TrendingUp className="h-3.5 w-3.5" />
          Growth
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard
            label="Active Users (7 days)"
            value={fmt(growth.activeUsersLast7Days)}
            sub="profiles with recent sign-in"
            accentClass="text-violet-400"
          />
          <KpiCard
            label="Total Prompts Created"
            value={fmt(growth.totalPrompts)}
            sub="across all workspaces"
          />
          <KpiCard
            label="Total Workspaces"
            value={fmt(growth.totalWorkspaces)}
            sub="all plans"
          />
        </div>
      </section>

      {/* ── Conversion & Retention ── */}
      <section>
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-gray-600">
          <Percent className="h-3.5 w-3.5" />
          Conversion & Retention
        </div>
        <ConversionGauge
          conversionRate={conversion.conversionRate}
          retentionRate={conversion.retentionRate30d}
        />
      </section>

      {/* ── Interpretation notes ── */}
      <Card className="bg-gray-900 border-gray-800">
        <Title className="text-gray-300 text-sm">Metric Definitions</Title>
        <Divider className="border-gray-800 my-2" />
        <div className="grid gap-2 text-xs text-gray-500 md:grid-cols-2">
          <p><span className="text-gray-400 font-medium">MRR</span> — sum of (max_seats × ${seatPrice}) for all organisations on the Team plan.</p>
          <p><span className="text-gray-400 font-medium">ARR</span> — MRR × 12 × 0.8 (20% annual billing discount).</p>
          <p><span className="text-gray-400 font-medium">Conversion rate</span> — (Team orgs) ÷ (all orgs). Does not account for churned orgs that previously paid.</p>
          <p><span className="text-gray-400 font-medium">30-day retention</span> — workspaces where a prompt_execution was observed in the 30–31 day window after the workspace was created.</p>
          <p><span className="text-gray-400 font-medium">Active users</span> — profile rows where updated_at &gt; now − 7 days. Auth sign-ins sync updated_at via trigger.</p>
        </div>
      </Card>
    </div>
  );
}
