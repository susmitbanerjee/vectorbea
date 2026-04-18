"use client";

import { BarChart, Card, Title, Text, Metric, Badge } from "@tremor/react";
import type { LatencyPercentiles } from "@/lib/queries/technical";

interface Props {
  data: LatencyPercentiles[];
  avgNetworkHops: number;
}

export function LatencyChart({ data, avgNetworkHops }: Props) {
  const row = data[0];

  // BarChart data: one bar per percentile
  const chartData = row
    ? [
        { label: "p50 (median)", latency: row.p50 },
        { label: "p95",          latency: row.p95 },
        { label: "p99",          latency: row.p99 },
      ]
    : [];

  function latencyColour(ms: number): "emerald" | "yellow" | "rose" {
    if (ms < 50)   return "emerald";
    if (ms < 200)  return "yellow";
    return "rose";
  }

  return (
    <Card className="bg-gray-900 border-gray-800">
      <div className="flex items-start justify-between">
        <div>
          <Title className="text-gray-100">Latency Percentiles</Title>
          <Text className="text-gray-500 text-xs mt-0.5">Proxy latency · last 24 h · {row?.sampleCount ?? 0} samples</Text>
        </div>
        {avgNetworkHops > 0 && (
          <Badge color="gray" size="sm">
            {avgNetworkHops} avg hops
          </Badge>
        )}
      </div>

      {/* KPI row */}
      {row ? (
        <div className="mt-4 grid grid-cols-3 gap-3 border-b border-gray-800 pb-4">
          {[
            { label: "p50", value: row.p50 },
            { label: "p95", value: row.p95 },
            { label: "p99", value: row.p99 },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-gray-800/50 p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <Metric className={`mt-0.5 text-${latencyColour(value)}-400`}>
                {value}<span className="text-sm font-normal text-gray-500"> ms</span>
              </Metric>
            </div>
          ))}
        </div>
      ) : null}

      {chartData.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-600">
          No latency data for selected environment
        </div>
      ) : (
        <BarChart
          className="mt-4 h-32"
          data={chartData}
          index="label"
          categories={["latency"]}
          colors={["blue"]}
          valueFormatter={(v) => `${v} ms`}
          showLegend={false}
          showGridLines={false}
        />
      )}
    </Card>
  );
}
