"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Link2, Loader2, Mail, Search, X, XCircle, Zap } from "lucide-react";
import { listWorkspaceConnections, bindExistingConnection, testConnection, setSimulationPlaceholder, type ConnectionRequirement } from "@/lib/architect";
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
  onBuiltIn?: (reqId: string) => void;   // called when user picks "use built-in"
  onClose: () => void;
}

// Types that have a built-in Vectorbea provider (no external connection needed)
const BUILTIN_TYPES = ["email", "smtp", "resend", "sendgrid", "mailgun"];
const isBuiltinEligible = (type: string) =>
  BUILTIN_TYPES.some(t => type.toLowerCase().includes(t));

export function ConnectionPickerModal({ sessionId, requirement, onBound, onBuiltIn, onClose }: Props) {
  const [connections, setConnections]   = useState<WorkspaceConnection[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [selected, setSelected]         = useState<string | null>(null);
  const [binding, setBinding]           = useState(false);
  const [testing, setTesting]           = useState(false);
  const [testResult, setTestResult]     = useState<{ ok: boolean; message: string; latencyMs: number } | null>(null);

  const canUseBuiltIn = isBuiltinEligible(requirement.type);

  useEffect(() => {
    // Load ALL connections — no type filter. Backend still returns a typeMatches hint.
    // We sort type-matched connections to the top.
    listWorkspaceConnections()
      .then(r => {
        const sorted = [...r.connections].sort((a, b) => {
          if (a.typeMatches && !b.typeMatches) return -1;
          if (!a.typeMatches && b.typeMatches) return 1;
          // tested connections first within each group
          const aOk = a.testStatus === "connected" || a.testStatus === "passed";
          const bOk = b.testStatus === "connected" || b.testStatus === "passed";
          if (aOk && !bOk) return -1;
          if (!aOk && bOk) return 1;
          return a.name.localeCompare(b.name);
        });
        setConnections(sorted);
      })
      .catch(() => setConnections([]))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = connections.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.provider.toLowerCase().includes(search.toLowerCase()) ||
    c.type.toLowerCase().includes(search.toLowerCase())
  );

  async function handleBind() {
    if (!selected) return;
    setBinding(true);
    try {
      await bindExistingConnection(sessionId, requirement.id, selected);
      onBound(requirement.id, selected);
      toast.success(`Bound to "${connections.find(c => c.id === selected)?.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to bind connection");
    } finally { setBinding(false); }
  }

  async function handleBindAndTest() {
    if (!selected) return;
    setBinding(true);
    setTestResult(null);
    try {
      await bindExistingConnection(sessionId, requirement.id, selected);
      setBinding(false);
      setTesting(true);
      const res = await testConnection(sessionId, requirement.id);
      setTestResult({ ok: res.ok, message: res.message, latencyMs: res.latencyMs });
      if (res.ok) {
        toast.success(`Connection test passed (${res.latencyMs}ms)`);
        onBound(requirement.id, selected);
      } else {
        toast.error(`Test failed: ${res.message}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally { setBinding(false); setTesting(false); }
  }

  async function handleUseBuiltIn() {
    try {
      await setSimulationPlaceholder(sessionId, requirement.id);
      onBuiltIn?.(requirement.id);
      onBound(requirement.id, "builtin");
      toast.success("Using built-in email (Resend via RESEND_API_KEY)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const matchedCount = connections.filter(c => c.typeMatches).length;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[14px] font-bold text-slate-900">Select Connection</h2>
              <p className="text-[11.5px] text-slate-500 mt-0.5">
                For: <span className="font-semibold text-slate-700">{requirement.name}</span>
                {requirement.type && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                    {requirement.type}
                  </span>
                )}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 transition-colors">
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>

          {/* Built-in option for email */}
          {canUseBuiltIn && (
            <div className="px-4 pt-4">
              <button type="button" onClick={handleUseBuiltIn}
                className="w-full flex items-center gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 transition-colors">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 shrink-0">
                  <Mail className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-[12.5px] font-semibold text-amber-900">Use built-in email (Resend)</p>
                  <p className="text-[11px] text-amber-700">Vectorbea sends email via your configured RESEND_API_KEY — no external connection needed</p>
                </div>
                <Zap className="h-4 w-4 text-amber-500 shrink-0" />
              </button>
              <div className="flex items-center gap-3 my-3">
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider">or select existing</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
            </div>
          )}

          {/* Search */}
          <div className={`px-4 ${canUseBuiltIn ? "pb-2" : "pt-4 pb-2"}`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`Search all connections${matchedCount > 0 ? ` (${matchedCount} suggested)` : ""}…`}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-4 py-2 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                autoFocus={!canUseBuiltIn}
              />
            </div>
          </div>

          {/* Connection list */}
          <div className="max-h-60 overflow-y-auto px-4 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[12.5px]">Loading connections…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center">
                <Link2 className="h-6 w-6 text-slate-200 mx-auto mb-2" />
                <p className="text-[12.5px] text-slate-400">
                  {connections.length === 0
                    ? "No connections found in your workspace."
                    : "No connections match your search."}
                </p>
                <a href="/connections/new" target="_blank"
                  className="mt-2 inline-flex items-center gap-1 text-[12px] text-amber-600 hover:text-amber-700 font-medium">
                  Create a new connection ↗
                </a>
              </div>
            ) : (
              <div className="space-y-1">
                {/* Section header if we have both matched and unmatched */}
                {matchedCount > 0 && matchedCount < filtered.length && !search && (
                  <p className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-600">
                    Suggested for {requirement.type}
                  </p>
                )}
                {filtered.map((conn, idx) => {
                  // Show divider between suggested and other connections
                  const showDivider = !search && matchedCount > 0 && matchedCount < filtered.length && idx === matchedCount;
                  return (
                    <div key={conn.id}>
                      {showDivider && (
                        <p className="px-1 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Other connections
                        </p>
                      )}
                      <button type="button"
                        onClick={() => { setSelected(conn.id); setTestResult(null); }}
                        className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                          selected === conn.id
                            ? "border-amber-300 bg-amber-50"
                            : conn.typeMatches
                              ? "border-amber-100 hover:border-amber-200 hover:bg-amber-50/50"
                              : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                        }`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[12.5px] font-semibold text-slate-700 truncate">{conn.name}</p>
                            {conn.typeMatches && (
                              <span className="rounded-full bg-amber-100 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 shrink-0">
                                MATCH
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400">{conn.provider} · {conn.type}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {(conn.testStatus === "connected" || conn.testStatus === "passed") ? (
                            <span className="text-[10px] font-bold text-green-600">✓ tested</span>
                          ) : conn.testStatus === "failed" ? (
                            <span className="text-[10px] font-bold text-red-500">✗ failed</span>
                          ) : null}
                          {selected === conn.id && <Check className="h-4 w-4 text-amber-500" />}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`mx-4 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${
              testResult.ok
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {testResult.ok
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                : <XCircle className="h-3.5 w-3.5 shrink-0" />}
              <span>{testResult.message}</span>
              {testResult.ok && <span className="ml-auto text-[10px] opacity-60">{testResult.latencyMs}ms</span>}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
            <button type="button" onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            {!selected && (
              <p className="flex-1 text-center text-[11.5px] text-slate-400">
                Select a connection above
              </p>
            )}
            <div className="flex-1" />
            {selected && (
              <>
                <button type="button" onClick={handleBindAndTest}
                  disabled={!selected || binding || testing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12.5px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors">
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Bind &amp; Test
                </button>
                <button type="button" onClick={handleBind}
                  disabled={!selected || binding || testing}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
                  {binding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  Bind
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
