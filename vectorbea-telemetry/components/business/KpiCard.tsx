"use client";

import { Card, Metric, Text, BadgeDelta } from "@tremor/react";

interface Props {
  label: string;
  value: string;
  delta?: string;
  deltaType?: "increase" | "decrease" | "unchanged" | "moderateIncrease" | "moderateDecrease";
  sub?: string;
  accentClass?: string;   // e.g. "text-emerald-400"
}

export function KpiCard({ label, value, delta, deltaType, sub, accentClass }: Props) {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <Text className="text-gray-400 text-xs">{label}</Text>
      <Metric className={`mt-1 ${accentClass ?? "text-white"}`}>{value}</Metric>
      <div className="mt-2 flex items-center gap-2">
        {delta && deltaType && (
          <BadgeDelta deltaType={deltaType} size="xs">{delta}</BadgeDelta>
        )}
        {sub && <Text className="text-gray-600 text-xs">{sub}</Text>}
      </div>
    </Card>
  );
}
