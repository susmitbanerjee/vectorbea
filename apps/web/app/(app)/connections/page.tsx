"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  BrainCircuit,
  Cable,
  CheckCircle2,
  Clock,
  Database,
  DatabaseZap,
  Globe,
  HardDrive,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Connection, ConnectionType, ConnectionStatus } from "@/types/connections";
import { getConnections, testConnection, deleteConnection } from "@/lib/repository";

// ─── Connection type meta ─────────────────────────────────────────────────────

const TYPE_META: Record<ConnectionType, { label: string; icon: React.ElementType; color: string }> = {
  llm_provider:    { label: "LLM Provider",    icon: BrainCircuit, color: "#A78BFA" },
  database:        { label: "Database",         icon: Database,     color: "#22D3EE" },
  http_api:        { label: "HTTP / API",       icon: Globe,        color: "#38BDF8" },
  saas:            { label: "SaaS",             icon: MessageSquare,color: "#34D399" },
  mcp_server:      { label: "MCP Server",       icon: Cable,        color: "#FB923C" },
  vector_store:    { label: "Vector Store",     icon: DatabaseZap,  color: "#F472B6" },
  object_storage:  { label: "Object Storage",   icon: HardDrive,    color: "#94A3B8" },
};

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_META: Record<ConnectionStatus, { label: string; color: string; icon: React.ElementType }> = {
  connected:       { label: "Connected",       color: "#34D399", icon: CheckCircle2 },
  not_tested:      { label: "Not tested",      color: "#94A3B8", icon: Clock },
  failed:          { label: "Failed",          color: "#F87171", icon: XCircle },
  needs_whitelist: { label: "Needs whitelist", color: "#FCD34D", icon: AlertTriangle },
  missing_secret:  { label: "Missing secret",  color: "#FB923C", icon: ShieldAlert },
  disabled:        { label: "Disabled",        color: "#475569", icon: Archive },
};

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
      style={{ color: m.color, borderColor: `${m.color}30`, background: `${m.color}12` }}
    >
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function TypeBadge({ type }: { type: ConnectionType }) {
  const m = TYPE_META[type];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: m.color }}>
      <Icon className="h-3.5 w-3.5" />
      {m.label}
    </span>
  );
}

// ─── Connection row ───────────────────────────────────────────────────────────

function ConnectionRow({
  conn,
  onTest,
  onDelete,
  testing,
}: {
  conn: Connection;
  onTest: () => void;
  onDelete: () => void;
  testing: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const latencyLabel = conn.lastTestLatencyMs ? `${conn.lastTestLatencyMs}ms` : "—";
  const usageCount = conn.usedByAgentIds.length + conn.usedByToolIds.length;

  return (
    <div
      className="group relative grid items-center gap-4 rounded-xl border border-border/40 bg-card/60 px-5 py-4 transition-all hover:border-border/70 hover:bg-card/80"
      style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr auto" }}
    >
      {/* Name + provider */}
      <div className="min-w-0">
        <Link
          href={`/connections/${conn.id}` as never}
          className="text-[13px] font-semibold text-foreground hover:text-primary transition-colors"
        >
          {conn.name}
        </Link>
        <p className="mt-0.5 text-[11px] capitalize text-muted-foreground/60">
          {conn.provider.replace(/_/g, " ")} · {conn.environment}
        </p>
      </div>

      {/* Type */}
      <TypeBadge type={conn.type} />

      {/* Status */}
      <StatusBadge status={conn.status} />

      {/* Used by */}
      <span className="text-[12px] text-muted-foreground">
        {usageCount > 0 ? `${usageCount} resource${usageCount !== 1 ? "s" : ""}` : <span className="text-muted-foreground/30">unused</span>}
      </span>

      {/* Last tested */}
      <div>
        <span className="text-[12px] text-muted-foreground">
          {conn.lastTestedAt ? new Date(conn.lastTestedAt).toLocaleDateString() : "Never"}
        </span>
        {conn.lastTestLatencyMs && (
          <span className="ml-1.5 text-[10px] text-muted-foreground/40">{latencyLabel}</span>
        )}
      </div>

      {/* Network */}
      <div>
        {conn.networkPolicy.networkStatus === "reachable" ? (
          <span className="text-[11px] text-emerald-400">Reachable</span>
        ) : conn.networkPolicy.networkStatus === "whitelist_required" ? (
          <span className="text-[11px] text-amber-400">Whitelist needed</span>
        ) : conn.networkPolicy.networkStatus === "blocked" ? (
          <span className="text-[11px] text-red-400">Blocked</span>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">Unknown</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/40 px-2.5 text-[11px] text-muted-foreground transition-all hover:border-border hover:text-foreground disabled:opacity-40"
        >
          {testing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Test
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/40 text-muted-foreground transition-all hover:border-border hover:text-foreground"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-xl border border-border/50 shadow-2xl"
              style={{ background: "var(--surface-2)" }}
              onMouseLeave={() => setMenuOpen(false)}
            >
              <Link
                href={`/connections/${conn.id}` as never}
                className="block px-3 py-2 text-[12px] text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              >
                View details
              </Link>
              <Link
                href={`/connections/${conn.id}` as never}
                className="block px-3 py-2 text-[12px] text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              >
                Edit
              </Link>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="block w-full px-3 py-2 text-left text-[12px] text-red-400 hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TYPE_FILTERS: { value: ConnectionType | "all"; label: string }[] = [
  { value: "all",            label: "All" },
  { value: "llm_provider",   label: "LLM" },
  { value: "database",       label: "Database" },
  { value: "http_api",       label: "HTTP/API" },
  { value: "saas",           label: "SaaS" },
  { value: "mcp_server",     label: "MCP" },
  { value: "vector_store",   label: "Vector Store" },
  { value: "object_storage", label: "Storage" },
];

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ConnectionType | "all">("all");
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());

  async function load() {
    const items = await getConnections({
      search: search || undefined,
      type: typeFilter === "all" ? undefined : typeFilter,
    });
    setConnections(items);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [search, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTest(id: string) {
    setTestingIds((s) => new Set([...s, id]));
    const updated = await testConnection(id);
    setTestingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    if (updated) {
      setConnections((prev) => prev.map((c) => (c.id === id ? updated : c)));
      toast[updated.lastTestStatus === "ok" ? "success" : "error"](
        updated.lastTestStatus === "ok"
          ? `${updated.name} connected (${updated.lastTestLatencyMs}ms)`
          : `${updated.name} test failed`,
      );
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
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-foreground">Connections</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Configure LLM providers, databases, APIs, SaaS tools, MCP servers, and storage used by agents and tools.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/50 px-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <Link
            href={"/connections/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Connection
          </Link>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && (
        <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-3">
          {[
            { label: "Connected", value: stats.connected, color: "#34D399" },
            { label: "Failed",    value: stats.failed,    color: "#F87171" },
            { label: "Needs action", value: stats.needsAction, color: "#FCD34D" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-border/40 bg-card/60 px-4 py-3"
            >
              <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider font-semibold">{s.label}</p>
              <p className="mt-1 text-[22px] font-bold" style={{ color: s.value > 0 ? s.color : "var(--text-faint)" }}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search connections…"
            className="h-9 w-full rounded-lg border border-border/50 bg-background pl-9 pr-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/30"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value as ConnectionType | "all")}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all",
                typeFilter === f.value
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table header */}
      {!loading && connections.length > 0 && (
        <div
          className="mb-2 grid items-center gap-4 px-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40"
          style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr auto" }}
        >
          <span>Name</span>
          <span>Type</span>
          <span>Status</span>
          <span>Used by</span>
          <span>Last tested</span>
          <span>Network</span>
          <span />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 py-20 text-center">
          <Cable className="mb-3 h-10 w-10 text-muted-foreground/15" />
          <p className="text-[14px] font-semibold text-foreground/60">No connections yet</p>
          <p className="mt-1 mb-4 text-[12px] text-muted-foreground/50">
            Connect an LLM provider, database, or API to start running agents.
          </p>
          <Link
            href={"/connections/new" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" />
            New Connection
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => (
            <ConnectionRow
              key={conn.id}
              conn={conn}
              onTest={() => void handleTest(conn.id)}
              onDelete={() => void handleDelete(conn.id, conn.name)}
              testing={testingIds.has(conn.id)}
            />
          ))}
        </div>
      )}

      {/* Private runner callout */}
      <div className="mt-8 rounded-2xl border border-border/40 bg-card/40 p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted/20">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground">Private systems require network access</p>
            <p className="mt-1 text-[12px] text-muted-foreground/70 max-w-2xl">
              For Vectorbee Cloud to connect to databases, internal APIs, or self-hosted services,
              your firewall or VPC security group must allow inbound connections from Vectorbee&apos;s outbound IPs.
              Alternatively, deploy a{" "}
              <Link href={"/workers" as never} className="text-primary hover:underline">
                private runner
              </Link>{" "}
              inside your network.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
