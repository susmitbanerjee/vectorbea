import { Activity, Bot, Zap, CheckCircle2, Layers, Tag, FileText } from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { RecentAuditTable } from "@/components/dashboard/recent-audit-table";
import { RequestsChart } from "@/components/dashboard/requests-chart";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  apiFetch,
  type AuditLogView,
  type DailyRequestPoint,
  type DashboardSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string }>;
}) {
  const { org, q } = await searchParams;
  const suffix = org ? `?organizationId=${org}` : "";
  const auditLogs = await apiFetch<AuditLogView[]>(`/api/audit${suffix}`);
  const dashboardSummary = await apiFetch<DashboardSummary>(`/api/dashboard/summary${suffix}`);
  const requests = await apiFetch<DailyRequestPoint[]>(`/api/dashboard/requests${suffix}`);
  const filteredLogs = q
    ? auditLogs.filter((log) =>
        `${log.promptName} ${log.versionTag}`.toLowerCase().includes(q.toLowerCase()),
      )
    : auditLogs;

  const signals: Array<{ label: string; value: string; icon: React.ReactNode; variant: "success" | "secondary" | "outline" }> = [
    {
      label: "Publish status",
      value: filteredLogs.length > 0 ? "Healthy" : "No writes yet",
      icon: <CheckCircle2 className="h-4 w-4 text-muted-foreground" />,
      variant: filteredLogs.length > 0 ? "success" : "secondary",
    },
    {
      label: "Recent log rows",
      value: filteredLogs.length.toString(),
      icon: <Layers className="h-4 w-4 text-muted-foreground" />,
      variant: "outline",
    },
    {
      label: "Latest version",
      value: filteredLogs[0]?.versionTag ?? "No data",
      icon: <Tag className="h-4 w-4 text-muted-foreground" />,
      variant: "secondary",
    },
    {
      label: "Latest prompt",
      value: filteredLogs[0]?.promptName ?? "No data",
      icon: <FileText className="h-4 w-4 text-muted-foreground" />,
      variant: "secondary",
    },
  ];

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Dashboard"
        subtitle="Observe prompt traffic, latency, and agent activity across your workspace."
        actions={
          <>
            <a
              href={`/api/audit${suffix}`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Export JSON
            </a>
            <a href={`/prompts${org ? `?org=${org}` : ""}`} className={cn(buttonVariants())}>
              New Release
            </a>
          </>
        }
      />

      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="API Calls (24h)"
            value={dashboardSummary.totalApiCallsLast24h}
            icon={<Activity className="h-5 w-5" />}
            staggerIndex={0}
          />
          <MetricCard
            label="Avg Proxy Latency"
            value={dashboardSummary.averageLatencyMs}
            suffix=" ms"
            icon={<Zap className="h-5 w-5" />}
            staggerIndex={1}
          />
          <MetricCard
            label="Active Agents"
            value={dashboardSummary.activeAgents}
            icon={<Bot className="h-5 w-5" />}
            staggerIndex={2}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <RequestsChart data={requests} />
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <CardTitle>Release Signals</CardTitle>
                  <CardDescription>Derived from recent audit activity.</CardDescription>
                </div>
                <Badge variant="outline">Live</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {signals.map((signal) => (
                <div
                  key={signal.label}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2.5">
                    {signal.icon}
                    <span className="text-sm text-muted-foreground">{signal.label}</span>
                  </div>
                  <Badge variant={signal.variant}>{signal.value}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section>
          <RecentAuditTable logs={filteredLogs} />
        </section>
      </div>
    </div>
  );
}
