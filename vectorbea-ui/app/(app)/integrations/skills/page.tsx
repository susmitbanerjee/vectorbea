"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Zap } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/lib/workspace-context";

function CodeBlock({ code, language = "python" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-lg border border-[#E7DED1] bg-[#1a1a1a] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-xs text-gray-400">{language}</span>
        <button onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <Copy className="h-3 w-3" />{copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-gray-200 leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

export default function SkillsIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const sdkExample = `import vectorbea

vectorbea.init(ingest_token="<YOUR_TOKEN>", workspace_id="${workspaceId || "<WORKSPACE_ID>"}")

@vectorbea.trace(capability_name="multi-skill-agent")
def run_agent(user_input: str) -> str:
    # Skills are captured as individual steps in the run
    with vectorbea.current_run().step("tool_call", step_name="search", tool_name="web_search") as step:
        results = web_search(user_input)
        step.set_output({"result_count": len(results)})

    with vectorbea.current_run().step("tool_call", step_name="summarize", tool_name="text_summary") as step:
        summary = summarize(results)
        step.set_output({"summary_length": len(summary)})

    with vectorbea.current_run().step("llm_call", model="gpt-4o", provider="openai") as step:
        response = generate_response(user_input, summary)
        step.set_tokens(input=response.usage.prompt_tokens, output=response.usage.completion_tokens)

    return response.choices[0].message.content`;

  const otelExample = `# Tag each skill invocation as a tool_call step
span.set_attribute("vectorbea.step_type", "tool_call")
span.set_attribute("tool.name", "web_search")
span.set_attribute("tool.arguments", '{"query": "…"}')
span.set_attribute("tool.result_summary", "Found 10 results")`;

  const policyChecks = [
    { check: "Allowed tool list", desc: "Agent may only invoke tools in its registered allowed list" },
    { check: "Tool call sequence", desc: "Tools must be called in the approved sequence for regulated workflows" },
    { check: "Tool call frequency", desc: "Track how often each skill is invoked across runs" },
    { check: "Failed tool calls", desc: "Tool failures are flagged as incidents if they exceed the error threshold" },
  ];

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Skill Runtime Integration"
        subtitle="Capture skill and tool invocation evidence for multi-step agent governance"
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Zap className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">Skill runtime governance</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Multi-skill agents invoke tools, APIs, and sub-models in sequences that can be difficult to
                  govern. VectorBea captures each skill invocation as a named step — tool name, arguments,
                  result, latency — creating a full audit trail. Policy checks can enforce allowed tool lists,
                  call sequences, and failure thresholds.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Per-skill tracing</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Allowed tool policy</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Sequence enforcement</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">SDK instrumentation</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <CodeBlock code={sdkExample} language="python" />
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">OpenTelemetry attributes</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <CodeBlock code={otelExample} language="python" />
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Governance policy checks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[#E7DED1]">
              {policyChecks.map((c) => (
                <div key={c.check} className="flex items-start gap-3 px-6 py-4">
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-[#111111]">{c.check}</p>
                    <p className="text-xs text-gray-500">{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
