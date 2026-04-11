"use client";

import { motion } from "framer-motion";
import { FileText } from "lucide-react";

import type { AuditLogView } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return timestamp;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function llmLatencyBadgeVariant(ms: number): "success" | "warning" | "destructive" {
  if (ms < 300) return "success";
  if (ms < 1000) return "warning";
  return "destructive";
}

function formatProxyLatency(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

function proxyLatencyBadgeVariant(ms: number): "success" | "warning" | "destructive" {
  if (ms < 5) return "success";
  if (ms < 50) return "warning";
  return "destructive";
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <FileText className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No audit logs yet</p>
        <p className="text-xs text-muted-foreground">
          Logs will appear here once prompts are executed.
        </p>
      </div>
    </div>
  );
}

export function RecentAuditTable({ logs }: { logs: AuditLogView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Audit Logs</CardTitle>
        <CardDescription>Prompt executions streaming in from active proxies.</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Prompt</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>VectorBea Latency</TableHead>
                <TableHead>LLM Latency</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log, i) => (
                <motion.tr
                  key={`${log.timestamp}-${log.promptName}-${log.versionTag}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04, ease: "easeOut" }}
                  className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                >
                  <TableCell className="text-muted-foreground">
                    <span title={log.timestamp}>{formatRelativeTime(log.timestamp)}</span>
                  </TableCell>
                  <TableCell className="font-medium">{log.promptName}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{log.versionTag}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={proxyLatencyBadgeVariant(log.proxyLatencyMs)}>
                      {formatProxyLatency(log.proxyLatencyMs)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={llmLatencyBadgeVariant(log.llmLatencyMs)}>
                      {log.llmLatencyMs} ms
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {log.tokenCount.toLocaleString()}
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
