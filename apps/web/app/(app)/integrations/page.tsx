"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  CheckCircle2,
  Globe,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getConnections } from "@/lib/repository";
import type { Connection } from "@/types/connections";
import { SearchInput } from "@/components/ui/search-input";
import { FilterTabs } from "@/components/ui/page-kit";

// ─── Static integration catalog ───────────────────────────────────────────────
// These are the apps/services Vectorbea supports. "Connected" state is resolved
// from real user connections at runtime; no fake data is introduced.

type IntegrationCategory =
  | "all"
  | "ai"
  | "communication"
  | "productivity"
  | "data"
  | "crm"
  | "devtools"
  | "custom";

type IntegrationDef = {
  id: string;
  name: string;
  category: Exclude<IntegrationCategory, "all">;
  description: string;
  iconText: string;   // emoji or short abbr while we don't have logo assets
  iconBg: string;
  iconFg: string;
  /** connection.provider value(s) that map to this integration */
  providerKeys: string[];
  /** link to create a connection of this type */
  newConnectionHref: Route;
  /** docs or tool-catalog href */
  learnHref?: string;
};

const INTEGRATIONS: IntegrationDef[] = [
  // AI / LLM
  { id: "openai",    name: "OpenAI",     category: "ai",            description: "Use GPT-4o and other OpenAI models in agents and LLM steps.",       iconText: "⬡",  iconBg: "#10B981", iconFg: "#fff", providerKeys: ["openai"],           newConnectionHref: "/connections/new" as Route },
  { id: "anthropic", name: "Anthropic",  category: "ai",            description: "Use Claude models for reasoning, summarization, and extraction.",    iconText: "◎",  iconBg: "#C77A3E", iconFg: "#fff", providerKeys: ["anthropic"],        newConnectionHref: "/connections/new" as Route },
  { id: "gemini",    name: "Gemini",     category: "ai",            description: "Use Google Gemini models in workflows and agents.",                  iconText: "✦",  iconBg: "#4285F4", iconFg: "#fff", providerKeys: ["gemini", "google"],  newConnectionHref: "/connections/new" as Route },
  { id: "mistral",   name: "Mistral",    category: "ai",            description: "Fast, efficient open-weight models via Mistral AI.",                 iconText: "M",  iconBg: "#FF7000", iconFg: "#fff", providerKeys: ["mistral"],          newConnectionHref: "/connections/new" as Route },
  // Communication
  { id: "gmail",     name: "Gmail",      category: "communication", description: "Read emails, send messages, and trigger workflows from your inbox.", iconText: "✉",  iconBg: "#EA4335", iconFg: "#fff", providerKeys: ["gmail"],            newConnectionHref: "/connections/new" as Route },
  { id: "slack",     name: "Slack",      category: "communication", description: "Send notifications, post updates, and route approvals.",             iconText: "#",  iconBg: "#4A154B", iconFg: "#fff", providerKeys: ["slack"],            newConnectionHref: "/connections/new" as Route },
  // Productivity
  { id: "sheets",    name: "Google Sheets", category: "productivity", description: "Read and write rows, create reports, and track data.",             iconText: "▦",  iconBg: "#0F9D58", iconFg: "#fff", providerKeys: ["google_sheets", "sheets"], newConnectionHref: "/connections/new" as Route },
  { id: "notion",    name: "Notion",     category: "productivity",  description: "Create, update, and query Notion pages and databases.",              iconText: "N",  iconBg: "#000000", iconFg: "#fff", providerKeys: ["notion"],           newConnectionHref: "/connections/new" as Route },
  { id: "airtable",  name: "Airtable",   category: "productivity",  description: "Read and write records, trigger on row changes.",                    iconText: "⊞",  iconBg: "#FCB400", iconFg: "#fff", providerKeys: ["airtable"],         newConnectionHref: "/connections/new" as Route },
  // Data
  { id: "postgres",  name: "Postgres",   category: "data",          description: "Query or update relational data from workflows.",                    iconText: "Pg", iconBg: "#336791", iconFg: "#fff", providerKeys: ["postgres", "postgresql"], newConnectionHref: "/connections/new" as Route },
  { id: "mysql",     name: "MySQL",      category: "data",          description: "Connect to MySQL databases for reads and writes.",                   iconText: "DB", iconBg: "#00758F", iconFg: "#fff", providerKeys: ["mysql"],            newConnectionHref: "/connections/new" as Route },
  { id: "webhook",   name: "Webhook",    category: "custom",        description: "Trigger workflows from any external system via HTTP webhook.",       iconText: "⚡", iconBg: "#7C3AED", iconFg: "#fff", providerKeys: ["webhook"],          newConnectionHref: "/connections/new" as Route },
  { id: "http",      name: "HTTP API",   category: "custom",        description: "Call any external REST or GraphQL API with headers and auth.",       iconText: "{}",  iconBg: "#2563EB", iconFg: "#fff", providerKeys: ["http", "http_api"], newConnectionHref: "/connections/new" as Route },
  // CRM
  { id: "hubspot",   name: "HubSpot",    category: "crm",           description: "Sync contacts, deals, and company data with your CRM.",             iconText: "⬟",  iconBg: "#FF7A59", iconFg: "#fff", providerKeys: ["hubspot"],          newConnectionHref: "/connections/new" as Route },
  // DevTools
  { id: "github",    name: "GitHub",     category: "devtools",      description: "Create issues, comment on PRs, and trigger on repo events.",        iconText: "◑",  iconBg: "#24292F", iconFg: "#fff", providerKeys: ["github"],           newConnectionHref: "/connections/new" as Route },
  { id: "jira",      name: "Jira",       category: "devtools",      description: "Create and update issues, sync sprint boards, and track work.",     iconText: "J",  iconBg: "#0052CC", iconFg: "#fff", providerKeys: ["jira"],             newConnectionHref: "/connections/new" as Route },
];

const CATEGORY_FILTERS = [
  { value: "all",           label: "All" },
  { value: "ai",            label: "AI" },
  { value: "communication", label: "Communication" },
  { value: "productivity",  label: "Productivity" },
  { value: "data",          label: "Data" },
  { value: "crm",           label: "CRM" },
  { value: "devtools",      label: "DevTools" },
  { value: "custom",        label: "Custom" },
];

// ─── Integration card ─────────────────────────────────────────────────────────

function IntegrationCard({
  def,
  connectedCount,
}: {
  def: IntegrationDef;
  connectedCount: number;
}) {
  const isConnected = connectedCount > 0;

  return (
    <div className="group relative flex flex-col rounded-[12px] border border-[#E0E3E6] bg-white transition-all hover:border-[#C9CED4] hover:shadow-[0_6px_20px_rgba(11,13,15,0.05)]">
      {/* Top: icon + name + badge */}
      <div className="flex items-start gap-3 p-4">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[15px] font-bold"
          style={{ background: def.iconBg, color: def.iconFg }}
        >
          {def.iconText}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-[#0B0D0F]">{def.name}</p>
          <p className="mt-0.5 truncate font-mono text-[10.5px] capitalize text-[#6B7280]">{def.category}</p>
        </div>
        {isConnected && (
          <span className="flex items-center gap-1 rounded-full border border-[#9CCFBB] bg-[#E6F4EF] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#006B45]">
            <CheckCircle2 className="h-3 w-3" />
            {connectedCount > 1 ? `${connectedCount} connected` : "Connected"}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="px-4 pb-3 text-[12.5px] leading-[1.65] text-[#6B7280]">{def.description}</p>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
        <Link
          href={`/connections?filter=${def.id}` as Route}
          className="text-[12px] font-medium text-[#4B5563] hover:text-[#0B0D0F]"
        >
          {isConnected ? "Manage" : "View tools"}
        </Link>
        <Link
          href={def.newConnectionHref}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold transition-colors",
            isConnected
              ? "border border-[#E0E3E6] bg-white text-[#4B5563] hover:border-[#C9CED4] hover:text-[#0B0D0F]"
              : "bg-[#0B0D0F] text-white hover:bg-[#1c1f22]",
          )}
        >
          <Plus className="h-3 w-3" />
          {isConnected ? "Add account" : "Connect"}
        </Link>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingConns, setLoadingConns] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<IntegrationCategory>("all");

  // Load real user connections to overlay "connected" state on the catalog
  useEffect(() => {
    setLoadingConns(true);
    getConnections({})
      .then(setConnections)
      .catch(() => toast.error("Could not load connection status."))
      .finally(() => setLoadingConns(false));
  }, []);

  // Build a provider→count map from real connections
  const connectedProviders = new Map<string, number>();
  for (const c of connections) {
    if (c.status === "connected") {
      const key = c.provider.toLowerCase();
      connectedProviders.set(key, (connectedProviders.get(key) ?? 0) + 1);
    }
  }

  function connectedCount(def: IntegrationDef): number {
    return def.providerKeys.reduce((sum, k) => sum + (connectedProviders.get(k) ?? 0), 0);
  }

  const filtered = INTEGRATIONS.filter((def) => {
    if (category !== "all" && def.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return def.name.toLowerCase().includes(q) || def.description.toLowerCase().includes(q) || def.category.includes(q);
    }
    return true;
  });

  const connectedTotal = INTEGRATIONS.reduce((n, d) => n + (connectedCount(d) > 0 ? 1 : 0), 0);

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Build</span>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.03em] text-[#0B0D0F]">Integrations</h1>
          <p className="mt-1 text-[13.5px] text-[#6B7280]">
            Apps and services you can connect to use in workflows, agents, and tools.
            {!loadingConns && connectedTotal > 0 && (
              <> <span className="font-semibold text-[#007F4E]">{connectedTotal} connected.</span></>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={"/connections" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[13px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F5]"
          >
            Manage connections
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          containerClassName="w-[260px] max-w-full"
          placeholder="Search integrations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterTabs options={CATEGORY_FILTERS} value={category} onChange={(v) => setCategory(v as IntegrationCategory)} />
      </div>

      {/* Catalog grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#E0E3E6] py-16 text-center">
          <Globe className="h-8 w-8 text-[#C9CED4]" />
          <p className="text-[14px] font-semibold text-[#4B5563]">No integrations match your search</p>
          <p className="max-w-[36ch] text-[13px] text-[#9CA3AF]">
            Try a different keyword or category, or connect a custom HTTP API.
          </p>
          <Link href="/connections/new" className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]">
            <Plus className="h-3.5 w-3.5" /> Add custom connection
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((def) => (
            <IntegrationCard key={def.id} def={def} connectedCount={loadingConns ? 0 : connectedCount(def)} />
          ))}
        </div>
      )}

      {/* Custom integration callout */}
      <div className="rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#E0E3E6] bg-white text-[18px]">
            {}
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-[#0B0D0F]">Don&apos;t see your app?</p>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[#6B7280]">
              Use the <strong>HTTP API</strong> integration to connect any service with a REST or GraphQL API.
              You can also add an <strong>MCP server</strong> connection to expose any MCP-compatible tool catalog.
            </p>
          </div>
          <Link
            href={"/connections/new" as never}
            className="shrink-0 inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[13px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F5]"
          >
            <Plus className="h-3.5 w-3.5" /> Custom connection
          </Link>
        </div>
      </div>
    </div>
  );
}
