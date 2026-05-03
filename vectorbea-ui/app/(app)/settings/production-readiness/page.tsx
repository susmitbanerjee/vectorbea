import Link from "next/link";
import type { Route } from "next";
import {
  BadgeCheck,
  ClipboardCheck,
  FileBarChart2,
  GitMerge,
  KeyRound,
  LockKeyhole,
  Scale,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";

const CHECKS = [
  {
    title: "AI Registry works",
    description: "Create an AI System, create a draft version, and confirm the version belongs to the system.",
    href: "/registry/systems",
    icon: ShieldCheck,
  },
  {
    title: "Policy packs load and apply",
    description: "Apply a policy pack to an AI System and verify required evidence appears.",
    href: "/governance/policy-packs",
    icon: Scale,
  },
  {
    title: "Evidence runs complete",
    description: "Run a required evidence check from the AI System detail page and verify the result is visible.",
    href: "/evidence/runs",
    icon: ClipboardCheck,
  },
  {
    title: "Release gates enforce evidence",
    description: "Evaluate a version gate, confirm missing evidence blocks release, then confirm passing evidence unblocks it.",
    href: "/release-gates",
    icon: GitMerge,
  },
  {
    title: "Approvals work",
    description: "Request approval for a high-risk release and confirm only admins can approve or reject it.",
    href: "/governance/approvals",
    icon: BadgeCheck,
  },
  {
    title: "Audit is complete",
    description: "Confirm create, policy, evidence, gate, approval, activation, and incident events appear in audit.",
    href: "/governance/audit",
    icon: FileBarChart2,
  },
  {
    title: "Incidents work",
    description: "Create an incident, link it to an AI System, resolve it, and verify the audit trail.",
    href: "/incidents",
    icon: TriangleAlert,
  },
  {
    title: "Reports use real data",
    description: "Open governance reports and verify the report is generated from registry, evidence, gate, approval, and audit data.",
    href: "/governance/reports",
    icon: FileBarChart2,
  },
  {
    title: "Permissions are enforced",
    description: "Viewer accounts should be read-only; developers can create systems and run evidence; admins can approve and activate.",
    href: "/settings/members",
    icon: Users,
  },
  {
    title: "Integrations are optional evidence sources",
    description: "Sidecar, SDK, and OpenTelemetry should feed evidence, not block the governance core from working.",
    href: "/settings/sdk",
    icon: KeyRound,
  },
  {
    title: "Privacy controls are configured",
    description: "Redaction and retention settings are visible before production evidence sources are connected.",
    href: "/governance/privacy",
    icon: LockKeyhole,
  },
];

export default function ProductionReadinessPage() {
  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Production Readiness Checklist"
        subtitle="Internal checklist for the enterprise governance MVP"
      />

      <main className="px-4 py-6 md:px-6 xl:px-8">
        <div className="max-w-5xl space-y-5">
          <section className="rounded-xl border border-[#E7DED1] bg-white p-5">
            <p className="text-sm font-semibold text-[#111111]">Production MVP scope</p>
            <p className="mt-1 text-sm leading-6 text-[#4B5563]">
              VectorBea production readiness is centered on AI Registry, Policies, Evaluation Evidence,
              Release Gates, Approvals, Audit, Incidents, Reports, Integrations, and Settings. Experimental
              observability, graph import, cost intelligence, and provider-arena surfaces should stay out of
              the main navigation until they are stable.
            </p>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            {CHECKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.title}
                  href={item.href as Route}
                  className="group rounded-xl border border-[#E7DED1] bg-white p-4 transition-colors hover:border-[#2563EB]/40 hover:bg-[#FBFAF7]"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-[#EFF6FF] p-2">
                      <Icon className="h-4 w-4 text-[#2563EB]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#111111]">{item.title}</p>
                      <p className="mt-1 text-xs leading-5 text-[#6B7280]">{item.description}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </section>
        </div>
      </main>
    </div>
  );
}
