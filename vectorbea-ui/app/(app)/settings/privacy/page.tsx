"use client";

import { useEffect, useState } from "react";
import { Loader2, Shield } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PrivacySettings, RedactionRule } from "@/lib/api";
import { canUsePrivacyControls } from "@/lib/behavioral-gate";
import { useWorkspace } from "@/lib/workspace-context";

export default function PrivacySettingsPage() {
  const { activeWorkspaceId, planTier } = useWorkspace();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [rules, setRules] = useState<RedactionRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState({ name: "", ruleType: "regex", pattern: "", replacement: "[REDACTED]", scope: "all" });

  useEffect(() => {
    if (!activeWorkspaceId || !canUsePrivacyControls(planTier)) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    fetch(`/api/settings/privacy?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) throw new Error(json.error ?? "Failed to load privacy settings");
        setSettings((json.settings ?? null) as PrivacySettings | null);
        setRules((json.rules ?? []) as RedactionRule[]);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, planTier]);

  async function saveSettings() {
    if (!activeWorkspaceId || !settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/privacy?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enablePiiRedaction: settings.enablePiiRedaction,
          storeRawInputs: settings.storeRawInputs,
          storeRawOutputs: settings.storeRawOutputs,
          storeToolArguments: settings.storeToolArguments,
          storeToolResults: settings.storeToolResults,
          retentionDays: settings.retentionDays,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save privacy settings");
      setSettings(json as PrivacySettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save privacy settings");
    } finally {
      setSaving(false);
    }
  }

  async function addRule() {
    if (!activeWorkspaceId || !ruleDraft.name.trim() || !ruleDraft.pattern.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/privacy/redaction-rules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleDraft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create redaction rule");
      setRules((prev) => [json as RedactionRule, ...prev]);
      setRuleDraft({ name: "", ruleType: "regex", pattern: "", replacement: "[REDACTED]", scope: "all" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create redaction rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="Privacy" subtitle="Redaction, trace capture controls, and retention defaults" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {!canUsePrivacyControls(planTier) && <div className="rounded-xl border border-[#E7DED1] bg-white px-4 py-4 text-sm text-[#6B7280]">Privacy controls are available on Pro. Enterprise adds custom redaction at scale.</div>}
        {loading && <div className="flex items-center gap-2 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" />Loading privacy settings…</div>}
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>}
        {settings && (
          <>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111] flex items-center gap-2"><Shield className="h-4 w-4 text-[#2563EB]" />Trace capture and redaction</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Enable PII redaction", "enablePiiRedaction"],
                  ["Store raw inputs", "storeRawInputs"],
                  ["Store raw outputs", "storeRawOutputs"],
                  ["Store tool arguments", "storeToolArguments"],
                  ["Store tool results", "storeToolResults"],
                ].map(([label, key]) => (
                  <label key={key} className="flex items-center justify-between rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-3 text-sm text-[#374151]">
                    <span>{label}</span>
                    <input type="checkbox" checked={Boolean(settings[key as keyof PrivacySettings])} onChange={(e) => setSettings((prev) => prev ? { ...prev, [key]: e.target.checked } : prev)} />
                  </label>
                ))}
                <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-3">
                  <label className="block text-sm text-[#374151]">Retention days</label>
                  <input type="number" value={settings.retentionDays ?? ""} onChange={(e) => setSettings((prev) => prev ? { ...prev, retentionDays: e.target.value ? Number(e.target.value) : null } : prev)} className="mt-2 w-full rounded-xl border border-[#D8CFC2] bg-white px-3 py-2 text-sm text-[#111111]" />
                </div>
                <button type="button" disabled={saving} onClick={() => void saveSettings()} className="rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
                  Save privacy settings
                </button>
              </CardContent>
            </Card>

            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-[#111111]">Custom redaction rules</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={ruleDraft.name} onChange={(e) => setRuleDraft((prev) => ({ ...prev, name: e.target.value }))} className="rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]" placeholder="Rule name" />
                  <select value={ruleDraft.ruleType} onChange={(e) => setRuleDraft((prev) => ({ ...prev, ruleType: e.target.value }))} className="rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]">
                    <option value="regex">Regex</option>
                    <option value="field_name">Field name</option>
                    <option value="built_in">Built in</option>
                  </select>
                  <input value={ruleDraft.pattern} onChange={(e) => setRuleDraft((prev) => ({ ...prev, pattern: e.target.value }))} className="rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]" placeholder="Pattern or built in type" />
                  <input value={ruleDraft.replacement} onChange={(e) => setRuleDraft((prev) => ({ ...prev, replacement: e.target.value }))} className="rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]" placeholder="Replacement" />
                </div>
                <select value={ruleDraft.scope} onChange={(e) => setRuleDraft((prev) => ({ ...prev, scope: e.target.value }))} className="rounded-xl border border-[#D8CFC2] bg-[#FBFAF7] px-3 py-2 text-sm text-[#111111]">
                  <option value="all">All</option>
                  <option value="traces">Traces</option>
                  <option value="tool_arguments">Tool arguments</option>
                  <option value="tool_results">Tool results</option>
                  <option value="final_response">Final response</option>
                </select>
                <button type="button" disabled={saving} onClick={() => void addRule()} className="rounded-xl border border-[#D8CFC2] bg-white px-4 py-2 text-sm font-semibold text-[#111111] hover:bg-[#F8F5EF] disabled:opacity-50">
                  Add redaction rule
                </button>
                <div className="space-y-2">
                  {rules.map((rule) => (
                    <div key={rule.id} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-3">
                      <p className="font-medium text-[#111111]">{rule.name}</p>
                      <p className="mt-1 text-xs text-[#6B7280]">{rule.ruleType} · {rule.scope} · {rule.pattern}</p>
                    </div>
                  ))}
                  {!rules.length && <p className="text-sm text-[#6B7280]">No custom redaction rules yet.</p>}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
