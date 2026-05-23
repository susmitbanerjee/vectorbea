import Link from "next/link";
import type { Route } from "next";
import {
  BadgeCheck,
  Bot,
  Clock,
  GitBranch,
  KeyRound,
  Play,
  Server,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";

const CHECKS = [
  {
    title: "Workflows can be created",
    description: "Create a native workflow, add steps, configure retry and budget policies, and confirm it saves correctly.",
    href: "/workflows/new",
    icon: GitBranch,
  },
  {
    title: "Agents are registered",
    description: "Register an agent with a model, instructions, and tool bindings. Verify it appears in the agent registry.",
    href: "/agents",
    icon: Bot,
  },
  {
    title: "Tools are registered",
    description: "Register an HTTP tool, set its risk level, and confirm the input/output schema validates correctly.",
    href: "/tools",
    icon: Wrench,
  },
  {
    title: "Runs execute end-to-end",
    description: "Trigger a workflow run and confirm events appear in the Timeline tab with correct status transitions.",
    href: "/runs",
    icon: Play,
  },
  {
    title: "Approvals gate high-risk steps",
    description: "Configure an approval gate on a tool step and confirm the run pauses and waits before proceeding.",
    href: "/approvals",
    icon: BadgeCheck,
  },
  {
    title: "Schedules trigger correctly",
    description: "Create a cron schedule for a workflow and verify the run is queued at the expected time.",
    href: "/schedules",
    icon: Clock,
  },
  {
    title: "Workers connect and process runs",
    description: "Start a worker process, confirm it connects in the Workers panel, and verify it picks up queued runs.",
    href: "/workers",
    icon: Server,
  },
  {
    title: "Permissions are enforced",
    description: "Viewer accounts should be read-only; developers can create workflows and trigger runs; admins can approve steps.",
    href: "/settings/members",
    icon: Users,
  },
  {
    title: "API keys are provisioned",
    description: "Generate an API key and confirm it can be used to authenticate SDK and API calls.",
    href: "/settings/api-keys",
    icon: KeyRound,
  },
  {
    title: "SDK integration is verified",
    description: "Connect a worker via the SDK, push a run event, and confirm it appears in the run timeline.",
    href: "/settings/sdk",
    icon: ShieldCheck,
  },
];

export default function ProductionReadinessPage() {
  return (
    <div className="min-h-screen">
      <AppHeader
        title="Production Readiness Checklist"
        subtitle="Internal checklist for the agent workflow platform MVP"
      />

      <main className="px-4 py-6 md:px-6 xl:px-8">
        <div className="max-w-5xl space-y-5">
          <section className="rounded-xl border border-border/60 p-5" style={{ background: "var(--surface-1)" }}>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Platform MVP scope</p>
            <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
              Vectorbee production readiness covers Workflows, Agents, Tools, Runs, Approvals, Schedules, Workers,
              and Settings. Experimental surfaces should stay out of the main navigation until stable.
            </p>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            {CHECKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.title}
                  href={item.href as Route}
                  className="group rounded-xl border border-border/60 p-4 transition-colors hover:border-primary/40"
                  style={{ background: "var(--surface-1)" }}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg p-2" style={{ background: "rgba(99,102,241,0.12)" }}>
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{item.title}</p>
                      <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-faint)" }}>{item.description}</p>
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
