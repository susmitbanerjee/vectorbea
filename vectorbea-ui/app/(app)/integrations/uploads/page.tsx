"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { useWorkspace } from "@/lib/workspace-context";

type UploadMode = "file" | "json";

export default function UploadsIntegrationPage() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";

  const [mode, setMode] = useState<UploadMode>("file");
  const [systems, setSystems] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSystem, setSelectedSystem] = useState<string>("");
  const [evidenceType, setEvidenceType] = useState("manual_evidence");
  const [status, setStatus] = useState<"passed" | "failed" | "needs_review">("needs_review");
  const [file, setFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ eventId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/capabilities?workspaceId=${workspaceId}&limit=100`)
      .then((r) => r.json())
      .then((d: { capabilities?: Array<{ id: string; name: string }> }) => setSystems(d.capabilities ?? []))
      .catch(() => null);
  }, [workspaceId]);

  function validateJson(text: string) {
    if (!text.trim()) { setJsonError(null); return; }
    try { JSON.parse(text); setJsonError(null); }
    catch (e) { setJsonError(`Invalid JSON: ${(e as Error).message}`); }
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const url = `/api/integrations/upload?workspaceId=${workspaceId}`;
      let res: Response;
      if (mode === "file" && file) {
        const fd = new FormData();
        fd.append("file", file);
        if (selectedSystem) fd.append("ai_system_id", selectedSystem);
        fd.append("evidence_type", evidenceType);
        fd.append("status", status);
        res = await fetch(url, { method: "POST", body: fd });
      } else {
        const content = jsonText.trim() ? JSON.parse(jsonText) : {};
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ai_system_id: selectedSystem || null,
            evidence_type: evidenceType,
            status,
            content,
          }),
        });
      }
      const d = await res.json() as { eventId?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Upload failed");
      setResult({ eventId: d.eventId! });
      setFile(null);
      setJsonText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = (mode === "file" ? !!file : (!!jsonText.trim() && !jsonError)) && !submitting;

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader
        title="Manual Evidence Upload"
        subtitle="Upload evidence files or JSON payloads directly into the governance pipeline"
      />

      <div className="mx-auto max-w-3xl space-y-6 p-6">

        {/* What it does */}
        <Card className="border-[#E7DED1] bg-white">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <FileUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-[#111111]">Manual evidence collection</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Upload evaluation reports, audit documents, test results, or any structured evidence
                  for an AI system. Evidence is queued as <strong>needs_review</strong> until a reviewer
                  confirms it. Use this for one-off uploads, vendor reports, or human evaluation results.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload form */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">Upload evidence</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-5">

            {/* Mode toggle */}
            <div className="flex gap-1 rounded-lg border border-[#E7DED1] bg-[#F8F5EF] p-1 w-fit">
              {(["file", "json"] as UploadMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    mode === m ? "bg-white shadow-sm text-[#111111]" : "text-gray-500 hover:text-[#111111]"
                  }`}
                >
                  {m === "file" ? "File upload" : "JSON editor"}
                </button>
              ))}
            </div>

            {/* AI system */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">AI system <span className="text-gray-400 font-normal">(optional)</span></label>
              <Select value={selectedSystem} onChange={(e) => setSelectedSystem(e.target.value)} className="border-[#E7DED1] bg-white">
                <option value="">No system (unassigned)</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>

            {/* Evidence type */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Evidence type</label>
              <Select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} className="border-[#E7DED1] bg-white">
                <option value="manual_evidence">Manual evidence</option>
                <option value="evaluation_report">Evaluation report</option>
                <option value="audit_document">Audit document</option>
                <option value="performance_test">Performance test</option>
                <option value="bias_assessment">Bias assessment</option>
                <option value="security_scan">Security scan</option>
                <option value="human_evaluation">Human evaluation</option>
                <option value="vendor_report">Vendor report</option>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Initial status</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="border-[#E7DED1] bg-white">
                <option value="needs_review">Needs review</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
              </Select>
            </div>

            {/* File drop zone */}
            {mode === "file" && (
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) setFile(f);
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#E7DED1] bg-[#F8F5EF] p-8 text-center hover:border-blue-300 transition-colors"
              >
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".json,.txt,.csv,.pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
                />
                {file ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="text-sm font-medium text-[#111111]">{file.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-gray-400 hover:text-gray-700">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-gray-400 mb-2" />
                    <p className="text-sm font-medium text-gray-700">Click to upload or drag and drop</p>
                    <p className="text-xs text-gray-500 mt-1">JSON, TXT, CSV, or PDF</p>
                  </>
                )}
              </div>
            )}

            {/* JSON editor */}
            {mode === "json" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">JSON payload</label>
                <textarea
                  className="w-full h-48 rounded-lg border border-[#E7DED1] bg-white px-3 py-2 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder='{"result": "passed", "score": 0.92, "notes": "…"}'
                  value={jsonText}
                  onChange={(e) => { setJsonText(e.target.value); validateJson(e.target.value); }}
                />
                {jsonError && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />{jsonError}
                  </p>
                )}
              </div>
            )}

            {/* Error/success */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}
            {result && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                Evidence uploaded — event ID <code className="font-mono text-xs">{result.eventId}</code>. Status: <Badge className="bg-amber-100 text-amber-800 ml-1">Needs review</Badge>
              </div>
            )}

            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="bg-[#111111] text-white hover:bg-black gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload evidence
            </Button>
          </CardContent>
        </Card>

        {/* Tips */}
        <Card className="border-[#E7DED1] bg-white">
          <CardHeader className="border-b border-[#E7DED1] pb-4">
            <CardTitle className="text-base font-semibold">When to use manual uploads</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <ul className="space-y-2 text-sm text-gray-600">
              {[
                "Third-party audit reports or vendor compliance certifications",
                "Human evaluation scores from red-team exercises",
                "One-off bias assessments or fairness evaluations",
                "Offline benchmark results that can't be reported via CI",
                "Security scans run outside your normal pipeline",
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
