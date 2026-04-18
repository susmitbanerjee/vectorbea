"use client";

import {
  Card,
  Title,
  Text,
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Badge,
} from "@tremor/react";
import { Flame } from "lucide-react";
import type { SlowPrompt } from "@/lib/queries/technical";

interface Props {
  data: SlowPrompt[];
}

function latencyBadgeColor(ms: number): "emerald" | "yellow" | "orange" | "rose" {
  if (ms < 100)  return "emerald";
  if (ms < 500)  return "yellow";
  if (ms < 1000) return "orange";
  return "rose";
}

export function WallOfShame({ data }: Props) {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-orange-400" />
        <Title className="text-gray-100">Wall of Shame — Top 10 Slowest Prompts</Title>
      </div>
      <Text className="text-gray-500 text-xs mt-0.5">
        Ranked by average execution latency · last 7 days
      </Text>

      {data.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-600">
          No prompt execution data yet
        </div>
      ) : (
        <Table className="mt-4">
          <TableHead>
            <TableRow className="border-gray-800">
              <TableHeaderCell className="text-gray-500 text-xs">#</TableHeaderCell>
              <TableHeaderCell className="text-gray-500 text-xs">Prompt</TableHeaderCell>
              <TableHeaderCell className="text-gray-500 text-xs">Workspace ID</TableHeaderCell>
              <TableHeaderCell className="text-gray-500 text-xs text-right">Avg Latency</TableHeaderCell>
              <TableHeaderCell className="text-gray-500 text-xs text-right">Executions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((row, i) => (
              <TableRow key={`${row.promptName}-${row.workspaceId ?? "none"}`} className="border-gray-800">
                <TableCell className="text-gray-600 text-xs w-8">{i + 1}</TableCell>
                <TableCell>
                  <span className="font-mono text-sm text-gray-200">{row.promptName}</span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-gray-500">
                    {row.workspaceId
                      ? `${row.workspaceId.slice(0, 8)}…`
                      : "—"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Badge color={latencyBadgeColor(row.avgLatencyMs)} size="sm">
                    {row.avgLatencyMs.toLocaleString()} ms
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-gray-400 text-sm tabular-nums">
                  {row.execCount.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
