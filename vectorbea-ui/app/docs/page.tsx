import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Cloud, Cpu, GitBranch, Shield, Zap } from "lucide-react";

export const metadata = {
  title: "Introduction — VectorBea Docs",
};

export default function DocsIntroPage() {
  return (
    <article className="mx-auto max-w-[65ch] space-y-12 py-4 lg:py-8">

      {/* Hero */}
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Introduction
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Prompt infrastructure for production AI
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          VectorBea gives teams centralized governance over their prompts while
          keeping model execution local — inside the customer environment,
          close to private data and internal networks.
        </p>
      </section>

      {/* What you get */}
      <section className="space-y-5">
        <h2 className="text-2xl font-semibold tracking-tight border-t border-border/60 pt-8">
          What VectorBea gives you
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: Cloud,
              title: "Cloud control plane",
              body: "Define prompts, versions, publication state, access controls, and org-wide governance from one place.",
            },
            {
              icon: Cpu,
              title: "Local Kotlin proxy",
              body: "Sits next to your agent runtime, resolves the latest approved rules, and enforces them before traffic hits the model provider.",
            },
            {
              icon: Shield,
              title: "Enterprise governance",
              body: "Role-based access control, project isolation, row-level security, and per-seat administration built in.",
            },
            {
              icon: GitBranch,
              title: "Versioned prompt registry",
              body: "Every prompt change is tracked, reviewable, and publishable — no more hot-patching strings in production services.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border/60 bg-card/60 p-5 space-y-2"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <p className="font-semibold text-sm">{title}</p>
              <p className="text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why teams adopt it */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight border-t border-border/60 pt-8">
          Why teams adopt it
        </h2>
        <p className="text-muted-foreground leading-7">
          Most AI teams hit the same failure mode: prompts start as local
          strings in notebooks, then gradually become production infrastructure
          without version control, ownership boundaries, or rollout discipline.
          VectorBea turns those prompts into governed assets.
        </p>
        <ul className="space-y-3 pl-5">
          {[
            "Move prompt definitions out of application code and into a managed registry.",
            "Publish changes intentionally instead of letting developers hot-patch prompt text directly in runtime services.",
            "Keep agents and proxy execution inside the customer environment, close to private data and internal networks.",
            "Separate day-to-day development concerns from enterprise governance and access control.",
          ].map((item) => (
            <li key={item} className="text-muted-foreground leading-7 relative pl-2">
              <span className="absolute left-[-12px] top-[11px] h-1.5 w-1.5 rounded-full bg-primary/60" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Platform model */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight border-t border-border/60 pt-8">
          Platform model
        </h2>
        <p className="text-muted-foreground leading-7">
          The platform is easiest to understand as two cooperating layers:
        </p>

        <div className="overflow-hidden rounded-2xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Layer</th>
                <th className="px-5 py-3 text-left font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/60">
                <td className="px-5 py-4 font-medium align-top whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <Cloud className="h-3.5 w-3.5 text-primary" />
                    Control Plane
                  </span>
                </td>
                <td className="px-5 py-4 text-muted-foreground leading-6">
                  Stores organizations, workspaces, prompts, RBAC state,
                  publication metadata, audit records, and billing/seat
                  information.
                </td>
              </tr>
              <tr className="border-t border-border/60">
                <td className="px-5 py-4 font-medium align-top whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    Data Plane
                  </span>
                </td>
                <td className="px-5 py-4 text-muted-foreground leading-6">
                  Runs the VectorBea proxy near the customer workload, serves
                  prompt rules locally, and mediates prompt execution close to
                  the agent.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-3">
          <p className="text-sm font-semibold">That split is the foundation of the rest of the product:</p>
          <ul className="space-y-2">
            {[
              ["The cloud decides", "what should run."],
              ["The local proxy decides", "how the local agent receives and applies those rules."],
              ["The customer environment", "is where execution happens."],
            ].map(([strong, rest]) => (
              <li key={strong} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <span><span className="font-semibold text-foreground">{strong}</span> {rest}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Read next */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight border-t border-border/60 pt-8">
          Read next
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { href: "/docs/quickstart" as Route, label: "Quickstart", desc: "Run the proxy with Docker" },
            { href: "/docs/architecture" as Route, label: "Architecture", desc: "Control-plane vs. data-plane" },
            { href: "/docs/enterprise" as Route, label: "Enterprise", desc: "RBAC, isolation, and billing" },
          ].map(({ href, label, desc }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center justify-between rounded-xl border border-border/60 bg-card/60 px-4 py-3.5 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <div>
                <p className="font-medium">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
