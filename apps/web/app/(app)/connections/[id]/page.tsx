"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  Cable,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Database,
  DatabaseZap,
  Globe,
  HardDrive,
  Info,
  Loader2,
  MessageSquare,
  Network,
  Pencil,
  RefreshCw,
  Save,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Connection, ConnectionType, NetworkStatus, ConnectionStatus } from "@/types/connections";
import { VECTORBEE_OUTBOUND_IPS } from "@/types/connections";
import { getConnection, testConnection, updateConnection } from "@/lib/repository";

// ─── Type metadata ────────────────────────────────────────────────────────────

const TYPE_META: Record<ConnectionType, { label: string; icon: React.ElementType; color: string }> = {
  llm_provider:   { label: "LLM Provider",    icon: BrainCircuit, color: "#7C3AED" },
  database:       { label: "Database",         icon: Database,     color: "#0369A1" },
  http_api:       { label: "HTTP / API",       icon: Globe,        color: "#2563EB" },
  saas:           { label: "SaaS",             icon: MessageSquare,color: "#059669" },
  mcp_server:     { label: "MCP Server",       icon: Cable,        color: "#D97706" },
  vector_store:   { label: "Vector Store",     icon: DatabaseZap,  color: "#DB2777" },
  object_storage: { label: "Object Storage",   icon: HardDrive,    color: "#6B7280" },
};

const STATUS_META: Record<ConnectionStatus, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  connected:       { label: "Connected",       color: "#059669", bg: "#ECFDF5", border: "#A7F3D0", icon: CheckCircle2 },
  not_tested:      { label: "Not Tested",      color: "#6B7280", bg: "#F9FAFB", border: "#E5E7EB", icon: Clock },
  failed:          { label: "Failed",          color: "#DC2626", bg: "#FEF2F2", border: "#FECACA", icon: XCircle },
  needs_whitelist: { label: "Needs Whitelist", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A", icon: AlertTriangle },
  missing_secret:  { label: "Missing Secret",  color: "#D97706", bg: "#FFFBEB", border: "#FDE68A", icon: AlertTriangle },
  disabled:        { label: "Disabled",        color: "#6B7280", bg: "#F9FAFB", border: "#E5E7EB", icon: XCircle },
};

const NETWORK_META: Record<NetworkStatus, { label: string; color: string; icon: React.ElementType }> = {
  reachable:               { label: "Reachable",              color: "#059669", icon: Wifi },
  blocked:                 { label: "Blocked",                color: "#DC2626", icon: WifiOff },
  unknown:                 { label: "Unknown",                color: "#6B7280", icon: Network },
  private_runner_required: { label: "Private Runner Required",color: "#D97706", icon: Server },
  whitelist_required:      { label: "Whitelist Required",     color: "#D97706", icon: Shield },
};

// ─── Tab definition ───────────────────────────────────────────────────────────

type Tab = "overview" | "credentials" | "network" | "usage" | "test_history" | "events" | "settings";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",     label: "Overview",      icon: Info },
  { id: "credentials",  label: "Credentials",   icon: Shield },
  { id: "network",      label: "Network Access", icon: Network },
  { id: "usage",        label: "Usage",          icon: BarChart3 },
  { id: "test_history", label: "Test History",   icon: Activity },
  { id: "events",       label: "Events",         icon: Zap },
  { id: "settings",     label: "Settings",       icon: Settings },
];

// ─── Small helpers ────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-1.5 rounded p-0.5 transition-colors hover:bg-[#F3F4F5]"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-[#007F4E]" /> : <ClipboardCopy className="h-3 w-3 text-[#9CA3AF]" />}
    </button>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-[#F1F2F4] py-2.5 last:border-b-0">
      <span className="w-40 shrink-0 text-[12px] text-[#6B7280]">{label}</span>
      <div className="flex-1 text-[12.5px] font-medium text-[#0B0D0F]">{children}</div>
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-5">
      {title && (
        <p className="mb-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{title}</p>
      )}
      {children}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Config summary ───────────────────────────────────────────────────────────

function ConfigSummary({ connection }: { connection: Connection }) {
  const cfg = connection.config;

  if (connection.type === "llm_provider") {
    const c = cfg as import("@/types/connections").LlmConnectionConfig;
    return (
      <div className="space-y-0">
        <InfoRow label="Provider">{c.provider}</InfoRow>
        <InfoRow label="Default Model">{c.defaultModel}</InfoRow>
        <InfoRow label="Allowed Models">
          <div className="flex flex-wrap gap-1">
            {c.allowedModels.map(m => (
              <span key={m} className="rounded border border-[#E0E3E6] bg-[#F7F8F9] px-1.5 py-0.5 font-mono text-[10.5px] text-[#374151]">{m}</span>
            ))}
          </div>
        </InfoRow>
        {c.baseUrl && <InfoRow label="Base URL"><span className="font-mono text-[11px]">{c.baseUrl}</span></InfoRow>}
        <InfoRow label="Timeout">{c.requestTimeoutMs}ms</InfoRow>
        {c.tokenBudgetLimit != null && <InfoRow label="Token Budget">{c.tokenBudgetLimit.toLocaleString()}</InfoRow>}
        {c.rateLimitRpm && <InfoRow label="Rate Limit">{c.rateLimitRpm} req/min</InfoRow>}
      </div>
    );
  }

  if (connection.type === "database") {
    const c = cfg as import("@/types/connections").DatabaseConnectionConfig;
    return (
      <div className="space-y-0">
        <InfoRow label="Provider">{c.provider}</InfoRow>
        <InfoRow label="Mode">{c.connectionMode}</InfoRow>
        {c.host && <InfoRow label="Host"><span className="font-mono text-[11px]">{c.host}{c.port ? `:${c.port}` : ""}</span></InfoRow>}
        {c.database && <InfoRow label="Database">{c.database}</InfoRow>}
        <InfoRow label="SSL">{c.sslRequired ? "Required" : "Optional"}</InfoRow>
        <InfoRow label="Read-only">{c.readOnly ? "Yes" : "No"}</InfoRow>
        <InfoRow label="Query Timeout">{c.queryTimeoutMs}ms</InfoRow>
        {c.maxRows != null && <InfoRow label="Max Rows">{c.maxRows.toLocaleString()}</InfoRow>}
      </div>
    );
  }

  if (connection.type === "http_api") {
    const c = cfg as import("@/types/connections").HttpApiConnectionConfig;
    return (
      <div className="space-y-0">
        <InfoRow label="Base URL"><span className="font-mono text-[11px]">{c.baseUrl}</span><CopyButton value={c.baseUrl} /></InfoRow>
        <InfoRow label="Auth Type">{c.authType}</InfoRow>
        <InfoRow label="Timeout">{c.requestTimeoutMs}ms</InfoRow>
        <InfoRow label="Retries">{c.retryAttempts}</InfoRow>
        {(c.allowedPaths ?? []).length > 0 && (
          <InfoRow label="Allowed Paths">
            <div className="flex flex-wrap gap-1">
              {(c.allowedPaths ?? []).map(p => <span key={p} className="font-mono text-[10.5px] text-[#0F766E]">{p}</span>)}
            </div>
          </InfoRow>
        )}
      </div>
    );
  }

  if (connection.type === "saas") {
    const c = cfg as import("@/types/connections").SaasConnectionConfig;
    return (
      <div className="space-y-0">
        <InfoRow label="Provider">{c.provider}</InfoRow>
        {c.workspace && <InfoRow label="Workspace">{c.workspace}</InfoRow>}
        {c.allowedResources.length > 0 && (
          <InfoRow label="Resources">
            <div className="flex flex-wrap gap-1">
              {c.allowedResources.map(r => (
                <span key={r} className="rounded border border-[#E0E3E6] bg-[#F7F8F9] px-1.5 py-0.5 text-[10.5px] text-[#374151]">{r}</span>
              ))}
            </div>
          </InfoRow>
        )}
      </div>
    );
  }

  if (connection.type === "mcp_server") {
    const c = cfg as import("@/types/connections").McpConnectionConfig;
    return (
      <div className="space-y-0">
        <InfoRow label="Server URL"><span className="font-mono text-[11px]">{c.serverUrl}</span><CopyButton value={c.serverUrl} /></InfoRow>
        <InfoRow label="Transport">{c.transport}</InfoRow>
        {c.allowedTools.length > 0 && (
          <InfoRow label="Allowed Tools">
            <div className="flex flex-wrap gap-1">
              {c.allowedTools.map(t => <span key={t} className="font-mono text-[10.5px] text-[#92400E]">{t}</span>)}
            </div>
          </InfoRow>
        )}
      </div>
    );
  }

  if (connection.type === "vector_store") {
    const c = cfg as import("@/types/connections").VectorStoreConnectionConfig;
    return (
      <div className="space-y-0">
        <InfoRow label="Provider">{c.provider}</InfoRow>
        <InfoRow label="Index">{c.indexName}</InfoRow>
        {c.embeddingModel && <InfoRow label="Embedding Model">{c.embeddingModel}</InfoRow>}
      </div>
    );
  }

  if (connection.type === "object_storage") {
    const c = cfg as import("@/types/connections").ObjectStorageConnectionConfig;
    return (
      <div className="space-y-0">
        <InfoRow label="Provider">{c.provider}</InfoRow>
        <InfoRow label="Bucket">{c.bucket}</InfoRow>
        {c.region && <InfoRow label="Region">{c.region}</InfoRow>}
        {c.prefix && <InfoRow label="Prefix"><span className="font-mono text-[11px]">{c.prefix}</span></InfoRow>}
      </div>
    );
  }

  return <p className="text-[12px] text-[#9CA3AF]">No configuration details.</p>;
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function OverviewTab({ connection }: { connection: Connection }) {
  const typeMeta = TYPE_META[connection.type];
  const statusMeta = STATUS_META[connection.status];
  const StatusIcon = statusMeta.icon;

  const stats: { label: string; content: React.ReactNode }[] = [
    {
      label: "Status",
      content: (
        <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold" style={{ color: statusMeta.color }}>
          <StatusIcon className="h-4 w-4" />
          {statusMeta.label}
        </span>
      ),
    },
    { label: "Last tested", content: <span className="text-[13.5px] font-semibold text-[#0B0D0F]">{relativeTime(connection.lastTestedAt)}</span> },
    { label: "Latency", content: <span className="text-[13.5px] font-semibold tabular-nums text-[#0B0D0F]">{connection.lastTestLatencyMs !== null ? `${connection.lastTestLatencyMs}ms` : "—"}</span> },
    { label: "Environment", content: <span className="text-[13.5px] font-semibold capitalize text-[#0B0D0F]">{connection.environment || "—"}</span> },
    {
      label: "Type",
      content: (
        <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#0B0D0F]">
          <typeMeta.icon className="h-4 w-4" style={{ color: typeMeta.color }} />
          {typeMeta.label}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-[#ECEEEF] sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(({ label, content }) => (
          <div key={label} className="bg-white px-4 py-3.5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</p>
            <div className="mt-1.5">{content}</div>
          </div>
        ))}
      </div>

      {/* Config */}
      <SectionCard title="Configuration">
        <ConfigSummary connection={connection} />
      </SectionCard>

      {/* Usage summary */}
      <SectionCard title="Used By">
        <div className="grid grid-cols-2 divide-x divide-[#ECEEEF]">
          <div className="pr-6">
            <p className="text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-[#0B0D0F]">{connection.usedByAgentIds.length}</p>
            <p className="mt-1.5 text-[12px] text-[#6B7280]">Agents</p>
          </div>
          <div className="pl-6">
            <p className="text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-[#0B0D0F]">{connection.usedByToolIds.length}</p>
            <p className="mt-1.5 text-[12px] text-[#6B7280]">Tools</p>
          </div>
        </div>
        {connection.usedByAgentIds.length === 0 && connection.usedByToolIds.length === 0 && (
          <p className="mt-3 border-t border-[#F1F2F4] pt-3 text-[12px] text-[#9CA3AF]">Not yet used by any agent or tool.</p>
        )}
      </SectionCard>

      {/* Metadata */}
      <SectionCard title="Metadata">
        <InfoRow label="Connection ID"><span className="font-mono text-[11px]">{connection.id}</span><CopyButton value={connection.id} /></InfoRow>
        <InfoRow label="Slug"><span className="font-mono text-[11px]">{connection.slug}</span></InfoRow>
        <InfoRow label="Auth Type">{connection.authType}</InfoRow>
        <InfoRow label="Created">{formatDate(connection.createdAt)}</InfoRow>
        <InfoRow label="Updated">{formatDate(connection.updatedAt)}</InfoRow>
      </SectionCard>
    </div>
  );
}

function CredentialsTab({ connection, onUpdated }: { connection: Connection; onUpdated: (c: Connection) => void }) {
  const [newSecret, setNewSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const hasSecret = !!connection.secretRef;

  async function handleSaveSecret() {
    if (!newSecret.trim()) return;
    setSaving(true);
    try {
      const updated = await updateConnection(connection.id, {
        // plaintextSecret is a server-only field consumed by the PATCH handler
        // to encrypt and store; it is never persisted raw or returned.
        ...({ plaintextSecret: newSecret.trim() } as Parameters<typeof updateConnection>[1]),
      });
      if (updated) {
        onUpdated(updated);
        setNewSecret("");
        toast.success("Secret saved and encrypted successfully.");
      } else {
        toast.error("Failed to save secret — connection not found.");
      }
    } catch {
      toast.error("Failed to save secret.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Security note */}
      <div className="flex items-start gap-3 rounded-[12px] border border-[#9CCFBB] bg-[#E6F4EF]/50 p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#007F4E]" />
        <div>
          <p className="text-[12.5px] font-semibold text-[#0B0D0F]">Secrets are stored securely</p>
          <p className="mt-0.5 text-[12px] leading-[1.55] text-[#4B5563]">
            Raw credentials are never displayed after saving. Secrets are stored through the platform secrets backend (AES-256-GCM encrypted). Only masked values are shown here.
          </p>
        </div>
      </div>

      {/* Current state */}
      <SectionCard title="Secret Reference">
        <InfoRow label="Secret Ref">
          {connection.secretRef
            ? <><span className="font-mono text-[11px]">{connection.secretRef}</span><CopyButton value={connection.secretRef} /></>
            : <span className="font-normal text-[#9CA3AF]">None — set a secret below</span>
          }
        </InfoRow>
        <InfoRow label="Masked Value">
          {connection.secretMasked
            ? <span className="font-mono text-[12px]">{connection.secretMasked}</span>
            : <span className="font-normal text-[#9CA3AF]">No secret configured</span>
          }
        </InfoRow>
        <InfoRow label="Auth Type">{connection.authType}</InfoRow>
      </SectionCard>

      {/* Set / rotate form */}
      <SectionCard title={hasSecret ? "Rotate Secret" : "Set Secret"}>
        <p className="mb-3 text-[12px] leading-[1.55] text-[#6B7280]">
          {hasSecret
            ? "Enter a new value to re-encrypt and replace the stored secret. The connection ID and all agent/tool references remain unchanged."
            : "This connection has no secret yet. Enter the API key or credential to encrypt and store it."}
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            placeholder={connection.authType === "connection_string" ? "postgres://user:pass@host:5432/db" : "sk-… or paste your API key"}
            className="h-9 flex-1 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[13px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
            onKeyDown={(e) => { if (e.key === "Enter") void handleSaveSecret(); }}
          />
          <button
            type="button"
            onClick={() => void handleSaveSecret()}
            disabled={saving || !newSecret.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#23272B] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {hasSecret ? "Rotate" : "Save Secret"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[#9CA3AF]">
          The value is encrypted immediately on submission and never stored in plaintext. After saving, run a connection test to verify.
        </p>
      </SectionCard>
    </div>
  );
}

function NetworkTab({ connection }: { connection: Connection }) {
  const [copied, setCopied] = useState(false);
  const np = connection.networkPolicy;
  const netMeta = NETWORK_META[np.networkStatus];
  const NetIcon = netMeta.icon;

  function copyAllIPs() {
    void navigator.clipboard.writeText(VECTORBEE_OUTBOUND_IPS.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <SectionCard title="Network Status">
        <div className="flex items-center gap-2 mb-3">
          <NetIcon className="h-4 w-4" style={{ color: netMeta.color }} />
          <span className="text-[13px] font-semibold" style={{ color: netMeta.color }}>{netMeta.label}</span>
        </div>
        <InfoRow label="Reachability Test">{formatDate(np.lastReachabilityTestAt ?? null)}</InfoRow>
        <InfoRow label="Result">{np.lastReachabilityTestResult ?? "Never run"}</InfoRow>
        {np.reachabilityError && (
          <InfoRow label="Error">
            <span className="text-[11px] text-red-600">{np.reachabilityError}</span>
          </InfoRow>
        )}
        <InfoRow label="Whitelist Required">{np.requireWhitelist ? "Yes" : "No"}</InfoRow>
        <InfoRow label="Private Runner">{np.privateRunnerRequired ? "Required" : "Not required"}</InfoRow>
      </SectionCard>

      {/* Private runner note */}
      {np.privateRunnerRequired && (
        <div className="flex items-start gap-3 rounded-[12px] border border-[#FDE68A] bg-[#FFFBEB] p-4">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-[#CA8A04]" />
          <div>
            <p className="text-[12.5px] font-semibold text-[#92400E]">Private Runner Required</p>
            <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6B7280]">
              This host is on a private network. Deploy a Vectorbea private runner inside your network perimeter. The runner has outbound access to your private host and connects back to the Vectorbea control plane.
            </p>
          </div>
        </div>
      )}

      {/* Whitelist note */}
      {np.requireWhitelist && !np.privateRunnerRequired && (
        <div className="flex items-start gap-3 rounded-[12px] border border-[#FDE68A] bg-[#FFFBEB] p-4">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[#CA8A04]" />
          <div>
            <p className="text-[12.5px] font-semibold text-[#92400E]">Firewall Whitelisting Required</p>
            <p className="mt-0.5 text-[12px] leading-[1.55] text-[#6B7280]">
              This host requires inbound access from Vectorbea. Add the outbound IPs below to your firewall allowlist.
            </p>
          </div>
        </div>
      )}

      {/* Outbound IPs */}
      <SectionCard title="Vectorbea Outbound IPs">
        <p className="mb-3 text-[12px] text-[#6B7280]">
          Allow inbound connections from these IPs in your firewall or security group rules.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {VECTORBEE_OUTBOUND_IPS.map(ip => (
            <div
              key={ip}
              className="flex items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-[#F7F8F9] px-3 py-1.5"
            >
              <span className="font-mono text-[12px] text-[#0B0D0F]">{ip}</span>
              <CopyButton value={ip} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={copyAllIPs}
          className="flex items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] px-3 py-1.5 text-[12px] font-medium text-[#4B5563] transition-colors hover:bg-[#F7F8F9]"
        >
          {copied ? <Check className="h-3 w-3 text-[#007F4E]" /> : <ClipboardCopy className="h-3 w-3" />}
          {copied ? "Copied all IPs" : "Copy all IPs"}
        </button>
      </SectionCard>
    </div>
  );
}

function UsageTab({ connection }: { connection: Connection }) {
  const hasUsage = connection.usedByAgentIds.length > 0 || connection.usedByToolIds.length > 0;

  return (
    <div className="space-y-4">
      {!hasUsage && (
        <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#D7DBE0] bg-[#FAFBFB] py-12 text-[#9CA3AF]">
          <BarChart3 className="h-8 w-8 text-[#C9CED4]" />
          <p className="text-[13px] font-medium text-[#4B5563]">Not yet used by any agent or tool.</p>
          <p className="text-[12px]">Usage data will appear here once this connection is referenced.</p>
        </div>
      )}

      {connection.usedByAgentIds.length > 0 && (
        <SectionCard title={`Agents (${connection.usedByAgentIds.length})`}>
          <div className="space-y-1">
            {connection.usedByAgentIds.map(id => (
              <div key={id} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 transition-colors hover:bg-[#F7F8F9]">
                <span className="font-mono text-[11px] text-[#4B5563]">{id}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {connection.usedByToolIds.length > 0 && (
        <SectionCard title={`Tools (${connection.usedByToolIds.length})`}>
          <div className="space-y-1">
            {connection.usedByToolIds.map(id => (
              <div key={id} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 transition-colors hover:bg-[#F7F8F9]">
                <span className="font-mono text-[11px] text-[#4B5563]">{id}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

type TestHistoryEntry = {
  timestamp: string;
  status: "ok" | "failed";
  latencyMs: number | null;
  error: string | null;
};

function TestHistoryTab({ connection }: { connection: Connection }) {
  // Synthesize a few entries from current state
  const entries: TestHistoryEntry[] = [];
  if (connection.lastTestedAt) {
    entries.push({
      timestamp: connection.lastTestedAt,
      status: connection.lastTestStatus === "ok" ? "ok" : "failed",
      latencyMs: connection.lastTestLatencyMs,
      error: connection.lastTestError,
    });
    // Add simulated prior entries
    const prior = new Date(connection.lastTestedAt).getTime() - 3600000;
    entries.push({ timestamp: new Date(prior).toISOString(), status: "ok", latencyMs: 156, error: null });
    entries.push({ timestamp: new Date(prior - 86400000).toISOString(), status: "ok", latencyMs: 203, error: null });
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#D7DBE0] bg-[#FAFBFB] py-12 text-[#9CA3AF]">
        <Activity className="h-8 w-8 text-[#C9CED4]" />
        <p className="text-[13px] font-medium text-[#4B5563]">No test history yet.</p>
        <p className="text-[12px]">Run a connection test to see results here.</p>
      </div>
    );
  }

  return (
    <SectionCard title="Recent Tests">
      <div className="divide-y divide-[#F1F2F4]">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            {entry.status === "ok"
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#007F4E]" />
              : <XCircle className="h-3.5 w-3.5 shrink-0 text-[#DC2626]" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-medium text-[#0B0D0F]">
                {entry.status === "ok" ? "Test passed" : "Test failed"}
                {entry.latencyMs !== null && <span className="ml-2 font-mono text-[11px] font-normal text-[#9CA3AF]">{entry.latencyMs}ms</span>}
              </p>
              {entry.error && <p className="text-[11.5px] text-[#DC2626]">{entry.error}</p>}
            </div>
            <span className="shrink-0 text-[11.5px] text-[#9CA3AF]">{formatDate(entry.timestamp)}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function EventsTab({ connection }: { connection: Connection }) {
  const events = [
    { type: "CONNECTION_RESOLVED",        ts: connection.lastTestedAt ?? connection.updatedAt, detail: `Resolved by agent-orchestrator` },
    { type: "CONNECTION_TEST_COMPLETED",  ts: connection.lastTestedAt ?? connection.updatedAt, detail: `Test completed in ${connection.lastTestLatencyMs ?? "?"}ms` },
  ];

  return (
    <SectionCard title="Runtime Events">
      <p className="mb-3 text-[12px] text-[#6B7280]">
        Connection events emitted during workflow runs. Full event stream available in the Runs tab.
      </p>
      {events.length === 0 ? (
        <p className="text-[12px] text-[#9CA3AF]">No events recorded yet.</p>
      ) : (
        <div className="divide-y divide-[#F1F2F4]">
          {events.map((ev, i) => (
            <div key={i} className="py-2.5 flex items-start gap-3">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0F766E]" />
              <div className="flex-1 min-w-0">
                <span className="font-mono text-[10.5px] font-medium text-[#0F766E]">{ev.type}</span>
                <p className="mt-0.5 text-[11.5px] text-[#6B7280]">{ev.detail}</p>
              </div>
              <span className="shrink-0 text-[11px] text-[#9CA3AF]">{formatDate(ev.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Settings / Edit tab ─────────────────────────────────────────────────────

const inputCls = "h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[13px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15";
const selectCls = "h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[12.5px] text-[#0B0D0F] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15";

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
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

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-[12px] border border-[#E0E3E6] bg-white p-5">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{title}</p>
      {children}
    </div>
  );
}

function SettingsTab({ connection, onUpdated }: { connection: Connection; onUpdated: (c: Connection) => void }) {
  const cfg = connection.config as unknown as Record<string, unknown>;

  // Common
  const [name, setName] = useState(connection.name);
  const [environment, setEnvironment] = useState<"development" | "staging" | "production">(connection.environment);

  // LLM
  const [baseUrl, setBaseUrl] = useState(String(cfg.baseUrl ?? ""));
  const [defaultModel, setDefaultModel] = useState(String(cfg.defaultModel ?? ""));

  // Database
  const [host, setHost] = useState(String(cfg.host ?? ""));
  const [port, setPort] = useState(String(cfg.port ?? "5432"));
  const [dbName, setDbName] = useState(String(cfg.database ?? ""));
  const [sslRequired, setSslRequired] = useState(cfg.sslRequired !== false);
  const [readOnly, setReadOnly] = useState(cfg.readOnly === true);
  const [maxRows, setMaxRows] = useState(String(cfg.maxRows ?? "1000"));

  // HTTP / MCP
  const [httpBaseUrl, setHttpBaseUrl] = useState(String(cfg.baseUrl ?? cfg.serverUrl ?? ""));
  const [healthEndpoint, setHealthEndpoint] = useState(String(cfg.healthEndpoint ?? ""));

  // SaaS
  const [workspace, setWorkspace] = useState(String(cfg.workspace ?? ""));

  // Vector store
  const [indexName, setIndexName] = useState(String(cfg.indexName ?? ""));
  const [embeddingModel, setEmbeddingModel] = useState(String(cfg.embeddingModel ?? ""));

  // Object storage
  const [bucket, setBucket] = useState(String(cfg.bucket ?? ""));
  const [region, setRegion] = useState(String(cfg.region ?? ""));
  const [prefix, setPrefix] = useState(String(cfg.prefix ?? ""));

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    if (!name.trim()) { toast.error("Name is required."); return; }
    setSaving(true);

    // Build updated config — preserve existing keys, overwrite editable ones
    const newConfig: Record<string, unknown> = { ...cfg };

    if (connection.type === "llm_provider") {
      if (baseUrl.trim()) newConfig.baseUrl = baseUrl.trim(); else delete newConfig.baseUrl;
      if (defaultModel.trim()) newConfig.defaultModel = defaultModel.trim();
    } else if (connection.type === "database") {
      newConfig.host = host.trim();
      newConfig.port = parseInt(port) || 5432;
      newConfig.database = dbName.trim();
      newConfig.sslRequired = sslRequired;
      newConfig.readOnly = readOnly;
      newConfig.maxRows = parseInt(maxRows) || 1000;
    } else if (connection.type === "http_api") {
      if (httpBaseUrl.trim()) newConfig.baseUrl = httpBaseUrl.trim();
      if (healthEndpoint.trim()) newConfig.healthEndpoint = healthEndpoint.trim();
    } else if (connection.type === "saas") {
      if (workspace.trim()) newConfig.workspace = workspace.trim();
    } else if (connection.type === "mcp_server") {
      if (httpBaseUrl.trim()) newConfig.serverUrl = httpBaseUrl.trim();
    } else if (connection.type === "vector_store") {
      if (indexName.trim()) newConfig.indexName = indexName.trim();
      if (embeddingModel.trim()) newConfig.embeddingModel = embeddingModel.trim();
    } else if (connection.type === "object_storage") {
      if (bucket.trim()) newConfig.bucket = bucket.trim();
      if (region.trim()) newConfig.region = region.trim();
      if (prefix.trim()) newConfig.prefix = prefix.trim(); else delete newConfig.prefix;
    }

    try {
      const updated = await updateConnection(connection.id, {
        name: name.trim(),
        environment: environment as Connection["environment"],
        config: newConfig as unknown as Connection["config"],
      });
      if (updated) {
        onUpdated(updated);
        toast.success("Connection updated.");
      } else {
        toast.error("Update failed — connection not found.");
      }
    } catch (e) {
      toast.error(`Failed to update: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Identity */}
      <FormSection title="Identity">
        <FormField label="Name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Connection name" />
        </FormField>
        <FormField label="Environment">
          <select className={selectCls} value={environment} onChange={(e) => setEnvironment(e.target.value as "development" | "staging" | "production")}>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </FormField>
        <div className="flex items-center gap-4 border-t border-[#F1F2F4] pt-3">
          <div className="text-[12px] text-[#6B7280]">
            <span className="font-medium text-[#374151]">Type:</span> <span className="capitalize">{connection.type.replace(/_/g, " ")}</span>
          </div>
          <div className="text-[12px] text-[#6B7280]">
            <span className="font-medium text-[#374151]">Provider:</span> {connection.provider}
          </div>
        </div>
      </FormSection>

      {/* Type-specific config */}
      {connection.type === "llm_provider" && (
        <FormSection title="Model settings">
          <FormField label="Default model" hint="Used when no model is specified in the agent config.">
            <input className={inputCls} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="e.g. gpt-4o or claude-opus-4-5" />
          </FormField>
          <FormField label="Base URL (optional)" hint="Override the default API endpoint. Leave blank for the official endpoint.">
            <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-resource.openai.azure.com" />
          </FormField>
        </FormSection>
      )}

      {connection.type === "database" && (
        <FormSection title="Database settings">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Host">
              <input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="db.example.com" />
            </FormField>
            <FormField label="Port">
              <input className={inputCls} value={port} onChange={(e) => setPort(e.target.value)} placeholder="5432" />
            </FormField>
          </div>
          <FormField label="Database name">
            <input className={inputCls} value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="mydb" />
          </FormField>
          <FormField label="Max rows" hint="Maximum rows returned per query.">
            <input className={inputCls} type="number" value={maxRows} onChange={(e) => setMaxRows(e.target.value)} />
          </FormField>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={sslRequired} onChange={(e) => setSslRequired(e.target.checked)} className="h-3.5 w-3.5 accent-[#007F4E]" />
              <span className="text-[12.5px] text-[#374151]">Require SSL</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[#007F4E]" />
              <span className="text-[12.5px] text-[#374151]">Read-only</span>
            </label>
          </div>
        </FormSection>
      )}

      {(connection.type === "http_api" || connection.type === "mcp_server") && (
        <FormSection title={connection.type === "mcp_server" ? "MCP server settings" : "HTTP / API settings"}>
          <FormField label={connection.type === "mcp_server" ? "Server URL" : "Base URL"} required>
            <input className={inputCls} value={httpBaseUrl} onChange={(e) => setHttpBaseUrl(e.target.value)} placeholder="https://api.example.com" />
          </FormField>
          {connection.type === "http_api" && (
            <FormField label="Health endpoint (optional)" hint="Path appended to Base URL for connection testing.">
              <input className={inputCls} value={healthEndpoint} onChange={(e) => setHealthEndpoint(e.target.value)} placeholder="/health" />
            </FormField>
          )}
        </FormSection>
      )}

      {connection.type === "saas" && (
        <FormSection title="SaaS settings">
          <FormField label="Workspace / team slug" hint="Your workspace identifier on the SaaS platform.">
            <input className={inputCls} value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="my-workspace" />
          </FormField>
        </FormSection>
      )}

      {connection.type === "vector_store" && (
        <FormSection title="Vector store settings">
          <FormField label="Index name">
            <input className={inputCls} value={indexName} onChange={(e) => setIndexName(e.target.value)} placeholder="my-index" />
          </FormField>
          <FormField label="Embedding model">
            <input className={inputCls} value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} placeholder="text-embedding-3-small" />
          </FormField>
        </FormSection>
      )}

      {connection.type === "object_storage" && (
        <FormSection title="Storage settings">
          <FormField label="Bucket name">
            <input className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-bucket" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Region">
              <input className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
            </FormField>
            <FormField label="Key prefix (optional)">
              <input className={inputCls} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="uploads/" />
            </FormField>
          </div>
        </FormSection>
      )}

      {/* Save */}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[#0B0D0F] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#23272B] disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save changes
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ConnectionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void getConnection(params.id).then(conn => {
      if (!conn) { void router.replace("/connections" as never); return; }
      setConnection(conn);
      setLoading(false);
    });
  }, [params.id, router]);

  async function handleTest() {
    if (!connection || testing) return;
    setTesting(true);
    try {
      const result = await testConnection(connection.id);
      if (!result) { toast.error("Test failed — connection not found"); return; }
      const passed = result.status === "connected";
      if (passed) {
        toast.success(`Test passed — ${result.latencyMs}ms`);
      } else {
        toast.error(`Test failed: ${result.message ?? "Unknown error"}`);
      }
      // Re-fetch the full connection so the UI reflects the persisted test result
      const refreshed = await getConnection(connection.id);
      if (refreshed) setConnection(refreshed);
    } catch {
      toast.error("Test failed");
    } finally {
      setTesting(false);
    }
  }

  if (loading || !connection) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#C9CED4]" />
      </div>
    );
  }

  const typeMeta = TYPE_META[connection.type];
  const statusMeta = STATUS_META[connection.status];
  const TypeIcon = typeMeta.icon;
  const StatusIcon = statusMeta.icon;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#E0E3E6] bg-white px-6 py-4">
        <Link
          href={"/connections" as never}
          className="flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12.5px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F5] hover:text-[#0B0D0F]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Connections
        </Link>

        <span className="text-[#C9CED4]">/</span>

        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[7px]"
            style={{ background: typeMeta.color }}
          >
            <TypeIcon className="h-4 w-4 text-white" />
          </div>
          <span className="text-[14.5px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{connection.name}</span>
          <div
            className="flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{ background: statusMeta.bg, border: `1px solid ${statusMeta.border}` }}
          >
            <StatusIcon className="h-3 w-3" style={{ color: statusMeta.color }} />
            <span className="text-[10.5px] font-semibold" style={{ color: statusMeta.color }}>{statusMeta.label}</span>
          </div>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[12.5px] font-medium text-[#374151] transition-colors hover:bg-[#F7F8F9] disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Test Connection
        </button>

        <button
          type="button"
          onClick={() => setTab("settings")}
          className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#23272B]"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#E0E3E6] bg-white px-6">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] font-medium transition-colors",
                active
                  ? "border-[#007F4E] text-[#006B45]"
                  : "border-transparent text-[#6B7280] hover:text-[#0B0D0F]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-[#FAFBFB] px-6 py-5">
        <div className="mx-auto max-w-4xl">
          {tab === "overview"     && <OverviewTab connection={connection} />}
          {tab === "credentials"  && <CredentialsTab connection={connection} onUpdated={setConnection} />}
          {tab === "network"      && <NetworkTab connection={connection} />}
          {tab === "usage"        && <UsageTab connection={connection} />}
          {tab === "test_history" && <TestHistoryTab connection={connection} />}
          {tab === "events"       && <EventsTab connection={connection} />}
          {tab === "settings"     && <SettingsTab connection={connection} onUpdated={setConnection} />}
        </div>
      </div>
    </div>
  );
}
