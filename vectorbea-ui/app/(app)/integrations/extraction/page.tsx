"use client";

import { useState } from "react";
import { CheckCircle2, Copy, FileSearch } from "lucide-react";

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

export default function ExtractionIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const sdkExample = `import vectorbea

vectorbea.init(ingest_token="<YOUR_TOKEN>", workspace_id="${workspaceId || "<WORKSPACE_ID>"}")

@vectorbea.trace(capability_name="data-extractor")
def extract(document: str) -> dict:
    result = llm_extract(document)

    with vectorbea.current_run().step("extraction", step_name="structured-extraction") as step:
        step.set_output({
            "extracted_fields": list(result.keys()),
            "required_fields": ["name", "date", "amount"],
            "missing_fields": [f for f in ["name", "date", "amount"] if f not in result],
            "schema_valid": all(f in result for f in ["name", "date", "amount"]),
        })

    return result`;

  const otelExample = `span.set_attribute("vectorbea.step_type", "extraction")
span.set_attribute("extraction.schema", "invoice_schema_v2")
span.set_attribute("extraction.field_count", 8)
span.set_attribute("extraction.schema_valid", True)
span.set_attribute("extraction.missing_fields", "[]")`;

  const policyChecks = [
    { check: "Required fields present", desc: "All required schema fields must be extracted" },
    { check: "Schema validation", desc: "Extracted output must conform to the registered schema" },
    { check: "Extraction completeness", desc: "Track the percentage of runs where extraction was complete" },
    { check: "PII field handling", desc: "Fields marked as PII must be handled according to data policy" },
  ];

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Extraction System Integration"
        subtitle="Capture structured extraction evidence for schema compliance and data governance"
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <FileSearch className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">Extraction governance</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Structured extraction systems (invoice parsing, contract review, form filling) have
                  strict schema requirements. VectorBea captures each extraction step — fields extracted,
                  schema validation status, missing required fields — as governance evidence that can
                  trigger policy checks and release gates.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Schema validation</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Field completeness</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> PII policy checks</span>
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
