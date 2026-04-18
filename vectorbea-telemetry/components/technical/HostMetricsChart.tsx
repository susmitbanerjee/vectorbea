"use client";

import { AreaChart, Card, Title, Text } from "@tremor/react";
import type { HourlyMetric } from "@/lib/queries/technical";

interface Props {
  title: string;
  unit: string;
  colour: "blue" | "emerald" | "violet" | "amber";
  data: HourlyMetric[];
}

/**
 * Pivots the flat { hour, host, avgValue } rows into the format Tremor's
 * AreaChart expects: one object per hour with a key per host.
 */
function pivot(rows: HourlyMetric[]): Record<string, string | number>[] {
  const byHour = new Map<string, Record<string, string | number>>();

  for (const row of rows) {
    // Format hour as "HH:00" for a compact x-axis label
    const label = new Date(row.hour).toLocaleTimeString("en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const existing = byHour.get(label) ?? { hour: label };
    existing[row.host] = Math.round(row.avgValue * 10) / 10;
    byHour.set(label, existing);
  }

  return Array.from(byHour.values());
}

export function HostMetricsChart({ title, unit, colour, data }: Props) {
  const chartData = pivot(data);
  const categories = [...new Set(data.map((r) => r.host))];

  return (
    <Card className="bg-gray-900 border-gray-800">
      <Title className="text-gray-100">{title}</Title>
      <Text className="text-gray-500 text-xs mt-0.5">Last 24 hours · per host</Text>

      {chartData.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-gray-600">
          No data yet — waiting for sidecar heartbeats
        </div>
      ) : (
        <AreaChart
          className="mt-4 h-44"
          data={chartData}
          index="hour"
          categories={categories.length > 0 ? categories : ["No hosts"]}
          colors={[colour, "violet", "amber", "rose", "cyan"]}
          valueFormatter={(v) => `${v} ${unit}`}
          showLegend={categories.length > 1}
          showGridLines={false}
          curveType="monotone"
        />
      )}
    </Card>
  );
}
