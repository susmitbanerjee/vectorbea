import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Cloud, Container, GitBranch, Lock, Zap } from "lucide-react";

export const metadata = {
  title: "Introduction — VectorBea Docs",
};

export default function DocsIntroPage() {
  return (
    <article className="mx-auto max-w-[65ch] space-y-12 py-4 lg:py-8">
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Introduction
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          The Enterprise AI Infrastructure Platform.{" "}
          <span className="text-muted-foreground">
            Manage, evaluate, and deliver prompts at the edge with zero latency.
          </span>
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Run the VectorBea Sidecar in your VPC to separate AI behavior from
          your codebase without compromising data privacy. The cloud UI is the
          control plane for governance, while execution stays inside your own
          environment.
        </p>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Who these docs are for
          </p>
          <p className="text-sm leading-7 text-muted-foreground">
            These docs are written for an engineer integrating VectorBea into an
            existing application. You do not need this repository checked out.
            The standard path is:
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
            <li>Create a workspace and API key in the VectorBea dashboard.</li>
            <li>Create and publish a prompt.</li>
            <li>Register a sidecar and copy its token.</li>
            <li>
              Pull the docker image and run the sidecar next to your service.
            </li>
            <li>
              Call the sidecar from your Python, Node.js, or any HTTP client.
            </li>
          </ol>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="border-t border-border/60 pt-8 text-2xl font-semibold tracking-tight">
          What VectorBea gives you
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: Cloud,
              title: "Cloud control plane",
              body: "Manage prompts, publication state, access controls, and usage visibility from a single hosted surface. No prompt data is stored here.",
            },
            {
              icon: Container,
              title: "Docker-native sidecar",
              body: "Pull one image, run it next to your service, and expose a stable local API. Prompts and settings sync from the control plane automatically.",
            },
            {
              icon: Lock,
              title: "Zero data residency",
              body: "VectorBea Cloud stores no inference data, no prompt content, and no secrets. Everything that matters to your business stays in your environment.",
            },
            {
              icon: GitBranch,
              title: "Versioned prompt registry",
              body: "Draft, review, and publish prompt versions with the same rigour as source control. Roll back any version with one click.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="space-y-2 rounded-2xl border border-border/60 bg-card/60 p-5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-t border-border/60 pt-8 text-2xl font-semibold tracking-tight">
          How teams integrate it
        </h2>
        <p className="leading-7 text-muted-foreground">
          VectorBea fits around an existing codebase. You do not rebuild your
          application around it — you add a sidecar and replace hardcoded prompt
          strings with local API calls. The typical rollout looks like this:
        </p>
        <ul className="space-y-3 pl-5">
          {[
            "Create prompts in the dashboard and publish the versions you want active.",
            "Run the sidecar locally first so you can validate prompt resolution quickly.",
            "Point your application at the sidecar — it exposes a stable REST endpoint at localhost:8080.",
            "Send execution traces back through the sidecar so the dashboard shows latency and audit data.",
            "In production, deploy the same docker image as a sidecar container alongside your service.",
          ].map((item) => (
            <li
              key={item}
              className="relative pl-2 leading-7 text-muted-foreground"
            >
              <span className="absolute left-[-12px] top-[11px] h-1.5 w-1.5 rounded-full bg-primary/60" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-6">
        <h2 className="border-t border-border/60 pt-8 text-2xl font-semibold tracking-tight">
          Platform model
        </h2>
        <p className="leading-7 text-muted-foreground">
          The platform is two cooperating layers with a clean boundary between
          them:
        </p>

        <div className="overflow-hidden rounded-2xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Layer</th>
                <th className="px-5 py-3 text-left font-semibold">What it manages</th>
                <th className="px-5 py-3 text-left font-semibold">Where it runs</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/60">
                <td className="whitespace-nowrap px-5 py-4 align-top font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Cloud className="h-3.5 w-3.5 text-primary" />
                    Control plane
                  </span>
                </td>
                <td className="px-5 py-4 leading-6 text-muted-foreground">
                  Workspaces, prompts, RBAC, publication metadata, audit records, billing
                </td>
                <td className="px-5 py-4 leading-6 text-muted-foreground">
                  VectorBea Cloud
                </td>
              </tr>
              <tr className="border-t border-border/60">
                <td className="whitespace-nowrap px-5 py-4 align-top font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    Data plane
                  </span>
                </td>
                <td className="px-5 py-4 leading-6 text-muted-foreground">
                  Inference calls, prompt resolution, audit events, secrets
                </td>
                <td className="px-5 py-4 leading-6 text-muted-foreground">
                  Your infrastructure
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-sm font-semibold">
            The practical split in one sentence each:
          </p>
          <ul className="space-y-2">
            {[
              ["The cloud decides", "which prompt versions and access policies are active."],
              ["The sidecar decides", "what your application receives at runtime."],
              ["Your application keeps control", "of the actual model call and all business logic."],
            ].map(([strong, rest]) => (
              <li
                key={strong}
                className="flex gap-2 text-sm leading-6 text-muted-foreground"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <span>
                  <span className="font-semibold text-foreground">{strong}</span>{" "}
                  {rest}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-t border-border/60 pt-8 text-2xl font-semibold tracking-tight">
          Read next
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              href: "/docs/quickstart" as Route,
              label: "Quickstart",
              desc: "Pull the sidecar and fetch your first prompt in 15 minutes",
            },
            {
              href: "/docs/architecture" as Route,
              label: "Architecture",
              desc: "Control plane vs. data plane, network boundaries, and the sidecar model",
            },
            {
              href: "/docs/enterprise" as Route,
              label: "Enterprise",
              desc: "RBAC, workspace isolation, and per-seat billing",
            },
          ].map(({ href, label, desc }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center justify-between rounded-xl border border-border/60 bg-card/60 px-4 py-3.5 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <div>
                <p className="font-medium">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
