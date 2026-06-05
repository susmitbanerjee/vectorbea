"use client";
import { useEffect, useState } from "react";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import {
  AlertTriangle, Bot, CalendarClock, CheckCircle2,
  FileText, FlaskConical, Loader2, Lock, RefreshCw,
  Users, Wrench, Zap,
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

function UsageBar({ used, max, label, icon: Icon, color = "bg-blue-500" }: {
  used: number; max: number; label: string; icon: React.ElementType; color?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[13px] text-slate-600 font-medium">{label}</span>
        </div>
        <span className={`text-[12.5px] font-bold tabular-nums ${isHigh ? "text-red-600" : "text-slate-700"}`}>
          {used} <span className="text-slate-400 font-normal">/ {max}</span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isHigh ? "bg-red-500" : color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isHigh && (
        <p className="mt-1 text-[11px] text-red-500 font-medium">
          {pct >= 100 ? "Limit reached for today" : `${pct}% used — approaching daily limit`}
        </p>
      )}
    </div>
  );
}

function LimitRow({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[13px] text-slate-600">{label}</span>
      </div>
      <span className="text-[13px] font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function FeatureRow({ label, enabled, icon: Icon }: { label: string; enabled: boolean; icon: React.ElementType }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[13px] text-slate-600">{label}</span>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${enabled ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-900">Usage &amp; Limits</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Private beta workspace. Daily usage resets at midnight UTC.
          </p>
        </div>
        <button type="button" onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-500 hover:bg-slate-50 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Status banner */}
      <div className={`rounded-2xl border p-4 flex items-center gap-3 ${
        status?.betaStatus === "approved" ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
      }`}>
        {status?.betaStatus === "approved"
          ? <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          : <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />}
        <p className="text-[13px] font-semibold text-slate-800">{status?.message ?? "Loading…"}</p>
      </div>

      {/* Execution mode */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Execution Mode</p>
        </div>
        <div className="divide-y divide-slate-100">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-[13px] text-slate-600">Simulation</span>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              status?.canRunSimulation ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
            }`}>
              {status?.canRunSimulation ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[13px] text-slate-600">Real execution</span>
            </div>
            {status?.canRunRealExecution
              ? <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-green-50 text-green-700">Enabled</span>
              : <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-500">
                  <Lock className="h-3 w-3" /> Admin approval required
                </span>
            }
          </div>
        </div>
      </div>

      {/* Today's usage with live progress bars */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Today&apos;s Usage
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          <UsageBar
            used={status?.runsToday ?? 0}
            max={status?.maxRunsPerDay ?? 20}
            label="Workflow runs today"
            icon={Zap}
            color="bg-blue-500"
          />
        </div>
        {status && (status.simulationRunsToday > 0 || status.realRunsToday > 0) && (
          <div className="px-4 py-2.5 flex gap-4 border-t border-slate-100 bg-slate-50/40">
            <span className="text-[11.5px] text-slate-500">
              Simulation: <strong className="text-slate-700">{status.simulationRunsToday}</strong>
            </span>
            <span className="text-[11.5px] text-slate-500">
              Real: <strong className="text-slate-700">{status.realRunsToday}</strong>
            </span>
            {status.aiArchitectRequestsToday > 0 && (
              <span className="text-[11.5px] text-slate-500">
                AI Architect: <strong className="text-slate-700">{status.aiArchitectRequestsToday}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Static limits */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Workspace Limits</p>
        </div>
        <div className="divide-y divide-slate-100">
          <LimitRow label="Max workflows"          value={status?.maxWorkflows ?? 3}                      icon={Zap} />
          <LimitRow label="Max steps / workflow"   value={status?.maxStepsPerWorkflow ?? 5}               icon={Zap} />
          <LimitRow label="Max run duration"       value="5 minutes"                                       icon={CalendarClock} />
          <LimitRow label="Log retention"          value={`${status?.logRetentionDays ?? 7} days`}        icon={FileText} />
          <LimitRow label="Team members"           value={status?.maxTeamMembers ?? 1}                    icon={Users} />
          <LimitRow label="LLM providers (BYOK)"   value={status?.maxLlmProviders ?? 1}                  icon={Bot} />
        </div>
      </div>

      {/* Feature flags */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Features</p>
        </div>
        <div className="divide-y divide-slate-100">
          <FeatureRow label="Schedules"             enabled={status?.allowSchedules ?? false}       icon={CalendarClock} />
          <FeatureRow label="Webhooks"              enabled={status?.allowWebhooks ?? false}         icon={Wrench} />
          <FeatureRow label="Iterative agents"     enabled={status?.allowIterativeAgents ?? false}  icon={Bot} />
          <FeatureRow label="AI Workflow Architect" enabled={true}                                   icon={Zap} />
        </div>
      </div>

      {/* Request limits CTA */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-4 w-4 text-amber-600" />
          <p className="text-[12.5px] font-semibold text-amber-800">Need higher limits?</p>
        </div>
        <p className="text-[12px] text-amber-700">
          Contact your Vectorbea admin to request increased limits for your workspace.
        </p>
      </div>
    </div>
  );
}
