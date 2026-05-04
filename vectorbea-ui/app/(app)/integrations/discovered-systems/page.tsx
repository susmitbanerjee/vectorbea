"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  EyeOff,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";

interface DiscoveredSystem {
  id: string;
  workspace_id: string;
  suggested_name: string;
  source_type: string;
  service_name: string | null;
  provider: string | null;
  model: string | null;
  environment: string | null;
  status: "pending" | "linked" | "registered" | "ignored";
  linked_ai_system_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  event_count: number;
}

interface RegisterModalProps {
  system: DiscoveredSystem;
  onClose: () => void;
  onDone: () => void;
  workspaceId: string;
}

function RegisterModal({ system, onClose, onDone, workspaceId }: RegisterModalProps) {
  const [name, setName] = useState(system.suggested_name);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  async function submit() {
    if (!name.trim()) { setErr("Name is required"); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/integrations/discovered-systems/${system.id}?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", name: name.trim(), description: description.trim() || undefined }),
      });
      const d = await res.json() as { error?: string; id?: string; name?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setCreated({ id: d.id ?? "", name: d.name ?? name.trim() });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-md rounded-xl border border-[#E7DED1] bg-white p-6 shadow-xl text-center">
          <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#111111] mb-1">AI system registered</h2>
          <p className="text-sm text-gray-500 mb-4"><strong>{created.name}</strong> has been added to your AI system registry.</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={onClose} className="border-[#E7DED1]">Close</Button>
            <a href={`/registry/systems/${created.id}`}
              className="inline-flex items-center gap-2 rounded-md bg-[#111111] px-4 py-2 text-sm font-medium text-white hover:bg-black">
              View AI system
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-[#E7DED1] bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[#111111] mb-1">Register as new AI system</h2>
        <p className="text-sm text-gray-500 mb-4">This creates a new managed AI system in VectorBea from the discovered signals.</p>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[#111111]">System name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 border-[#E7DED1]" />
          </div>
          <div>
            <label className="text-sm font-medium text-[#111111]">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 border-[#E7DED1]" placeholder="Brief description…" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <div className="mt-6 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="border-[#E7DED1]">Cancel</Button>
          <Button onClick={() => void submit()} disabled={submitting} className="bg-[#111111] text-white hover:bg-black gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Register
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinkModal({ system, onClose, onDone, workspaceId }: RegisterModalProps) {
  const [systems, setSystems] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/registry/systems?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then((d: unknown) => {
        // Response is a plain array of AI system objects
        const arr = Array.isArray(d) ? d as Array<{ id: string; name: string }> : [];
        setSystems(arr.map(s => ({ id: s.id, name: s.name })));
      })
      .catch(() => null);
  }, [workspaceId]);

  async function submit() {
    if (!selectedId) { setErr("Select a system"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/integrations/discovered-systems/${system.id}?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link", aiSystemId: selectedId }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-[#E7DED1] bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[#111111] mb-1">Link to existing AI system</h2>
        <p className="text-sm text-gray-500 mb-4">Map this discovered system to an already-registered AI system.</p>
        <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="border-[#E7DED1]">
          <option value="">Select AI system…</option>
          {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <div className="mt-6 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="border-[#E7DED1]">Cancel</Button>
          <Button onClick={() => void submit()} disabled={submitting} className="bg-[#111111] text-white hover:bg-black gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Link
          </Button>
        </div>
      </div>
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  sidecar: "Sidecar",
  opentelemetry: "OpenTelemetry",
  sdk: "SDK",
  direct_api: "Direct API",
  ci_cd: "CI/CD",
  manual_upload: "Manual upload",
};

export default function DiscoveredSystemsPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const [systems, setSystems] = useState<DiscoveredSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [registerTarget, setRegisterTarget] = useState<DiscoveredSystem | null>(null);
  const [linkTarget, setLinkTarget] = useState<DiscoveredSystem | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId, statusFilter]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/discovered-systems?workspaceId=${workspaceId}&status=${statusFilter}`);
      if (res.ok) {
        const d = await res.json() as { systems: DiscoveredSystem[] };
        setSystems(d.systems ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function ignore(id: string) {
    setActing(id);
    try {
      await fetch(`/api/integrations/discovered-systems/${id}?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ignore" }),
      });
      await load();
    } finally {
      setActing(null);
    }
  }

  const filtered = systems.filter((s) =>
    !search || s.suggested_name.toLowerCase().includes(search.toLowerCase()) ||
    (s.service_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Discovered AI Systems"
        subtitle="AI systems detected from integration signals that haven't been registered yet"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2 border-[#E7DED1]">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {registerTarget && (
        <RegisterModal system={registerTarget} workspaceId={workspaceId}
          onClose={() => setRegisterTarget(null)} onDone={() => { setRegisterTarget(null); void load(); }} />
      )}
      {linkTarget && (
        <LinkModal system={linkTarget} workspaceId={workspaceId}
          onClose={() => setLinkTarget(null)} onDone={() => { setLinkTarget(null); void load(); }} />
      )}

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        {/* Explanation */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-700">
                When VectorBea receives traces or CI evidence for an AI system it doesn&apos;t recognise,
                it creates a discovered system record. Review these and either <strong>register</strong> them
                as new managed AI systems, <strong>link</strong> them to an existing one, or <strong>ignore</strong> them.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9 border-[#E7DED1] bg-white"
              placeholder="Search by name or service…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44 border-[#E7DED1] bg-white">
            <option value="pending">Pending</option>
            <option value="linked">Linked</option>
            <option value="registered">Registered</option>
            <option value="ignored">Ignored</option>
            <option value="">All</option>
          </Select>
        </div>

        {/* Table */}
        <Card className="border-[#E7DED1] bg-white">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bot className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-700">No discovered systems</p>
              <p className="text-xs text-gray-500 mt-1">
                {statusFilter === "pending"
                  ? "All discovered systems have been actioned."
                  : "No systems match this filter."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E7DED1] bg-[#F8F5EF]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">System name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Provider / model</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Events</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">First seen</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-b border-[#E7DED1] last:border-0 hover:bg-[#F8F5EF]/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#111111]">{s.suggested_name}</p>
                        {s.service_name && s.service_name !== s.suggested_name && (
                          <p className="text-xs text-gray-500">{s.service_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{SOURCE_LABELS[s.source_type] ?? s.source_type}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {[s.provider, s.model].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">{s.event_count}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{new Date(s.first_seen_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {s.status === "pending" && <Badge className="bg-amber-100 text-amber-800">Pending</Badge>}
                        {s.status === "linked" && <Badge className="bg-blue-100 text-blue-800">Linked</Badge>}
                        {s.status === "registered" && <Badge className="bg-green-100 text-green-800">Registered</Badge>}
                        {s.status === "ignored" && <Badge className="bg-gray-100 text-gray-500">Ignored</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.status === "pending" && (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs border-[#E7DED1] gap-1"
                              onClick={() => setLinkTarget(s)}
                            >
                              <Link2 className="h-3 w-3" />
                              Link
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs bg-[#111111] text-white hover:bg-black gap-1"
                              onClick={() => setRegisterTarget(s)}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Register
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-gray-400 hover:text-red-600"
                              disabled={acting === s.id}
                              onClick={() => void ignore(s.id)}
                            >
                              {acting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
