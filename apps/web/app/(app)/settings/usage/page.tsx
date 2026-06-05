"use client";

import { useEffect, useState } from "react";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import {
  AlertTriangle, Bot, CalendarClock, CheckCircle2,
  FileText, FlaskConical, Loader2, Lock, RefreshCw,
  Users, Wrench, Zap, Activity,
} from "lucide-react";

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 text-[10.5px] font-bold uppercase tracking-widest text-slate-400 mb-1">
      {children}
    </p>
  );
}

function UsageBar({ used, max, icon: Icon, label, color = "bg-blue-500" }: {
  used: number; max: number; label: string;
  icon: React.ElementType; color?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="flex items-center gap-3 py-3 px-4">
      <Icon className="h-4 w-4 text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[13px] text-slate-600">{label}</span>
          <span className={`text-[13px] font-bold tabular-nums ${isHigh ? "text-red-600" : "text-slate-800"}`}>
            {used} <span className="text-slate-400 font-normal text-[11px]">/ {max}</span>
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isHigh ? "bg-red-500" : color}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {isHigh && (
          <p className="mt-1 text-[11px] text-red-500 font-medium">
            {pct >= 100 ? "Limit reached for today" : `${pct}% used — approaching limit`}
          </p>
        )}
      </div>
    </div>
  );
}

function LimitRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 py-3 px-4">
      <Icon className="h-4 w-4 text-slate-400 shrink-0" />
      <span className="flex-1 text-[13px] text-slate-600">{label}</span>
      <span className="text-[13px] font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function FeatureRow({ icon: Icon, label, enabled }: { icon: React.ElementType; label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3 px-4">
      <Icon className="h-4 w-4 text-slate-400 shrink-0" />
      <span className="flex-1 text-[13px] text-slate-600">{label}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
        enabled ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
      }`}>
        {enabled ? "Enabled" : "Disabled"}
      </span>
    </div>
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

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
    </div>
  );

  return (
    <div className="w-full max-w-5xl space-y-6 p-6 lg:p-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-900">Usage & Limits</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Private beta · daily usage resets at midnight UTC</p>
        </div>
        <button type="button" onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-500 hover:bg-slate-50 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Status banner */}
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        status?.betaStatus === "approved"
          ? "border-green-200 bg-green-50"
          : "border-amber-200 bg-amber-50"
      }`}>
        {status?.betaStatus === "approved"
          ? <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />}
        <p className="text-[13px] font-medium text-slate-800">{status?.message ?? "Loading…"}</p>
      </div>

      {/* 2-column grid on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left column */}
        <div className="space-y-6">
          {/* Execution mode */}
          <div>
            <SectionLabel>Execution Mode</SectionLabel>
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              <div className="flex items-center gap-3 py-3.5 px-4">
                <FlaskConical className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="flex-1 text-[13px] text-slate-600">Simulation</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  status?.canRunSimulation ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                }`}>
                  {status?.canRunSimulation ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-3 py-3.5 px-4">
                <Zap className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="flex-1 text-[13px] text-slate-600">Real execution</span>
                {status?.canRunRealExecution
                  ? <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-green-50 text-green-700">Enabled</span>
                  : <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                      <Lock className="h-3 w-3" /> Admin approval required
                    </span>
                }
              </div>
            </div>
          </div>

          {/* Today's usage */}
          <div>
            <SectionLabel>Today&apos;s Usage</SectionLabel>
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              <UsageBar
                used={status?.runsToday ?? 0}
                max={status?.maxRunsPerDay ?? 20}
                label="Workflow runs"
                icon={Activity}
                color="bg-blue-500"
              />
              {status && (status.simulationRunsToday > 0 || status.realRunsToday > 0) && (
                <div className="px-4 pb-3 pt-0">
                  <span className="text-[11.5px] text-slate-400 ml-7">
                    {status.simulationRunsToday > 0 && <>{status.simulationRunsToday} simulation</>}
                    {status.simulationRunsToday > 0 && status.realRunsToday > 0 && " · "}
                    {status.realRunsToday > 0 && <>{status.realRunsToday} real</>}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Features */}
          <div>
            <SectionLabel>Features</SectionLabel>
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              <FeatureRow icon={CalendarClock} label="Schedules"             enabled={status?.allowSchedules ?? false} />
              <FeatureRow icon={Wrench}        label="Webhooks"              enabled={status?.allowWebhooks ?? false} />
              <FeatureRow icon={Bot}           label="Iterative agents"      enabled={status?.allowIterativeAgents ?? false} />
              <FeatureRow icon={Zap}           label="AI Workflow Architect" enabled={true} />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Workspace limits */}
          <div>
            <SectionLabel>Workspace Limits</SectionLabel>
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              <LimitRow icon={Zap}           label="Max workflows"         value={status?.maxWorkflows ?? 3} />
              <LimitRow icon={Zap}           label="Max steps / workflow"  value={status?.maxStepsPerWorkflow ?? 5} />
              <LimitRow icon={CalendarClock} label="Max run duration"      value="5 minutes" />
              <LimitRow icon={FileText}      label="Log retention"         value={`${status?.logRetentionDays ?? 7} days`} />
              <LimitRow icon={Users}         label="Team members"          value={status?.maxTeamMembers ?? 1} />
              <LimitRow icon={Bot}           label="LLM providers (BYOK)"  value={status?.maxLlmProviders ?? 1} />
            </div>
          </div>

          {/* Request limits */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-[13px] font-semibold text-amber-800">Need higher limits?</p>
            <p className="text-[12.5px] text-amber-700 mt-1 leading-relaxed">
              Contact your Vectorbea admin to request increased limits for your workspace.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
