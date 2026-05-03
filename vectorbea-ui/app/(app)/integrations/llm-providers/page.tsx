"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";

interface ProviderConfig {
  id: string;
  provider: string;
  display_name: string | null;
  model_hint: string | null;
  is_active: boolean;
  created_at: string;
  last_tested_at: string | null;
  test_status: "ok" | "failed" | "untested" | null;
}

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "cohere", label: "Cohere" },
  { value: "mistral", label: "Mistral" },
  { value: "groq", label: "Groq" },
  { value: "together", label: "Together AI" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "vertex", label: "Google Vertex AI" },
  { value: "custom", label: "Custom / Other" },
];

function AddModal({ onClose, onDone, workspaceId }: { onClose: () => void; onDone: () => void; workspaceId: string }) {
  const [provider, setProvider] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelHint, setModelHint] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!provider) { setErr("Select a provider"); return; }
    if (!apiKey.trim()) { setErr("API key is required"); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/settings/providers?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          display_name: displayName.trim() || null,
          api_key: apiKey.trim(),
          model_hint: modelHint.trim() || null,
          base_url: baseUrl.trim() || null,
        }),
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
        <h2 className="text-lg font-semibold text-[#111111] mb-1">Add LLM provider</h2>
        <p className="text-sm text-gray-500 mb-4">Connect an LLM provider so VectorBea can collect usage evidence and governance signals.</p>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Provider</label>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 border-[#E7DED1]">
              <option value="">Select provider…</option>
              {PROVIDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Display name <span className="text-gray-400 font-normal">(optional)</span></label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} className="mt-1 border-[#E7DED1]" placeholder="e.g. Production OpenAI" />
          </div>
          <div>
            <label className="text-sm font-medium">API key</label>
            <div className="relative mt-1">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="border-[#E7DED1] pr-10"
                placeholder="sk-…"
              />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" onClick={() => setShowKey(v => !v)}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Default model <span className="text-gray-400 font-normal">(optional)</span></label>
            <Input value={modelHint} onChange={e => setModelHint(e.target.value)} className="mt-1 border-[#E7DED1]" placeholder="gpt-4o" />
          </div>
          {(provider === "azure_openai" || provider === "custom") && (
            <div>
              <label className="text-sm font-medium">Base URL</label>
              <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="mt-1 border-[#E7DED1]" placeholder="https://…" />
            </div>
          )}
          {err && <p className="text-sm text-red-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{err}</p>}
        </div>
        <div className="mt-6 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="border-[#E7DED1]">Cancel</Button>
          <Button onClick={() => void submit()} disabled={submitting} className="bg-[#111111] text-white hover:bg-black gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Add provider
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LlmProvidersPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void load();
  }, [workspaceId]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/providers?workspaceId=${workspaceId}`);
      if (res.ok) {
        const d = await res.json() as { providers?: ProviderConfig[] };
        setProviders(d.providers ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function testProvider(id: string) {
    setTesting(id);
    try {
      await fetch(`/api/settings/providers/${id}/test?workspaceId=${workspaceId}`, { method: "POST" });
      await load();
    } finally {
      setTesting(null);
    }
  }

  async function deleteProvider(id: string) {
    if (!confirm("Remove this provider?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/settings/providers/${id}?workspaceId=${workspaceId}`, { method: "DELETE" });
      await load();
    } finally {
      setDeleting(null);
    }
  }

  async function toggleActive(p: ProviderConfig) {
    await fetch(`/api/settings/providers/${p.id}?workspaceId=${workspaceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    await load();
  }

  const providerLabel = (p: string) => PROVIDER_OPTIONS.find(o => o.value === p)?.label ?? p;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="LLM Providers"
        subtitle="Connect LLM providers to collect model usage evidence for governance"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2 border-[#E7DED1]">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setShowAdd(true)} className="gap-2 bg-[#111111] text-white hover:bg-black">
              <Plus className="h-4 w-4" />
              Add provider
            </Button>
          </div>
        }
      />

      {showAdd && (
        <AddModal workspaceId={workspaceId} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); void load(); }} />
      )}

      <div className="mx-auto max-w-4xl space-y-6 p-6">

        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <Cpu className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-700">
                LLM provider credentials are encrypted and used to collect model call evidence — token usage,
                model versions, cost estimates — that feeds directly into governance reports. Keys are never
                returned in API responses after creation.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Configured providers</CardTitle>
              <span className="text-xs text-gray-500">{providers.length} provider{providers.length !== 1 ? "s" : ""}</span>
            </div>
          </CardHeader>
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Cpu className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-700">No providers configured</p>
              <p className="text-xs text-gray-500 mt-1">Add an LLM provider to start collecting model usage evidence.</p>
              <Button size="sm" onClick={() => setShowAdd(true)} className="mt-4 bg-[#111111] text-white hover:bg-black gap-2">
                <Plus className="h-4 w-4" />Add provider
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-[#E7DED1]">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-4">
                    <div className={`h-2.5 w-2.5 rounded-full ${p.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                    <div>
                      <p className="font-medium text-[#111111]">{p.display_name ?? providerLabel(p.provider)}</p>
                      <p className="text-xs text-gray-500">
                        {providerLabel(p.provider)}
                        {p.model_hint ? ` · ${p.model_hint}` : ""}
                        {" · "}Added {new Date(p.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.test_status === "ok" && <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="h-3 w-3" />Verified</Badge>}
                    {p.test_status === "failed" && <Badge className="bg-red-100 text-red-800 gap-1"><AlertTriangle className="h-3 w-3" />Failed</Badge>}
                    <Button size="sm" variant="outline" className="h-7 px-3 text-xs border-[#E7DED1]"
                      disabled={testing === p.id} onClick={() => void testProvider(p.id)}>
                      {testing === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-3 text-xs border-[#E7DED1]"
                      onClick={() => void toggleActive(p)}>
                      {p.is_active ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
                      disabled={deleting === p.id} onClick={() => void deleteProvider(p.id)}>
                      {deleting === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
