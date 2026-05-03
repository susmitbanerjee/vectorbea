"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Layers, Tag } from "lucide-react";

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

export default function ClassificationIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const sdkExample = `import vectorbea

vectorbea.init(ingest_token="<YOUR_TOKEN>", workspace_id="${workspaceId || "<WORKSPACE_ID>"}")

@vectorbea.trace(capability_name="content-classifier")
def classify(text: str) -> dict:
    result = my_classifier.predict(text)

    # Record classification as a step
    with vectorbea.current_run().step("classification", step_name="content-safety") as step:
        step.set_output({
            "label": result["label"],
            "confidence": result["score"],
            "allowed_labels": ["safe", "review", "blocked"],
            "threshold": 0.8,
        })

    return result`;

  const otelExample = `span.set_attribute("vectorbea.step_type", "classification")
span.set_attribute("classification.label", "safe")
span.set_attribute("classification.confidence", 0.97)
span.set_attribute("classification.system", "my-safety-classifier")
span.set_attribute("classification.threshold", 0.8)`;

  const policyChecks = [
    { check: "Label allowed", desc: "Output label must be in the allowed labels list" },
    { check: "Confidence threshold", desc: "Classification confidence must exceed configured minimum" },
    { check: "Blocking label audit", desc: "Every 'blocked' label is recorded as a governance event" },
    { check: "Coverage continuity", desc: "Classification evidence must be present for each governed agent run" },
  ];

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Classification System Integration"
        subtitle="Capture content classification evidence for policy enforcement"
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Tag className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">Classification as governance evidence</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Content classifiers (safety, toxicity, PII, topic) are a key governance control for AI systems.
                  VectorBea captures each classification call — label, confidence, threshold — as a governance
                  step. Policy checks can require classifications to pass before a run is considered compliant.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Label auditing</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Confidence tracking</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Policy checks</span>
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
