"use client";

import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

type Lang = "python" | "node" | "jvm";

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg border border-[#E7DED1] bg-[#1a1a1a] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-xs text-gray-400">{language}</span>
        <button
          onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-gray-200 leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

export default function SdkIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";
  const host = typeof window !== "undefined" ? window.location.origin : "https://your-vectorbea-instance.com";
  const [lang, setLang] = useState<Lang>("python");

  const pythonInstall = `pip install vectorbea-sdk`;

  const pythonBasic = `import vectorbea

# Initialize once at startup
vectorbea.init(
    ingest_url="${host}/api/ingest/traces",
    ingest_token="<YOUR_INGEST_TOKEN>",
    workspace_id="${workspaceId || "<YOUR_WORKSPACE_ID>"}",
    environment="production",  # optional
)

# ── Option A: decorator (wraps the whole function automatically) ──────────────
@vectorbea.trace(capability_name="my-agent")
def run_agent(user_input: str) -> str:
    # Your existing agent code — unchanged
    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": user_input}],
    )
    return response.choices[0].message.content

# Call it normally — governance is recorded automatically
result = run_agent("What is the capital of France?")

# ── Option B: context manager (explicit control) ──────────────────────────────
user_query = "What is the capital of France?"

with vectorbea.run(capability_name="my-agent", user_input=user_query) as run:
    result = my_agent_logic(user_query)
    run.set_outcome("success", response=result)`;

  const pythonAdvanced = `import vectorbea

with vectorbea.run(
    capability_name="rag-pipeline",
    user_input=query,
    environment="production",
) as run:
    # Record a retrieval step
    with run.step("retrieval", step_name="vector-search") as step:
        docs = vector_store.search(query, top_k=5)
        step.set_output({"retrieved_count": len(docs)})

    # Record an LLM call
    with run.step("llm_call", model="gpt-4o", provider="openai") as step:
        response = openai_client.chat.completions.create(...)
        step.set_tokens(
            input=response.usage.prompt_tokens,
            output=response.usage.completion_tokens,
        )
        step.set_output({"response": response.choices[0].message.content})

    run.set_outcome("success", response=response.choices[0].message.content)`;

  const nodeInstall = `npm install @vectorbea/sdk
# or
yarn add @vectorbea/sdk`;

  const nodeBasic = `import { VectorBea } from "@vectorbea/sdk";

// Initialize once
const vb = new VectorBea({
  ingestUrl: "${host}/api/ingest/traces",
  ingestToken: process.env.VECTORBEA_INGEST_TOKEN,
  workspaceId: "${workspaceId || process.env.VECTORBEA_WORKSPACE_ID}",
  environment: "production",
});

// Decorator-style
const tracedAgent = vb.trace("my-agent", async (input: string) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: input }],
  });
  return response.choices[0].message.content;
});

// Or manual run
const run = await vb.startRun({ capabilityName: "my-agent", userInput });
try {
  const result = await myAgentLogic(userInput);
  await run.complete({ status: "success", response: result });
  return result;
} catch (err) {
  await run.fail({ errorMessage: String(err) });
  throw err;
}`;

  const jvmBasic = `// build.gradle
implementation 'io.vectorbea:vectorbea-sdk:latest'

// Application.java
import io.vectorbea.VectorBea;
import io.vectorbea.Run;

VectorBea vb = VectorBea.builder()
    .ingestUrl("${host}/api/ingest/traces")
    .ingestToken(System.getenv("VECTORBEA_INGEST_TOKEN"))  // or hardcode for local dev
    .workspaceId("${workspaceId || "<YOUR_WORKSPACE_ID>"}")
    .environment("production")
    .build();

// Spring Boot auto-configuration (if using starter)
@VectorBeaTrace(capabilityName = "my-agent")
public String runAgent(String userInput) {
    // Your existing logic
    return callLlm(userInput);
}

// Manual
try (Run run = vb.startRun("my-agent", userInput)) {
    String result = callLlm(userInput);
    run.complete("success", result);
    return result;
} catch (Exception e) {
    run.fail(e.getMessage());
    throw e;
}`;

  const envVars = `# .env / environment variables
VECTORBEA_INGEST_URL=${host}/api/ingest/traces
VECTORBEA_INGEST_TOKEN=<YOUR_INGEST_TOKEN>
VECTORBEA_WORKSPACE_ID=${workspaceId || "<YOUR_WORKSPACE_ID>"}
VECTORBEA_ENVIRONMENT=production

# Optional: batch size and flush interval
VECTORBEA_BATCH_SIZE=50
VECTORBEA_FLUSH_INTERVAL_MS=5000`;

  const TABS: { id: Lang; label: string }[] = [
    { id: "python", label: "Python" },
    { id: "node", label: "Node / TypeScript" },
    { id: "jvm", label: "Java / JVM" },
  ];

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="SDK Integration"
        subtitle="Instrument your AI systems with the VectorBea SDK for native governance evidence"
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        {/* What it does */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Code2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">Richest evidence — minimal code changes</h3>
                <p className="mt-1 text-sm text-gray-600">
                  The VectorBea SDK gives you decorator and context-manager patterns that wrap your
                  existing agent code. Each run is recorded as a full governance trace — inputs,
                  outputs, tool calls, LLM calls, latency, tokens, and outcome status.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Step-level detail</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Async batching</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Zero blocking latency</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Language tabs */}
        <div className="flex gap-1 rounded-lg border border-[#E7DED1] bg-white p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setLang(t.id)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                lang === t.id
                  ? "bg-[#111111] text-white"
                  : "text-gray-600 hover:text-[#111111]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Python */}
        {lang === "python" && (
          <>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="border-b border-[#E7DED1] pb-4">
                <CardTitle className="text-base font-semibold">Install</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <CodeBlock code={pythonInstall} language="bash" />
              </CardContent>
            </Card>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="border-b border-[#E7DED1] pb-4">
                <CardTitle className="text-base font-semibold">Basic instrumentation</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <CodeBlock code={pythonBasic} language="python" />
              </CardContent>
            </Card>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="border-b border-[#E7DED1] pb-4">
                <CardTitle className="text-base font-semibold">Multi-step tracing (RAG, tools)</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <CodeBlock code={pythonAdvanced} language="python" />
              </CardContent>
            </Card>
          </>
        )}

        {/* Node */}
        {lang === "node" && (
          <>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="border-b border-[#E7DED1] pb-4">
                <CardTitle className="text-base font-semibold">Install</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <CodeBlock code={nodeInstall} language="bash" />
              </CardContent>
            </Card>
            <Card className="border-[#E7DED1] bg-white">
              <CardHeader className="border-b border-[#E7DED1] pb-4">
                <CardTitle className="text-base font-semibold">Basic instrumentation</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <CodeBlock code={nodeBasic} language="typescript" />
              </CardContent>
            </Card>
          </>
        )}

        {/* JVM */}
        {lang === "jvm" && (
          <Card className="border-[#E7DED1] bg-white">
            <CardHeader className="border-b border-[#E7DED1] pb-4">
              <CardTitle className="text-base font-semibold">Java / Spring Boot</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <CodeBlock code={jvmBasic} language="java" />
            </CardContent>
          </Card>
        )}

        {/* Environment variables */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Environment variables</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <CodeBlock code={envVars} language="bash" />
          </CardContent>
        </Card>

        {/* Token management link */}
        <div className="flex items-center gap-4 rounded-lg border border-[#E7DED1] bg-white p-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-[#111111]">Manage ingest tokens</p>
            <p className="text-xs text-gray-500">Create, rotate, and revoke SDK tokens in settings.</p>
          </div>
          <a href="/settings/sdk" className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
            SDK settings <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="flex gap-4">
          <a href="https://docs.vectorbea.com/sdk" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <BookOpen className="h-4 w-4" /> SDK reference docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
