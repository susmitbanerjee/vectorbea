import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CreditCard,
  Download,
  ReceiptText,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

// In a real deployment this would come from the billing provider (Stripe, etc.).
// For now we surface the plan tied to the workspace + a deterministic invoice history.
const CURRENT_PLAN = {
  name: "Team",
  status: "active" as const,
  seats: 5,
  pricePerSeat: 29,
  cycle: "Annual" as const,
  renewsOn: "2027-04-09",
  trialEndsOn: null as string | null,
  paymentMethod: {
    brand: "Visa",
    last4: "4242",
    expMonth: "08",
    expYear: "27",
  },
};

const INVOICES = [
  { id: "INV-2026-04", date: "Apr 09, 2026", amount: 1392, status: "Paid", periodLabel: "Annual · 5 seats" },
  { id: "INV-2025-04", date: "Apr 09, 2025", amount: 1392, status: "Paid", periodLabel: "Annual · 5 seats" },
  { id: "INV-2024-04", date: "Apr 09, 2024", amount: 1044, status: "Paid", periodLabel: "Annual · 3 seats" },
];

const PLAN_FEATURES = [
  "Unlimited prompts & versions",
  "Up to 1M proxied requests / month",
  "90-day audit log retention",
  "SSO via Google Workspace",
  "Email & Slack support",
];

const USAGE = {
  requests: { used: 642_180, limit: 1_000_000 },
  seats: { used: 4, limit: 5 },
  storage: { usedGb: 2.4, limitGb: 25 },
};

function pct(used: number, limit: number) {
  return Math.min(100, Math.round((used / limit) * 100));
}

export default function BillingPage() {
  const annualTotal = CURRENT_PLAN.pricePerSeat * CURRENT_PLAN.seats * 12 * 0.8;

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <AppHeader
        title="Billing & plan"
        subtitle="Manage your subscription, payment method, and invoice history."
        actions={
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-white hover:bg-white/[0.06]"
          >
            Compare plans <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {/* ── Current plan ── */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <Card className="border-amber-400/20 bg-gradient-to-br from-amber-400/[0.04] via-card/40 to-card/20">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">
                    Current plan
                  </p>
                </div>
                <CardTitle className="text-2xl font-bold text-white">
                  {CURRENT_PLAN.name}
                </CardTitle>
                <CardDescription className="mt-1">
                  {CURRENT_PLAN.cycle} billing · {CURRENT_PLAN.seats} seats · renews{" "}
                  {new Date(CURRENT_PLAN.renewsOn).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </CardDescription>
              </div>
              <Badge variant="success" className="shrink-0">
                Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tracking-tight text-white">
                ${annualTotal.toFixed(0)}
              </span>
              <span className="text-sm text-muted-foreground">/ year</span>
              <Badge variant="outline" className="ml-2 border-emerald-400/30 text-emerald-300">
                20% annual discount
              </Badge>
            </div>

            <ul className="space-y-2.5">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2 pt-2">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-400/25"
              >
                Upgrade plan
              </Link>
              <Button variant="outline" size="sm">
                Manage seats
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Cancel subscription
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Payment method */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Payment method</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900 p-4 text-white shadow-inner">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  {CURRENT_PLAN.paymentMethod.brand}
                </span>
                <div className="flex gap-1">
                  <span className="h-5 w-5 rounded-full bg-red-500/80" />
                  <span className="-ml-2 h-5 w-5 rounded-full bg-amber-400/80" />
                </div>
              </div>
              <p className="font-mono text-base tracking-widest">
                •••• •••• •••• {CURRENT_PLAN.paymentMethod.last4}
              </p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                <span>Card holder</span>
                <span>
                  Exp {CURRENT_PLAN.paymentMethod.expMonth}/{CURRENT_PLAN.paymentMethod.expYear}
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full">
              Update payment method
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* ── Usage ── */}
      <section>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Usage this period</CardTitle>
            </div>
            <CardDescription>Resets on the 1st of every month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              <UsageBar
                label="Proxied requests"
                used={USAGE.requests.used.toLocaleString()}
                limit={USAGE.requests.limit.toLocaleString()}
                pct={pct(USAGE.requests.used, USAGE.requests.limit)}
              />
              <UsageBar
                label="Active seats"
                used={`${USAGE.seats.used}`}
                limit={`${USAGE.seats.limit}`}
                pct={pct(USAGE.seats.used, USAGE.seats.limit)}
                icon={<Users className="h-3.5 w-3.5" />}
              />
              <UsageBar
                label="Audit log storage"
                used={`${USAGE.storage.usedGb} GB`}
                limit={`${USAGE.storage.limitGb} GB`}
                pct={pct(USAGE.storage.usedGb, USAGE.storage.limitGb)}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Invoice history ── */}
      <section>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Invoice history</CardTitle>
              </div>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                <Download className="h-3.5 w-3.5" />
                Export all
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-white/8">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {INVOICES.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">{inv.id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{inv.date}</TableCell>
                      <TableCell className="text-sm">{inv.periodLabel}</TableCell>
                      <TableCell className="text-sm font-medium">${inv.amount.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="success" className="text-[10px]">
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                          <Download className="h-3 w-3" />
                          PDF
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Billing email ── */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing contact</CardTitle>
            <CardDescription>
              Receipts and renewal notices are sent to this address.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div>
                <p className="text-sm font-medium text-white">billing@yourcompany.com</p>
                <p className="text-xs text-muted-foreground">VAT ID: not configured</p>
              </div>
              <Button variant="outline" size="sm">Edit</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function UsageBar({
  label,
  used,
  limit,
  pct,
  icon,
}: {
  label: string;
  used: string;
  limit: string;
  pct: number;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-mono text-slate-400">
          {used} <span className="text-slate-600">/ {limit}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[10px] uppercase tracking-wider text-slate-600">
        {pct}% used
      </p>
    </div>
  );
}
