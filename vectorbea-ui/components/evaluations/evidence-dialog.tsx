"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { TraceSetEvaluationRunView, TraceEvaluationCheckView } from "@/lib/api";

type Result = TraceSetEvaluationRunView["results"][number];

function pct(v: number | null | undefined) {
  return v == null ? null : Math.round(v * 100);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function TextBlock({ label, value, mono = false }: { label?: string; value?: string | null; mono?: boolean }) {
  const text = value?.trim();
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
          {text && <CopyButton text={text} />}
        </div>
      )}
      <pre className={`max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap ${mono ? "font-mono" : "font-sans"} ${!text ? "text-muted-foreground italic" : "text-foreground/90"}`}>
        {text || "Unavailable"}
      </pre>
    </div>
  );
}

function CheckRow({ check, idx }: { check: TraceEvaluationCheckView; idx: number }) {
  const pass = check.status === "pass";
  const warn = check.status === "warning";
  const Icon = pass ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  const color = pass ? "text-emerald-700" : warn ? "text-amber-700" : "text-red-700";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold capitalize text-foreground">{check.name.replaceAll("_", " ")}</span>
          {check.critical && <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase bg-red-500/20 text-red-400">critical</span>}
          {(check.weight ?? 1) > 1 && <span className="text-muted-foreground">×{check.weight}</span>}
        </div>
        <div className="mt-0.5 text-muted-foreground">{check.reason}</div>
      </div>
      <span className={`shrink-0 font-bold tabular-nums ${color}`}>
        {check.score == null ? "—" : `${Math.round(check.score * 100)}%`}
      </span>
    </div>
  );
}

interface EvidenceDialogProps {
  open: boolean;
  onClose: () => void;
  result: Result;
  index: number;
}

export function EvidenceDialog({ open, onClose, result, index }: EvidenceDialogProps) {
  const score = pct(result.score);
  const similarity = pct(result.similarityScore);
  const confidence = pct(result.confidence);
  const pass = result.label === "pass" || result.status === "success";
  const rec = result.recommendation ?? "needs_review";
  const badgeVariant = rec === "ready_for_rollout" ? "success" : (rec === "blocked" || rec === "regression_detected") ? "destructive" : "warning";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 flex-wrap">
            <DialogTitle className="text-base font-semibold">Evidence — item {index + 1}</DialogTitle>
            <Badge variant={badgeVariant}>{rec.replaceAll("_", " ")}</Badge>
            {score !== null && (
        <span className={`text-sm font-bold tabular-nums ${pass ? "text-emerald-700" : "text-red-700"}`}>{score}%</span>
            )}
          </div>
          <DialogDescription className="text-xs">
            {result.evaluationMode ? `Mode: ${result.evaluationMode.replaceAll("_", " ")}` : ""}
            {result.provider ? ` · ${result.provider}/${result.model ?? "unknown"}` : ""}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="output" className="mt-2">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="scoring">Scoring</TabsTrigger>
            <TabsTrigger value="steps">Execution</TabsTrigger>
          </TabsList>

          {/* INPUT */}
          <TabsContent value="input" className="space-y-3">
            <TextBlock label="Dataset input" value={result.inputText} />
            {result.variables && Object.keys(result.variables).length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Variables</span>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs font-mono space-y-1">
                  {Object.entries(result.variables).map(([k, v]) => (
                    <div key={k}><span className="text-primary">{k}</span><span className="text-muted-foreground"> = </span><span className="text-foreground/80">{String(v)}</span></div>
                  ))}
                </div>
              </div>
            )}
            {result.datasetItemId && (
              <div className="text-[10px] text-muted-foreground font-mono">Dataset item ID: {result.datasetItemId}</div>
            )}
          </TabsContent>

          {/* PROMPT */}
          <TabsContent value="prompt" className="space-y-3">
            <TextBlock label="Rendered prompt (sent as system message)" value={result.renderedPrompt} mono />
          </TabsContent>

          {/* OUTPUT */}
          <TabsContent value="output" className="space-y-3">
            {result.actualOutput?.trim() ? (
              <TextBlock label="Actual LLM output" value={result.actualOutput} />
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-700 space-y-1">
                <div className="font-semibold">Output unavailable</div>
                <div>
                  {result.error
                    ? `Provider error: ${result.error}`
                    : "No output was produced. Check the Execution tab for the failed step."}
                </div>
              </div>
            )}
            {(result.expectedOutput || result.referenceOutput) && (
              <TextBlock
                label={result.referenceOutput ? "Reference output" : "Expected output"}
                value={result.referenceOutput ?? result.expectedOutput}
              />
            )}
          </TabsContent>

          {/* SCORING */}
          <TabsContent value="scoring" className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Score", value: score == null ? "—" : `${score}%` },
                { label: "Similarity", value: similarity == null ? "Unavailable" : `${similarity}% (${result.similarityLabel ?? ""})` },
                { label: "Confidence", value: confidence == null ? "—" : `${confidence}% (${result.confidenceLabel ?? ""})` },
                { label: "Mode", value: (result.evaluationMode ?? "—").replaceAll("_", " ") },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <div className="text-muted-foreground">{label}</div>
                  <div className="mt-1 font-semibold capitalize">{value}</div>
                </div>
              ))}
            </div>
            {result.similarityReason && (
              <div className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Similarity: </span>{result.similarityReason}
              </div>
            )}
            {(result.confidenceReasons?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Confidence: </span>{result.confidenceReasons?.join(" ")}
              </div>
            )}
            {result.checks && result.checks.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Evaluation checks</div>
                {result.checks.map((c, i) => <CheckRow key={`${c.name}-${i}`} check={c} idx={i} />)}
              </div>
            )}
            {result.error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
                <span className="font-semibold">Error: </span>{result.error}
              </div>
            )}
          </TabsContent>

          {/* EXECUTION STEPS */}
          <TabsContent value="steps" className="space-y-2">
            {(!result.executionSteps || result.executionSteps.length === 0) ? (
              <p className="text-xs text-muted-foreground">No execution steps recorded for this item.</p>
            ) : (
              result.executionSteps.map((step, i) => {
                const sc = step.status === "success" ? "border-emerald-500/30 text-emerald-700 bg-emerald-500/8"
                  : step.status === "error" ? "border-red-500/30 text-red-700 bg-red-500/8"
                  : step.status === "warning" || step.status === "skipped" ? "border-amber-500/30 text-amber-700 bg-amber-500/8"
                  : "border-border text-muted-foreground bg-muted/20";
                const Icon = step.status === "success" ? CheckCircle2 : step.status === "error" ? XCircle : AlertTriangle;
                return (
                  <div key={`${step.name}-${i}`} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-xs ${sc}`}>
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{step.label}</div>
                      <div className="text-muted-foreground mt-0.5">{step.summary}</div>
                    </div>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {step.durationMs != null ? `${Math.round(step.durationMs)}ms` : "—"}
                    </span>
                  </div>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
