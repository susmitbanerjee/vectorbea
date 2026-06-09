"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Archive, BrainCircuit, Cable, CheckCircle2, Clock, Database,
  DatabaseZap, Globe, HardDrive, Loader2, MessageSquare, Plus, RefreshCw,
  ShieldAlert, XCircle, ArrowRight, Trash2, Plug,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Connection, ConnectionType, ConnectionStatus } from "@/types/connections";
import { getConnections, getConnection, testConnection, deleteConnection } from "@/lib/repository";
import { SearchInput } from "@/components/ui/search-input";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Chip, FilterTabs, EmptyHint, StatTile } from "@/components/ui/page-kit";

// ─── Connection type meta ─────────────────────────────────────────────────────

const TYPE_META: Record<ConnectionType, { label: string; icon: React.ElementType; color: string }> = {
  llm_provider:    { label: "LLM Provider",    icon: BrainCircuit, color: "#7C3AED" },
  database:        { label: "Database",         icon: Database,     color: "#0369A1" },
  http_api:        { label: "HTTP / API",       icon: Globe,        color: "#2563EB" },
  saas:            { label: "SaaS",             icon: MessageSquare,color: "#059669" },
  mcp_server:      { label: "MCP Server",       icon: Cable,        color: "#D97706" },
  vector_store:    { label: "Vector Store",     icon: DatabaseZap,  color: "#DB2777" },
  object_storage:  { label: "Object Storage",   icon: HardDrive,    color: "#6B7280" },
};

const STATUS_TONE: Record<ConnectionStatus, "green" | "gray" | "red" | "amber"> = {
  connected: "green", not_tested: "gray", failed: "red",
  needs_whitelist: "amber", missing_secret: "amber", disabled: "gray",
};
const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected", not_tested: "Not tested", failed: "Failed",
  needs_whitelist: "Needs whitelist", missing_secret: "Missing secret", disabled: "Disabled",
};
const STATUS_ICON: Record<ConnectionStatus, React.ElementType> = {
  connected: CheckCircle2, not_tested: Clock, failed: XCircle,
  needs_whitelist: AlertTriangle, missing_secret: ShieldAlert, disabled: Archive,
};

// ─── Connection card ──────────────────────────────────────────────────────────

function ConnectionCard({ conn, onTest, onDelete, testing }: {
  conn: Connection; onTest: () => void; onDelete: () => void; testing: boolean;
}) {
  const meta = TYPE_META[conn.type];
  const Icon = meta.icon;
  const usageCount = conn.usedByAgentIds.length + conn.usedByToolIds.length;
  const isLLM = conn.type === "llm_provider";
  const net = conn.networkPolicy.networkStatus;
  return (
    <div className="group flex flex-col overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white transition-all hover:border-[#C9CED4] hover:shadow-[0_6px_20px_rgba(11,13,15,0.05)]">
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        {isLLM ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[#E0E3E6] bg-white"><ProviderIcon providerType={conn.provider} className="h-[18px] w-[18px]" /></span>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]" style={{ background: meta.color, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.26), 0 2px 5px ${meta.color}40` }}><Icon className="h-[18px] w-[18px] text-white" /></span>
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/connections/${conn.id}` as never} className="block truncate text-[14.5px] font-semibold tracking-[-0.01em] text-[#0B0D0F] hover:text-[#007F4E]">{conn.name}</Link>
          <p className="mt-0.5 truncate font-mono text-[11.5px] capitalize text-[#6B7280]">{conn.provider.replace(/_/g, " ")} · {conn.environment}</p>
        </div>
        <Chip tone={STATUS_TONE[conn.status]} pulse={conn.status === "not_tested" ? false : undefined}>{STATUS_LABEL[conn.status]}</Chip>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[#ECEEEF] px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: meta.color }}><Icon className="h-3.5 w-3.5" />{meta.label}</span>
        <span className="text-[#D7DBE0]">·</span>
        <span className="font-mono text-[11.5px] text-[#6B7280]">{usageCount > 0 ? `${usageCount} resource${usageCount !== 1 ? "s" : ""}` : "unused"}</span>
        {net && (
          <>
            <span className="text-[#D7DBE0]">·</span>
            <span className={cn("font-mono text-[11.5px]", net === "reachable" ? "text-[#047857]" : net === "whitelist_required" ? "text-[#B45309]" : net === "blocked" ? "text-[#DC2626]" : "text-[#9CA3AF]")}>
              {net === "reachable" ? "reachable" : net === "whitelist_required" ? "whitelist needed" : net === "blocked" ? "blocked" : "unknown"}
            </span>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
        <span className="font-mono text-[11.5px] text-[#6B7280]">
          {conn.lastTestedAt ? `tested ${new Date(conn.lastTestedAt).toLocaleDateString()}` : "never tested"}
          {conn.lastTestLatencyMs ? ` · ${conn.lastTestLatencyMs}ms` : ""}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onTest} disabled={testing} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#E0E3E6] bg-white px-2.5 text-[11.5px] font-medium text-[#4B5563] transition-colors hover:border-[#C9CED4] hover:text-[#0B0D0F] disabled:opacity-40">
            <RefreshCw className={cn("h-3 w-3", testing && "animate-spin")} /> Test
          </button>
          <Link href={`/connections/${conn.id}` as never} className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-[#4B5563] opacity-0 transition-opacity hover:bg-[#ECEEEF] hover:text-[#0B0D0F] group-hover:opacity-100">View <ArrowRight className="h-3 w-3" /></Link>
          <button type="button" onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#9CA3AF] opacity-0 transition-all hover:bg-[#FEF2F2] hover:text-[#DC2626] group-hover:opacity-100" title="Delete connection"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "llm_provider", label: "LLM" },
  { value: "database", label: "Database" },
  { value: "http_api", label: "HTTP/API" },
  { value: "saas", label: "SaaS" },
  { value: "mcp_server", label: "MCP" },
  { value: "vector_store", label: "Vector" },
  { value: "object_storage", label: "Storage" },
];

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ConnectionType | "all">("all");
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const items = await getConnections({ search: search || undefined, type: typeFilter === "all" ? undefined : typeFilter });
      setConnections(items);
    } catch (error) {
      console.error("[connections] load failed:", error);
      setConnections([]);
      toast.error(error instanceof Error ? error.message : "Failed to load connections.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [search, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTest(id: string) {
    setTestingIds((s) => new Set([...s, id]));
    const result = await testConnection(id);
    setTestingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    if (result) {
      const passed = result.status === "connected";
      const refreshed = await getConnection(id);
      if (refreshed) setConnections((prev) => prev.map((c) => (c.id === id ? refreshed : c)));
      toast[passed ? "success" : "error"](passed ? `${refreshed?.name ?? id} connected (${result.latencyMs}ms)` : `${refreshed?.name ?? id} test failed: ${result.message}`);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete connection "${name}"? This cannot be undone.`)) return;
    await deleteConnection(id);
    setConnections((prev) => prev.filter((c) => c.id !== id));
    toast.success("Connection deleted.");
  }

  const stats = {
    connected: connections.filter((c) => c.status === "connected").length,
    failed: connections.filter((c) => c.status === "failed").length,
    needsAction: connections.filter((c) => c.status === "needs_whitelist" || c.status === "missing_secret").length,
  };

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Build</span>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.03em] text-[#0B0D0F]">Connections</h1>
          <p className="mt-1 max-w-[60ch] text-[13.5px] text-[#6B7280]">LLM providers, databases, APIs, SaaS, MCP servers, and storage — secrets encrypted, never shown.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => void load()} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5]">
            <RefreshCw className="h-3.5 w-3.5 text-[#6B7280]" />
          </button>
          <Link href={"/connections/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            <Plus className="h-3.5 w-3.5" /> New connection
          </Link>
        </div>
      </div>

      {/* Stats */}
      {!loading && connections.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Connected" value={stats.connected} accent={stats.connected > 0 ? "#007F4E" : undefined} icon={CheckCircle2} />
          <StatTile label="Failed" value={stats.failed} accent={stats.failed > 0 ? "#DC2626" : undefined} icon={XCircle} />
          <StatTile label="Needs action" value={stats.needsAction} accent={stats.needsAction > 0 ? "#CA8A04" : undefined} icon={AlertTriangle} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput containerClassName="w-[260px] max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search connections…" />
        <FilterTabs options={TYPE_FILTERS} value={typeFilter} onChange={(v) => setTypeFilter(v as ConnectionType | "all")} />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[140px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />)}
        </div>
      ) : connections.length === 0 ? (
        <EmptyHint
          icon={Plug}
          title="No connections yet"
          desc="Connect an LLM provider, database, or API to start running agents."
          action={<Link href={"/connections/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]"><Plus className="h-3.5 w-3.5" /> New connection</Link>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn) => (
            <ConnectionCard key={conn.id} conn={conn} onTest={() => void handleTest(conn.id)} onDelete={() => void handleDelete(conn.id, conn.name)} testing={testingIds.has(conn.id)} />
          ))}
        </div>
      )}

      {/* Private runner callout */}
      <div className="rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB]"><AlertTriangle className="h-5 w-5 text-[#CA8A04]" /></div>
          <div>
            <p className="text-[13px] font-semibold text-[#0B0D0F]">Private systems require network access</p>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[#6B7280]">
              For Vectorbea Cloud to reach databases, internal APIs, or self-hosted services, your firewall or VPC must allow inbound connections from Vectorbea&apos;s outbound IPs — or deploy a{" "}
              <Link href={"/workers" as never} className="font-medium text-[#007F4E] hover:underline">private runner</Link> inside your network.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
