"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Bot,
  CheckCircle2,
  FileText,
  Layers,
  RefreshCw,
  Tag,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import type { AuditLogView, DashboardSummary } from "@/lib/api";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RecentAuditTable } from "@/components/dashboard/recent-audit-table";
import { RequestsChart } from "@/components/dashboard/requests-chart";
import { cn } from "@/lib/utils";

type DashboardOverviewProps = {
  workspaceId: string | null;
  initialAuditLogs: AuditLogView[];
  initialSummary: DashboardSummary;
};

async function getResponseMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export function DashboardOverview({
  workspaceId,
  initialAuditLogs,
  initialSummary,
}: DashboardOverviewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [auditLogs, setAuditLogs] = useState(initialAuditLogs);
  const [dashboardSummary, setDashboardSummary] = useState(initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setAuditLogs(initialAuditLogs);
  }, [initialAuditLogs]);

  useEffect(() => {
    setDashboardSummary(initialSummary);
  }, [initialSummary]);

  // Guards against overlapping in-flight requests. If the previous poll
  // hasn't returned yet when the next interval fires, we skip that tick
  // rather than queuing a second parallel fetch for the same data.
  const fetchingRef = useRef(false);

  const refreshDashboard = useCallback(
    async ({ showToast = false }: { showToast?: boolean } = {}) => {
      if (!workspaceId) return;
      if (fetchingRef.current && !showToast) return; // skip silent polls while one is in-flight

      try {
        fetchingRef.current = true;
        setRefreshing(true);

        const [summaryResponse, auditResponse] = await Promise.all([
          fetch(`/api/dashboard/summary?workspaceId=${encodeURIComponent(workspaceId)}`),
          fetch(`/api/audit?workspaceId=${encodeURIComponent(workspaceId)}`),
        ]);

        if (!summaryResponse.ok) {
          throw new Error(
            await getResponseMessage(summaryResponse, "Unable to refresh dashboard summary."),
          );
        }

        if (!auditResponse.ok) {
          throw new Error(
            await getResponseMessage(auditResponse, "Unable to refresh audit activity."),
          );
        }

        const [nextSummary, nextAuditLogs] = await Promise.all([
          summaryResponse.json() as Promise<DashboardSummary>,
          auditResponse.json() as Promise<AuditLogView[]>,
        ]);

        setDashboardSummary(nextSummary);
        setAuditLogs(nextAuditLogs);

        if (showToast) {
          toast.success("Dashboard refreshed.");
        }
      } catch (error) {
        if (showToast) {
          toast.error(error instanceof Error ? error.message : "Failed to refresh dashboard.");
        }
      } finally {
        fetchingRef.current = false;
        setRefreshing(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!workspaceId) return;

    const interval = window.setInterval(() => {
      // Skip background tabs — fire immediately when the tab becomes visible again
      if (document.visibilityState === "hidden") return;
      void refreshDashboard();
    }, 15_000);

    // Catch the tab coming back into focus after being hidden
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshDashboard();
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshDashboard, workspaceId]);

  const handleManualRefresh = () => {
    void refreshDashboard({ showToast: true });
    startTransition(() => {
      router.refresh();
    });
  };

  const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const filteredLogs = useMemo(
    () =>
      query
        ? auditLogs.filter((log) =>
            `${log.promptName} ${log.versionTag}`.toLowerCase().includes(query),
          )
        : auditLogs,
    [auditLogs, query],
  );

  const signals: Array<{
    label: string;
    value: string;
    icon: ReactNode;
    variant: "success" | "secondary" | "outline";
  }> = [
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

  const suffix = workspaceId ? `?workspaceId=${workspaceId}` : "";

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Dashboard"
        subtitle="Observe prompt traffic, latency, and agent activity across your workspace."
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleManualRefresh}
              disabled={!workspaceId || refreshing || isPending}
            >
              <RefreshCw className={cn("h-4 w-4", (refreshing || isPending) && "animate-spin")} />
              {refreshing || isPending ? "Refreshing..." : "Refresh"}
            </Button>
            <a
              href={`/api/audit${suffix}`}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Export JSON
            </a>
            <a href={workspaceId ? `/prompts?org=${workspaceId}` : "/prompts"} className={cn(buttonVariants())}>
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
          <RequestsChart />
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
