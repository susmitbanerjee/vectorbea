"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Code2,
  FileText,
  GitMerge,
  Globe,
  Plug,
  Server,
  Workflow,
  Zap,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const INTEGRATIONS = [
  {
    id: "sdk",
    title: "SDK & Ingest Tokens",
    description:
      "Send evaluation evidence directly from your application using the VectorBea SDK or REST API. Generate ingest tokens and view setup instructions.",
    icon: Code2,
    href: "/settings/sdk",
    badge: "Recommended",
    badgeColor: "bg-[#EFF6FF] text-[#1D4ED8]",
  },
  {
    id: "traces",
    title: "Execution Traces",
    description:
      "Browse raw execution traces collected from your AI systems. Traces are evidence inputs — link them to evaluation runs for governance proof.",
    icon: Activity,
    href: "/traces",
    badge: null,
    badgeColor: "",
  },
  {
    id: "workflows",
    title: "Workflow Blueprints",
    description:
      "View and manage workflow execution graphs. Map agentic and RAG workflows to AI systems in the registry for release gate tracking.",
    icon: Workflow,
    href: "/workflows",
    badge: null,
    badgeColor: "",
  },
  {
    id: "otel",
    title: "OpenTelemetry",
    description:
      "Ingest execution spans via OpenTelemetry protocol. Use OTEL exporters from your existing observability stack to feed evidence into VectorBea.",
    icon: Globe,
    href: "/docs/integrations",
    badge: "Docs",
    badgeColor: "bg-muted text-muted-foreground",
  },
  {
    id: "sidecar",
    title: "Sidecar Agent",
    description:
      "Deploy the VectorBea sidecar agent alongside your service. It automatically captures execution evidence without code changes.",
    icon: Server,
    href: "/docs/architecture",
    badge: "Docs",
    badgeColor: "bg-muted text-muted-foreground",
  },
  {
    id: "cicd",
    title: "CI/CD Integration",
    description:
      "Run evidence checks as part of your deployment pipeline. Block releases automatically when governance gates fail.",
    icon: Zap,
    href: "/docs/sdk-and-ingestion",
    badge: "Docs",
    badgeColor: "bg-muted text-muted-foreground",
  },
  {
    id: "direct",
    title: "Direct REST API",
    description:
      "Send evidence payloads directly via the VectorBea REST API. Full control over evidence schema, environment tagging, and metadata.",
    icon: Plug,
    href: "/docs/sdk-and-ingestion",
    badge: "Docs",
    badgeColor: "bg-muted text-muted-foreground",
  },
  {
    id: "api-keys",
    title: "API Keys",
    description:
      "Manage workspace API keys for server-to-server integrations. Use these alongside ingest tokens for authenticated evidence submission.",
    icon: FileText,
    href: "/api-keys",
    badge: null,
    badgeColor: "",
  },
];

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col">
      <AppHeader
        title="Integrations"
        subtitle="Connect your AI systems and collect evaluation evidence from any source"
      />

      <div className="flex-1 space-y-6 p-6">
        {/* Positioning callout */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF]">
              <BookOpen className="h-4.5 w-4.5 text-[#1D4ED8]" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                VectorBea does not replace your observability stack
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Traces, spans, and workflow data collected here become{" "}
                <strong className="font-medium text-foreground">governance evidence</strong> — inputs for
                release gate decisions, policy compliance checks, and audit proof. Connect whichever
                sources your team uses.
              </p>
            </div>
          </div>
        </div>

        {/* Integration cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map(({ id, title, description, icon: Icon, href, badge, badgeColor }) => (
            <Card key={id} className="group flex flex-col transition-shadow hover:shadow-sm">
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  {badge && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeColor}`}>
                      {badge}
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
                </div>
                <Link
                  href={href as any}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-auto w-full")}
                >
                  Open <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
