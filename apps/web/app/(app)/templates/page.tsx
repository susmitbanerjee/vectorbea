"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Bot, Clock, Layers, Plus, Sparkles, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { FilterTabs } from "@/components/ui/page-kit";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";

// ─── Template catalog ─────────────────────────────────────────────────────────
// Static definitions. These link to the workflow new-page or architect flow.
// No fake runtime data is shown here.

type TemplateCategory =
  | "all"
  | "sales"
  | "support"
  | "research"
  | "engineering"
  | "operations"
  | "finance";

type Complexity = "starter" | "intermediate" | "advanced";

type TemplateDef = {
  id: string;
  name: string;
  description: string;
  category: Exclude<TemplateCategory, "all">;
  complexity: Complexity;
  estimatedRuntime: string;
  requiredIntegrations: string[];
  tags: string[];
  /** Architect prompt to pre-fill */
  architectPrompt?: string;
};

const TEMPLATES: TemplateDef[] = [
  {
    id: "investor-reply-triage",
    name: "Investor reply triage",
    description: "Check new investor replies in Gmail, classify interest level with AI, update a Google Sheet, draft follow-ups, and request approval before sending.",
    category: "sales",
    complexity: "intermediate",
    estimatedRuntime: "30–90s",
    requiredIntegrations: ["Gmail", "OpenAI", "Google Sheets"],
    tags: ["gmail", "ai", "approval"],
    architectPrompt: "Every morning, check new investor replies in Gmail, classify interest, update Google Sheets, draft follow-ups, and ask me before sending.",
  },
  {
    id: "gmail-lead-triage",
    name: "Gmail lead triage",
    description: "Monitor your inbox for new leads, classify intent and quality with AI, route high-quality leads to your CRM, and summarize the rest in a daily digest.",
    category: "sales",
    complexity: "intermediate",
    estimatedRuntime: "15–60s",
    requiredIntegrations: ["Gmail", "OpenAI", "HubSpot"],
    tags: ["gmail", "ai", "crm"],
    architectPrompt: "Monitor Gmail for new leads, classify intent with AI, route high-quality ones to HubSpot, and send a daily summary.",
  },
  {
    id: "support-ticket-classifier",
    name: "Support ticket classifier",
    description: "Classify incoming support tickets by type and urgency, route to the right team, and draft an initial reply with AI.",
    category: "support",
    complexity: "starter",
    estimatedRuntime: "5–20s",
    requiredIntegrations: ["Slack", "OpenAI"],
    tags: ["support", "ai", "slack"],
    architectPrompt: "Classify incoming support tickets by urgency, route to the right Slack channel, and draft an initial reply.",
  },
  {
    id: "slack-incident-summarizer",
    name: "Slack incident summarizer",
    description: "When a Slack incident channel becomes active, collect messages, summarize the timeline, extract action items, and post a summary.",
    category: "support",
    complexity: "starter",
    estimatedRuntime: "10–30s",
    requiredIntegrations: ["Slack", "OpenAI"],
    tags: ["slack", "ai", "incident"],
    architectPrompt: "Monitor a Slack incident channel, summarize the timeline, and post an executive summary with action items.",
  },
  {
    id: "daily-research-digest",
    name: "Daily research digest",
    description: "Run a scheduled research sweep on topics you care about, summarize findings with AI, and send a structured digest to Slack or email.",
    category: "research",
    complexity: "starter",
    estimatedRuntime: "60–120s",
    requiredIntegrations: ["OpenAI", "Slack", "Gmail"],
    tags: ["research", "ai", "scheduled"],
    architectPrompt: "Every morning, research my key topics, summarize findings with AI, and send a structured digest to Slack.",
  },
  {
    id: "product-feedback-analyzer",
    name: "Product feedback analyzer",
    description: "Collect product feedback from multiple sources, deduplicate, cluster by theme, score severity, and produce a weekly insights report.",
    category: "research",
    complexity: "advanced",
    estimatedRuntime: "2–5m",
    requiredIntegrations: ["OpenAI", "Google Sheets", "Notion"],
    tags: ["research", "ai", "product"],
    architectPrompt: "Collect product feedback from Notion and Sheets, cluster by theme with AI, and produce a weekly insights report.",
  },
  {
    id: "meeting-notes-to-jira",
    name: "Meeting notes → Jira tickets",
    description: "Take raw meeting notes or a transcript, extract action items and decisions with AI, create Jira tickets with the right fields, and notify assignees.",
    category: "engineering",
    complexity: "starter",
    estimatedRuntime: "10–30s",
    requiredIntegrations: ["OpenAI", "Jira"],
    tags: ["jira", "ai", "productivity"],
    architectPrompt: "Take meeting notes, extract action items with AI, create Jira tickets with proper fields, and notify assignees.",
  },
  {
    id: "travel-price-checker",
    name: "Travel price checker",
    description: "Search flight and hotel prices across routes, compare options, summarize with AI, and ask for approval before booking.",
    category: "operations",
    complexity: "intermediate",
    estimatedRuntime: "30–90s",
    requiredIntegrations: ["OpenAI", "HTTP API"],
    tags: ["travel", "ai", "approval"],
    architectPrompt: "Search flight and hotel prices for my trip, summarize the best options, and ask me before booking.",
  },
  {
    id: "financial-report-generator",
    name: "Financial report generator",
    description: "Pull transaction data from a database, run SQL aggregations, generate a formatted financial report with AI narrative, and email it to stakeholders.",
    category: "finance",
    complexity: "advanced",
    estimatedRuntime: "1–3m",
    requiredIntegrations: ["Postgres", "OpenAI", "Gmail"],
    tags: ["finance", "sql", "email"],
    architectPrompt: "Pull transaction data from Postgres, aggregate by category, write a CFO-level narrative with AI, and email the report.",
  },
];

const CATEGORY_FILTERS = [
  { value: "all",         label: "All" },
  { value: "sales",       label: "Sales" },
  { value: "support",     label: "Support" },
  { value: "research",    label: "Research" },
  { value: "engineering", label: "Engineering" },
  { value: "operations",  label: "Operations" },
  { value: "finance",     label: "Finance" },
];

const COMPLEXITY_META: Record<Complexity, { label: string; color: string; bg: string; border: string }> = {
  starter:      { label: "Starter",      color: "#047857", bg: "#ECFDF5", border: "#9CCFBB" },
  intermediate: { label: "Intermediate", color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
  advanced:     { label: "Advanced",     color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
};

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({ t }: { t: TemplateDef }) {
  const cx = COMPLEXITY_META[t.complexity];
  const architectHref = t.architectPrompt
    ? (`/workflows/new/architect?prompt=${encodeURIComponent(t.architectPrompt)}` as Route)
    : ("/workflows/new/architect" as Route);

  return (
    <div className="group flex flex-col rounded-[12px] border border-[#E0E3E6] bg-white transition-all hover:border-[#C9CED4] hover:shadow-[0_6px_20px_rgba(11,13,15,0.05)]">
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold tracking-[-0.01em] text-[#0B0D0F]">{t.name}</p>
            <span
              className="rounded-full border px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: cx.color, background: cx.bg, borderColor: cx.border }}
            >
              {cx.label}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-[1.65] text-[#6B7280]">{t.description}</p>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#ECEEEF] px-4 py-2.5">
        <span className="flex items-center gap-1 font-mono text-[11px] text-[#9CA3AF]">
          <Clock className="h-3 w-3" /> {t.estimatedRuntime}
        </span>
        <span className="flex items-center gap-1 font-mono text-[11px] text-[#9CA3AF]">
          <Layers className="h-3 w-3" /> {t.requiredIntegrations.join(", ")}
        </span>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
        <Link
          href={"/workflows/new" as Route}
          className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[12px] font-medium text-[#4B5563] transition-colors hover:bg-[#ECEEEF] hover:text-[#0B0D0F]"
        >
          Preview <ArrowRight className="h-3 w-3" />
        </Link>
        <Link
          href={architectHref}
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[#007F4E] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#006B45]"
        >
          <Sparkles className="h-3 w-3" /> Use template
        </Link>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [category, setCategory] = useState<TemplateCategory>("all");

  const filtered = TEMPLATES.filter(
    (t) => category === "all" || t.category === category,
  );

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Build</span>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.03em] text-[#0B0D0F]">Templates</h1>
          <p className="mt-1 text-[13.5px] text-[#6B7280]">Start faster with proven AI workflow patterns — fully customizable.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={"/workflows/new" as Route}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[13px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F5]"
          >
            <Plus className="h-3.5 w-3.5" /> Blank workflow
          </Link>
          <Link
            href={"/workflows/new/architect" as Route}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#007F4E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#006B45]"
          >
            <Sparkles className="h-3.5 w-3.5" /> Describe with AI
          </Link>
        </div>
      </div>

      {/* AI Architect banner */}
      <div
        className="flex flex-col items-start justify-between gap-4 overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB] px-5 py-5 sm:flex-row sm:items-center"
        style={{
          backgroundImage: "radial-gradient(#D2D6DB 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div className="flex items-center gap-3.5">
          <ArchitectLogo size={38} />
          <div>
            <p className="text-[14.5px] font-bold tracking-[-0.01em] text-[#0B0D0F]">Describe your own workflow</p>
            <p className="mt-0.5 text-[12.5px] text-[#6B7280]">
              Don&apos;t see what you need? Describe your goal and the AI Architect builds it for you.
            </p>
          </div>
        </div>
        <Link
          href={"/workflows/new/architect" as Route}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] bg-[#007F4E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#006B45]"
        >
          <Sparkles className="h-3.5 w-3.5" /> Open AI Architect
        </Link>
      </div>

      {/* Category filter */}
      <FilterTabs options={CATEGORY_FILTERS} value={category} onChange={(v) => setCategory(v as TemplateCategory)} />

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-[#E0E3E6] py-16 text-center">
          <Bot className="h-8 w-8 text-[#C9CED4]" />
          <p className="text-[14px] font-semibold text-[#4B5563]">No templates in this category yet</p>
          <p className="text-[13px] text-[#9CA3AF]">Use the AI Architect to build a custom workflow instead.</p>
          <Link href="/workflows/new/architect" className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#007F4E] px-4 text-[13px] font-semibold text-white hover:bg-[#006B45]">
            <Sparkles className="h-3.5 w-3.5" /> Architect with AI
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => <TemplateCard key={t.id} t={t} />)}
        </div>
      )}

      {/* Bottom callout */}
      <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB] px-5 py-4">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-[#CA8A04]" />
          <p className="text-[13px] text-[#4B5563]">
            <span className="font-semibold text-[#0B0D0F]">Want to contribute a template?</span>
            {" "}Share a workflow that your team finds valuable.
          </p>
        </div>
        <a
          href="/docs"
          className="shrink-0 text-[12.5px] font-semibold text-[#007F4E] hover:underline"
          target="_blank"
          rel="noopener"
        >
          Learn more →
        </a>
      </div>
    </div>
  );
}
