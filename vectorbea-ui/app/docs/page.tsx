import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Cloud, Cpu, GitBranch, Shield, Zap } from "lucide-react";

export const metadata = {
  title: "Introduction - VectorBea Docs",
};

export default function DocsIntroPage() {
  return (
    <article className="mx-auto max-w-[65ch] space-y-12 py-4 lg:py-8">
      <section className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Introduction
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Govern prompts centrally. Run your application locally.
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          VectorBea gives you a hosted control plane for prompts, publishing,
          RBAC, and audit visibility, plus a local proxy you can run inside
          your own environment. Your code keeps talking to a local endpoint
          while prompt operations move into a managed system.
        </p>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Who These Docs Are For
          </p>
          <p className="text-sm leading-7 text-muted-foreground">
            These docs are written for an engineer integrating VectorBea into an
            existing application. You do not need this repository checked out.
            The normal path is:
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
            <li>Create a workspace and API key in the VectorBea dashboard.</li>
            <li>Pull the published proxy image from GitHub Container Registry.</li>
            <li>Run that proxy next to your own Python, Node.js, or JVM service.</li>
            <li>Call the local proxy from your application code.</li>
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
              body: "Manage prompts, publication state, access controls, and usage visibility from a single hosted surface.",
            },
            {
              icon: Cpu,
              title: "Local Kotlin proxy",
              body: "Run a lightweight Docker container in your environment and expose a stable local API to your application.",
            },
            {
              icon: Shield,
              title: "Enterprise governance",
              body: "Keep prompt ownership, project isolation, and billing controls out of ad hoc application code.",
            },
            {
              icon: GitBranch,
              title: "Versioned prompt registry",
              body: "Publish approved prompt versions intentionally instead of hot-patching strings across services.",
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
          How teams usually integrate it
        </h2>
        <p className="leading-7 text-muted-foreground">
          VectorBea is designed to fit around an existing codebase. The usual
          rollout is not &quot;fork our repo and build our app.&quot; It is:
        </p>
        <ul className="space-y-3 pl-5">
          {[
            "Create prompts and publish versions in the VectorBea dashboard.",
            "Run the VectorBea proxy image from GitHub Container Registry in Docker or Kubernetes.",
            "Point your application at the local proxy instead of embedding prompt text directly in code.",
            "Send execution traces back through the proxy so the dashboard can show audit and latency data.",
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
                <td className="whitespace-nowrap px-5 py-4 align-top font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Cloud className="h-3.5 w-3.5 text-primary" />
                    Control Plane
                  </span>
                </td>
                <td className="px-5 py-4 leading-6 text-muted-foreground">
                  Stores organizations, workspaces, prompts, RBAC state,
                  publication metadata, audit records, and billing information.
                </td>
              </tr>
              <tr className="border-t border-border/60">
                <td className="whitespace-nowrap px-5 py-4 align-top font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    Data Plane
                  </span>
                </td>
                <td className="px-5 py-4 leading-6 text-muted-foreground">
                  Runs the VectorBea proxy near the customer workload and gives
                  your own service a stable local API to call.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-sm font-semibold">
            The practical split looks like this:
          </p>
          <ul className="space-y-2">
            {[
              ["The cloud decides", "what prompt versions and policies are active."],
              ["The local proxy decides", "what your application receives at runtime."],
              ["Your application stays in control", "of the actual model call and business logic."],
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
              desc: "Pull the GHCR image and test it from your own app",
            },
            {
              href: "/docs/architecture" as Route,
              label: "Architecture",
              desc: "Control-plane vs. data-plane and network boundaries",
            },
            {
              href: "/docs/enterprise" as Route,
              label: "Enterprise",
              desc: "RBAC, isolation, and billing",
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
