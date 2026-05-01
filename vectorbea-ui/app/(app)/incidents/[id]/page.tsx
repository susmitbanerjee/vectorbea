"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IncidentDetailView, RegressionSuite, WorkflowRegressionRun } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeWorkspaceId } = useWorkspace();
  const [incident, setIncident] = useState<IncidentDetailView | null>(null);
  const [suites, setSuites] = useState<RegressionSuite[]>([]);
  const [runs, setRuns] = useState<WorkflowRegressionRun[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || !id) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const incidentRes = await fetch(`/api/incidents/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
        const incidentJson = await incidentRes.json();
        if (!incidentRes.ok) throw new Error(incidentJson.error ?? "Failed to load incident");
        const next = incidentJson as IncidentDetailView;
        if (cancelled) return;
        setIncident(next);
        if (next.capabilityId) {
          const suiteRes = await fetch(`/api/reliability/capabilities/${encodeURIComponent(next.capabilityId)}/regression-suites?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
          const suiteJson = await suiteRes.json();
          if (suiteRes.ok && !cancelled) setSuites(Array.isArray(suiteJson) ? suiteJson as RegressionSuite[] : []);
          const runRes = await fetch(`/api/reliability/regression-runs?workspaceId=${encodeURIComponent(workspaceId)}&capabilityId=${encodeURIComponent(next.capabilityId)}`, { cache: "no-store" });
          const runJson = await runRes.json();
          if (runRes.ok && !cancelled) setRuns(Array.isArray(runJson) ? runJson as WorkflowRegressionRun[] : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load incident");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, id]);

  const latestVerification = useMemo(() => incident?.verifications?.[0] ?? null, [incident]);

  async function addToRegressionSuite() {
    if (!activeWorkspaceId || !selectedSuiteId || !id) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(id)}/add-to-regression?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId: selectedSuiteId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create regression case");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create regression case");
    } finally {
      setWorking(false);
    }
  }

  async function verifyFix() {
    if (!activeWorkspaceId || !selectedRunId || !id) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${encodeURIComponent(id)}/verify?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regressionRunId: selectedRunId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to verify incident");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify incident");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading incident…</div>;
  }

  if (!incident) {
    return <div className="min-h-screen bg-[#F8F5EF]"><AppHeader title="Incident" subtitle="Not found" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title={incident.title} subtitle={`Severity ${incident.severity} · ${incident.status.replaceAll("_", " ")}`} />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-[#374151]">
              <div className="flex flex-wrap gap-2">
                <Badge className={incident.severity === "critical" ? "bg-[#FEF2F2] text-[#991B1B]" : incident.severity === "high" ? "bg-[#FFF7ED] text-[#C2410C]" : incident.severity === "medium" ? "bg-[#FFFBEB] text-[#92400E]" : "bg-[#ECFDF5] text-[#065F46]"}>{incident.severity}</Badge>
                <Badge className="bg-[#F3F4F6] text-[#374151]">{incident.status.replaceAll("_", " ")}</Badge>
                <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">{incident.sourceType.replaceAll("_", " ")}</Badge>
              </div>
              <p>{incident.description ?? "No description provided"}</p>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3"><p className="text-xs text-[#6B7280]">Capability</p><p className="mt-1 font-medium text-[#111111]">{incident.capabilityName ?? "Unassigned"}</p></div>
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3"><p className="text-xs text-[#6B7280]">Verification status</p><p className="mt-1 font-medium text-[#111111]">{latestVerification?.status ?? "Not verified"}</p></div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-[#2563EB]" />Add to regression suite</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <select value={selectedSuiteId} onChange={(e) => setSelectedSuiteId(e.target.value)} className="w-full rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]">
                  <option value="">Select regression suite</option>
                  {suites.map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}
                </select>
                <button type="button" disabled={!selectedSuiteId || working} onClick={() => void addToRegressionSuite()} className="w-full rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
                  Add to regression suite
                </button>
              </CardContent>
            </Card>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#065F46]" />Fix verification</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <select value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)} className="w-full rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]">
                  <option value="">Select regression run</option>
                  {runs.map((run) => <option key={run.id} value={run.id}>{run.id.slice(0, 8)} · {run.status}</option>)}
                </select>
                <button type="button" disabled={!selectedRunId || working} onClick={() => void verifyFix()} className="w-full rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-50">
                  Verify fix
                </button>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Activity</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {incident.activities.map((activity) => (
                <div key={activity.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <p className="font-medium text-[#111111]">{activity.message}</p>
                  <p className="mt-1 text-xs text-[#6B7280]">{new Date(activity.createdAt).toLocaleString()}</p>
                </div>
              ))}
              {!incident.activities.length && <p className="text-sm text-[#6B7280]">No activity yet.</p>}
            </CardContent>
          </Card>

          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Verification timeline</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {incident.verifications.map((verification) => (
                <div key={verification.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-[#111111]">{verification.status}</p>
                    <span className="text-xs text-[#6B7280]">{new Date(verification.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-sm text-[#374151]">{verification.summary ?? "Verification recorded"}</p>
                </div>
              ))}
              {!incident.verifications.length && <p className="text-sm text-[#6B7280]">No verification has been recorded yet.</p>}
            </CardContent>
          </Card>
        </div>

        {incident.relatedTrace && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[#991B1B]" />Related trace</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-[#374151]">
              <p><span className="font-medium text-[#111111]">Input</span> · {incident.relatedTrace.userInput ?? "—"}</p>
              <p><span className="font-medium text-[#111111]">Final action</span> · {incident.relatedTrace.finalAction ?? "—"}</p>
              <p><span className="font-medium text-[#111111]">Outcome</span> · {incident.relatedTrace.outcomeStatus ?? incident.relatedTrace.status}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
