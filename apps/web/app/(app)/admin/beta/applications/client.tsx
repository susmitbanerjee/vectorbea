"use client";

import { useEffect, useState } from "react";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import {
  Check, ChevronDown, ChevronRight, Loader2,
  RefreshCw, Shield, User, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Application {
  id: string;
  email: string;
  fullName: string | null;
  company: string | null;
  useCase: string | null;
  status: "waitlisted" | "approved" | "rejected" | "disabled" | "invited";
  createdAt: string;
}

const STATUS_STYLES: Record<string, { cls: string; label: string }> = {
  waitlisted: { cls: "bg-amber-50 text-amber-700 border-amber-200",  label: "Waitlisted" },
  approved:   { cls: "bg-green-50 text-green-700 border-green-200",  label: "Approved"   },
  rejected:   { cls: "bg-red-50 text-red-700 border-red-200",        label: "Rejected"   },
  invited:    { cls: "bg-blue-50 text-blue-700 border-blue-200",     label: "Invited"    },
  disabled:   { cls: "bg-slate-50 text-slate-500 border-slate-200",  label: "Disabled"   },
};

export default function AdminBetaApplicationsClient() {
  const [apps, setApps]       = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("waitlisted");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing]   = useState<string | null>(null);

  async function load(status: string) {
    setLoading(true);
    try {
      const url = status !== "all"
        ? withWorkspace(`/api/admin/beta/applications?status=${status}`)
        : withWorkspace("/api/admin/beta/applications");
      const data = await apiFetch<{ applications: Application[]; total: number }>(url);
      setApps(data.applications);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load applications");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(filter); }, [filter]);

  async function handleApprove(id: string) {
    setActing(id);
    try {
      await apiFetch(withWorkspace(`/api/admin/beta/applications/${id}/approve`), {
        method: "POST", json: { reason: "Approved via admin panel" },
      });
      toast.success("Approved — user now has full access");
      load(filter);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  }

  async function handleReject(id: string) {
    setActing(id);
    try {
      await apiFetch(withWorkspace(`/api/admin/beta/applications/${id}/reject`), {
        method: "POST", json: { reason: "Rejected via admin panel" },
      });
      toast.success("Application rejected");
      load(filter);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(null); }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-slate-900">Beta Applications</h1>
            <p className="text-[12.5px] text-slate-500">{apps.length} application{apps.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <button type="button" onClick={() => load(filter)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-500 hover:bg-slate-50 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {["waitlisted", "approved", "rejected", "all"].map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn(
              "px-3.5 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors capitalize",
              filter === f
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-[13px]">Loading…</span>
        </div>
      ) : apps.length === 0 ? (
        <div className="text-center py-16">
          <User className="h-8 w-8 text-slate-200 mx-auto mb-3" />
          <p className="text-[13.5px] text-slate-400">No {filter !== "all" ? filter : ""} applications yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {apps.map(app => {
            const isOpen   = expanded === app.id;
            const isActing = acting === app.id;
            const { cls, label } = STATUS_STYLES[app.status] ?? STATUS_STYLES.waitlisted;

            return (
              <div key={app.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600 shrink-0">
                    {((app.fullName ?? app.email)[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13.5px] font-semibold text-slate-800">{app.fullName ?? "—"}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>
                    </div>
                    <p className="text-[12px] text-slate-400">{app.email}{app.company ? ` · ${app.company}` : ""}</p>
                  </div>
                  <p className="text-[11.5px] text-slate-400 shrink-0 hidden sm:block">
                    {new Date(app.createdAt).toLocaleDateString()}
                  </p>
                  <button type="button" onClick={() => setExpanded(isOpen ? null : app.id)}
                    className="text-slate-400 hover:text-slate-600 shrink-0">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 space-y-4">
                    {app.useCase && (
                      <div>
                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1">Use case</p>
                        <p className="text-[13px] text-slate-700 leading-relaxed">{app.useCase}</p>
                      </div>
                    )}
                    {app.status === "waitlisted" && (
                      <div className="flex items-center gap-2 pt-1">
                        <button type="button" onClick={() => handleApprove(app.id)} disabled={isActing}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors">
                          {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Approve
                        </button>
                        <button type="button" onClick={() => handleReject(app.id)} disabled={isActing}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-[12.5px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors">
                          {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                          Reject
                        </button>
                      </div>
                    )}
                    {app.status === "approved" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-green-700 font-medium">✓ Approved — user has full access</span>
                        <button type="button" onClick={() => handleReject(app.id)} disabled={isActing}
                          className="ml-auto text-[11.5px] text-red-500 hover:text-red-700 disabled:opacity-50">
                          Revoke access
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
