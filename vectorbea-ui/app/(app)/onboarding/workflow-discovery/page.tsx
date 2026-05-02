"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Cable, Loader2, Radar, Rocket, ScanSearch, Wrench } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { WorkflowGraphView } from "@/components/workflows/workflow-graph-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiscoveryReview, DiscoverySession } from "@/lib/api";
import { canUseWorkflowReliability } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

const MODE_CARDS = [
  {
    id: "sdk",
    title: "SDK",
    summary: "Best for capturing agent, tool, and MCP semantics.",
    snippet: `VectorBea.init({\n  ingestUrl: "https://your-vectorbea-domain/api/ingest/traces",\n  ingestToken: process.env.VECTORBEA_INGEST_TOKEN,\n  environment: "production"\n})`,
  },
  {
    id: "sidecar",
    title: "Sidecar",
    summary: "Best for Kubernetes and low-latency production ingestion.",
    snippet: `docker run -e VECTORBEA_INGEST_TOKEN=*** vectorbea/sidecar:latest`,
  },
  {
    id: "opentelemetry",
    title: "OpenTelemetry",
    summary: "Best if you already emit traces and span events.",
    snippet: `OTEL_EXPORTER_OTLP_ENDPOINT=https://your-vectorbea-domain/api/ingest/traces`,
  },
  {
    id: "direct_api",
    title: "Direct API",
    summary: "Best for quick testing and scripted workflow replay.",
    snippet: `curl -X POST https://your-vectorbea-domain/api/ingest/traces \\`,
  },
];

export default function WorkflowDiscoveryOnboardingPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [mode, setMode] = useState("sdk");
  const [sessions, setSessions] = useState<DiscoverySession[]>([]);
  const [review, setReview] = useState<DiscoveryReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const latestSession = sessions[0] ?? null;
  const selectedWorkflow = review?.workflows[0] ?? null;

  useEffect(() => {
    if (!activeWorkspaceId || !canUseWorkflowReliability(planTier)) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const sessionsRes = await fetch(`/api/workflows/discovery?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
        const sessionsJson = await sessionsRes.json();
        if (!sessionsRes.ok) throw new Error(sessionsJson.error ?? "Failed to load discovery sessions");
        if (cancelled) return;
        const nextSessions = Array.isArray(sessionsJson.items) ? sessionsJson.items as DiscoverySession[] : [];
        setSessions(nextSessions);
        if (nextSessions[0]) {
          const reviewRes = await fetch(`/api/workflows/discovery?workspaceId=${encodeURIComponent(activeWorkspaceId)}&sessionId=${encodeURIComponent(nextSessions[0].id)}`, { cache: "no-store" });
          const reviewJson = await reviewRes.json();
          if (!reviewRes.ok) throw new Error(reviewJson.error ?? "Failed to load discovery review");
          if (!cancelled) setReview(reviewJson as DiscoveryReview);
        } else if (!cancelled) {
          setReview(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load workflow discovery");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(load, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceId, planTier]);

  const currentMode = useMemo(() => MODE_CARDS.find((item) => item.id === mode) ?? MODE_CARDS[0], [mode]);

  async function confirmCapability() {
    if (!activeWorkspaceId || !latestSession || !review?.capabilities[0]) return;
    setWorking("capability");
    setError(null);
    try {
      const res = await fetch(`/api/workflows/discovery/${encodeURIComponent(latestSession.id)}/confirm-capability?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discoveredCapabilityId: review.capabilities[0].id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to confirm capability");
      window.location.href = `/reliability/capabilities/${json.capability.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm capability");
    } finally {
      setWorking(null);
    }
  }

  async function confirmTools() {
    if (!activeWorkspaceId || !latestSession || !review?.tools.length) return;
    setWorking("tools");
    setError(null);
    try {
      const res = await fetch(`/api/workflows/discovery/${encodeURIComponent(latestSession.id)}/confirm-tools?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolIds: review.tools.map((tool) => tool.id) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to confirm tools");
      await fetch(`/api/workflows/discovery?workspaceId=${encodeURIComponent(activeWorkspaceId)}&sessionId=${encodeURIComponent(latestSession.id)}`, { cache: "no-store" })
        .then((next) => next.json())
        .then((nextReview) => setReview(nextReview as DiscoveryReview));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm tools");
    } finally {
      setWorking(null);
    }
  }

  async function createRegressionSuite() {
    if (!activeWorkspaceId || !selectedWorkflow?.traceId) return;
    setWorking("regression");
    setError(null);
    try {
      const res = await fetch(`/api/workflows/traces/${encodeURIComponent(selectedWorkflow.traceId)}/regression-suite?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create regression suite");
      window.location.href = `/reliability/capabilities/${json.capabilityId ?? review?.capabilities[0]?.matchedCapabilityId ?? ""}/regression-suites`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create regression suite");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Workflow discovery" subtitle="Install once, run one real workflow, then review what VectorBea detected" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {!canUseWorkflowReliability(planTier) ? (
          <Card className="border-[#E7DED1] bg-white">
            <CardContent className="py-14 text-center">
              <Radar className="mx-auto h-10 w-10 text-[#2563EB]" />
              <p className="mt-4 text-2xl font-bold text-[#111111]">Workflow discovery is available on Pro</p>
              <p className="mt-3 text-sm text-[#6B7280]">Upgrade to discover capabilities, tools, MCP servers, graph shapes, and suggested rules from your first real workflow run.</p>
              <Link href="/settings/billing" className="mt-6 inline-flex rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]">Upgrade to Pro</Link>
            </CardContent>
          </Card>
        ) : null}

        {canUseWorkflowReliability(planTier) ? (
          <>
            <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
              <Card className="border-[#E7DED1] bg-white">
                <CardHeader><CardTitle className="text-sm text-[#111111]">1. Choose integration mode</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {MODE_CARDS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition ${mode === item.id ? "border-[#2563EB] bg-[#EFF6FF]" : "border-[#E7DED1] bg-white hover:bg-[#FBFAF7]"}`}
                    >
                      <p className="font-semibold text-[#111111]">{item.title}</p>
                      <p className="mt-1 text-xs text-[#6B7280]">{item.summary}</p>
                    </button>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-[#E7DED1] bg-white">
                <CardHeader><CardTitle className="text-sm text-[#111111]">2. Configure and run one real workflow</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-[#6B7280]">{currentMode.summary}</p>
                  <div className="rounded-2xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                    <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-[#374151]">{currentMode.snippet}</pre>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link href="/settings/sdk" className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF]">Open SDK setup</Link>
                    <a href="/docs/sdk-and-ingestion" target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]">Read SDK and ingestion docs</a>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader><CardTitle className="text-sm text-[#111111]">3. Wait for the first trace</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 text-sm text-[#6B7280]">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : latestSession ? <CheckCircle2 className="h-4 w-4 text-[#166534]" /> : <ScanSearch className="h-4 w-4 text-[#2563EB]" />}
                {loading ? "Polling for discovery sessions…" : latestSession ? "Agent workflow detected. Review the discovered graph and confirm the capability and tools." : "Waiting for your first agent workflow trace."}
                {latestSession ? <Badge className="bg-[#F8F5EF] text-[#6B7280]">{latestSession.source}</Badge> : null}
              </CardContent>
            </Card>

            {error ? <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div> : null}

            {review ? (
              <>
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_420px]">
                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader><CardTitle className="text-sm text-[#111111]">4. Review detected workflow</CardTitle></CardHeader>
                    <CardContent>
                      {selectedWorkflow ? (
                        <WorkflowGraphView nodes={selectedWorkflow.graphNodes} edges={selectedWorkflow.graphEdges} sourceBadge={selectedWorkflow.sourceBadge} />
                      ) : (
                        <p className="text-sm text-[#6B7280]">No workflow graph detected yet.</p>
                      )}
                    </CardContent>
                  </Card>

                  <div className="space-y-5">
                    <Card className="border-[#E7DED1] bg-white">
                      <CardHeader><CardTitle className="text-sm text-[#111111]">5. Confirm capability and tools</CardTitle></CardHeader>
                      <CardContent className="space-y-4">
                        {review.capabilities[0] ? (
                          <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                            <p className="font-semibold text-[#111111]">{review.capabilities[0].suggestedName}</p>
                            <p className="mt-1 text-xs text-[#6B7280]">{review.capabilities[0].suggestedType.replaceAll("_", " ")} · confidence {Math.round(review.capabilities[0].confidence * 100)}%</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{review.capabilities[0].environment ?? "unknown env"}</Badge>
                              {review.capabilities[0].matchedCapabilityId ? <Badge className="bg-[#FFF7ED] text-[#C2410C]">match found</Badge> : <Badge className="bg-[#ECFDF5] text-[#166534]">new capability</Badge>}
                            </div>
                          </div>
                        ) : null}

                        <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-[#111111]"><Wrench className="h-4 w-4 text-[#2563EB]" />Detected tools</div>
                          <ul className="mt-3 space-y-2 text-sm text-[#374151]">
                            {review.tools.map((tool) => (
                              <li key={tool.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#E7DED1] bg-white px-3 py-2">
                                <span>{tool.toolName}</span>
                                <Badge className="bg-[#F8F5EF] text-[#6B7280]">{tool.seenCount}x</Badge>
                              </li>
                            ))}
                            {review.tools.length === 0 ? <li>No tools detected yet.</li> : null}
                          </ul>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <button type="button" onClick={confirmCapability} disabled={working !== null || !review.capabilities[0]} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60">
                            {working === "capability" ? "Confirming…" : "Confirm capability"}
                          </button>
                          <button type="button" onClick={confirmTools} disabled={working !== null || review.tools.length === 0} className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-60">
                            {working === "tools" ? "Confirming…" : "Confirm tools"}
                          </button>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-[#E7DED1] bg-white">
                      <CardHeader><CardTitle className="text-sm text-[#111111]">6. Create your first regression suite</CardTitle></CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-sm text-[#6B7280]">
                          Create a deterministic regression suite directly from the observed workflow path so you can start catching tool order and outcome regressions immediately.
                        </p>
                        <button type="button" onClick={createRegressionSuite} disabled={working !== null || !selectedWorkflow?.traceId} className="inline-flex items-center gap-2 rounded-xl bg-[#166534] px-4 py-2 text-sm font-semibold text-white hover:bg-[#14532D] disabled:opacity-60">
                          {working === "regression" ? "Creating…" : "Create from this trace"}
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </CardContent>
                    </Card>

                    <Card className="border-[#E7DED1] bg-white">
                      <CardHeader><CardTitle className="text-sm text-[#111111]">Suggested rules</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        {selectedWorkflow?.suggestedRules.map((rule) => (
                          <div key={rule.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                            <p className="font-medium text-[#111111]">{rule.summary}</p>
                            <p className="mt-1 text-sm text-[#6B7280]">{rule.whySuggested}</p>
                          </div>
                        ))}
                        {!selectedWorkflow?.suggestedRules.length ? <p className="text-sm text-[#6B7280]">No suggested deterministic rules yet.</p> : null}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
