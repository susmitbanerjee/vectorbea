"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Cable,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Database,
  DatabaseZap,
  Globe,
  HardDrive,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { ConnectionType, LlmProvider, DatabaseProvider, SaasProvider, AuthType, VectorStoreProvider, ObjectStorageProvider } from "@/types/connections";
import { LLM_PROVIDER_MODELS, VECTORBEE_OUTBOUND_IPS, isPrivateHost } from "@/types/connections";
import { createConnection, testConnection } from "@/lib/repository";

// ─── Type cards ───────────────────────────────────────────────────────────────

const TYPE_CARDS: {
  type: ConnectionType;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
  examples: string;
}[] = [
  { type: "llm_provider",   label: "LLM Provider",   icon: BrainCircuit, color: "#7C3AED", description: "Connect to an AI model API to power native agents and LLM steps.", examples: "OpenAI, Anthropic, Azure OpenAI, Gemini, Bedrock" },
  { type: "database",       label: "Database",        icon: Database,     color: "#0369A1", description: "Read from or write to SQL and NoSQL databases safely.", examples: "PostgreSQL, MySQL, MongoDB, Snowflake, BigQuery" },
  { type: "http_api",       label: "HTTP / API",      icon: Globe,        color: "#2563EB", description: "Call internal or third-party REST APIs from tools.", examples: "CRM API, Billing API, Internal microservices" },
  { type: "saas",           label: "SaaS Integration",icon: MessageSquare,color: "#059669", description: "Connect to SaaS platforms for notifications and data sync.", examples: "Gmail, Salesforce, HubSpot, Jira, GitHub" },
  { type: "mcp_server",     label: "MCP Server",      icon: Cable,        color: "#D97706", description: "Connect to an MCP server to expose its tools to agents.", examples: "Remote MCP server, Local MCP bridge" },
  { type: "vector_store",   label: "Vector Store",    icon: DatabaseZap,  color: "#DB2777", description: "Long-term semantic memory and retrieval for agents.", examples: "Pinecone, Weaviate, Qdrant, pgvector, Redis" },
  { type: "object_storage", label: "Object Storage",  icon: HardDrive,    color: "#6B7280", description: "Store and retrieve workflow artifacts and files.", examples: "S3, GCS, Azure Blob, Cloudflare R2" },
];

// ─── Field helpers ────────────────────────────────────────────────────────────

import { inputCls } from "@/lib/ui/field-styles";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-select";

const ENV_OPTIONS: AppSelectOption[] = [
  { value: "development", label: "Development" },
  { value: "staging", label: "Staging" },
  { value: "production", label: "Production" },
];

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-medium text-[#374151]">
        {label}{required && <span className="ml-0.5 text-[#DC2626]">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[#9CA3AF]">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Divider() { return <div className="border-t border-[#F1F2F4]" />; }

// ─── IP copy widget ───────────────────────────────────────────────────────────

function OutboundIPs() {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(VECTORBEE_OUTBOUND_IPS.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="rounded-[12px] border border-[#FDE68A] bg-[#FFFBEB] p-4">
      <p className="mb-2 text-[12.5px] font-semibold text-[#92400E]">Network access requirements</p>
      <p className="mb-3 text-[12px] leading-[1.55] text-[#6B7280]">
        For Vectorbea Cloud to reach your database or API, add these IPs to your firewall, VPC security group,
        API gateway, or database allowlist.
      </p>
      <div className="mb-3 rounded-[8px] border border-[#E0E3E6] bg-white p-3 font-mono text-[11.5px] leading-[1.7] text-[#374151]">
        {VECTORBEE_OUTBOUND_IPS.map((ip) => <div key={ip}>{ip}</div>)}
      </div>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12px] font-medium transition-all",
          copied
            ? "border-[#9CCFBB] bg-[#E6F4EF] text-[#006B45]"
            : "border-[#E0E3E6] bg-white text-[#4B5563] hover:bg-[#F7F8F9]",
        )}
      >
        {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
        {copied ? "Copied!" : "Copy IPs"}
      </button>
      <div className="mt-3 rounded-[8px] border border-[#ECEEEF] bg-white/60 p-3 text-[11.5px] leading-[1.55] text-[#6B7280]">
        <strong className="font-medium text-[#374151]">Using a private runner?</strong> Self-hosted workers
        use your own network egress. Whitelisting depends on your deployment. See{" "}
        <Link href={"/workers" as never} className="font-medium text-[#007F4E] hover:underline">Workers</Link>.
      </div>
    </div>
  );
}

// ─── Provider-specific forms ──────────────────────────────────────────────────

function LlmForm({ name, setName, provider, setProvider, apiKey, setApiKey, baseUrl, setBaseUrl, defaultModel, setDefaultModel, environment, setEnvironment }: {
  name: string; setName: (v: string) => void;
  provider: LlmProvider; setProvider: (v: LlmProvider) => void;
  apiKey: string; setApiKey: (v: string) => void;
  baseUrl: string; setBaseUrl: (v: string) => void;
  defaultModel: string; setDefaultModel: (v: string) => void;
  environment: string; setEnvironment: (v: string) => void;
}) {
  const models = LLM_PROVIDER_MODELS[provider] ?? [];
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="Connection name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OpenAI Production" />
        </Field>
        <Field label="Provider" required>
          <AppSelect
            className="w-full"
            value={provider}
            onValueChange={(v) => { setProvider(v as LlmProvider); setDefaultModel(""); }}
            options={[
              { value: "openai", label: "OpenAI" },
              { value: "anthropic", label: "Anthropic" },
              { value: "azure_openai", label: "Azure OpenAI" },
              { value: "google_gemini", label: "Google Gemini" },
              { value: "aws_bedrock", label: "AWS Bedrock" },
              { value: "openai_compatible", label: "OpenAI-compatible endpoint" },
            ]}
          />
        </Field>
        <Field label="Environment">
          <AppSelect className="w-full" value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} />
        </Field>
      </Section>

      <Divider />

      <Section title="Credentials">
        <Field label="API key / secret" required hint="Stored through the configured secrets backend. Never displayed after save.">
          <input className={inputCls} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
        </Field>
        {(provider === "azure_openai" || provider === "openai_compatible") && (
          <Field label="Base URL" hint="Custom endpoint URL">
            <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-resource.openai.azure.com" />
          </Field>
        )}
      </Section>

      <Divider />

      <Section title="Model defaults">
        <Field label="Default model">
          <AppSelect
            className="w-full"
            value={defaultModel}
            onValueChange={setDefaultModel}
            placeholder="— select —"
            options={[
              { value: "", label: "— select —" },
              ...models.map((m) => ({ value: m, label: m })),
            ]}
          />
        </Field>
      </Section>
    </div>
  );
}

function DatabaseForm({ name, setName, dbProvider, setDbProvider, connString, setConnString, host, setHost, port, setPort, database, setDatabase, username, setUsername, password, setPassword, sslRequired, setSslRequired, readOnly, setReadOnly, environment, setEnvironment }: {
  name: string; setName: (v: string) => void;
  dbProvider: DatabaseProvider; setDbProvider: (v: DatabaseProvider) => void;
  connString: string; setConnString: (v: string) => void;
  host: string; setHost: (v: string) => void;
  port: string; setPort: (v: string) => void;
  database: string; setDatabase: (v: string) => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  sslRequired: boolean; setSslRequired: (v: boolean) => void;
  readOnly: boolean; setReadOnly: (v: boolean) => void;
  environment: string; setEnvironment: (v: string) => void;
}) {
  const showPrivateWarning = isPrivateHost(host) || isPrivateHost(connString);
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="Connection name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CRM PostgreSQL Prod" />
        </Field>
        <Field label="Database type" required>
          <AppSelect
            className="w-full"
            value={dbProvider}
            onValueChange={(v) => setDbProvider(v as DatabaseProvider)}
            options={[
              { value: "postgresql", label: "PostgreSQL" },
              { value: "mysql", label: "MySQL" },
              { value: "sqlserver", label: "SQL Server" },
              { value: "mongodb", label: "MongoDB" },
              { value: "snowflake", label: "Snowflake" },
              { value: "bigquery", label: "BigQuery" },
              { value: "redshift", label: "Redshift" },
            ]}
          />
        </Field>
        <Field label="Environment">
          <AppSelect className="w-full" value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} />
        </Field>
      </Section>

      <Divider />

      <Section title="Connection details">
        <Field label="Connection string" hint="Full connection URL including credentials. Stored securely.">
          <input className={inputCls} type="password" value={connString} onChange={(e) => setConnString(e.target.value)} placeholder="postgres://user:pass@host:5432/db" />
        </Field>
        <p className="text-[11px] text-[#9CA3AF]">— or enter individually —</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Field label="Host">
              <input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="db.example.com" />
            </Field>
          </div>
          <Field label="Port">
            <input className={inputCls} value={port} onChange={(e) => setPort(e.target.value)} placeholder="5432" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Database">
            <input className={inputCls} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="mydb" />
          </Field>
          <Field label="Username">
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="vectorbea_user" />
          </Field>
        </div>
        <Field label="Password" hint="Stored through secrets backend">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
      </Section>

      <Divider />

      <Section title="Options">
        <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-[#374151]">
          <input type="checkbox" className="h-3.5 w-3.5 rounded accent-[#007F4E]" checked={sslRequired} onChange={(e) => setSslRequired(e.target.checked)} />
          Require SSL / TLS
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-[#374151]">
          <input type="checkbox" className="h-3.5 w-3.5 rounded accent-[#007F4E]" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          Read-only connection (prevents any writes)
        </label>
      </Section>

      {showPrivateWarning && (
        <div className="rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12px] leading-[1.55] text-[#92400E]">
          <strong>Private address detected.</strong> This host appears to be on a private network. Vectorbea Cloud
          cannot reach it unless you whitelist our outbound IPs or use a private runner.
        </div>
      )}
    </div>
  );
}

function HttpForm({ name, setName, baseUrl, setBaseUrl, authType, setAuthType, secret, setSecret, environment, setEnvironment }: {
  name: string; setName: (v: string) => void;
  baseUrl: string; setBaseUrl: (v: string) => void;
  authType: AuthType; setAuthType: (v: AuthType) => void;
  secret: string; setSecret: (v: string) => void;
  environment: string; setEnvironment: (v: string) => void;
}) {
  const showPrivateWarning = isPrivateHost(baseUrl);
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="Connection name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Internal CRM API" />
        </Field>
        <Field label="Base URL" required>
          <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" />
        </Field>
        <Field label="Environment">
          <AppSelect className="w-full" value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} />
        </Field>
      </Section>

      <Divider />

      <Section title="Authentication">
        <Field label="Auth type">
          <AppSelect
            className="w-full"
            value={authType}
            onValueChange={(v) => setAuthType(v as AuthType)}
            options={[
              { value: "none", label: "None" },
              { value: "api_key", label: "API key header" },
              { value: "bearer", label: "Bearer token" },
              { value: "basic", label: "Basic auth" },
              { value: "oauth2", label: "OAuth 2.0 (placeholder)" },
              { value: "custom", label: "Custom header" },
            ]}
          />
        </Field>
        {authType !== "none" && (
          <Field label="Secret / token" hint="Stored through secrets backend. Never displayed after save.">
            <input className={inputCls} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
          </Field>
        )}
      </Section>

      {showPrivateWarning && (
        <div className="rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12px] leading-[1.55] text-[#92400E]">
          <strong>Private address detected.</strong> This URL appears private. Vectorbea Cloud cannot reach it
          without IP whitelisting or a private runner.
        </div>
      )}
    </div>
  );
}

function SaasForm({ name, setName, saasProvider, setSaasProvider, token, setToken, workspace, setWorkspace, environment, setEnvironment }: {
  name: string; setName: (v: string) => void;
  saasProvider: SaasProvider; setSaasProvider: (v: SaasProvider) => void;
  token: string; setToken: (v: string) => void;
  workspace: string; setWorkspace: (v: string) => void;
  environment: string; setEnvironment: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="Connection name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Gmail" />
        </Field>
        <Field label="Provider" required>
          <AppSelect
            className="w-full"
            value={saasProvider}
            onValueChange={(v) => setSaasProvider(v as SaasProvider)}
            options={[
              { value: "gmail", label: "Gmail / Email" },
              { value: "salesforce", label: "Salesforce" },
              { value: "hubspot", label: "HubSpot" },
              { value: "zendesk", label: "Zendesk" },
              { value: "jira", label: "Jira" },
              { value: "github", label: "GitHub" },
            ]}
          />
        </Field>
        <Field label="Environment">
          <AppSelect className="w-full" value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} />
        </Field>
      </Section>
      <Divider />
      <Section title="Credentials">
        <Field label="Token / API key" hint="Stored through secrets backend">
          <input className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="xoxb-... or Bearer token" />
        </Field>
        <Field label="Workspace / team (optional)">
          <input className={inputCls} value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="acme-corp" />
        </Field>
      </Section>
    </div>
  );
}

function McpForm({ name, setName, serverUrl, setServerUrl, transport, setTransport, authToken, setAuthToken, environment, setEnvironment }: {
  name: string; setName: (v: string) => void;
  serverUrl: string; setServerUrl: (v: string) => void;
  transport: "http" | "sse"; setTransport: (v: "http" | "sse") => void;
  authToken: string; setAuthToken: (v: string) => void;
  environment: string; setEnvironment: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="Connection name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Internal MCP Server" />
        </Field>
        <Field label="Environment">
          <AppSelect className="w-full" value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} />
        </Field>
      </Section>
      <Divider />
      <Section title="Server">
        <Field label="MCP server URL" required>
          <input className={inputCls} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://mcp.example.com/sse" />
        </Field>
        <Field label="Transport">
          <AppSelect
            className="w-full"
            value={transport}
            onValueChange={(v) => setTransport(v as "http" | "sse")}
            options={[
              { value: "http", label: "HTTP" },
              { value: "sse", label: "Server-Sent Events (SSE)" },
            ]}
          />
        </Field>
        <Field label="Auth token (optional)" hint="Stored through secrets backend">
          <input className={inputCls} type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Bearer token or API key" />
        </Field>
      </Section>
    </div>
  );
}

function VectorStoreForm({ name, setName, provider, setProvider, endpoint, setEndpoint, indexName, setIndexName, apiKey, setApiKey, environment, setEnvironment }: {
  name: string; setName: (v: string) => void;
  provider: string; setProvider: (v: string) => void;
  endpoint: string; setEndpoint: (v: string) => void;
  indexName: string; setIndexName: (v: string) => void;
  apiKey: string; setApiKey: (v: string) => void;
  environment: string; setEnvironment: (v: string) => void;
}) {
  const showPrivateWarning = isPrivateHost(endpoint);
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="Connection name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pinecone Production" />
        </Field>
        <Field label="Provider" required>
          <AppSelect
            className="w-full"
            value={provider}
            onValueChange={setProvider}
            options={[
              { value: "pinecone", label: "Pinecone" },
              { value: "weaviate", label: "Weaviate" },
              { value: "qdrant", label: "Qdrant" },
              { value: "pgvector", label: "pgvector (PostgreSQL)" },
              { value: "redis", label: "Redis" },
            ]}
          />
        </Field>
        <Field label="Environment">
          <AppSelect className="w-full" value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} />
        </Field>
      </Section>
      <Divider />
      <Section title="Endpoint">
        <Field label="Endpoint URL" required hint={provider === "pgvector" ? "PostgreSQL host or connection string" : "Index host / API endpoint — used by Test connection."}>
          <input className={inputCls} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://my-index-abc123.svc.pinecone.io" />
        </Field>
        <Field label="Index / collection (optional)">
          <input className={inputCls} value={indexName} onChange={(e) => setIndexName(e.target.value)} placeholder="documents" />
        </Field>
      </Section>
      <Divider />
      <Section title="Credentials">
        <Field label="API key" hint="Stored through secrets backend. Never displayed after save.">
          <input className={inputCls} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="••••••••" />
        </Field>
      </Section>
      {showPrivateWarning && (
        <div className="rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12px] leading-[1.55] text-[#92400E]">
          <strong>Private address detected.</strong> Vectorbea Cloud cannot reach this endpoint without IP whitelisting or a private runner.
        </div>
      )}
    </div>
  );
}

function ObjectStorageForm({ name, setName, provider, setProvider, endpoint, setEndpoint, bucket, setBucket, region, setRegion, accessKey, setAccessKey, secretKey, setSecretKey, environment, setEnvironment }: {
  name: string; setName: (v: string) => void;
  provider: string; setProvider: (v: string) => void;
  endpoint: string; setEndpoint: (v: string) => void;
  bucket: string; setBucket: (v: string) => void;
  region: string; setRegion: (v: string) => void;
  accessKey: string; setAccessKey: (v: string) => void;
  secretKey: string; setSecretKey: (v: string) => void;
  environment: string; setEnvironment: (v: string) => void;
}) {
  const showPrivateWarning = isPrivateHost(endpoint);
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="Connection name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Artifacts S3 Prod" />
        </Field>
        <Field label="Provider" required>
          <AppSelect
            className="w-full"
            value={provider}
            onValueChange={setProvider}
            options={[
              { value: "s3", label: "Amazon S3" },
              { value: "gcs", label: "Google Cloud Storage" },
              { value: "azure_blob", label: "Azure Blob" },
              { value: "r2", label: "Cloudflare R2" },
              { value: "minio", label: "MinIO / S3-compatible" },
            ]}
          />
        </Field>
        <Field label="Environment">
          <AppSelect className="w-full" value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} />
        </Field>
      </Section>
      <Divider />
      <Section title="Bucket">
        <Field label="Endpoint URL" required hint="Bucket or service endpoint — used by Test connection to verify reachability.">
          <input className={inputCls} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://my-bucket.s3.us-east-1.amazonaws.com" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Bucket (optional)">
            <input className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-bucket" />
          </Field>
          <Field label="Region (optional)">
            <input className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
          </Field>
        </div>
      </Section>
      <Divider />
      <Section title="Credentials">
        <Field label="Access key ID">
          <input className={inputCls} value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder="AKIA…" />
        </Field>
        <Field label="Secret access key" hint="Stored through secrets backend. Never displayed after save.">
          <input className={inputCls} type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="••••••••" />
        </Field>
      </Section>
      {showPrivateWarning && (
        <div className="rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12px] leading-[1.55] text-[#92400E]">
          <strong>Private address detected.</strong> Vectorbea Cloud cannot reach this endpoint without IP whitelisting or a private runner.
        </div>
      )}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  const labels = ["Choose type", "Configure", "Network", "Test & save"];
  return (
    <div className="flex items-center gap-0">
      {labels.slice(0, total).map((label, i) => {
        const s = i + 1;
        const done = step > s;
        const active = step === s;
        return (
          <div key={s} className="flex items-center">
            <div className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border text-[11.5px] font-semibold transition-all",
              done
                ? "border-[#007F4E] bg-[#007F4E] text-white"
                : active
                  ? "border-[#007F4E] bg-[#E6F4EF] text-[#006B45]"
                  : "border-[#E0E3E6] bg-white text-[#9CA3AF]",
            )}>
              {done ? <Check className="h-3.5 w-3.5" /> : s}
            </div>
            <span className={cn(
              "ml-1.5 mr-4 hidden text-[12px] font-medium sm:inline",
              active ? "text-[#0B0D0F]" : done ? "text-[#4B5563]" : "text-[#9CA3AF]",
            )}>
              {label}
            </span>
            {s < total && <div className={cn("mr-4 h-px w-8", done ? "bg-[#9CCFBB]" : "bg-[#E0E3E6]")} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewConnectionPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<ConnectionType | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "failed" | null>(null);
  const [savedConnId, setSavedConnId] = useState<string | null>(null);

  // Shared
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("production");

  // LLM
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");

  // DB
  const [dbProvider, setDbProvider] = useState<DatabaseProvider>("postgresql");
  const [connString, setConnString] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sslRequired, setSslRequired] = useState(true);
  const [readOnly, setReadOnly] = useState(false);

  // HTTP
  const [httpBaseUrl, setHttpBaseUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("api_key");
  const [secret, setSecret] = useState("");

  // SaaS
  const [saasProvider, setSaasProvider] = useState<SaasProvider>("gmail");
  const [saasToken, setSaasToken] = useState("");
  const [workspace, setWorkspace] = useState("");

  // MCP
  const [mcpUrl, setMcpUrl] = useState("");
  const [transport, setTransport] = useState<"http" | "sse">("sse");
  const [mcpToken, setMcpToken] = useState("");

  // Vector store
  const [vectorProvider, setVectorProvider] = useState("pinecone");
  const [vectorEndpoint, setVectorEndpoint] = useState("");
  const [vectorIndex, setVectorIndex] = useState("");
  const [vectorApiKey, setVectorApiKey] = useState("");

  // Object storage
  const [storageProvider, setStorageProvider] = useState("s3");
  const [storageEndpoint, setStorageEndpoint] = useState("");
  const [storageBucket, setStorageBucket] = useState("");
  const [storageRegion, setStorageRegion] = useState("");
  const [storageAccessKey, setStorageAccessKey] = useState("");
  const [storageSecretKey, setStorageSecretKey] = useState("");

  const needsNetworkStep = type === "database" || type === "http_api" || type === "mcp_server";
  const totalSteps = needsNetworkStep ? 4 : 3;

  async function handleSave(skipTest = false) {
    if (saving) return; // prevent double-submit
    if (!type || !name.trim()) { toast.error("Name is required."); return; }
    setSaving(true);
    try {
      let config: Parameters<typeof createConnection>[0]["config"];
      let provider = "";
      let connAuthType: AuthType = "api_key";

      if (type === "llm_provider") {
        provider = llmProvider;
        config = { provider: llmProvider, defaultModel, allowedModels: LLM_PROVIDER_MODELS[llmProvider] ?? [], requestTimeoutMs: 30000 };
      } else if (type === "database") {
        provider = dbProvider;
        connAuthType = "connection_string";
        config = {
          provider: dbProvider,
          connectionMode: connString ? "connection_string" : "host_port",
          host, port: parseInt(port) || 5432, database, sslRequired, readOnly,
          allowedSchemas: [] as string[],
          allowedTables:  [] as string[],
          queryTimeoutMs: 10000, maxRows: 1000,
        };
      } else if (type === "http_api") {
        provider = "http_api";
        connAuthType = authType;
        config = { baseUrl: httpBaseUrl, authType, defaultHeaders: {}, allowedPaths: [], blockedPaths: [], requestTimeoutMs: 15000, retryAttempts: 2 };
      } else if (type === "saas") {
        provider = saasProvider;
        connAuthType = "bearer";
        // baseUrl is required by the HTTP connection tester — map each SaaS provider
        // to its canonical API base so "Test connection" can reach a health endpoint.
        const SAAS_BASE_URLS: Record<string, string> = {
          gmail:       "https://gmail.googleapis.com",
          salesforce:  "https://login.salesforce.com/services/data/v59.0",
          hubspot:     "https://api.hubapi.com",
          zendesk:     "https://api.zendesk.com/api/v2",
          jira:        "https://api.atlassian.com",
          github:      "https://api.github.com",
        };
        config = {
          provider: saasProvider,
          baseUrl: SAAS_BASE_URLS[saasProvider] ?? "",
          workspace,
          allowedResources: [],
        };
      } else if (type === "mcp_server") {
        provider = "mcp";
        connAuthType = mcpToken ? "bearer" : "none";
        config = { serverUrl: mcpUrl, transport, allowedTools: [] };
      } else if (type === "vector_store") {
        provider = vectorProvider;
        connAuthType = vectorApiKey ? "api_key" : "none";
        config = { provider: vectorProvider as VectorStoreProvider, endpoint: vectorEndpoint, indexName: vectorIndex };
      } else if (type === "object_storage") {
        provider = storageProvider;
        connAuthType = storageSecretKey ? "basic" : "none";
        config = { provider: storageProvider as ObjectStorageProvider, endpoint: storageEndpoint, bucket: storageBucket, region: storageRegion, accessKeyId: storageAccessKey };
      } else {
        provider = type;
        config = {} as Parameters<typeof createConnection>[0]["config"];
      }

      // Determine if the target host is private (RFC1918 / .internal / localhost)
      const targetHost =
        type === "database"       ? (host || connString) :
        type === "http_api"       ? httpBaseUrl :
        type === "mcp_server"     ? mcpUrl :
        type === "vector_store"   ? vectorEndpoint :
        type === "object_storage" ? storageEndpoint :
        "";
      const isPrivate = isPrivateHost(targetHost);

      // Resolve the plaintext secret for this connection type.
      // Sent to the server as plaintextSecret — never stored raw; the API encrypts
      // it server-side and returns only a masked display value + opaque secretRef.
      const plaintextSecret =
        type === "llm_provider"   ? apiKey :
        type === "database"       ? (connString || (password ? `postgres://${username}:${password}@${host}:${port}/${database}` : "")) :
        type === "http_api"       ? (authType !== "none" ? secret : "") :
        type === "saas"           ? saasToken :
        type === "mcp_server"     ? mcpToken :
        type === "vector_store"   ? vectorApiKey :
        type === "object_storage" ? storageSecretKey :
        "";

      // Map frontend display types to backend API types
      const apiType = ((): string => {
        switch (type) {
          case "llm_provider": return "llm";
          case "http_api":     return "http";
          case "saas":         return "http";   // SaaS connections go through http
          case "mcp_server":   return "tool";   // MCP servers are tool connections
          default:             return type;     // "database" | "http" | "tool" pass through
        }
      })();

      let conn: Awaited<ReturnType<typeof createConnection>>;
      try {
        conn = await createConnection({
          name: name.trim(),
          type: apiType,
          provider,
          environment: environment as "development" | "staging" | "production",
          authType: connAuthType,
          config,
          networkPolicy: {
            requireWhitelist: isPrivate,
            privateRunnerRequired: isPrivate,
            networkStatus: isPrivate ? "private_runner_required" : "unknown",
          },
          // plaintextSecret is a server-only field: API encrypts it and returns
          // only secretRef + secretMasked. Never persisted raw.
          ...(plaintextSecret.trim() ? { plaintextSecret: plaintextSecret.trim() } : {}),
        } as Parameters<typeof createConnection>[0]);
      } catch (createErr) {
        toast.error(
          `Failed to create connection: ${createErr instanceof Error ? createErr.message : "Unknown error"}`,
        );
        setSaving(false);
        return;
      }

      setSavedConnId(conn.id);

      if (!skipTest) {
        try {
          const result = await testConnection(conn.id);
          if (result) {
            const passed = result.status === "connected";
            setTestResult(passed ? "ok" : "failed");
            if (passed) {
              toast.success(`Connection test passed — ${result.latencyMs}ms`);
            } else {
              toast.error(`Test failed: ${result.message ?? "Could not reach host"}`);
            }
            // Auto-navigate to detail page after short delay on success
            if (passed) {
              setTimeout(() => router.push(`/connections/${conn.id}` as never), 1200);
            }
            return; // stay on page so user can see result
          }
        } catch (testErr) {
          toast.error(
            `Connection saved but test failed: ${testErr instanceof Error ? testErr.message : "Unknown error"}`,
          );
          setSaving(false);
          return;
        }
      }

      toast.success("Connection saved.");
      router.push(`/connections/${conn.id}` as never);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (saving || testing) return; // prevent double-submit
    if (!type || !name.trim()) { toast.error("Name is required."); return; }
    setTesting(true);
    setTestResult(null);
    try {
      if (savedConnId) {
        // Already saved — just re-run the test against the existing record
        const result = await testConnection(savedConnId);
        if (result) {
          const passed = result.status === "connected";
          setTestResult(passed ? "ok" : "failed");
          if (passed) {
            toast.success(`Connection test passed — ${result.latencyMs}ms`);
            setTimeout(() => router.push(`/connections/${savedConnId}` as never), 1200);
          } else {
            toast.error(`Test failed: ${result.message ?? "Could not reach host"}`);
          }
        }
      } else {
        // First time — save then test
        await handleSave(false);
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href={"/connections" as never} className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B7280] transition-colors hover:text-[#0B0D0F]">
          <ArrowLeft className="h-3.5 w-3.5" />
          Connections
        </Link>
        <span className="text-[#C9CED4]">/</span>
        <span className="text-[12.5px] font-semibold text-[#0B0D0F]">New Connection</span>
      </div>

      <div className="mb-6">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Connections</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-[-0.01em] text-[#0B0D0F]">New Connection</h1>
        <p className="mt-1 text-[13px] text-[#6B7280]">Connect an LLM provider, database, API, or service to use in agents and tools.</p>
      </div>

      <div className="mb-8">
        <StepIndicator step={step} total={totalSteps} />
      </div>

      {/* Step 1: Choose type */}
      {step === 1 && (
        <div>
          <p className="mb-4 text-[13.5px] font-semibold text-[#0B0D0F]">What are you connecting?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPE_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.type}
                  type="button"
                  onClick={() => { setType(card.type); setStep(2); }}
                  className={cn(
                    "flex items-start gap-3 rounded-[12px] border bg-white p-4 text-left transition-all",
                    type === card.type
                      ? "border-[#007F4E] ring-2 ring-[#007F4E]/12"
                      : "border-[#E0E3E6] hover:border-[#C9CED4] hover:bg-[#FAFBFB]",
                  )}
                >
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]"
                    style={{ background: card.color }}
                  >
                    <Icon className="h-[18px] w-[18px] text-white" strokeWidth={1.9} />
                  </span>
                  <div>
                    <p className="text-[13.5px] font-semibold text-[#0B0D0F]">{card.label}</p>
                    <p className="mt-0.5 text-[12px] leading-[1.5] text-[#6B7280]">{card.description}</p>
                    <p className="mt-1.5 font-mono text-[10.5px] text-[#9CA3AF]">{card.examples}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && type && (
        <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-6">
          <p className="mb-5 text-[13.5px] font-semibold text-[#0B0D0F]">
            Configure {TYPE_CARDS.find((c) => c.type === type)?.label}
          </p>

          {type === "llm_provider" && (
            <LlmForm name={name} setName={setName} provider={llmProvider} setProvider={setLlmProvider} apiKey={apiKey} setApiKey={setApiKey} baseUrl={baseUrl} setBaseUrl={setBaseUrl} defaultModel={defaultModel} setDefaultModel={setDefaultModel} environment={environment} setEnvironment={setEnvironment} />
          )}
          {type === "database" && (
            <DatabaseForm name={name} setName={setName} dbProvider={dbProvider} setDbProvider={setDbProvider} connString={connString} setConnString={setConnString} host={host} setHost={setHost} port={port} setPort={setPort} database={database} setDatabase={setDatabase} username={username} setUsername={setUsername} password={password} setPassword={setPassword} sslRequired={sslRequired} setSslRequired={setSslRequired} readOnly={readOnly} setReadOnly={setReadOnly} environment={environment} setEnvironment={setEnvironment} />
          )}
          {type === "http_api" && (
            <HttpForm name={name} setName={setName} baseUrl={httpBaseUrl} setBaseUrl={setHttpBaseUrl} authType={authType} setAuthType={setAuthType} secret={secret} setSecret={setSecret} environment={environment} setEnvironment={setEnvironment} />
          )}
          {type === "saas" && (
            <SaasForm name={name} setName={setName} saasProvider={saasProvider} setSaasProvider={setSaasProvider} token={saasToken} setToken={setSaasToken} workspace={workspace} setWorkspace={setWorkspace} environment={environment} setEnvironment={setEnvironment} />
          )}
          {type === "mcp_server" && (
            <McpForm name={name} setName={setName} serverUrl={mcpUrl} setServerUrl={setMcpUrl} transport={transport} setTransport={setTransport} authToken={mcpToken} setAuthToken={setMcpToken} environment={environment} setEnvironment={setEnvironment} />
          )}
          {type === "vector_store" && (
            <VectorStoreForm name={name} setName={setName} provider={vectorProvider} setProvider={setVectorProvider} endpoint={vectorEndpoint} setEndpoint={setVectorEndpoint} indexName={vectorIndex} setIndexName={setVectorIndex} apiKey={vectorApiKey} setApiKey={setVectorApiKey} environment={environment} setEnvironment={setEnvironment} />
          )}
          {type === "object_storage" && (
            <ObjectStorageForm name={name} setName={setName} provider={storageProvider} setProvider={setStorageProvider} endpoint={storageEndpoint} setEndpoint={setStorageEndpoint} bucket={storageBucket} setBucket={setStorageBucket} region={storageRegion} setRegion={setStorageRegion} accessKey={storageAccessKey} setAccessKey={setStorageAccessKey} secretKey={storageSecretKey} setSecretKey={setStorageSecretKey} environment={environment} setEnvironment={setEnvironment} />
          )}

          <div className="mt-5 flex items-center justify-between border-t border-[#F1F2F4] pt-5">
            <button type="button" onClick={() => setStep(1)} className="text-[12.5px] font-medium text-[#6B7280] transition-colors hover:text-[#0B0D0F]">← Back</button>
            <button
              type="button"
              onClick={() => setStep(needsNetworkStep ? 3 : totalSteps)}
              disabled={!name.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#23272B] disabled:opacity-40"
            >
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Network */}
      {step === 3 && needsNetworkStep && (
        <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-6">
          <p className="mb-5 text-[13.5px] font-semibold text-[#0B0D0F]">Network access</p>
          <OutboundIPs />
          <div className="mt-5 flex items-center justify-between border-t border-[#F1F2F4] pt-5">
            <button type="button" onClick={() => setStep(2)} className="text-[12.5px] font-medium text-[#6B7280] transition-colors hover:text-[#0B0D0F]">← Back</button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#23272B]"
            >
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3/4: Test & Save */}
      {((step === 3 && !needsNetworkStep) || step === 4) && (
        <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-6">
          <p className="mb-1 text-[13.5px] font-semibold text-[#0B0D0F]">Test &amp; save</p>
          <p className="mb-5 text-[12.5px] text-[#6B7280]">Run a test to verify credentials and connectivity before saving.</p>

          <div className="mb-5 rounded-[10px] border border-[#ECEEEF] bg-[#FAFBFB] p-4">
            <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Summary</p>
            <div className="space-y-1.5 text-[12.5px] text-[#6B7280]">
              <div className="flex justify-between"><span>Name</span><span className="font-medium text-[#0B0D0F]">{name}</span></div>
              <div className="flex justify-between"><span>Type</span><span className="font-medium capitalize text-[#0B0D0F]">{type?.replace(/_/g, " ")}</span></div>
              <div className="flex justify-between"><span>Environment</span><span className="font-medium capitalize text-[#0B0D0F]">{environment}</span></div>
            </div>
          </div>

          {testResult === "ok" && (
            <div className="mb-4 flex items-center gap-2.5 rounded-[10px] border border-[#9CCFBB] bg-[#E6F4EF]/60 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#007F4E]" />
              <p className="text-[12.5px] font-medium text-[#006B45]">Connection test passed. Ready to save.</p>
            </div>
          )}
          {testResult === "failed" && (
            <div className="mb-4 flex items-center gap-2.5 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-4 py-3">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[#DC2626]" />
              <p className="text-[12.5px] font-medium text-[#B91C1C]">Test failed. Check credentials and network access. You can still save as draft.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[12.5px] font-medium text-[#374151] transition-colors hover:bg-[#F7F8F9] disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", testing && "animate-spin")} />
              Test connection
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#23272B] disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save connection
            </button>
            <button
              type="button"
              onClick={() => void handleSave(true)}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[12.5px] text-[#6B7280] transition-colors hover:bg-[#F7F8F9] hover:text-[#0B0D0F] disabled:opacity-40"
            >
              Save as draft (skip test)
            </button>
          </div>

          <div className="mt-5 border-t border-[#F1F2F4] pt-4">
            <button type="button" onClick={() => setStep(needsNetworkStep ? 3 : 2)} className="text-[12.5px] font-medium text-[#6B7280] transition-colors hover:text-[#0B0D0F]">← Back</button>
          </div>
        </div>
      )}

      {/* Security note */}
      <div className="mt-6 flex items-start gap-2.5 rounded-[12px] border border-[#ECEEEF] bg-[#FAFBFB] p-4 text-[12px] leading-[1.55] text-[#6B7280]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" />
        <span>
          Secrets are stored through the configured secrets backend. They are never displayed after save and are not
          included in run events or audit logs.
        </span>
      </div>
    </div>
  );
}
