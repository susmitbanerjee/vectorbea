"use client";

import { useEffect, useState } from "react";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import {
  Activity, AlertTriangle, Bot, CalendarClock, CheckCircle2, Clock,
  FileText, FlaskConical, GitBranch, Layers, Loader2, Mail,
  RefreshCw, Timer, Users, Webhook, Zap,
} from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Chip } from "@/components/ui/page-kit";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";
import { cn } from "@/lib/utils";

interface UsageStatus {
  betaStatus: string;
  canRunSimulation: boolean;
  canRunRealExecution: boolean;
  executionMode: string;
  maxRunsPerDay: number;
  maxWorkflows: number;
  maxStepsPerWorkflow: number;
  maxTeamMembers: number;
  maxLlmProviders: number;
  logRetentionDays: number;
  allowSchedules: boolean;
  allowWebhooks: boolean;
  allowIterativeAgents: boolean;
  runsToday: number;
  simulationRunsToday: number;
  realRunsToday: number;
  llmCallsToday: number;
  aiArchitectRequestsToday: number;
  message: string;
}

function MonoLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]", className)}>
      {children}
    </p>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[12px] border border-[#E0E3E6] bg-white", className)}>{children}</div>;
}

/** Time remaining until the next UTC midnight (when daily quotas reset). */
function resetCountdown(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const mins = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 60_000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** Segmented quota meter — one cell per run when the quota is small. */
function QuotaMeter({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const color = pct >= 100 ? "#DC2626" : pct >= 80 ? "#CA8A04" : "#007F4E";
  if (max > 0 && max <= 40) {
    return (
      <div className="flex w-full gap-[3px]">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className="h-[10px] flex-1 rounded-[2px] transition-colors duration-300"
            style={{ background: i < used ? color : "#ECEEEF" }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="h-[10px] w-full overflow-hidden rounded-full bg-[#ECEEEF]">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function LimitTile({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string | number; sub?: string }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between">
        <MonoLabel>{label}</MonoLabel>
        <Icon className="h-4 w-4 text-[#C9CED4]" strokeWidth={1.8} />
      </div>
      <p className="mt-2.5 text-[22px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-[#0B0D0F]">{value}</p>
      {sub && <p className="mt-1 text-[11.5px] text-[#9CA3AF]">{sub}</p>}
    </Panel>
  );
}

export default function UsagePage() {
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch<UsageStatus>(withWorkspace("/api/beta/status"))
      .then(setStatus).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const approved = status?.betaStatus === "approved";
  const used = status?.runsToday ?? 0;
  const max  = status?.maxRunsPerDay ?? 20;
  const pct  = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;

  const features = [
    { label: "AI Workflow Architect", desc: "Plain English → running workflow · 1 build/month", enabled: true, architect: true, icon: Zap },
    { label: "Schedules",        desc: "Cron-triggered workflows",      enabled: status?.allowSchedules ?? false,       icon: CalendarClock },
    { label: "Webhooks",         desc: "HTTP-triggered workflows",      enabled: status?.allowWebhooks ?? false,        icon: Webhook },
    { label: "Iterative agents", desc: "Multi-turn agent loops",        enabled: status?.allowIterativeAgents ?? false, icon: Bot },
  ];

  return (
    <div className="min-h-screen">
      <AppHeader
        eyebrow="Workspace"
        title="Usage & limits"
        subtitle="Private beta · daily usage resets at midnight UTC"
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[12.5px] font-medium text-[#4B5563] transition-colors hover:bg-[#F7F8F9] disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </button>
        }
      />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">
        {loading && !status ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-5 w-5 animate-spin text-[#C9CED4]" />
          </div>
        ) : (
          <>
            {/* ── Beta status banner ── */}
            <div className={cn(
              "animate-slide-up flex items-center gap-3 rounded-[12px] border px-4 py-3",
              approved ? "border-[#9CCFBB] bg-[#E6F4EF]/60" : "border-[#FDE68A] bg-[#FFFBEB]",
            )}>
              {approved
                ? <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-[#007F4E]" />
                : <AlertTriangle className="h-[18px] w-[18px] shrink-0 text-[#CA8A04]" />}
              <p className={cn("text-[13px] font-medium", approved ? "text-[#006B45]" : "text-[#92400E]")}>
                {status?.message ?? "Loading…"}
              </p>
            </div>

            {/* ── Quota hero ── */}
            <div className="animate-slide-up stagger-1">
              {/* Today's runs */}
              <Panel className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <MonoLabel>Today&apos;s usage</MonoLabel>
                    <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em] text-[#0B0D0F]">Workflow runs</p>
                  </div>
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#9CA3AF]">
                    <Clock className="h-3 w-3" /> resets in {resetCountdown()}
                  </span>
                </div>

                <div className="mt-4 flex items-end gap-2">
                  <span
                    className="text-[40px] font-semibold leading-none tabular-nums tracking-[-0.03em]"
                    style={{ color: pct >= 100 ? "#DC2626" : pct >= 80 ? "#CA8A04" : "#0B0D0F" }}
                  >
                    {used}
                  </span>
                  <span className="mb-1 font-mono text-[14px] text-[#9CA3AF]">/ {max}</span>
                  <span className="mb-1 ml-auto font-mono text-[12px] tabular-nums text-[#9CA3AF]">{pct}%</span>
                </div>

                <div className="mt-3">
                  <QuotaMeter used={used} max={max} />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#ECEEEF] pt-3.5">
                  <Chip tone="teal" dot={false}>
                    <FlaskConical className="mr-0.5 h-3 w-3" /> {status?.simulationRunsToday ?? 0} simulation
                  </Chip>
                  <Chip tone="green" dot={false}>
                    <Zap className="mr-0.5 h-3 w-3" /> {status?.realRunsToday ?? 0} real
                  </Chip>
                  {pct >= 80 && (
                    <span className="ml-auto text-[11.5px] font-medium text-[#DC2626]">
                      {pct >= 100 ? "Daily limit reached" : "Approaching daily limit"}
                    </span>
                  )}
                </div>
              </Panel>
            </div>

            {/* ── Workspace limits ── */}
            <div className="animate-slide-up stagger-2">
              <MonoLabel className="mb-2.5">Workspace limits</MonoLabel>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
                <LimitTile icon={GitBranch}     label="Workflows"      value={status?.maxWorkflows ?? 3}        sub="max active" />
                <LimitTile icon={Layers}        label="Steps"          value={status?.maxStepsPerWorkflow ?? 5} sub="per workflow" />
                <LimitTile icon={Timer}         label="Run duration"   value="∞"                                sub="durable by design" />
                <LimitTile icon={FileText}      label="Log retention"  value={`${status?.logRetentionDays ?? 7}d`} sub="then purged" />
                <LimitTile icon={Users}         label="Team"           value={status?.maxTeamMembers ?? 1}      sub="members" />
                <LimitTile icon={Activity}      label="AI Architect"   value="1"                                sub="build / month" />
              </div>
            </div>

            {/* ── Features + request more ── */}
            <div className="animate-slide-up stagger-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
              <div>
                <MonoLabel className="mb-2.5">Features</MonoLabel>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {features.map(({ label, desc, enabled, icon: Icon, architect }) => (
                    <Panel key={label} className={cn("flex items-center gap-3 p-3.5", !enabled && "opacity-70")}>
                      {architect ? (
                        <ArchitectLogo size={32} />
                      ) : (
                        <span className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]",
                          enabled ? "bg-[#0B0D0F]" : "bg-[#F3F4F5]",
                        )}>
                          <Icon className={cn("h-4 w-4", enabled ? "text-white" : "text-[#9CA3AF]")} strokeWidth={1.9} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-[#0B0D0F]">{label}</p>
                        <p className="truncate text-[11.5px] text-[#9CA3AF]">{desc}</p>
                      </div>
                      <Chip tone={enabled ? "green" : "gray"} dot={false}>{enabled ? "Enabled" : "Disabled"}</Chip>
                    </Panel>
                  ))}
                </div>
              </div>

              {/* Need higher limits */}
              <Panel className="flex flex-col p-5">
                <MonoLabel>Limits</MonoLabel>
                <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em] text-[#0B0D0F]">Need more headroom?</p>
                <p className="mt-2 text-[12.5px] leading-[1.6] text-[#6B7280]">
                  Private-beta limits keep early workloads safe. Contact your Vectorbea admin to raise run quotas,
                  workflow counts, or unlock features for this workspace.
                </p>
                <a
                  href="mailto:support@vectorbea.com?subject=Limit%20increase%20request"
                  className="mt-auto flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-[#9CCFBB] bg-white pt-px text-[13px] font-semibold text-[#006B45] transition-colors hover:bg-[#E6F4EF]"
                >
                  <Mail className="h-3.5 w-3.5" /> Request higher limits
                </a>
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
