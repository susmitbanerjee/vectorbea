"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Link2, Loader2, Mail, Search, X, Zap } from "lucide-react";
import { listWorkspaceConnections, bindExistingConnection, setSimulationPlaceholder, type ConnectionRequirement } from "@/lib/architect";
import { toast } from "sonner";

interface WorkspaceConnection {
  id: string;
  name: string;
  type: string;
  provider: string;
  status: string;
  testStatus?: string;
  typeMatches?: boolean;
}

interface Props {
  sessionId: string;
  requirement: ConnectionRequirement;
  onBound: (reqId: string, connId: string) => void;
  onClose: () => void;
}

const BUILTIN_TYPES = ["email", "smtp", "resend", "sendgrid", "mailgun"];
const isBuiltinEligible = (type: string) =>
  BUILTIN_TYPES.some(t => type.toLowerCase().includes(t));

export function ConnectionPickerModal({ sessionId, requirement, onBound, onClose }: Props) {
  const [connections, setConnections] = useState<WorkspaceConnection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");
  const [binding, setBinding]         = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const canUseBuiltIn = isBuiltinEligible(requirement.type);

  useEffect(() => {
    listWorkspaceConnections()
      .then(r => {
        const sorted = [...r.connections].sort((a, b) => {
          if (a.typeMatches && !b.typeMatches) return -1;
          if (!a.typeMatches && b.typeMatches) return 1;
          return a.name.localeCompare(b.name);
        });
        setConnections(sorted);
      })
      .catch(() => setConnections([]))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = connections.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.provider.toLowerCase().includes(search.toLowerCase()) ||
    c.type.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSelect(connId: string) {
    setBinding(true);
    try {
      await bindExistingConnection(sessionId, requirement.id, connId);
      const name = connections.find(c => c.id === connId)?.name ?? connId;
      onBound(requirement.id, connId);
      toast.success(`Connected: ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to bind");
    } finally { setBinding(false); }
  }

  async function handleBuiltIn() {
    setBinding(true);
    try {
      await setSimulationPlaceholder(sessionId, requirement.id);
      onBound(requirement.id, "builtin");
      toast.success("Using built-in email (Resend)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBinding(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-[13px] font-bold text-slate-800">{requirement.name}</p>
                <p className="text-[11px] text-slate-400">{requirement.type} · Select a connection from your workspace</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>

          {/* Built-in option */}
          {canUseBuiltIn && (
            <div className="px-3 pt-3">
              <button type="button" onClick={handleBuiltIn} disabled={binding}
                className="w-full flex items-center gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2.5 text-left hover:bg-amber-100 transition-all disabled:opacity-50">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 shrink-0">
                  <Mail className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-bold text-amber-900">Use built-in email (Resend)</p>
                  <p className="text-[11px] text-amber-700">No connection needed — uses your RESEND_API_KEY</p>
                </div>
                {binding ? <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin shrink-0" /> : <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
              </button>
              <div className="flex items-center gap-2 mt-3 mb-1">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">or use existing connection</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
            </div>
          )}

          {/* Search */}
          <div className="px-3 pt-2 pb-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input autoFocus={!canUseBuiltIn} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search connections…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 py-2 text-[12.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent" />
            </div>
          </div>

          {/* List */}
          <div className="max-h-56 overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[12.5px]">Loading connections…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <Link2 className="h-7 w-7 text-slate-200 mx-auto" />
                <p className="text-[12.5px] text-slate-400">
                  {connections.length === 0 ? "No connections in workspace yet." : "No results."}
                </p>
                <a href="/connections/new" target="_blank"
                  className="inline-flex items-center gap-1 text-[12px] text-amber-600 hover:text-amber-700 font-semibold">
                  + Create connection ↗
                </a>
              </div>
            ) : (
              <div className="space-y-0.5 mt-1">
                {filtered.map(conn => (
                  <button key={conn.id} type="button"
                    onClick={() => handleSelect(conn.id)}
                    disabled={binding}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-amber-50 hover:border-amber-100 border border-transparent disabled:opacity-50 group">
                    {/* Color dot by type */}
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                      conn.typeMatches ? "bg-amber-400" : "bg-slate-300"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold text-slate-700 truncate">{conn.name}</span>
                        {conn.typeMatches && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-bold text-amber-700 shrink-0">SUGGESTED</span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">{conn.provider || conn.type}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(conn.testStatus === "connected" || conn.testStatus === "passed") && (
                        <span className="text-[10px] text-green-600 font-bold">✓</span>
                      )}
                      <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 opacity-0 group-hover:opacity-100 transition-opacity">
                        Select
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
            <button type="button" onClick={onClose}
              className="text-[12px] font-medium text-slate-500 hover:text-slate-700">
              Cancel
            </button>
            <a href="/connections/new" target="_blank"
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              + New connection ↗
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
