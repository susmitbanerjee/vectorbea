"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  Cloud,
  Code2,
  Cpu,
  FileUp,
  GitBranch,
  Loader2,
  Package,
  Plug,
  Radio,
  Server,
  Shield,
  Siren,
  XCircle,
  Zap,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IntegrationConnection } from "@/lib/server/integrations";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewStats {
  connected: number;
  configured: number;
  notConfigured: number;
  disabled: number;
  error: number;
  healthy: number;
  degraded: number;
  failing: number;
  totalEvents24h: number;
  discoveredPending: number;
  totalConnections: number;
}

interface CoverageEntry {
  aiSystemId: string;
  aiSystemName: string;
  riskLevel: string | null;
  coverageStatus: "fully_monitored" | "partially_monitored" | "no_evidence" | "stale";
  lastEvidenceAt: string | null;
  sourceTypes: string[];
  eventsLast24h: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INTEGRATION_TYPE_META: Record<string, { label: string; icon: typeof Server; href: string }> = {
  sidecar:               { label: "Sidecar",           icon: Server,    href: "/integrations/sidecar" },
  opentelemetry:         { label: "OpenTelemetry",     icon: Radio,     href: "/integrations/opentelemetry" },
  sdk:                   { label: "SDK",               icon: Code2,     href: "/integrations/sdk" },
  direct_api:            { label: "Direct API",        icon: Plug,      href: "/integrations/sdk" },
  llm_provider:          { label: "LLM Provider",      icon: Cloud,     href: "/integrations/llm-providers" },
  mcp_server:            { label: "MCP Server",        icon: Cpu,       href: "/integrations/mcp" },
  rag_pipeline:          { label: "RAG Pipeline",      icon: Package,   href: "/integrations/rag" },
  classification_system: { label: "Classification",    icon: Activity,  href: "/integrations/classification" },
  extraction_system:     { label: "Extraction",        icon: FileUp,    href: "/integrations/extraction" },
  skill_runtime:         { label: "Skill Runtime",     icon: Zap,       href: "/integrations/skills" },
  ci_cd:                 { label: "CI/CD",             icon: GitBranch, href: "/integrations/ci-cd" },
  manual_upload:         { label: "Manual Upload",     icon: FileUp,    href: "/integrations/uploads" },
  langgraph:             { label: "LangGraph",         icon: GitBranch, href: "/integrations/sdk" },
  custom_webhook:        { label: "Custom Webhook",    icon: Plug,      href: "/integrations/ci-cd" },
};

const STATUS_STYLE = {
  connected:      { cls: "bg-[#ECFDF5] text-[#065F46]", label: "Connected" },
  configured:     { cls: "bg-[#EFF6FF] text-[#1D4ED8]", label: "Configured" },
  not_configured: { cls: "bg-[#F3F4F6] text-[#9CA3AF]", label: "Not configured" },
  disabled:       { cls: "bg-[#F3F4F6] text-[#9CA3AF]", label: "Disabled" },
  error:          { cls: "bg-[#FEF2F2] text-[#991B1B]", label: "Error" },
};

const HEALTH_STYLE = {
  healthy:  { cls: "text-[#065F46]", dot: "bg-[#065F46]" },
  degraded: { cls: "text-[#92400E]", dot: "bg-[#D97706]" },
  failing:  { cls: "text-[#991B1B]", dot: "bg-[#991B1B]" },
  unknown:  { cls: "text-[#9CA3AF]", dot: "bg-[#D1C9BD]" },
};

const COVERAGE_STYLE = {
  fully_monitored:    { cls: "bg-[#ECFDF5] text-[#065F46]",  label: "Fully monitored" },
  partially_monitored:{ cls: "bg-[#FFFBEB] text-[#92400E]",  label: "Partial" },
  no_evidence:        { cls: "bg-[#FEF2F2] text-[#991B1B]",  label: "No evidence" },
  stale:              { cls: "bg-[#FFF7ED] text-[#C2410C]",  label: "Stale" },
};

const RECOMMENDED_SOURCES = [
  { type: "sidecar",       label: "Deploy Sidecar",          desc: "Recommended for production AI agents",          href: "/integrations/sidecar" as Route },
  { type: "opentelemetry", label: "Connect OpenTelemetry",   desc: "Plug into existing enterprise telemetry",       href: "/integrations/opentelemetry" as Route },
  { type: "sdk",           label: "Instrument with SDK",     desc: "Add semantic evidence to your AI code",         href: "/integrations/sdk" as Route },
  { type: "ci_cd",         label: "Add CI/CD evidence",      desc: "Block releases from your pipeline",             href: "/integrations/ci-cd" as Route },
  { type: "llm_provider",  label: "Configure LLM Providers", desc: "Required for managed evidence checks",          href: "/integrations/llm-providers" as Route },
  { type: "manual_upload", label: "Upload evidence",         desc: "Start immediately without instrumentation",     href: "/integrations/uploads" as Route },
];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsOverviewPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [stats, setStats]         = useState<OverviewStats | null>(null);
  const [connections, setConns]   = useState<IntegrationConnection[]>([]);
  const [coverage, setCoverage]   = useState<CoverageEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const ws = encodeURIComponent(activeWorkspaceId);
    setLoading(true);
    Promise.all([
      fetch(`/api/integrations/overview?workspaceId=${ws}`).then((r) => r.json()),
      fetch(`/api/integrations?workspaceId=${ws}`).then((r) => r.json()),
      fetch(`/api/integrations/coverage?workspaceId=${ws}`).then((r) => r.json()),
    ])
      .then(([statsData, connsData, coverageData]: [unknown, unknown, unknown]) => {
        if ((statsData as { error?: string }).error) throw new Error((statsData as { error: string }).error);
        setStats(statsData as OverviewStats);
        setConns(Array.isArray(connsData) ? connsData as IntegrationConnection[] : []);
        setCoverage(Array.isArray(coverageData) ? coverageData as CoverageEntry[] : []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [activeWorkspaceId]);

  const noConnections = !loading && connections.length === 0;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Integrations"
        subtitle="Connect your AI systems once — VectorBea continuously monitors governance risk, policy compliance, evidence readiness, and release safety"
        actions={
          <Link
            href={"/integrations/discovered-systems" as Route}
            className="flex items-center gap-1.5 rounded-xl border border-[#E7DED1] bg-white px-3 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]"
          >
            <Bot className="h-3.5 w-3.5" />
            Discovered systems
            {stats && stats.discoveredPending > 0 && (
              <span className="ml-1 rounded-full bg-[#FEF2F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#991B1B]">
                {stats.discoveredPending}
              </span>
            )}
          </Link>
        }
      />

      <div className="px-4 py-6 md:px-6 xl:px-8 space-y-6">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* ── No integrations CTA ─────────────────────────────────────────── */}
        {noConnections && (
          <div className="rounded-2xl border-2 border-dashed border-[#D8CFC2] bg-white p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#EFF6FF]">
              <Plug className="h-7 w-7 text-[#2563EB]" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-[#111111]">No evidence sources connected</h2>
            <p className="mt-2 max-w-md mx-auto text-sm text-[#6B7280]">
              VectorBea cannot govern what it cannot see. Connect an evidence source to start continuous governance monitoring.
            </p>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-2xl mx-auto">
              {RECOMMENDED_SOURCES.map((s) => (
                <Link
                  key={s.type}
                  href={s.href}
                  className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-3 text-left hover:border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                >
                  <p className="text-sm font-semibold text-[#111111]">{s.label}</p>
                  <p className="text-xs text-[#6B7280] mt-0.5">{s.desc}</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Summary strip ───────────────────────────────────────────────── */}
        {!noConnections && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Connected",       value: stats?.connected ?? 0,       color: "text-[#065F46]" },
              { label: "Healthy",         value: stats?.healthy ?? 0,          color: "text-[#065F46]" },
              { label: "Degraded",        value: stats?.degraded ?? 0,         color: "text-[#92400E]" },
              { label: "Events / 24h",    value: stats?.totalEvents24h ?? 0,   color: "text-[#1D4ED8]" },
              { label: "Unregistered",    value: stats?.discoveredPending ?? 0, color: stats && stats.discoveredPending > 0 ? "text-[#C2410C]" : "text-[#111111]" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-[#E7DED1] bg-white px-4 py-3">
                <p className={`text-2xl font-bold ${s.color}`}>{loading ? "—" : s.value}</p>
                <p className="text-xs text-[#6B7280] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {/* ── Connection health ─────────────────────────────────────── */}
            <Card className="border-[#E7DED1]">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold text-[#111111]">Connection health</CardTitle>
                <Link href={"/integrations/health" as Route} className="text-xs text-[#2563EB] hover:underline">View all →</Link>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                ) : connections.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-[#6B7280]">No integrations configured yet.</div>
                ) : (
                  <div className="divide-y divide-[#F1ECE3]">
                    {connections.slice(0, 8).map((conn) => {
                      const meta = INTEGRATION_TYPE_META[conn.integrationType] ?? { label: conn.integrationType, icon: Plug, href: "/integrations" };
                      const TypeIcon = meta.icon;
                      const sc = STATUS_STYLE[conn.status] ?? STATUS_STYLE.not_configured;
                      const hc = HEALTH_STYLE[conn.healthStatus] ?? HEALTH_STYLE.unknown;
                      return (
                        <Link
                          key={conn.id}
                          href={meta.href as Route}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-[#FBFAF7] transition-colors"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                            <TypeIcon className="h-4 w-4 text-[#374151]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#111111] truncate">{conn.name}</p>
                            <p className="text-[10px] text-[#9CA3AF]">{meta.label} · Last seen: {fmtDate(conn.lastSeenAt)}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`flex items-center gap-1 text-[10px] font-medium ${hc.cls}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${hc.dot}`} />
                              {conn.healthStatus}
                            </span>
                            <Badge className={`${sc.cls} text-[10px] font-normal`}>{sc.label}</Badge>
                          </div>
                          <ChevronRight className="h-4 w-4 text-[#D1C9BD] shrink-0" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Continuous governance status ──────────────────────────── */}
            <Card className="border-[#E7DED1]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-[#111111]">Continuous governance</CardTitle>
              </CardHeader>
              <CardContent>
                {connections.length === 0 ? (
                  <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-4 text-sm text-[#6B7280]">
                    Connect an evidence source to enable continuous governance monitoring.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Active evidence sources", value: stats?.connected ?? 0, icon: Shield, color: "text-[#065F46]", bg: "bg-[#ECFDF5]" },
                      { label: "Evidence events / 24h",   value: stats?.totalEvents24h ?? 0, icon: Activity, color: "text-[#1D4ED8]", bg: "bg-[#EFF6FF]" },
                      { label: "Unregistered AI systems", value: stats?.discoveredPending ?? 0, icon: Bot, color: "text-[#C2410C]", bg: "bg-[#FFF7ED]" },
                      { label: "Degraded connections",    value: stats?.degraded ?? 0, icon: AlertTriangle, color: "text-[#92400E]", bg: "bg-[#FFFBEB]" },
                      { label: "Failed connections",      value: stats?.failing ?? 0, icon: XCircle, color: "text-[#991B1B]", bg: "bg-[#FEF2F2]" },
                      { label: "Systems with evidence",   value: coverage.filter((c) => c.coverageStatus !== "no_evidence").length, icon: CheckCircle2, color: "text-[#065F46]", bg: "bg-[#ECFDF5]" },
                    ].map((s) => {
                      const Icon = s.icon;
                      return (
                        <div key={s.label} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-3">
                          <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${s.bg} mb-2`}>
                            <Icon className={`h-3.5 w-3.5 ${s.color}`} />
                          </div>
                          <p className={`text-xl font-bold ${s.color}`}>{loading ? "—" : s.value}</p>
                          <p className="text-[10px] text-[#9CA3AF] mt-0.5">{s.label}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            {/* ── Evidence coverage ─────────────────────────────────────── */}
            <Card className="border-[#E7DED1]">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold text-[#111111]">Evidence coverage</CardTitle>
                <Link href={"/integrations/coverage" as Route} className="text-xs text-[#2563EB] hover:underline">View all →</Link>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="px-4 py-4 text-sm text-[#6B7280] flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
                ) : coverage.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-[#6B7280]">No AI systems registered yet.</div>
                ) : (
                  <div className="divide-y divide-[#F1ECE3]">
                    {coverage.slice(0, 8).map((c) => {
                      const cs = COVERAGE_STYLE[c.coverageStatus];
                      return (
                        <div key={c.aiSystemId} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#111111] truncate">{c.aiSystemName}</p>
                            <p className="text-[10px] text-[#9CA3AF]">
                              {c.sourceTypes.length > 0 ? c.sourceTypes.join(", ") : "no sources"}
                              {" · "}{c.eventsLast24h} events/24h
                            </p>
                          </div>
                          <Badge className={`${cs.cls} text-[10px] font-normal shrink-0`}>{cs.label}</Badge>
                        </div>
                      );
                    })}
                    {coverage.length > 8 && (
                      <div className="px-4 py-2">
                        <Link href={"/integrations/coverage" as Route} className="text-xs text-[#2563EB] hover:underline">
                          View all {coverage.length} systems →
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Recommended actions ───────────────────────────────────── */}
            <Card className="border-[#E7DED1]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-[#111111]">Add evidence sources</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {RECOMMENDED_SOURCES.map((s) => {
                  const alreadyConnected = connections.some((c) => c.integrationType === s.type && (c.status === "connected" || c.status === "configured"));
                  return (
                    <Link
                      key={s.type}
                      href={s.href}
                      className="flex items-center gap-3 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2.5 hover:border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#111111]">{s.label}</p>
                        <p className="text-[10px] text-[#9CA3AF] truncate">{s.desc}</p>
                      </div>
                      {alreadyConnected
                        ? <CheckCircle2 className="h-4 w-4 text-[#065F46] shrink-0" />
                        : <ArrowRight className="h-4 w-4 text-[#D1C9BD] shrink-0" />
                      }
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
