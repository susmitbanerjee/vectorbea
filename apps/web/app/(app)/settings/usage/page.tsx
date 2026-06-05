"use client";
import { useEffect, useState } from "react";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import { AlertTriangle, CheckCircle2, Loader2, Zap } from "lucide-react";
interface BetaStatus { betaStatus: string; canRunSimulation: boolean; canRunRealExecution: boolean; executionMode: string; maxWorkflows: number; maxRunsPerDay: number; message: string; }
export default function UsagePage() {
  const [status, setStatus] = useState<BetaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { apiFetch<BetaStatus>(withWorkspace("/api/beta/status")).then(setStatus).catch(()=>{}).finally(()=>setLoading(false)); }, []);
  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  return (
    <div className="max-w-2xl space-y-6 p-6 lg:p-8">
      <div><h1 className="text-[18px] font-bold text-slate-900">Beta Usage &amp; Limits</h1><p className="mt-1 text-[13px] text-slate-500">Vectorbea is in private beta. Usage limits apply to all workspaces.</p></div>
      <div className={`rounded-2xl border p-4 ${status?.betaStatus==="approved"?"border-green-200 bg-green-50":"border-amber-200 bg-amber-50"}`}>
        <div className="flex items-center gap-2">{status?.betaStatus==="approved"?<CheckCircle2 className="h-4 w-4 text-green-600"/>:<AlertTriangle className="h-4 w-4 text-amber-600"/>}<p className="text-[13px] font-semibold text-slate-800">{status?.message}</p></div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {[{label:"Max Workflows",value:status?.maxWorkflows??3},{label:"Max Runs / Day",value:status?.maxRunsPerDay??20},{label:"Max Steps / Workflow",value:5},{label:"Max Run Duration",value:"5 min"},{label:"Log Retention",value:"7 days"},{label:"Team Members",value:1},{label:"LLM Providers (BYOK)",value:1}].map(({label,value})=>(<div key={label} className="flex items-center justify-between px-4 py-3"><span className="text-[13px] text-slate-600">{label}</span><span className="text-[13px] font-semibold text-slate-900">{value}</span></div>))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        <div className="flex items-center justify-between px-4 py-3"><span className="text-[13px] text-slate-600">Simulation Mode</span><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${status?.canRunSimulation?"bg-green-50 text-green-700":"bg-red-50 text-red-700"}`}>{status?.canRunSimulation?"Enabled":"Disabled"}</span></div>
        <div className="flex items-center justify-between px-4 py-3"><span className="text-[13px] text-slate-600">Real Execution</span><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${status?.canRunRealExecution?"bg-green-50 text-green-700":"bg-slate-50 text-slate-500"}`}>{status?.canRunRealExecution?"Enabled":"Admin approval required"}</span></div>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 mb-1"><Zap className="h-4 w-4 text-amber-600"/><p className="text-[12.5px] font-semibold text-amber-800">Need higher limits?</p></div><p className="text-[12px] text-amber-700">Contact your Vectorbea admin to request increased limits for your workspace.</p></div>
    </div>
  );
}
