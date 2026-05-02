"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Cable,
  CheckCircle2,
  Database,
  Loader2,
  Radar,
  Rocket,
  ScanSearch,
  Sparkles,
  Wrench,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { WorkflowMapView } from "@/components/workflows/workflow-map-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiscoveryReview, DiscoverySession, DiscoveredTool } from "@/lib/api";
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

function SectionEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#D8CFC2] bg-[#FBFAF7] px-4 py-5">
      <p className="text-sm font-medium text-[#374151]">{title}</p>
      <p className="mt-1 text-xs text-[#6B7280]">{body}</p>
    </div>
  );
}

function Toast({ message, tone, onDismiss }: { message: string; tone: "success" | "error"; onDismiss: () => void }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
        tone === "success"
          ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]"
          : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"
      }`}
    >
      {tone === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="opacity-70 hover:opacity-100">Dismiss</button>
    </div>
  );
}

export default function WorkflowDiscoveryOnboardingPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [mode, setMode] = useState("sdk");
  const [sessions, setSessions] = useState<DiscoverySession[]>([]);
  const [review, setReview] = useState<DiscoveryReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const latestSession = sessions[0] ?? null;
  const selectedWorkflow = review?.workflows[0] ?? null;
  const primaryCapability = review?.capabilities[0] ?? null;
  const confirmedCapabilityId = primaryCapability?.matchedCapabilityId ?? null;

  const currentMode = useMemo(() => MODE_CARDS.find((item) => item.id === mode) ?? MODE_CARDS[0], [mode]);

  const loadDiscovery = useCallback(async (sessionOverride?: DiscoverySession | null) => {
    if (!activeWorkspaceId || !canUseWorkflowReliability(planTier)) {
      setLoading(false);
      return;
    }

    const sessionsRes = await fetch(`/api/workflows/discovery?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
    const sessionsJson = await sessionsRes.json();
    if (!sessionsRes.ok) {
      throw new Error(sessionsJson.error ?? "Failed to load discovery sessions");
    }

    const nextSessions = Array.isArray(sessionsJson.items) ? (sessionsJson.items as DiscoverySession[]) : [];
    setSessions(nextSessions);

    const targetSession = sessionOverride ?? nextSessions[0] ?? null;
    if (!targetSession) {
      setReview(null);
      return;
    }

    const reviewRes = await fetch(`/api/workflows/discovery?workspaceId=${encodeURIComponent(activeWorkspaceId)}&sessionId=${encodeURIComponent(targetSession.id)}`, { cache: "no-store" });
    const reviewJson = await reviewRes.json();
    if (!reviewRes.ok) {
      throw new Error(reviewJson.error ?? "Failed to load discovery review");
    }
    setReview(reviewJson as DiscoveryReview);
  }, [activeWorkspaceId, planTier]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        await loadDiscovery();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load workflow discovery");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    const timer = window.setInterval(() => {
      void loadDiscovery().catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to refresh workflow discovery");
      });
    }, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadDiscovery]);

  async function confirmCapability() {
    if (!activeWorkspaceId || !latestSession || !primaryCapability) return;
    setWorking("capability");
    setError(null);
    try {
      const res = await fetch(`/api/workflows/discovery/${encodeURIComponent(latestSession.id)}/confirm-capability?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discoveredCapabilityId: primaryCapability.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to confirm capability");
      setReview((json.review as DiscoveryReview | null) ?? review);
      setToast({ message: "Capability confirmed", tone: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to confirm capability";
      setError(message);
      setToast({ message, tone: "error" });
    } finally {
      setWorking(null);
    }
  }

  async function confirmTools() {
    if (!activeWorkspaceId || !latestSession || !review?.tools.length) return;
    const pendingToolIds = review.tools
      .filter((tool) => tool.status !== "confirmed" && tool.status !== "merged")
      .map((tool) => tool.id);
    if (pendingToolIds.length === 0) {
      setToast({ message: "All detected tools are already confirmed", tone: "success" });
      return;
    }

    setWorking("tools");
    setError(null);
    try {
      const res = await fetch(`/api/workflows/discovery/${encodeURIComponent(latestSession.id)}/confirm-tools?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolIds: pendingToolIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to confirm tools");
      setReview((json.review as DiscoveryReview | null) ?? review);
      setToast({ message: "Tools confirmed", tone: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to confirm tools";
      setError(message);
      setToast({ message, tone: "error" });
    } finally {
      setWorking(null);
    }
  }

  async function confirmWorkflow() {
    if (!activeWorkspaceId || !latestSession || !selectedWorkflow) return;
    setWorking("workflow");
    setError(null);
    try {
      const res = await fetch(`/api/workflows/discovery/${encodeURIComponent(latestSession.id)}/confirm-workflow?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discoveredWorkflowId: selectedWorkflow.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to confirm workflow map");
      setReview((json.review as DiscoveryReview | null) ?? review);
      setToast({ message: "Workflow map confirmed", tone: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to confirm workflow map";
      setError(message);
      setToast({ message, tone: "error" });
    } finally {
      setWorking(null);
    }
  }

  async function createRegressionSuite() {
    if (!activeWorkspaceId || !selectedWorkflow?.traceId) return;
    if (!confirmedCapabilityId) {
      const message = "Confirm capability before creating a regression suite.";
      setError(message);
      setToast({ message, tone: "error" });
      return;
    }

    setWorking("regression");
    setError(null);
    try {
      const res = await fetch(`/api/workflows/traces/${encodeURIComponent(selectedWorkflow.traceId)}/regression-suite?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId: confirmedCapabilityId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Unable to create regression suite");
      setToast({ message: json.created === false ? "Regression suite already exists for this trace" : "Regression suite created", tone: "success" });
      window.location.href = `/reliability/capabilities/${json.capabilityId}/regression-suites`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create regression suite";
      setError(message);
      setToast({ message, tone: "error" });
    } finally {
      setWorking(null);
    }
  }

  const toolStatusCounts = useMemo(() => {
    const tools = review?.tools ?? [];
    return {
      confirmed: tools.filter((tool) => tool.status === "confirmed" || tool.status === "merged").length,
      total: tools.length,
    };
  }, [review?.tools]);

  const usageHotspots = useMemo(() => {
    if (!selectedWorkflow) return [];
    const nodes = selectedWorkflow.graphNodes.filter((node) => node.type !== "agent");
    const hotspots: string[] = [];
    const highestLatency = [...nodes].filter((node) => node.latencyMs != null).sort((left, right) => (right.latencyMs ?? 0) - (left.latencyMs ?? 0))[0];
    const highestCost = [...nodes].filter((node) => node.costEstimate != null).sort((left, right) => (right.costEstimate ?? 0) - (left.costEstimate ?? 0))[0];
    const highestOutputTokens = [...nodes]
      .map((node) => ({ node, outputTokens: Number((node.metadata as Record<string, unknown> | undefined)?.tokensOutput ?? 0) }))
      .sort((left, right) => right.outputTokens - left.outputTokens)[0];
    const repeatedTools = review?.tools.filter((tool) => tool.seenCount > 2) ?? [];

    if (highestLatency?.latencyMs != null) {
      hotspots.push(`${highestLatency.name} had the highest latency at ${highestLatency.latencyMs} ms.`);
    }
    if (highestCost?.costEstimate != null) {
      hotspots.push(`${highestCost.name} accounted for the highest estimated cost at $${highestCost.costEstimate.toFixed(4)}.`);
    }
    if (highestOutputTokens && highestOutputTokens.outputTokens > 0) {
      hotspots.push(`${highestOutputTokens.node.name} produced the highest output token volume with ${highestOutputTokens.outputTokens} tokens.`);
    }
    if (repeatedTools.length > 0) {
      hotspots.push(`${repeatedTools[0].toolName} was observed ${repeatedTools[0].seenCount} times across the discovered workflow shape.`);
    }

    return hotspots;
  }, [review?.tools, selectedWorkflow]);

  const canCreateRegressionSuite = Boolean(selectedWorkflow?.traceId && confirmedCapabilityId);

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Workflow discovery" subtitle="Install once, run one real workflow, then review the detected capability, tools, graph, and first regression path." />

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
        ) : (
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
                {loading ? "Polling for discovery sessions..." : latestSession ? "Agent workflow detected. Review the discovered workflow map, output, tools, and next steps below." : "Waiting for your first agent workflow trace."}
                {latestSession ? <Badge className="bg-[#F8F5EF] text-[#6B7280]">{latestSession.source}</Badge> : null}
                {review?.session.environment ? <Badge className="bg-[#ECFDF5] text-[#166534]">{review.session.environment}</Badge> : null}
              </CardContent>
            </Card>

            {error ? <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div> : null}

            {review ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_420px]">
                <div className="space-y-5">
                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader><CardTitle className="text-sm text-[#111111]">4. Review detected workflow map</CardTitle></CardHeader>
                    <CardContent>
                      {selectedWorkflow ? (
                        <WorkflowMapView
                          nodes={selectedWorkflow.graphNodes}
                          edges={selectedWorkflow.graphEdges}
                          sourceBadge={selectedWorkflow.sourceBadge}
                          discoveredBanner="This workflow map was inferred from observed traces. Confirm it when the structure looks right."
                        />
                      ) : (
                        <SectionEmpty
                          title="No workflow map detected yet"
                          body="Send a trace with agent, model, tool, or final response events to discover the workflow shape."
                        />
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <Card className="border-[#E7DED1] bg-white">
                      <CardHeader><CardTitle className="text-sm text-[#111111]">Detected models</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        {review.models.length > 0 ? review.models.map((model) => (
                          <div key={`${model.provider}-${model.model}`} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-[#111111]">{model.model ?? "Unknown model"}</p>
                                <p className="mt-1 text-xs text-[#6B7280]">{model.provider ?? "Unknown provider"} · seen {model.seenCount} time{model.seenCount === 1 ? "" : "s"}</p>
                              </div>
                              <div className="text-right text-xs text-[#6B7280]">
                                <p>{model.averageLatencyMs != null ? `${model.averageLatencyMs} ms avg` : "Latency unavailable"}</p>
                                <p>{model.estimatedCost != null ? `$${model.estimatedCost.toFixed(4)}` : "Cost estimate unavailable"}</p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#374151]">
                              <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">in {model.inputTokens} tokens</Badge>
                              <Badge className="bg-[#F8F5EF] text-[#6B7280]">out {model.outputTokens} tokens</Badge>
                            </div>
                          </div>
                        )) : (
                          <SectionEmpty
                            title="No model calls detected in this workflow yet"
                            body="If you are sending OpenTelemetry-style events, include provider and model attributes like gen_ai.system and gen_ai.request.model."
                          />
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-[#E7DED1] bg-white">
                      <CardHeader><CardTitle className="text-sm text-[#111111]">Workflow output</CardTitle></CardHeader>
                      <CardContent>
                        {review.workflowOutput ? (
                          <div className="space-y-3 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                            <div className="flex flex-wrap gap-2">
                              <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{review.workflowOutput.finalAction ?? "No final action"}</Badge>
                              <Badge className="bg-[#ECFDF5] text-[#166534]">{review.workflowOutput.outcomeStatus ?? "Outcome unavailable"}</Badge>
                            </div>
                            <p className="text-xs text-[#6B7280]">{review.workflowOutput.outcomeReason ?? "No outcome reason was captured for this trace."}</p>
                            <div className="rounded-xl border border-[#EEE6DA] bg-white p-3 text-sm text-[#374151]">
                              {review.workflowOutput.outputCaptureDisabled
                                ? "Output capture is disabled for this workspace."
                                : review.workflowOutput.finalResponsePreview ?? "No final output was captured for this trace."}
                            </div>
                          </div>
                        ) : (
                          <SectionEmpty
                            title="No final output was captured for this trace"
                            body="Send agent_run_completed or final_response events with final_response and outcome_status so the workflow output can be reviewed here."
                          />
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <div className="space-y-5">
                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader><CardTitle className="text-sm text-[#111111]">5. Confirm capability, tools, and workflow map</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      {primaryCapability ? (
                        <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[#111111]">{primaryCapability.suggestedName}</p>
                              <p className="mt-1 text-xs text-[#6B7280]">{primaryCapability.suggestedType.replaceAll("_", " ")} · confidence {Math.round(primaryCapability.confidence * 100)}%</p>
                            </div>
                            <Badge className={primaryCapability.status === "confirmed" || primaryCapability.status === "merged" ? "bg-[#ECFDF5] text-[#166534]" : "bg-[#FFF7ED] text-[#C2410C]"}>
                              {primaryCapability.status}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {primaryCapability.environment ? <Badge className="bg-[#F8F5EF] text-[#6B7280]">{primaryCapability.environment}</Badge> : null}
                            {confirmedCapabilityId ? (
                              <Link href={`/reliability/capabilities/${confirmedCapabilityId}`} className="inline-flex items-center rounded-lg bg-[#ECFDF5] px-3 py-1.5 text-xs font-semibold text-[#166534] hover:bg-[#D1FAE5]">
                                View capability
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <SectionEmpty
                          title="No capability suggestion yet"
                          body="Capability detection uses agent name, workflow name, service name, and tool shape from the incoming trace."
                        />
                      )}

                      <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-semibold text-[#111111]">
                            <Wrench className="h-4 w-4 text-[#2563EB]" />
                            Detected tools
                          </div>
                          <Badge className="bg-white text-[#6B7280]">{toolStatusCounts.confirmed}/{toolStatusCounts.total} confirmed</Badge>
                        </div>
                        <div className="mt-3 space-y-2">
                          {review.tools.length > 0 ? review.tools.map((tool: DiscoveredTool) => (
                            <div key={tool.id} className="rounded-lg border border-[#E7DED1] bg-white px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-[#111111]">{tool.toolName}</p>
                                  <p className="mt-1 text-xs text-[#6B7280]">
                                    {tool.mcpServerName ? `${tool.mcpServerName} · ` : ""}seen {tool.seenCount} time{tool.seenCount === 1 ? "" : "s"}
                                  </p>
                                </div>
                                <Badge className={tool.status === "confirmed" || tool.status === "merged" ? "bg-[#ECFDF5] text-[#166534]" : "bg-[#F8F5EF] text-[#6B7280]"}>
                                  {tool.status}
                                </Badge>
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                <div className="rounded-lg border border-[#EEE6DA] bg-[#FBFAF7] p-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8A7F72]">Arguments</p>
                                  <pre className="mt-1 overflow-x-auto text-[11px] text-[#374151]">{JSON.stringify(tool.argumentSchema, null, 2)}</pre>
                                </div>
                                <div className="rounded-lg border border-[#EEE6DA] bg-[#FBFAF7] p-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8A7F72]">Results</p>
                                  <pre className="mt-1 overflow-x-auto text-[11px] text-[#374151]">{JSON.stringify(tool.resultSchema, null, 2)}</pre>
                                </div>
                              </div>
                            </div>
                          )) : (
                            <SectionEmpty
                              title="No tool calls detected in this trace"
                              body="Make sure your trace emits tool_call or mcp_tool_call events with tool names and arguments."
                            />
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#111111]">
                          <Cable className="h-4 w-4 text-[#2563EB]" />
                          MCP servers
                        </div>
                        <div className="mt-3 space-y-2">
                          {review.mcpServers.length > 0 ? review.mcpServers.map((server) => (
                            <div key={server.serverName} className="rounded-lg border border-[#E7DED1] bg-white px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-[#111111]">{server.serverName}</p>
                                <Badge className="bg-[#F8F5EF] text-[#6B7280]">{server.seenCount} calls</Badge>
                              </div>
                              <p className="mt-1 text-xs text-[#6B7280]">Tools: {server.toolsDetected.join(", ") || "No tools detected"}</p>
                            </div>
                          )) : (
                            <SectionEmpty
                              title="No MCP servers detected"
                              body="If your workflow uses MCP, include mcp_server_name on mcp_tool_call events so discovery can group those tools correctly."
                            />
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button type="button" onClick={confirmCapability} disabled={working !== null || !primaryCapability || Boolean(confirmedCapabilityId)} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60">
                          {working === "capability" ? "Confirming..." : confirmedCapabilityId ? "Capability confirmed" : "Confirm capability"}
                        </button>
                        <button type="button" onClick={confirmTools} disabled={working !== null || review.tools.length === 0 || toolStatusCounts.confirmed === toolStatusCounts.total} className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-60">
                          {working === "tools" ? "Confirming..." : toolStatusCounts.confirmed === toolStatusCounts.total ? "Tools confirmed" : "Confirm selected tools"}
                        </button>
                        <button type="button" onClick={confirmWorkflow} disabled={working !== null || !selectedWorkflow || selectedWorkflow.status === "confirmed"} className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-60">
                          {working === "workflow" ? "Confirming..." : selectedWorkflow?.status === "confirmed" ? "Workflow map confirmed" : "Confirm workflow map"}
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
                      {!confirmedCapabilityId ? (
                        <SectionEmpty
                          title="Confirm the capability first"
                          body="A regression suite needs a confirmed capability so the suite and case can be attached to the right production workflow."
                        />
                      ) : null}
                      <button type="button" onClick={createRegressionSuite} disabled={working !== null || !selectedWorkflow?.traceId || !canCreateRegressionSuite} className="inline-flex items-center gap-2 rounded-xl bg-[#166534] px-4 py-2 text-sm font-semibold text-white hover:bg-[#14532D] disabled:opacity-60">
                        {working === "regression" ? "Creating..." : "Create your first regression suite"}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </CardContent>
                  </Card>

                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader><CardTitle className="text-sm text-[#111111]">Suggested rules</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {selectedWorkflow?.suggestedRules.length ? selectedWorkflow.suggestedRules.map((rule) => (
                        <div key={rule.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium text-[#111111]">{rule.summary}</p>
                            <Badge className={rule.severitySuggestion === "critical" ? "bg-[#FEF2F2] text-[#991B1B]" : rule.severitySuggestion === "high" ? "bg-[#FFF7ED] text-[#C2410C]" : "bg-[#FFFBEB] text-[#92400E]"}>
                              {rule.severitySuggestion}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-[#6B7280]">{rule.whySuggested}</p>
                        </div>
                      )) : (
                        <SectionEmpty
                          title="No suggested deterministic rules yet"
                          body="As more workflows are discovered, VectorBea will suggest reusable tool-order, cost, latency, and outcome guardrails here."
                        />
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader><CardTitle className="text-sm text-[#111111]">Usage hotspots</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {usageHotspots.length > 0 ? usageHotspots.map((hotspot) => (
                        <div key={hotspot} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3 text-sm text-[#374151]">
                          {hotspot}
                        </div>
                      )) : (
                        <SectionEmpty
                          title="No usage hotspots yet"
                          body="Once model calls and tool steps carry latency, token, and cost metadata, VectorBea will highlight the highest-latency and highest-cost steps here."
                        />
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-[#E7DED1] bg-white">
                    <CardHeader><CardTitle className="text-sm text-[#111111]">Execution mode and provider usage</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm text-[#6B7280]">
                      <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4">
                        <div className="flex items-center gap-2 font-semibold text-[#111111]">
                          <Rocket className="h-4 w-4 text-[#2563EB]" />
                          Observed production trace
                        </div>
                        <p className="mt-2 text-xs">This discovery session is using an observed trace from your runtime. When VectorBea performs managed test runs or replays, it uses the workspace provider connection server-side and traces model, token, cost, and latency usage without exposing provider keys.</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              !loading && (
                <Card className="border-[#E7DED1] bg-white">
                  <CardContent className="py-14 text-center">
                    <ScanSearch className="mx-auto h-10 w-10 text-[#2563EB]" />
                    <p className="mt-4 text-lg font-semibold text-[#111111]">No discovery session yet</p>
                    <p className="mt-2 text-sm text-[#6B7280]">Send your first real workflow trace through SDK, sidecar, OpenTelemetry, or direct API and the review surface will appear here automatically.</p>
                  </CardContent>
                </Card>
              )
            )}
          </>
        )}
      </div>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
