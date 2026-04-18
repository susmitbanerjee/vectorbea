import { Suspense } from "react";
import { Card, Metric, Text, Badge } from "@tremor/react";
import { Server, Activity, Clock, Network } from "lucide-react";

import { EnvToggle }        from "@/components/technical/EnvToggle";
import { HostMetricsChart } from "@/components/technical/HostMetricsChart";
import { LatencyChart }     from "@/components/technical/LatencyChart";
import { WallOfShame }      from "@/components/technical/WallOfShame";

import {
  getHourlyHostMetrics,
  getLatencyPercentiles,
  getTop10SlowestPrompts,
  getAvgNetworkHops,
  getActiveHostCount,
  type Environment,
} from "@/lib/queries/technical";

// Re-fetch every 30 seconds so the page stays live without a client-side
// polling loop. Telemetry is internal, so a 30 s stale window is fine.
export const revalidate = 30;

interface PageProps {
  searchParams: { env?: string };
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Server;
}) {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <div className="flex items-center justify-between">
        <Text className="text-gray-400 text-xs">{label}</Text>
        <Icon className="h-4 w-4 text-gray-600" />
      </div>
      <Metric className="mt-1 text-gray-100">{value}</Metric>
      {sub && <Text className="text-gray-600 text-xs mt-0.5">{sub}</Text>}
    </Card>
  );
}

export default async function TechnicalPage({ searchParams }: PageProps) {
  const env: Environment =
    searchParams.env === "dev" ? "dev" : "prod";

  // All queries run in parallel on the server — no waterfalls.
  const [cpuData, memData, latencyData, slowPrompts, hops, activeHosts] =
    await Promise.all([
      getHourlyHostMetrics(env, "cpu_usage"),
      getHourlyHostMetrics(env, "memory_usage"),
      getLatencyPercentiles(env),
      getTop10SlowestPrompts(env),
      getAvgNetworkHops(env),
      getActiveHostCount(env),
    ]);

  const latRow = latencyData[0];

  return (
    <div className="px-6 py-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Infrastructure Health</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Live sidecar telemetry · auto-refreshes every 30 s
          </p>
        </div>
        {/* EnvToggle needs useSearchParams → must be a Client Component.
            Wrap in Suspense so the Server Component can stream around it. */}
        <Suspense fallback={null}>
          <EnvToggle />
        </Suspense>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Active Proxy Hosts"
          value={String(activeHosts)}
          sub="seen in last 24 h"
          icon={Server}
        />
        <StatCard
          label="Avg p50 Latency"
          value={latRow ? `${latRow.p50} ms` : "—"}
          sub="last 24 h"
          icon={Clock}
        />
        <StatCard
          label="p99 Latency"
          value={latRow ? `${latRow.p99} ms` : "—"}
          sub="99th percentile"
          icon={Activity}
        />
        <StatCard
          label="Avg Network Hops"
          value={hops.sampleCount > 0 ? String(hops.avgHops) : "—"}
          sub={hops.sampleCount > 0 ? `${hops.sampleCount} samples` : "no data"}
          icon={Network}
        />
      </div>

      {/* ── Host resource charts ── */}
      <div className="grid gap-4 md:grid-cols-2">
        <HostMetricsChart
          title="CPU Usage"
          unit="%"
          colour="blue"
          data={cpuData}
        />
        <HostMetricsChart
          title="Memory Consumption"
          unit="MB"
          colour="emerald"
          data={memData}
        />
      </div>

      {/* ── Latency percentiles ── */}
      <LatencyChart data={latencyData} avgNetworkHops={hops.avgHops} />

      {/* ── Wall of Shame ── */}
      <WallOfShame data={slowPrompts} />
    </div>
  );
}
