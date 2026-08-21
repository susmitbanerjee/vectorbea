"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { useApi } from "~/lib/api/api-provider";
import type { Scope } from "~/lib/api/client";

function split(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function ConnectionEditor({ id, scope, onUpdated }: { id: string; scope: Scope; onUpdated: () => void | Promise<void> }) {
  const api = useApi();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [name, setName] = React.useState("");
  const [config, setConfig] = React.useState("{}");
  const [hosts, setHosts] = React.useState("");
  const [paths, setPaths] = React.useState("");
  const [schemas, setSchemas] = React.useState("");
  const [tables, setTables] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [meta, setMeta] = React.useState({ provider: "", type: "", authType: "", secretConfigured: false });

  const load = React.useCallback(async () => {
    const connection = await api.connections.get(id, scope);
    setName(connection.name); setConfig(JSON.stringify(connection.config, null, 2));
    setHosts(connection.allowedHosts.join("\n")); setPaths(connection.allowedPaths.join("\n"));
    setSchemas(connection.allowedSchemas.join("\n")); setTables(connection.allowedTables.join("\n"));
    setMeta({ provider: connection.provider, type: connection.type, authType: connection.authType, secretConfigured: connection.secretConfigured });
  }, [api, id, scope]);

  React.useEffect(() => { let alive = true; void load().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load connection.")).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [load]);

  async function save() {
    if (!name.trim()) { toast.error("Connection name is required."); return; }
    let parsed: Record<string, unknown>;
    try { const value: unknown = JSON.parse(config); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); parsed = value as Record<string, unknown>; }
    catch { toast.error("Configuration must be a valid JSON object."); return; }
    setSaving(true);
    try {
      await api.connections.update(id, {
        name: name.trim(), config: parsed, allowedHosts: split(hosts), allowedPaths: split(paths),
        allowedSchemas: split(schemas), allowedTables: split(tables), ...(secret.trim() ? { plaintextSecret: secret.trim() } : {}),
      }, scope);
      setSecret(""); await load(); await onUpdated(); toast.success("Connection updated.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update connection."); }
    finally { setSaving(false); }
  }

  async function test() {
    setTesting(true);
    try { const result = await api.connections.test(id, scope); result.status === "connected" ? toast.success(`${result.message} · ${result.latencyMs}ms`) : toast.error(`${result.errorCode ?? "TEST_FAILED"}: ${result.message}`); await onUpdated(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Connection test failed."); }
    finally { setTesting(false); }
  }

  if (loading) return <div className="border-subtle bg-surface-raised h-40 animate-pulse rounded-lg border" />;
  return (
    <div className="grid gap-3">
      <section className="border-subtle bg-surface-raised rounded-lg border p-4">
        <Text variant="heading-sm" tone="max">Connection settings</Text>
        <Text variant="caption" tone="muted" className="mt-1 block">{meta.type} · {meta.provider} · {meta.authType}</Text>
        <div className="mt-4 grid gap-4">
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Provider configuration" description="Non-secret runtime configuration. Credentials belong in the encrypted field below."><Textarea mono autoGrow={false} minRows={9} value={config} onChange={(e) => setConfig(e.target.value)} /></Field>
        </div>
      </section>
      <section className="border-subtle bg-surface-raised rounded-lg border p-4">
        <Text variant="heading-sm" tone="max">Access boundaries</Text>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Allowed hosts" description="One hostname per line."><Textarea mono minRows={3} value={hosts} onChange={(e) => setHosts(e.target.value)} /></Field>
          <Field label="Allowed paths" description="One API path per line."><Textarea mono minRows={3} value={paths} onChange={(e) => setPaths(e.target.value)} /></Field>
          <Field label="Allowed schemas"><Textarea mono minRows={3} value={schemas} onChange={(e) => setSchemas(e.target.value)} /></Field>
          <Field label="Allowed tables"><Textarea mono minRows={3} value={tables} onChange={(e) => setTables(e.target.value)} /></Field>
        </div>
      </section>
      <section className="border-subtle bg-surface-raised rounded-lg border p-4">
        <Text variant="heading-sm" tone="max">Encrypted credential</Text>
        <Field className="mt-4" label={meta.secretConfigured ? "Replace credential" : "Add credential"} description="Leave blank to keep the current encrypted credential."><Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={meta.secretConfigured ? "Credential configured" : "Enter credential"} /></Field>
      </section>
      <div className="flex justify-end gap-2"><Button variant="secondary" loading={testing} onClick={() => void test()}>Test connection</Button><Button variant="primary" loading={saving} onClick={() => void save()}>Save changes</Button></div>
    </div>
  );
}
