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
import type { ConnectionType, LlmProvider, DatabaseProvider, SaasProvider, AuthType } from "@/types/connections";
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
  { type: "saas",           label: "SaaS Integration",icon: MessageSquare,color: "#059669", description: "Connect to SaaS platforms for notifications and data sync.", examples: "Slack, Gmail, Salesforce, HubSpot, Jira, GitHub" },
  { type: "mcp_server",     label: "MCP Server",      icon: Cable,        color: "#D97706", description: "Connect to an MCP server to expose its tools to agents.", examples: "Remote MCP server, Local MCP bridge" },
  { type: "vector_store",   label: "Vector Store",    icon: DatabaseZap,  color: "#DB2777", description: "Long-term semantic memory and retrieval for agents.", examples: "Pinecone, Weaviate, Qdrant, pgvector, Redis" },
  { type: "object_storage", label: "Object Storage",  icon: HardDrive,    color: "#6B7280", description: "Store and retrieve workflow artifacts and files.", examples: "S3, GCS, Azure Blob, Cloudflare R2" },
];

// ─── Field helpers ────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/30";
const selectCls = "w-full rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[12px] focus:outline-none";

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/40">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Divider() { return <div className="border-t border-border/30" />; }

// ─── IP copy widget ───────────────────────────────────────────────────────────

function OutboundIPs() {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(VECTORBEE_OUTBOUND_IPS.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="mb-2 text-[12px] font-semibold text-amber-800">Network access requirements</p>
      <p className="mb-3 text-[11px] text-muted-foreground/70">
        For Vectorbee Cloud to reach your database or API, add these IPs to your firewall, VPC security group,
        API gateway, or database allowlist.
      </p>
      <div className="mb-3 rounded-lg border border-border/40 bg-background/40 p-3 font-mono text-[11px] text-muted-foreground">
        {VECTORBEE_OUTBOUND_IPS.map((ip) => <div key={ip}>{ip}</div>)}
      </div>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all",
          copied
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground",
        )}
      >
        {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
        {copied ? "Copied!" : "Copy IPs"}
      </button>
      <div className="mt-3 rounded-lg border border-border/30 bg-muted/5 p-3 text-[11px] text-muted-foreground/60">
        <strong className="font-medium text-foreground/60">Using a private runner?</strong> Self-hosted workers
        use your own network egress. Whitelisting depends on your deployment. See{" "}
        <Link href={"/workers" as never} className="text-primary hover:underline">Workers</Link>.
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
          <select className={selectCls} value={provider} onChange={(e) => { setProvider(e.target.value as LlmProvider); setDefaultModel(""); }}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="azure_openai">Azure OpenAI</option>
            <option value="google_gemini">Google Gemini</option>
            <option value="aws_bedrock">AWS Bedrock</option>
            <option value="openai_compatible">OpenAI-compatible endpoint</option>
          </select>
        </Field>
        <Field label="Environment">
          <select className={selectCls} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
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
          <select className={selectCls} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
            <option value="">— select —</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
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
          <select className={selectCls} value={dbProvider} onChange={(e) => setDbProvider(e.target.value as DatabaseProvider)}>
            <option value="postgresql">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="sqlserver">SQL Server</option>
            <option value="mongodb">MongoDB</option>
            <option value="snowflake">Snowflake</option>
            <option value="bigquery">BigQuery</option>
            <option value="redshift">Redshift</option>
          </select>
        </Field>
        <Field label="Environment">
          <select className={selectCls} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </Field>
      </Section>

      <Divider />

      <Section title="Connection details">
        <Field label="Connection string" hint="Full connection URL including credentials. Stored securely.">
          <input className={inputCls} type="password" value={connString} onChange={(e) => setConnString(e.target.value)} placeholder="postgres://user:pass@host:5432/db" />
        </Field>
        <p className="text-[10px] text-muted-foreground/40">— or enter individually —</p>
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
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="vectorbee_user" />
          </Field>
        </div>
        <Field label="Password" hint="Stored through secrets backend">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
      </Section>

      <Divider />

      <Section title="Options">
        <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-muted-foreground">
          <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={sslRequired} onChange={(e) => setSslRequired(e.target.checked)} />
          Require SSL / TLS
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-muted-foreground">
          <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          Read-only connection (prevents any writes)
        </label>
      </Section>

      {showPrivateWarning && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
          <strong>Private address detected.</strong> This host appears to be on a private network. Vectorbee Cloud
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
          <select className={selectCls} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </Field>
      </Section>

      <Divider />

      <Section title="Authentication">
        <Field label="Auth type">
          <select className={selectCls} value={authType} onChange={(e) => setAuthType(e.target.value as AuthType)}>
            <option value="none">None</option>
            <option value="api_key">API key header</option>
            <option value="bearer_token">Bearer token</option>
            <option value="basic_auth">Basic auth</option>
            <option value="oauth2">OAuth 2.0 (placeholder)</option>
            <option value="custom_header">Custom header</option>
          </select>
        </Field>
        {authType !== "none" && (
          <Field label="Secret / token" hint="Stored through secrets backend. Never displayed after save.">
            <input className={inputCls} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" />
          </Field>
        )}
      </Section>

      {showPrivateWarning && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
          <strong>Private address detected.</strong> This URL appears private. Vectorbee Cloud cannot reach it
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
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Slack" />
        </Field>
        <Field label="Provider" required>
          <select className={selectCls} value={saasProvider} onChange={(e) => setSaasProvider(e.target.value as SaasProvider)}>
            <option value="slack">Slack</option>
            <option value="gmail">Gmail / Email</option>
            <option value="salesforce">Salesforce</option>
            <option value="hubspot">HubSpot</option>
            <option value="zendesk">Zendesk</option>
            <option value="jira">Jira</option>
            <option value="github">GitHub</option>
          </select>
        </Field>
        <Field label="Environment">
          <select className={selectCls} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
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
          <select className={selectCls} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </Field>
      </Section>
      <Divider />
      <Section title="Server">
        <Field label="MCP server URL" required>
          <input className={inputCls} value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://mcp.example.com/sse" />
        </Field>
        <Field label="Transport">
          <select className={selectCls} value={transport} onChange={(e) => setTransport(e.target.value as "http" | "sse")}>
            <option value="http">HTTP</option>
            <option value="sse">Server-Sent Events (SSE)</option>
          </select>
        </Field>
        <Field label="Auth token (optional)" hint="Stored through secrets backend">
          <input className={inputCls} type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Bearer token or API key" />
        </Field>
      </Section>
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
              "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold border transition-all",
              done ? "border-primary/50 bg-primary/20 text-primary" : active ? "border-primary bg-primary/20 text-primary" : "border-border/40 text-muted-foreground/40",
            )}>
              {done ? <Check className="h-3.5 w-3.5" /> : s}
            </div>
            <span className={cn("ml-1.5 mr-4 text-[11px] font-medium hidden sm:inline", active ? "text-foreground" : "text-muted-foreground/40")}>
              {label}
            </span>
            {s < total && <div className="mr-4 h-px w-8 bg-border/30" />}
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
  const [saasProvider, setSaasProvider] = useState<SaasProvider>("slack");
  const [saasToken, setSaasToken] = useState("");
  const [workspace, setWorkspace] = useState("");

  // MCP
  const [mcpUrl, setMcpUrl] = useState("");
  const [transport, setTransport] = useState<"http" | "sse">("sse");
  const [mcpToken, setMcpToken] = useState("");

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
        config = { provider: dbProvider, connectionMode: connString ? "connection_string" : "host_port", host, port: parseInt(port) || 5432, database, sslRequired, readOnly, allowedSchemas: [], allowedTables: [], queryTimeoutMs: 10000, maxRows: 1000 };
      } else if (type === "http_api") {
        provider = "http_api";
        connAuthType = authType;
        config = { baseUrl: httpBaseUrl, authType, defaultHeaders: {}, allowedPaths: [], blockedPaths: [], requestTimeoutMs: 15000, retryAttempts: 2 };
      } else if (type === "saas") {
        provider = saasProvider;
        connAuthType = "bearer_token";
        config = { provider: saasProvider, workspace, allowedResources: [] };
      } else if (type === "mcp_server") {
        provider = "mcp";
        connAuthType = mcpToken ? "bearer_token" : "none";
        config = { serverUrl: mcpUrl, transport, allowedTools: [] };
      } else {
        provider = type;
        config = {} as Parameters<typeof createConnection>[0]["config"];
      }

      // Determine if the target host is private (RFC1918 / .internal / localhost)
      const targetHost = type === "database" ? (host || connString) : (type === "http_api" ? httpBaseUrl : type === "mcp_server" ? mcpUrl : "");
      const isPrivate = isPrivateHost(targetHost);

      // Resolve the plaintext secret for this connection type.
      // Sent to the server as plaintextSecret — never stored raw; the API encrypts
      // it server-side and returns only a masked display value + opaque secretRef.
      const plaintextSecret =
        type === "llm_provider" ? apiKey :
        type === "database"     ? (connString || (password ? `postgres://${username}:${password}@${host}:${port}/${database}` : "")) :
        type === "http_api"     ? (authType !== "none" ? secret : "") :
        type === "saas"         ? saasToken :
        type === "mcp_server"   ? mcpToken :
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
            setTestResult(result.lastTestStatus === "ok" ? "ok" : "failed");
            if (result.lastTestStatus === "ok") {
              toast.success(`Connection test passed — ${result.lastTestLatencyMs}ms`);
            } else {
              toast.error(`Test failed: ${result.lastTestError ?? "Could not reach host"}`);
            }
            // Auto-navigate to detail page after short delay on success
            if (result.lastTestStatus === "ok") {
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
          setTestResult(result.lastTestStatus === "ok" ? "ok" : "failed");
          if (result.lastTestStatus === "ok") {
            toast.success(`Connection test passed — ${result.lastTestLatencyMs}ms`);
            setTimeout(() => router.push(`/connections/${savedConnId}` as never), 1200);
          } else {
            toast.error(`Test failed: ${result.lastTestError ?? "Could not reach host"}`);
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
        <Link href={"/connections" as never} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Connections
        </Link>
        <span className="text-muted-foreground/30">/</span>
        <span className="text-[12px] font-semibold">New Connection</span>
      </div>

      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-foreground">New Connection</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Connect an LLM provider, database, API, or service to use in agents and tools.</p>
      </div>

      <div className="mb-8">
        <StepIndicator step={step} total={totalSteps} />
      </div>

      {/* Step 1: Choose type */}
      {step === 1 && (
        <div>
          <p className="mb-4 text-[13px] font-semibold text-foreground">What are you connecting?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPE_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.type}
                  type="button"
                  onClick={() => { setType(card.type); setStep(2); }}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-4 text-left transition-all hover:border-border",
                    type === card.type ? "border-primary/50 bg-primary/5" : "border-border/40 bg-card/40",
                  )}
                >
                  <span
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${card.color}15`, border: `1px solid ${card.color}30` }}
                  >
                    <Icon className="h-4.5 w-4.5" style={{ color: card.color }} />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{card.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">{card.description}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground/40">{card.examples}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && type && (
        <div className="rounded-2xl border border-border/40 bg-card/60 p-6">
          <p className="mb-5 text-[13px] font-semibold text-foreground">
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
          {(type === "vector_store" || type === "object_storage") && (
            <div className="space-y-5">
              <Section title="Identity">
                <Field label="Connection name" required>
                  <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pinecone Production" />
                </Field>
                <Field label="Environment">
                  <select className={selectCls} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </Field>
              </Section>
              <Divider />
              <p className="text-[12px] text-muted-foreground/60">Full configuration for this connection type is coming soon. You can save as draft.</p>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-border/30 pt-5">
            <button type="button" onClick={() => setStep(1)} className="text-[12px] text-muted-foreground hover:text-foreground">← Back</button>
            <button
              type="button"
              onClick={() => setStep(needsNetworkStep ? 3 : totalSteps)}
              disabled={!name.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Network */}
      {step === 3 && needsNetworkStep && (
        <div className="rounded-2xl border border-border/40 bg-card/60 p-6">
          <p className="mb-5 text-[13px] font-semibold text-foreground">Network access</p>
          <OutboundIPs />
          <div className="mt-5 flex items-center justify-between border-t border-border/30 pt-5">
            <button type="button" onClick={() => setStep(2)} className="text-[12px] text-muted-foreground hover:text-foreground">← Back</button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground"
            >
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3/4: Test & Save */}
      {((step === 3 && !needsNetworkStep) || step === 4) && (
        <div className="rounded-2xl border border-border/40 bg-card/60 p-6">
          <p className="mb-1 text-[13px] font-semibold text-foreground">Test &amp; save</p>
          <p className="mb-5 text-[12px] text-muted-foreground/60">Run a test to verify credentials and connectivity before saving.</p>

          <div className="mb-5 rounded-xl border border-border/40 bg-muted/5 p-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/40">Summary</p>
            <div className="space-y-1 text-[12px] text-muted-foreground">
              <div className="flex justify-between"><span>Name</span><span className="font-medium text-foreground">{name}</span></div>
              <div className="flex justify-between"><span>Type</span><span className="font-medium text-foreground capitalize">{type?.replace(/_/g, " ")}</span></div>
              <div className="flex justify-between"><span>Environment</span><span className="font-medium text-foreground capitalize">{environment}</span></div>
            </div>
          </div>

          {testResult === "ok" && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <p className="text-[12px] text-emerald-800">Connection test passed. Ready to save.</p>
            </div>
          )}
          {testResult === "failed" && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <ShieldCheck className="h-4 w-4 text-red-600 shrink-0" />
              <p className="text-[12px] text-red-700">Test failed. Check credentials and network access. You can still save as draft.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/50 px-4 text-[12px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Test connection
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save connection
            </button>
            <button
              type="button"
              onClick={() => void handleSave(true)}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/40 px-4 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Save as draft (skip test)
            </button>
          </div>

          <div className="mt-5 border-t border-border/30 pt-4">
            <button type="button" onClick={() => setStep(needsNetworkStep ? 3 : 2)} className="text-[12px] text-muted-foreground hover:text-foreground">← Back</button>
          </div>
        </div>
      )}

      {/* Security note */}
      <div className="mt-6 rounded-xl border border-border/30 bg-muted/5 p-4 text-[11px] text-muted-foreground/50">
        <ShieldCheck className="mb-1.5 inline h-3.5 w-3.5 text-muted-foreground/40" />
        {" "}Secrets are stored through the configured secrets backend. They are never displayed after save and are not
        included in run events or audit logs.
      </div>
    </div>
  );
}
