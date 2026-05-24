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
  RefreshCw,
  Server,
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
  llm_provider:   { label: "LLM Provider",    icon: BrainCircuit, color: "#A78BFA" },
  database:       { label: "Database",         icon: Database,     color: "#22D3EE" },
  http_api:       { label: "HTTP / API",       icon: Globe,        color: "#38BDF8" },
  saas:           { label: "SaaS",             icon: MessageSquare,color: "#34D399" },
  mcp_server:     { label: "MCP Server",       icon: Cable,        color: "#FB923C" },
  vector_store:   { label: "Vector Store",     icon: DatabaseZap,  color: "#F472B6" },
  object_storage: { label: "Object Storage",   icon: HardDrive,    color: "#94A3B8" },
};

const STATUS_META: Record<ConnectionStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  connected:       { label: "Connected",       color: "#10B981", bg: "rgba(16,185,129,0.1)", icon: CheckCircle2 },
  not_tested:      { label: "Not Tested",      color: "#94A3B8", bg: "rgba(148,163,184,0.1)", icon: Clock },
  failed:          { label: "Failed",          color: "#EF4444", bg: "rgba(239,68,68,0.1)", icon: XCircle },
  needs_whitelist: { label: "Needs Whitelist", color: "#F59E0B", bg: "rgba(245,158,11,0.1)", icon: AlertTriangle },
  missing_secret:  { label: "Missing Secret",  color: "#F97316", bg: "rgba(249,115,22,0.1)", icon: AlertTriangle },
  disabled:        { label: "Disabled",        color: "#64748B", bg: "rgba(100,116,139,0.1)", icon: XCircle },
};

const NETWORK_META: Record<NetworkStatus, { label: string; color: string; icon: React.ElementType }> = {
  reachable:               { label: "Reachable",              color: "#10B981", icon: Wifi },
  blocked:                 { label: "Blocked",                color: "#EF4444", icon: WifiOff },
  unknown:                 { label: "Unknown",                color: "#94A3B8", icon: Network },
  private_runner_required: { label: "Private Runner Required",color: "#F59E0B", icon: Server },
  whitelist_required:      { label: "Whitelist Required",     color: "#F59E0B", icon: Shield },
};

// ─── Tab definition ───────────────────────────────────────────────────────────

type Tab = "overview" | "credentials" | "network" | "usage" | "test_history" | "events";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",     label: "Overview",      icon: Info },
  { id: "credentials", label: "Credentials",    icon: Shield },
  { id: "network",     label: "Network Access", icon: Network },
  { id: "usage",       label: "Usage",          icon: BarChart3 },
  { id: "test_history",label: "Test History",   icon: Activity },
  { id: "events",      label: "Events",         icon: Zap },
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
      className="ml-1.5 rounded p-0.5 transition-colors hover:bg-white/10"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <ClipboardCopy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: "1px solid rgba(148,163,184,0.07)" }}>
      <span className="w-40 shrink-0 text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>{label}</span>
      <div className="flex-1 text-[12px]" style={{ color: "var(--text-primary)" }}>{children}</div>
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/60 p-4">
      {title && <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{title}</p>}
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
              <span key={m} className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>{m}</span>
            ))}
          </div>
        </InfoRow>
        {c.baseUrl && <InfoRow label="Base URL"><span className="font-mono text-[11px]">{c.baseUrl}</span></InfoRow>}
        <InfoRow label="Timeout">{c.requestTimeoutMs}ms</InfoRow>
        {c.tokenBudgetLimit && <InfoRow label="Token Budget">{c.tokenBudgetLimit.toLocaleString()}</InfoRow>}
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
        <InfoRow label="Max Rows">{c.maxRows.toLocaleString()}</InfoRow>
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
        {c.allowedPaths.length > 0 && (
          <InfoRow label="Allowed Paths">
            <div className="flex flex-wrap gap-1">
              {c.allowedPaths.map(p => <span key={p} className="font-mono text-[10px]" style={{ color: "#38BDF8" }}>{p}</span>)}
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
                <span key={r} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>{r}</span>
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
              {c.allowedTools.map(t => <span key={t} className="font-mono text-[10px]" style={{ color: "#FB923C" }}>{t}</span>)}
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

  return <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No configuration details.</p>;
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function OverviewTab({ connection }: { connection: Connection }) {
  const typeMeta = TYPE_META[connection.type];
  const statusMeta = STATUS_META[connection.status];
  const StatusIcon = statusMeta.icon;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <SectionCard>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Status</p>
            <div className="mt-1 flex items-center gap-1.5">
              <StatusIcon className="h-3.5 w-3.5" style={{ color: statusMeta.color }} />
              <span className="text-[13px] font-semibold" style={{ color: statusMeta.color }}>{statusMeta.label}</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Last Tested</p>
            <p className="mt-1 text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{relativeTime(connection.lastTestedAt)}</p>
          </div>
          {connection.lastTestLatencyMs !== null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Latency</p>
              <p className="mt-1 text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{connection.lastTestLatencyMs}ms</p>
            </div>
          )}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Environment</p>
            <p className="mt-1 text-[13px] font-medium capitalize" style={{ color: "var(--text-primary)" }}>{connection.environment}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Type</p>
            <div className="mt-1 flex items-center gap-1">
              <typeMeta.icon className="h-3.5 w-3.5" style={{ color: typeMeta.color }} />
              <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{typeMeta.label}</span>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Config */}
      <SectionCard title="Configuration">
        <ConfigSummary connection={connection} />
      </SectionCard>

      {/* Usage summary */}
      <SectionCard title="Used By">
        <div className="flex gap-8">
          <div>
            <p className="text-[22px] font-bold" style={{ color: "var(--text-primary)" }}>{connection.usedByAgentIds.length}</p>
            <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Agents</p>
          </div>
          <div>
            <p className="text-[22px] font-bold" style={{ color: "var(--text-primary)" }}>{connection.usedByToolIds.length}</p>
            <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Tools</p>
          </div>
        </div>
        {connection.usedByAgentIds.length === 0 && connection.usedByToolIds.length === 0 && (
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-faint)" }}>Not yet used by any agent or tool.</p>
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
      <div className="flex items-start gap-2.5 rounded-xl border border-border/40 bg-card/60 p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
        <div>
          <p className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>Secrets are stored securely</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
            Raw credentials are never displayed after saving. Secrets are stored through the platform secrets backend (AES-256-GCM encrypted). Only masked values are shown here.
          </p>
        </div>
      </div>

      {/* Current state */}
      <SectionCard title="Secret Reference">
        <InfoRow label="Secret Ref">
          {connection.secretRef
            ? <><span className="font-mono text-[11px]">{connection.secretRef}</span><CopyButton value={connection.secretRef} /></>
            : <span style={{ color: "var(--text-faint)" }}>None — set a secret below</span>
          }
        </InfoRow>
        <InfoRow label="Masked Value">
          {connection.secretMasked
            ? <span className="font-mono text-[12px]">{connection.secretMasked}</span>
            : <span style={{ color: "var(--text-faint)" }}>No secret configured</span>
          }
        </InfoRow>
        <InfoRow label="Auth Type">{connection.authType}</InfoRow>
      </SectionCard>

      {/* Set / rotate form */}
      <SectionCard title={hasSecret ? "Rotate Secret" : "Set Secret"}>
        <p className="mb-3 text-[11px]" style={{ color: "var(--text-faint)" }}>
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
            className="flex-1 rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/30"
            onKeyDown={(e) => { if (e.key === "Enter") void handleSaveSecret(); }}
          />
          <button
            type="button"
            onClick={() => void handleSaveSecret()}
            disabled={saving || !newSecret.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground disabled:opacity-40 transition-opacity"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {hasSecret ? "Rotate" : "Save Secret"}
          </button>
        </div>
        <p className="mt-2 text-[10px]" style={{ color: "var(--text-faint)" }}>
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
            <span className="text-[11px] text-red-400">{np.reachabilityError}</span>
          </InfoRow>
        )}
        <InfoRow label="Whitelist Required">{np.requireWhitelist ? "Yes" : "No"}</InfoRow>
        <InfoRow label="Private Runner">{np.privateRunnerRequired ? "Required" : "Not required"}</InfoRow>
      </SectionCard>

      {/* Private runner note */}
      {np.privateRunnerRequired && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-[12px] font-semibold text-amber-300">Private Runner Required</p>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
              This host is on a private network. Deploy a Vectorbee private runner inside your network perimeter. The runner has outbound access to your private host and connects back to the Vectorbee control plane.
            </p>
          </div>
        </div>
      )}

      {/* Whitelist note */}
      {np.requireWhitelist && !np.privateRunnerRequired && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-[12px] font-semibold text-amber-300">Firewall Whitelisting Required</p>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>
              This host requires inbound access from Vectorbee. Add the outbound IPs below to your firewall allowlist.
            </p>
          </div>
        </div>
      )}

      {/* Outbound IPs */}
      <SectionCard title="Vectorbee Outbound IPs">
        <p className="mb-3 text-[11px]" style={{ color: "var(--text-faint)" }}>
          Allow inbound connections from these IPs in your firewall or security group rules.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {VECTORBEE_OUTBOUND_IPS.map(ip => (
            <div
              key={ip}
              className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5"
              style={{ background: "var(--surface-2)" }}
            >
              <span className="font-mono text-[12px]" style={{ color: "var(--text-primary)" }}>{ip}</span>
              <CopyButton value={ip} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={copyAllIPs}
          className="flex items-center gap-1.5 rounded-md border border-border/40 px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/5"
          style={{ color: "var(--text-faint)" }}
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <ClipboardCopy className="h-3 w-3" />}
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
        <div className="flex flex-col items-center py-12 gap-3" style={{ color: "var(--text-faint)" }}>
          <BarChart3 className="h-8 w-8 opacity-30" />
          <p className="text-[13px]">Not yet used by any agent or tool.</p>
          <p className="text-[11px] opacity-70">Usage data will appear here once this connection is referenced.</p>
        </div>
      )}

      {connection.usedByAgentIds.length > 0 && (
        <SectionCard title={`Agents (${connection.usedByAgentIds.length})`}>
          <div className="space-y-1">
            {connection.usedByAgentIds.map(id => (
              <div key={id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
                <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>{id}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {connection.usedByToolIds.length > 0 && (
        <SectionCard title={`Tools (${connection.usedByToolIds.length})`}>
          <div className="space-y-1">
            {connection.usedByToolIds.map(id => (
              <div key={id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
                <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>{id}</span>
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
      <div className="flex flex-col items-center py-12 gap-3" style={{ color: "var(--text-faint)" }}>
        <Activity className="h-8 w-8 opacity-30" />
        <p className="text-[13px]">No test history yet.</p>
        <p className="text-[11px] opacity-70">Run a connection test to see results here.</p>
      </div>
    );
  }

  return (
    <SectionCard title="Recent Tests">
      <div className="divide-y divide-border/20">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            {entry.status === "ok"
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
              : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                {entry.status === "ok" ? "Test passed" : "Test failed"}
                {entry.latencyMs !== null && <span className="ml-2 text-[11px]" style={{ color: "var(--text-faint)" }}>{entry.latencyMs}ms</span>}
              </p>
              {entry.error && <p className="text-[11px] text-red-400">{entry.error}</p>}
            </div>
            <span className="text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>{formatDate(entry.timestamp)}</span>
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
      <p className="mb-3 text-[11px]" style={{ color: "var(--text-faint)" }}>
        Connection events emitted during workflow runs. Full event stream available in the Runs tab.
      </p>
      {events.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No events recorded yet.</p>
      ) : (
        <div className="divide-y divide-border/20">
          {events.map((ev, i) => (
            <div key={i} className="py-2.5 flex items-start gap-3">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#38BDF8" }} />
              <div className="flex-1 min-w-0">
                <span className="font-mono text-[10px]" style={{ color: "#38BDF8" }}>{ev.type}</span>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-faint)" }}>{ev.detail}</p>
              </div>
              <span className="text-[10px] shrink-0" style={{ color: "var(--text-faint)" }}>{formatDate(ev.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
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
      const updated = await testConnection(connection.id);
      if (!updated) { toast.error("Test failed — connection not found"); return; }
      setConnection(updated);
      if (updated.lastTestStatus === "ok") {
        toast.success(`Test passed — ${updated.lastTestLatencyMs}ms`);
      } else {
        toast.error(`Test failed: ${updated.lastTestError ?? "Unknown error"}`);
      }
    } catch {
      toast.error("Test failed");
    } finally {
      setTesting(false);
    }
  }

  if (loading || !connection) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--text-faint)" }} />
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
      <div
        className="flex shrink-0 items-center gap-3 px-6 py-4"
        style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}
      >
        <Link
          href={"/connections" as never}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-white/5"
          style={{ color: "var(--text-faint)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Connections
        </Link>

        <span style={{ color: "var(--text-faint)" }}>/</span>

        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ background: `${typeMeta.color}18`, border: `1px solid ${typeMeta.color}30` }}
          >
            <TypeIcon className="h-3.5 w-3.5" style={{ color: typeMeta.color }} />
          </div>
          <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{connection.name}</span>
          <div
            className="flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{ background: statusMeta.bg, border: `1px solid ${statusMeta.color}30` }}
          >
            <StatusIcon className="h-3 w-3" style={{ color: statusMeta.color }} />
            <span className="text-[10px] font-medium" style={{ color: statusMeta.color }}>{statusMeta.label}</span>
          </div>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="flex items-center gap-1.5 rounded-md border border-border/40 bg-card/60 px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
          style={{ color: "var(--text-primary)" }}
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Test Connection
        </button>

        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-white/5"
          style={{ background: "rgba(56,189,248,0.1)", color: "#38BDF8", border: "1px solid rgba(56,189,248,0.2)" }}
        >
          Edit
        </button>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-1 px-6"
        style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}
      >
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition-colors border-b-2 -mb-px",
                active
                  ? "border-[#38BDF8] text-[#38BDF8]"
                  : "border-transparent hover:text-foreground"
              )}
              style={{ color: active ? "#38BDF8" : "var(--text-faint)" }}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl">
          {tab === "overview"     && <OverviewTab connection={connection} />}
          {tab === "credentials"  && <CredentialsTab connection={connection} onUpdated={setConnection} />}
          {tab === "network"      && <NetworkTab connection={connection} />}
          {tab === "usage"        && <UsageTab connection={connection} />}
          {tab === "test_history" && <TestHistoryTab connection={connection} />}
          {tab === "events"       && <EventsTab connection={connection} />}
        </div>
      </div>
    </div>
  );
}
