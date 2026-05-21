"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AuditLogView } from "@/lib/api";
import { cn } from "@/lib/utils";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.max(Math.floor(diff / 1000), 0);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLogView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/audit")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: AuditLogView[]) => setLogs(data.slice(0, 5)))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const hasNew = logs === null || logs.length > 0;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        className="relative"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {hasNew && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
        )}
      </Button>
      {open && (
        <div
          className={cn(
            "absolute right-0 top-full mt-2 w-[340px] rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-panel",
            "animate-fade-in z-30",
          )}
        >
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <p className="text-sm font-semibold">Recent activity</p>
            <span className="text-[11px] text-muted-foreground">Live from backend</span>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : logs && logs.length > 0 ? (
              <ul className="divide-y divide-border/40">
                {logs.map((log, i) => (
                  <li key={`${log.timestamp}-${i}`} className="px-4 py-3 hover:bg-accent/30 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{log.promptName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {log.versionTag} · {log.llmLatencyMs}ms LLM · {log.tokenCount} tokens
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {relativeTime(log.timestamp)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No recent activity.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
