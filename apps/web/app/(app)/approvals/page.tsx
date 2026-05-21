"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Approval {
  id: string;
  title: string;
  message: string;
  requestedAt: string;
  status: string;
  agentRun: {
    id: string;
    status: string;
    agentJob: { id: string; name: string };
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approvals");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { approvals: Approval[] };
      setApprovals(data.approvals);
    } catch {
      toast.error("Failed to load approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, action: "approve" | "reject") {
    setActing(id);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason[id] ?? undefined }),
      });
      if (!res.ok) {
        const b = (await res.json()) as { error?: string };
        throw new Error(b.error ?? "Failed");
      }
      toast.success(action === "approve" ? "Approved — run will continue." : "Rejected — run cancelled.");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Agent runs waiting for human approval before continuing.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-[14px] bg-muted" />
          ))}
        </div>
      ) : approvals.length === 0 ? (
        <EmptyApprovals />
      ) : (
        <div className="space-y-4">
          {approvals.map((ap) => (
            <Card key={ap.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{ap.title}</CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        Job:{" "}
                        <Link
                          href={`/agent-jobs/${ap.agentRun.agentJob.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {ap.agentRun.agentJob.name}
                        </Link>
                      </span>
                      <span>
                        Run:{" "}
                        <Link
                          href={`/agent-runs/${ap.agentRun.id}`}
                          className="font-mono text-foreground hover:underline"
                        >
                          {ap.agentRun.id.slice(0, 12)}…
                        </Link>
                      </span>
                      <span>
                        <Clock className="inline h-3 w-3 mr-0.5" />
                        Requested {new Date(ap.requestedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">{ap.message}</p>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">
                    Reason (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Add a reason for your decision…"
                    value={reason[ap.id] ?? ""}
                    onChange={(e) => setReason((r) => ({ ...r, [ap.id]: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    size="sm"
                    onClick={() => void decide(ap.id, "approve")}
                    disabled={acting === ap.id}
                    className="gap-1.5"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void decide(ap.id, "reject")}
                    disabled={acting === ap.id}
                    className="gap-1.5"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject
                  </Button>
                  <Link
                    href={`/agent-runs/${ap.agentRun.id}`}
                    className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  >
                    View run →
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyApprovals() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[14px] border border-border bg-card py-16 text-center">
      <CheckCircle className="h-10 w-10 text-emerald-500/40" />
      <p className="text-sm font-medium">No approvals waiting</p>
      <p className="text-xs text-muted-foreground">
        All clear. When agent runs require approval, they&apos;ll appear here.
      </p>
    </div>
  );
}
