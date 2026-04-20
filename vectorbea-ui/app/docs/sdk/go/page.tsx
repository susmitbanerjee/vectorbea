import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";

import { Callout, Code, InlineCode } from "@/components/docs/prose";

export const metadata = {
  title: "Go SDK — VectorBea Docs",
};

export default function GoSdkPage() {
  return (
    <article className="mx-auto max-w-[68ch] space-y-6 py-4 lg:py-8">

      {/* Hero */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#00ADD8" }} />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Go SDK
          </p>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          VectorBea for Go
        </h1>
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            The native Go SDK is on the roadmap. Subscribe to release notes at{" "}
            <a
              href="https://vectorbea.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              vectorbea.com
            </a>{" "}
            to be notified when it ships.
          </span>
        </div>
      </section>

      {/* id="overview" for TOC anchor */}
      <section id="overview" className="space-y-4 scroll-mt-24 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">
          Use the REST API in the meantime
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">
          The sidecar exposes a plain HTTP API — you can call it from Go today
          using the standard <InlineCode>net/http</InlineCode> package.
        </p>
        <Code lang="go">{`package main

import (
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "strings"
)

type Prompt struct {
    Name         string \`json:"name"\`
    VersionTag   string \`json:"version_tag"\`
    TemplateText string \`json:"template_text"\`
}

func main() {
    resp, err := http.Get("http://localhost:8080/v1/prompts/greet-user")
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    var prompt Prompt
    json.Unmarshal(body, &prompt)

    fmt.Println("Name:    ", prompt.Name)
    fmt.Println("Version: ", prompt.VersionTag)
    fmt.Println("Template:", prompt.TemplateText)
}`}</Code>
        <Callout kind="info">
          The sidecar REST endpoint accepts a{" "}
          <InlineCode>X-Api-Key</InlineCode> header (your sidecar token) and
          returns JSON. Full REST reference docs are available in the
          Architecture guide.
        </Callout>
      </section>

      {/* Next steps */}
      <section className="space-y-4 border-t border-border/60 pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Other SDKs</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { href: "/docs/sdk/python",   label: "Python SDK",  desc: "Available now" },
            { href: "/docs/sdk/nodejs",   label: "Node.js SDK", desc: "Available now" },
            { href: "/docs/sdk/java",     label: "Java SDK",    desc: "Available now" },
            { href: "/docs/sdk/kotlin",   label: "Kotlin SDK",  desc: "Available now" },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href as Route}
              className="group flex flex-col gap-1 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="text-sm font-semibold text-foreground group-hover:text-primary">
                {c.label} <ArrowRight className="inline h-3.5 w-3.5" />
              </span>
              <span className="text-xs text-muted-foreground">{c.desc}</span>
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
