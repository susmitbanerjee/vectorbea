"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Database,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export default function RagIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const [traces, setTraces] = useState<Array<{ id: string; created_at: string; outcome_status: string | null; metadata: Record<string, unknown> | null }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/workflow-traces?workspaceId=${workspaceId}&hasRag=true&limit=10`)
      .then(r => r.ok ? r.json() : { traces: [] })
      .then((d: { traces?: typeof traces }) => setTraces(d.traces ?? []))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const sdkExample = `import vectorbea

vectorbea.init(ingest_token="<YOUR_TOKEN>", workspace_id="${workspaceId || "<WORKSPACE_ID>"}")

@vectorbea.trace(capability_name="rag-pipeline")
def run_rag(query: str) -> str:
    with vectorbea.current_run().step("retrieval", step_name="vector-search") as step:
        docs = vector_store.similarity_search(query, k=5)
        step.set_output({
            "retrieved_count": len(docs),
            "source_ids": [d.metadata["id"] for d in docs],
        })

    with vectorbea.current_run().step("llm_call", model="gpt-4o", provider="openai") as step:
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Answer using the provided context."},
                {"role": "user", "content": f"Context: {docs}\\n\\nQuestion: {query}"},
            ],
        )
        step.set_tokens(
            input=response.usage.prompt_tokens,
            output=response.usage.completion_tokens,
        )
        return response.choices[0].message.content`;

  const otelExample = `# Tag retrieval spans with:
span.set_attribute("vectorbea.step_type", "retrieval")
span.set_attribute("rag.vector_store", "pinecone")
span.set_attribute("rag.retrieved_count", 5)
span.set_attribute("rag.query_embedding_model", "text-embedding-3-small")`;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="RAG Pipeline Integration"
        subtitle="Capture retrieval and grounding evidence from RAG pipelines"
        actions={
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetch(`/api/workflow-traces?workspaceId=${workspaceId}&hasRag=true&limit=10`).then(r => r.json()).then((d: { traces?: typeof traces }) => setTraces(d.traces ?? [])).finally(() => setLoading(false)); }} className="gap-2 border-[#E7DED1]">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-6 p-6">

        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Database className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">RAG retrieval as governance evidence</h3>
                <p className="mt-1 text-sm text-gray-600">
                  VectorBea captures each retrieval step in your RAG pipeline — what was retrieved, from which
                  vector store, how many documents, and the resulting LLM call. This creates a grounding
                  audit trail: every answer can be traced back to the source documents used.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Retrieval step tracing</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Source document audit trail</span>
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600" /> Grounding policy checks</span>
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
            <CardTitle className="text-base font-semibold">OpenTelemetry attribute mapping</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <CodeBlock code={otelExample} language="python" />
          </CardContent>
        </Card>

        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Recent RAG traces</CardTitle>
          </CardHeader>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          ) : traces.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Database className="h-8 w-8 text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">No RAG traces received yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E7DED1]">
              {traces.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <p className="text-sm font-medium text-[#111111]">{(t.metadata?.serviceName as string) ?? "RAG run"}</p>
                    <p className="text-xs text-gray-500">{new Date(t.created_at).toLocaleString()}</p>
                  </div>
                  {t.outcome_status && (
                    <Badge className={t.outcome_status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                      {t.outcome_status}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
