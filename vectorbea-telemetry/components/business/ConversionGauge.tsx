"use client";

import { Card, Title, Text, CategoryBar, Legend } from "@tremor/react";

interface Props {
  conversionRate: number;  // 0–100
  retentionRate:  number;  // 0–100
}

export function ConversionGauge({ conversionRate, retentionRate }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Conversion */}
      <Card className="bg-gray-900 border-gray-800">
        <Title className="text-gray-100">Free → Paid Conversion</Title>
        <Text className="text-gray-500 text-xs mt-0.5">
          % of all organisations on the Team plan
        </Text>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>Free</span>
            <span className="font-semibold text-blue-400">{conversionRate}%</span>
          </div>
          <CategoryBar
            values={[conversionRate, 100 - conversionRate]}
            colors={["blue", "gray"]}
            className="mt-1"
          />
          <Legend
            categories={["Paid (Team)", "Free"]}
            colors={["blue", "gray"]}
            className="mt-3 justify-start text-xs"
          />
        </div>
      </Card>

      {/* 30-day retention */}
      <Card className="bg-gray-900 border-gray-800">
        <Title className="text-gray-100">30-Day Retention</Title>
        <Text className="text-gray-500 text-xs mt-0.5">
          Workspaces with a prompt execution 30 days after creation
        </Text>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>Churned</span>
            <span className="font-semibold text-emerald-400">{retentionRate}%</span>
          </div>
          <CategoryBar
            values={[retentionRate, 100 - retentionRate]}
            colors={["emerald", "gray"]}
            className="mt-1"
          />
          <Legend
            categories={["Retained", "Churned"]}
            colors={["emerald", "gray"]}
            className="mt-3 justify-start text-xs"
          />
        </div>
      </Card>
    </div>
  );
}
