"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, FileText } from "lucide-react";

import type { AuditLogView } from "@/lib/api";
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

const PAGE_SIZE = 10;

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
  const [page, setPage] = useState(0);

  // Reset to first page whenever the underlying data changes (e.g. refresh)
  useEffect(() => {
    setPage(0);
  }, [logs]);

  const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const visible = logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Recent Audit Logs</CardTitle>
          <CardDescription>Prompt executions streaming in from active proxies.</CardDescription>
        </div>
        <Link
          href="/audit-logs"
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
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
                {visible.map((log, i) => (
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

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-4">
                <p className="text-xs text-muted-foreground">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, logs.length)} of {logs.length}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
