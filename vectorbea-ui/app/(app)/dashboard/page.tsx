"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  AlertCircle,
  Activity,
  PlusCircle,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GovSummary {
  total_ai_systems: number;
  high_risk_systems: number;
  missing_required_evidence: number;
  blocked_releases: number;
  pending_approvals: number;
  open_incidents: number;
  runtime_policy_violations: number;
  unregistered_ai_activity: number;
}

interface GovernanceDashboardData {
  summary: GovSummary;
  governance_readiness: Array<{ status: string; count: number; pct: number }>;
  risk_distribution: Array<{ risk_level: string; count: number }>;
  system_type_distribution: Array<{ type: string; count: number }>;
  evidence_health: Array<{ status: string; count: number }>;
  evidence_by_type: Array<{ evidence_type: string; count: number }>;
  release_gate_status: Array<{ decision: string; count: number }>;
  policy_violations_by_severity: Array<{ severity: string; count: number }>;
  policy_violations_by_type: Array<{ policy_type: string; count: number }>;
  monitoring_coverage: Array<{ status: string; count: number }>;
  integration_health: Array<{
    id: string;
    name: string;
    integrationType: string;
    status: string;
    healthStatus: string;
    lastSeenAt: string | null;
  }>;
  recent_release_gates: Array<{
    id: string;
    capabilityName: string;
    versionNumber: string;
    decision: string;
    reason: string;
    updatedAt: string;
  }>;
  top_missing_evidence: Array<{
    id: string;
    capabilityName: string;
    evidenceType: string;
    isBlocking: boolean;
    policyName: string;
  }>;
  top_open_violations: Array<{
    id: string;
    capabilityName: string;
    policyName: string;
    severity: string;
    count: number;
    lastSeenAt: string;
    status: string;
  }>;
  pending_approvals: Array<{
    id: string;
    type: string;
    capabilityName: string;
    versionNumber: string | null;
    riskLevel: string | null;
    requestedBy: string;
    createdAt: string;
  }>;
  open_incidents: Array<{
    id: string;
    title: string;
    severity: string;
    capabilityName: string;
    status: string;
    ownerName: string;
    updatedAt: string;
  }>;
  recent_audit_events: Array<{
    id: string;
    eventType: string;
    actorName: string;
    entityName: string;
    entityType: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
  recommended_actions: Array<{
    id: string;
    title: string;
    reason: string;
    count: number;
    cta: string;
    href: string;
  }>;
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const CHART_COLORS = {
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
  darkred: "#991b1b",
  blue: "#2563eb",
  gray: "#6b7280",
};

const READINESS_COLORS: Record<string, string> = {
  Ready: CHART_COLORS.green,
  "Missing Evidence": CHART_COLORS.amber,
  Blocked: CHART_COLORS.red,
  "Needs Review": CHART_COLORS.blue,
  "No Policy": CHART_COLORS.gray,
};

const RISK_COLORS: Record<string, string> = {
  low: CHART_COLORS.green,
  medium: CHART_COLORS.amber,
  high: CHART_COLORS.red,
  critical: CHART_COLORS.darkred,
};

const SEVERITY_COLORS: Record<string, string> = {
  low: CHART_COLORS.green,
  medium: CHART_COLORS.amber,
  high: CHART_COLORS.red,
  critical: CHART_COLORS.darkred,
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtRelative(s: string | null | undefined) {
  if (!s) return "—";
  const diff = Date.now() - new Date(s).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

function pill(label: string, colorClass: string) {
  return (
    <span
      key={label}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {label}
    </span>
  );
}

function decisionBadge(decision: string) {
  if (decision === "approved") return pill("Approved", "bg-green-100 text-green-700");
  if (decision === "blocked") return pill("Blocked", "bg-red-100 text-red-700");
  return pill(capitalize(decision), "bg-blue-100 text-blue-700");
}

function severityBadge(sev: string) {
  if (sev === "critical") return pill("Critical", "bg-red-200 text-red-800");
  if (sev === "high") return pill("High", "bg-red-100 text-red-700");
  if (sev === "medium") return pill("Medium", "bg-amber-100 text-amber-700");
  return pill("Low", "bg-green-100 text-green-700");
}

function healthBadge(h: string) {
  if (h === "healthy") return pill("Healthy", "bg-green-100 text-green-700");
  if (h === "degraded") return pill("Degraded", "bg-amber-100 text-amber-700");
  if (h === "failing") return pill("Failing", "bg-red-100 text-red-700");
  return pill("Unknown", "bg-gray-100 text-gray-600");
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-200 ${className}`} />
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-[#E7DED1] bg-white p-4">
            <Skeleton className="mb-2 h-8 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-[#E7DED1] bg-white p-4">
            <Skeleton className="mb-4 h-5 w-40" />
            <Skeleton className="h-48 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  subtext,
  accentClass,
  icon: Icon,
}: {
  label: string;
  value: number;
  subtext?: string;
  accentClass: string;
  icon?: React.ElementType;
}) {
  return (
    <div
      className={`rounded-lg border border-[#E7DED1] bg-white p-4 border-l-4 ${accentClass}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-3xl font-bold text-[#111111]">{value.toLocaleString()}</div>
          <div className="mt-1 text-sm font-medium text-[#111111]">{label}</div>
          {subtext && (
            <div className="mt-0.5 text-xs text-gray-500">{subtext}</div>
          )}
        </div>
        {Icon && (
          <Icon className="h-6 w-6 text-gray-400" />
        )}
      </div>
    </div>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-[#E7DED1] bg-white p-5 ${className}`}>
      <h2 className="mb-4 text-base font-semibold text-[#111111]">{title}</h2>
      {children}
    </div>
  );
}

// ─── No-data placeholder ──────────────────────────────────────────────────────

function NoData() {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-gray-400">
      No data available
    </div>
  );
}

// ─── Donut chart ──────────────────────────────────────────────────────────────

function DonutChart({
  data,
  colorMap,
  dataKey,
  nameKey,
}: {
  data: Array<Record<string, unknown>>;
  colorMap: Record<string, string>;
  dataKey: string;
  nameKey: string;
}) {
  if (!data.length) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey={dataKey}
          nameKey={nameKey}
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={colorMap[String(entry[nameKey])] ?? CHART_COLORS.gray}
            />
          ))}
        </Pie>
        <Tooltip formatter={(v: unknown) => [String(v), ""]} />
        <Legend
          formatter={(value) => (
            <span className="text-xs text-gray-700">{capitalize(value)}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function SimpleBar({
  data,
  xKey,
  fill = CHART_COLORS.blue,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  fill?: string;
}) {
  if (!data.length) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: -20, right: 8, top: 4, bottom: 4 }}>
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} tickFormatter={capitalize} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip formatter={(v: unknown) => [String(v), "Count"]} />
        <Bar dataKey="count" fill={fill} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
        <Activity className="h-8 w-8 text-blue-600" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-[#111111]">
        No AI systems registered yet
      </h2>
      <p className="mb-6 max-w-sm text-sm text-gray-500">
        Register your first AI system to start tracking governance, evidence,
        policies, and releases across your organization.
      </p>
      <Link
        href="/registry/systems/new"
        className="inline-flex items-center gap-2 rounded-lg bg-[#111111] px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        <PlusCircle className="h-4 w-4" />
        Register AI System
      </Link>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  const [timeRange, setTimeRange] = useState("7d");
  const [data, setData] = useState<GovernanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("workspaceId", workspaceId);
      params.set("time_range", timeRange);
      const res = await fetch(`/api/dashboard/governance?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to load");
      }
      setData((await res.json()) as GovernanceDashboardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, timeRange]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, lastRefresh]);

  const refresh = () => setLastRefresh(Date.now());

  const actions = (
    <div className="flex items-center gap-3">
      <select
        value={timeRange}
        onChange={(e) => setTimeRange(e.target.value)}
        className="rounded-md border border-[#E7DED1] bg-white px-3 py-1.5 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
      <button
        onClick={refresh}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#E7DED1] bg-white px-3 py-1.5 text-sm text-[#111111] hover:bg-gray-50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Governance Overview"
        subtitle="Continuous governance status across AI systems, policies, evidence, approvals, and releases"
        actions={actions}
      />

      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        </div>
      ) : !data ? null : data.summary.total_ai_systems === 0 ? (
        <div className="p-6">
          <EmptyState />
        </div>
      ) : (
        <div className="space-y-6 p-6">

          {/* ── 1. KPI Cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard
              label="Total AI Systems"
              value={data.summary.total_ai_systems}
              subtext="Registered in workspace"
              accentClass="border-l-blue-500"
              icon={Activity}
            />
            <KpiCard
              label="High Risk Systems"
              value={data.summary.high_risk_systems}
              subtext="High + critical risk level"
              accentClass={data.summary.high_risk_systems > 0 ? "border-l-red-500" : "border-l-green-500"}
              icon={ShieldAlert}
            />
            <KpiCard
              label="Missing Required Evidence"
              value={data.summary.missing_required_evidence}
              subtext="Systems with gaps"
              accentClass={data.summary.missing_required_evidence > 0 ? "border-l-red-500" : "border-l-green-500"}
              icon={AlertTriangle}
            />
            <KpiCard
              label="Blocked Releases"
              value={data.summary.blocked_releases}
              subtext="Versions blocked from release"
              accentClass={data.summary.blocked_releases > 0 ? "border-l-red-500" : "border-l-green-500"}
              icon={AlertCircle}
            />
            <KpiCard
              label="Pending Approvals"
              value={data.summary.pending_approvals}
              subtext="Awaiting review"
              accentClass={data.summary.pending_approvals > 0 ? "border-l-amber-500" : "border-l-green-500"}
              icon={Clock}
            />
            <KpiCard
              label="Open Incidents"
              value={data.summary.open_incidents}
              subtext="Active & investigating"
              accentClass={data.summary.open_incidents > 0 ? "border-l-red-500" : "border-l-green-500"}
              icon={AlertTriangle}
            />
            <KpiCard
              label="Runtime Policy Violations"
              value={data.summary.runtime_policy_violations}
              subtext={`In the last ${timeRange}`}
              accentClass={data.summary.runtime_policy_violations > 0 ? "border-l-red-500" : "border-l-green-500"}
              icon={ShieldAlert}
            />
            <KpiCard
              label="Unregistered AI Activity"
              value={data.summary.unregistered_ai_activity}
              subtext="Discovered, not registered"
              accentClass={data.summary.unregistered_ai_activity > 0 ? "border-l-amber-500" : "border-l-green-500"}
              icon={AlertCircle}
            />
          </div>

          {/* ── 2. Governance Readiness ──────────────────────────────── */}
          <Section title="Governance Readiness">
            <div className="flex flex-col gap-6 md:flex-row">
              <div className="md:w-80">
                <DonutChart
                  data={data.governance_readiness}
                  colorMap={READINESS_COLORS}
                  dataKey="count"
                  nameKey="status"
                />
              </div>
              <div className="flex-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 pr-4 text-right">Count</th>
                      <th className="pb-2 pr-4 text-right">%</th>
                      <th className="pb-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.governance_readiness.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-gray-400">
                          No data
                        </td>
                      </tr>
                    ) : (
                      data.governance_readiness.map((row) => (
                        <tr key={row.status} className="border-b border-[#E7DED1]">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded-full"
                                style={{
                                  backgroundColor:
                                    READINESS_COLORS[row.status] ?? CHART_COLORS.gray,
                                }}
                              />
                              {row.status}
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right font-medium">
                            {row.count}
                          </td>
                          <td className="py-2 pr-4 text-right text-gray-500">
                            {row.pct}%
                          </td>
                          <td className="py-2">
                            {row.status === "Ready" ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <Link
                                href="/registry/systems"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Review
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          {/* ── 3. Risk & Type distribution ──────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="AI Systems by Risk Level">
              <DonutChart
                data={data.risk_distribution}
                colorMap={RISK_COLORS}
                dataKey="count"
                nameKey="risk_level"
              />
            </Section>
            <Section title="AI Systems by Type">
              <SimpleBar
                data={data.system_type_distribution}
                xKey="type"
                fill={CHART_COLORS.blue}
              />
            </Section>
          </div>

          {/* ── 4. Evidence Health ───────────────────────────────────── */}
          <Section title="Evidence Health">
            {data.evidence_health.length === 0 ? (
              <NoData />
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-3">
                  {data.evidence_health.map((r) => {
                    const colorClass =
                      r.status === "passed"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : r.status === "failed"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : r.status === "needs_review"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-blue-50 text-blue-700 border border-blue-200";
                    return (
                      <div
                        key={r.status}
                        className={`rounded-lg px-3 py-2 ${colorClass}`}
                      >
                        <div className="text-lg font-bold">{r.count}</div>
                        <div className="text-xs">{capitalize(r.status)}</div>
                      </div>
                    );
                  })}
                </div>
                <SimpleBar
                  data={data.evidence_by_type}
                  xKey="evidence_type"
                  fill={CHART_COLORS.green}
                />
              </>
            )}
          </Section>

          {/* ── 5. Release Gates ─────────────────────────────────────── */}
          <Section title="Release Gates">
            <div className="mb-4 flex flex-wrap gap-3">
              {data.release_gate_status.map((r) => {
                const colorClass =
                  r.decision === "approved"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : r.decision === "blocked"
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-blue-50 text-blue-700 border border-blue-200";
                return (
                  <div key={r.decision} className={`rounded-lg px-3 py-2 ${colorClass}`}>
                    <div className="text-lg font-bold">{r.count}</div>
                    <div className="text-xs">{capitalize(r.decision)}</div>
                  </div>
                );
              })}
            </div>
            {data.recent_release_gates.length === 0 ? (
              <NoData />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                    <th className="pb-2 pr-4">AI System</th>
                    <th className="pb-2 pr-4">Version</th>
                    <th className="pb-2 pr-4">Decision</th>
                    <th className="pb-2 pr-4">Reason</th>
                    <th className="pb-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_release_gates.map((row) => (
                    <tr key={row.id} className="border-b border-[#E7DED1]">
                      <td className="py-2 pr-4 font-medium">{row.capabilityName}</td>
                      <td className="py-2 pr-4 text-gray-600">v{row.versionNumber}</td>
                      <td className="py-2 pr-4">{decisionBadge(row.decision)}</td>
                      <td className="py-2 pr-4 text-gray-500">{capitalize(row.reason)}</td>
                      <td className="py-2">
                        <Link
                          href="/registry/systems"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* ── 6. Policy Violations ─────────────────────────────────── */}
          <Section title="Policy Violations">
            {data.policy_violations_by_severity.length === 0 &&
            data.top_open_violations.length === 0 ? (
              <div className="flex h-20 items-center justify-center text-sm text-green-700">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                No policy violations in the selected time range
              </div>
            ) : (
              <div className="flex flex-col gap-4 md:flex-row">
                <div className="md:w-64">
                  <SimpleBar
                    data={data.policy_violations_by_severity}
                    xKey="severity"
                    fill={CHART_COLORS.red}
                  />
                </div>
                <div className="flex-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                        <th className="pb-2 pr-4">System</th>
                        <th className="pb-2 pr-4">Policy</th>
                        <th className="pb-2 pr-4">Severity</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_open_violations.map((v) => (
                        <tr key={v.id} className="border-b border-[#E7DED1]">
                          <td className="py-2 pr-4 font-medium">{v.capabilityName}</td>
                          <td className="py-2 pr-4 text-gray-600">{v.policyName}</td>
                          <td className="py-2 pr-4">{severityBadge(v.severity)}</td>
                          <td className="py-2 text-gray-500">{capitalize(v.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Section>

          {/* ── 7. Approvals & Incidents ─────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Pending Approvals">
              {data.pending_approvals.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-sm text-green-700">
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  No pending approvals
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                      <th className="pb-2 pr-3">System</th>
                      <th className="pb-2 pr-3">Type</th>
                      <th className="pb-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pending_approvals.map((a) => (
                      <tr key={a.id} className="border-b border-[#E7DED1]">
                        <td className="py-2 pr-3 font-medium">{a.capabilityName}</td>
                        <td className="py-2 pr-3 text-gray-600">
                          {capitalize(a.type)}
                        </td>
                        <td className="py-2 text-gray-500">{fmtRelative(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section title="Open Incidents">
              {data.open_incidents.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-sm text-green-700">
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  No open incidents
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                      <th className="pb-2 pr-3">Title</th>
                      <th className="pb-2 pr-3">Sev</th>
                      <th className="pb-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.open_incidents.map((i) => (
                      <tr key={i.id} className="border-b border-[#E7DED1]">
                        <td className="py-2 pr-3 font-medium">{i.title}</td>
                        <td className="py-2 pr-3">{severityBadge(i.severity)}</td>
                        <td className="py-2 text-gray-500">{fmtRelative(i.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </div>

          {/* ── 8. Missing Evidence Table ────────────────────────────── */}
          {data.top_missing_evidence.length > 0 && (
            <Section title="Missing Required Evidence">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                    <th className="pb-2 pr-4">AI System</th>
                    <th className="pb-2 pr-4">Evidence Type</th>
                    <th className="pb-2 pr-4">Blocking</th>
                    <th className="pb-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_missing_evidence.map((e) => (
                    <tr key={e.id} className="border-b border-[#E7DED1]">
                      <td className="py-2 pr-4 font-medium">{e.capabilityName}</td>
                      <td className="py-2 pr-4 text-gray-600">
                        {capitalize(e.evidenceType)}
                      </td>
                      <td className="py-2 pr-4">
                        {e.isBlocking ? (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            Blocking
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Advisory
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <Link
                          href="/registry/systems"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Collect
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* ── 9. Integration Coverage ──────────────────────────────── */}
          <Section title="Integration Coverage">
            <div className="flex flex-col gap-4 md:flex-row">
              <div className="md:w-64">
                <DonutChart
                  data={data.monitoring_coverage}
                  colorMap={{
                    connected: CHART_COLORS.green,
                    configured: CHART_COLORS.blue,
                    not_configured: CHART_COLORS.gray,
                    error: CHART_COLORS.red,
                    disabled: CHART_COLORS.gray,
                  }}
                  dataKey="count"
                  nameKey="status"
                />
              </div>
              <div className="flex-1">
                {data.integration_health.length === 0 ? (
                  <NoData />
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                        <th className="pb-2 pr-4">Integration</th>
                        <th className="pb-2 pr-4">Type</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Health</th>
                        <th className="pb-2">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.integration_health.map((i) => (
                        <tr key={i.id} className="border-b border-[#E7DED1]">
                          <td className="py-2 pr-4 font-medium">{i.name}</td>
                          <td className="py-2 pr-4 text-gray-600">
                            {capitalize(i.integrationType)}
                          </td>
                          <td className="py-2 pr-4">
                            {pill(
                              capitalize(i.status),
                              i.status === "connected"
                                ? "bg-green-100 text-green-700"
                                : i.status === "error"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-600",
                            )}
                          </td>
                          <td className="py-2 pr-4">{healthBadge(i.healthStatus)}</td>
                          <td className="py-2 text-gray-500">
                            {fmtRelative(i.lastSeenAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </Section>

          {/* ── 10. Recent Audit Activity ────────────────────────────── */}
          <Section title="Recent Audit Activity">
            {data.recent_audit_events.length === 0 ? (
              <NoData />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E7DED1] text-left text-xs uppercase text-gray-500">
                    <th className="pb-2 pr-4">Time</th>
                    <th className="pb-2 pr-4">Actor</th>
                    <th className="pb-2 pr-4">Event</th>
                    <th className="pb-2 pr-4">Entity</th>
                    <th className="pb-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_audit_events.map((e) => (
                    <tr key={e.id} className="border-b border-[#E7DED1]">
                      <td className="py-2 pr-4 text-gray-500">{fmtDate(e.createdAt)}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-gray-600">
                        {e.actorName.length > 20
                          ? `${e.actorName.slice(0, 8)}…`
                          : e.actorName}
                      </td>
                      <td className="py-2 pr-4">
                        <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-700">
                          {e.eventType}
                        </code>
                      </td>
                      <td className="py-2 pr-4 font-medium">{e.entityName}</td>
                      <td className="py-2 text-gray-500">{capitalize(e.entityType)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* ── 11. Recommended Actions ──────────────────────────────── */}
          {data.recommended_actions.length > 0 && (
            <Section title="Recommended Actions">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.recommended_actions.map((action) => (
                  <div
                    key={action.id}
                    className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium text-amber-900">{action.title}</h3>
                      <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800">
                        {action.count}
                      </span>
                    </div>
                    <p className="text-xs text-amber-700">{action.reason}</p>
                    <Link
                      href={action.href as Parameters<typeof Link>[0]["href"]}
                      className="mt-auto inline-flex w-full items-center justify-center rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
                    >
                      {action.cta}
                    </Link>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
