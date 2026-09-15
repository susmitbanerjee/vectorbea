"use client";

import * as React from "react";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import { Text } from "~/components/ui/text";
import { Modal, ModalBody, ModalHeader, ModalFooter } from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useScope } from "~/lib/workspace/workspace-provider";
import { emptyHttpDraft, field, importCurl, isSecretName, requestPayload, splitRequestUrl,
  type HttpDraft, type HttpResponseResult, type RequestField, type BodyType } from "~/lib/tools/http-client";
import { variableNames, resolveTestDraft, agentToolSpec, type AgentVariables, type AgentVariable } from "~/lib/tools/http-template";
import type { SpecDocument } from "~/lib/tools/http-spec";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const TABS = ["Query", "Headers", "Authorization", "Body", "Agent inputs", "Import cURL"] as const;

export function HttpClientDialog({ onClose, onCreateTool }: { onClose: () => void; onCreateTool?: (spec: SpecDocument) => void }) {
  const api = useApi();
  const { workspaceId } = useScope();
  const [draft, setDraft] = React.useState<HttpDraft>(emptyHttpDraft);
  const [variables, setVariables] = React.useState<AgentVariables>({});
  const discovered = variableNames(draft);
  const [tab, setTab] = React.useState<(typeof TABS)[number]>("Authorization");
  const [curl, setCurl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<HttpResponseResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [fileBusy, setFileBusy] = React.useState(false);
  const [responseTab, setResponseTab] = React.useState<"body" | "headers">("body");
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  function update(patch: Partial<HttpDraft>) { setDraft((previous) => ({ ...previous, ...patch })); setResult(null); setError(null); }
  async function send() {
    setError(null); setResult(null);
    let payload;
    try { payload = requestPayload(resolveTestDraft(draft, variables)); } catch (error) { setError(error instanceof Error ? error.message : "Check the request."); return; }
    const pending = new AbortController(); controller.current = pending; setBusy(true);
    try {
      const response = await api.connections.testHttpRequest(payload, { workspaceId, environmentId: null }, { signal: pending.signal });
      if (!pending.signal.aborted) setResult(response);
    } catch (error) {
      if (!pending.signal.aborted) setError(error instanceof Error ? error.message : "Request failed.");
    } finally { if (controller.current === pending) { setBusy(false); controller.current = null; } }
  }
  function stop() { controller.current?.abort(); controller.current = null; setBusy(false); setError("Stopped waiting. The remote API may still process the request."); }
  function loadCurl(value: string) {
    try { const parsed = importCurl(value); update(parsed); setVariables({}); setCurl(""); setTab(variableNames(parsed).length ? "Agent inputs" : "Body"); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not import cURL."); }
  }
  const prettyBody = React.useMemo(() => {
    if (!result) return "";
    try { return JSON.stringify(JSON.parse(result.body), null, 2); } catch { return result.body; }
  }, [result]);

  return <Modal open onOpenChange={(open) => { if (!open) { controller.current?.abort(); onClose(); } }} size="xl">
    <ModalHeader eyebrow="Integrations · Generic HTTP" title="HTTP request client" description="Test a request, then create a reusable agent tool. Test values and credentials are never copied into the tool definition." />
    <ModalBody>
      <div className="grid gap-4">
        <fieldset disabled={busy || fileBusy} className="grid min-w-0 gap-4">
          {draft.importWarnings.map((warning) => <Text key={warning} variant="caption" tone="muted">{warning}</Text>)}
          <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            <Field label="Method"><Select value={draft.method} onValueChange={(method) => update({ method })} options={METHODS.map((value) => ({ value, label: value }))} /></Field>
            <Field label="Request URL" required><Input mono value={draft.url} onChange={(event) => update({ url: event.target.value })} placeholder="https://api.example.com/v1/search" autoComplete="off" /></Field>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Request sections">
            {TABS.map((name) => <Button key={name} size="sm" variant={tab === name ? "primary" : "secondary"} aria-pressed={tab === name} onClick={() => { setTab(name); setError(null); }}>{name}</Button>)}
          </div>
          {tab === "Agent inputs" ? <div className="grid gap-3">
            <Text variant="body-sm">Use {"{{name}}"} in query values, headers or body strings, and {"{id}"} in paths. Each input is required at runtime. The API host and credentials stay fixed.</Text>
            <Text variant="caption" tone="muted">Example JSON body: {`{"source":"{{source}}","target":"{{target}}"}`}. An agent supplies source and target; the values below are only for this test.</Text>
            {discovered.length === 0 ? <Text variant="body-sm" tone="muted">Add placeholders to the request or import a cURL command containing them.</Text> : null}
            {discovered.map((name) => {
              const value = variables[name] ?? { type: "string", description: "", testValue: "" };
              const change = (patch: Partial<AgentVariable>) => { setVariables((previous) => ({ ...previous, [name]: { ...value, ...patch } })); setResult(null); setError(null); };
              return <section key={name} className="border-subtle grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <Field label={`Type for ${name}`}><Select value={value.type} onValueChange={(type) => change({ type: type as AgentVariable["type"] })} options={["string", "integer", "number", "boolean", "array", "object"].map((type) => ({ value: type, label: type }))} /></Field>
                <Field label={`Test value for ${name}`} description="Temporary; not saved as a default."><Input value={value.testValue} onChange={(event) => change({ testValue: event.target.value })} autoComplete="off" /></Field>
                <Field label={`Description for ${name}`} description="Explains this argument to the agent."><Input value={value.description} onChange={(event) => change({ description: event.target.value })} /></Field>
              </section>;
            })}
          </div> : null}
          {tab === "Query" ? <>
            <Text variant="caption" tone="muted">Enabled rows are appended to the URL, including repeated parameter names.</Text>
            <Button size="sm" variant="secondary" onClick={() => { try { const parsed = splitRequestUrl(draft.url); update({ url: parsed.url, query: [...draft.query, ...parsed.query] }); } catch { setError("Enter a valid HTTP(S) URL first."); } }}>Move URL parameters into rows</Button>
            <RequestRows label="Query parameter" rows={draft.query} onChange={(query) => update({ query })} onError={setError} onFileBusy={setFileBusy} />
          </> : null}
          {tab === "Headers" ? <>
            <Text variant="caption" tone="muted">Use any API header name, including apy_token or api_token. Mark credentials Secret to mask them and redact response echoes.</Text>
            <RequestRows label="Header" rows={draft.headers} onChange={(headers) => update({ headers })} onError={setError} onFileBusy={setFileBusy} />
          </> : null}
          {tab === "Authorization" ? <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Authorization type"><Select value={draft.auth} onValueChange={(auth) => update({ auth: auth as HttpDraft["auth"] })} options={[
              { value: "none", label: "None / custom headers" }, { value: "api-key", label: "API key" }, { value: "bearer", label: "Bearer token" }, { value: "basic", label: "Basic auth" },
            ]} /></Field>
            {draft.auth === "api-key" ? <>
              <Field label="Key name"><Input value={draft.authName} onChange={(event) => update({ authName: event.target.value })} placeholder="apy_token" /></Field>
              <Field label="Add key to"><Select value={draft.authLocation} onValueChange={(authLocation) => update({ authLocation: authLocation as "header" | "query" })} options={[{ value: "header", label: "Header" }, { value: "query", label: "Query string" }]} /></Field>
            </> : null}
            {draft.auth === "basic" ? <Field label="Username"><Input value={draft.username} onChange={(event) => update({ username: event.target.value })} autoComplete="off" /></Field> : null}
            {draft.auth !== "none" ? <Field label={draft.auth === "basic" ? "Password" : "Token / key value"} required><Input type="password" value={draft.authValue} onChange={(event) => update({ authValue: event.target.value })} autoComplete="off" /></Field> : null}
            <Text variant="caption" tone="muted">For OAuth, paste an access token as Bearer. Additional authentication headers can be supplied in Headers.</Text>
          </div> : null}
          {tab === "Body" ? <div className="grid gap-3">
            <Field label="Body format"><Select value={draft.bodyType} onValueChange={(bodyType) => update({ bodyType: bodyType as BodyType })} options={[
              { value: "none", label: "No body" }, { value: "json", label: "JSON" }, { value: "raw", label: "Raw text / XML" }, { value: "form", label: "Form URL encoded" }, { value: "multipart", label: "Multipart form-data" },
            ]} /></Field>
            {draft.bodyType === "json" || draft.bodyType === "raw" ? <Field label="Request body" description={draft.bodyType === "raw" ? "Set Content-Type in Headers for XML or other text formats." : "JSON is validated before sending."}><Textarea mono autoGrow={false} minRows={9} value={draft.body} onChange={(event) => update({ body: event.target.value })} /></Field> : null}
            {draft.bodyType === "form" || draft.bodyType === "multipart" ? <RequestRows label="Form field" rows={draft.fields} onChange={(fields) => update({ fields })} files={draft.bodyType === "multipart"} onError={setError} onFileBusy={setFileBusy} /> : null}
            <Text variant="caption" tone="muted">Request bodies and files: 1 MiB total. Multipart boundaries are generated automatically.</Text>
          </div> : null}
          {tab === "Import cURL" ? <div className="grid gap-3">
            <Field label="cURL command" description="Paste a single cURL command. It is parsed, never executed as a shell command. Unsupported flags and local file references are reported."><Textarea mono autoGrow={false} minRows={8} value={curl} onChange={(event) => setCurl(event.target.value)} placeholder={"curl -X POST 'https://api.example.com/search' -H 'Content-Type: application/json' --data-raw '{\"query\":\"hello\"}'"} /></Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={!curl.trim()} onClick={() => loadCurl(curl)}>Import request</Button>
              <Field label="Upload cURL text file"><input type="file" accept=".txt,.curl,.sh" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1024 * 1024) { setError("cURL file exceeds 1 MiB."); return; } try { loadCurl(await file.text()); } catch { setError("Could not read the cURL file."); } }} /></Field>
            </div>
          </div> : null}
          <Field label="Timeout (ms)"><Input type="number" min={1000} max={30000} value={draft.timeoutMs} onChange={(event) => update({ timeoutMs: Number(event.target.value) })} /></Field>
        </fieldset>
        {error ? <div role="alert" className="border-status-failed text-status-failed rounded-md border p-3"><Text variant="body-sm">{error}</Text></div> : null}
        {result ? <section className="border-subtle grid gap-3 rounded-lg border p-4" aria-label="HTTP response" aria-live="polite">
          <Text variant="heading-sm">{result.status != null ? `HTTP ${result.status} · ${result.status >= 200 && result.status < 300 ? "Success" : result.status < 400 ? "Redirect (not followed)" : "API error"}` : result.errorCode} · {result.latencyMs} ms · {result.sizeBytes} bytes</Text>
          {result.message ? <Text variant="body-sm">{result.message}</Text> : null}
          {result.truncated ? <Text variant="caption" tone="muted">Response truncated at 256 KiB.</Text> : null}
          <div className="flex gap-2"><Button size="sm" variant="secondary" aria-pressed={responseTab === "body"} onClick={() => setResponseTab("body")}>Response body</Button><Button size="sm" variant="secondary" aria-pressed={responseTab === "headers"} onClick={() => setResponseTab("headers")}>Response headers</Button></div>
          <pre className="bg-surface-sunken text-fg-secondary max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 font-mono text-sm">{responseTab === "body" ? prettyBody || "(empty body)" : JSON.stringify(result.headers, null, 2)}</pre>
        </section> : null}
      </div>
    </ModalBody>
    <ModalFooter>
      <Text variant="caption" tone="muted" className="mr-auto max-w-lg">Send executes a real request and may change remote data. Redirects are shown without following them. Private hosts require a private runner.</Text>
      {busy ? <Button variant="secondary" onClick={stop}>Stop waiting</Button> : null}
      {onCreateTool ? <Button variant="secondary" disabled={busy || fileBusy || !draft.url.trim()} onClick={() => {
        try { onCreateTool(agentToolSpec(draft, variables)); } catch (error) { setError(error instanceof Error ? error.message : "Check the request template."); }
      }}>Create agent tool</Button> : null}
      <Button variant="primary" loading={busy} disabled={!draft.url.trim() || fileBusy} onClick={() => void send()}>Send request</Button>
    </ModalFooter>
  </Modal>;
}

function RequestRows({ rows, onChange, label, files = false, onError, onFileBusy }: { rows: RequestField[]; onChange: (rows: RequestField[]) => void; label: string; files?: boolean; onError: (error: string) => void; onFileBusy: (busy: boolean) => void }) {
  const patch = (index: number, value: Partial<RequestField>) => onChange(rows.map((row, i) => i === index ? { ...row, ...value } : row));
  return <div className="grid gap-3">
    {rows.map((row, index) => <div key={index} className="border-subtle grid gap-2 rounded-md border p-3">
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Field label={`${label} name ${index + 1}`}><Input value={row.name} onChange={(event) => patch(index, { name: event.target.value, secret: row.secret || isSecretName(event.target.value) })} /></Field>
        <Field label={`${label} value ${index + 1}`}><Input type={row.secret ? "password" : "text"} value={row.fileName ?? row.value} disabled={row.fileBase64 !== undefined} onChange={(event) => patch(index, { value: event.target.value })} autoComplete="off" /></Field>
        <Button variant="ghost" size="sm" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove</Button>
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox checked={row.enabled} onCheckedChange={(checked) => patch(index, { enabled: checked === true })}>Enabled</Checkbox>
        <Checkbox checked={row.secret} onCheckedChange={(checked) => patch(index, { secret: checked === true })}>Secret</Checkbox>
        {files ? <Field label={`Attach file ${index + 1}`}><input type="file" onChange={async (event) => {
          const file = event.target.files?.[0]; if (!file) return;
          if (file.size > 1024 * 1024) { onError("File exceeds 1 MiB."); return; }
          onFileBusy(true);
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
            patch(index, { fileName: file.name, contentType: file.type, fileBase64: btoa(binary) });
          } catch { onError("Could not read the file."); } finally { onFileBusy(false); }
        }} /></Field> : null}
        {row.fileBase64 !== undefined ? <Button size="sm" variant="ghost" onClick={() => patch(index, { fileBase64: undefined, fileName: undefined, contentType: undefined })}>Use text instead</Button> : null}
      </div>
    </div>)}
    <Button variant="secondary" size="sm" disabled={rows.length >= 100} onClick={() => onChange([...rows, field()])}>Add {label.toLowerCase()}</Button>
  </div>;
}
