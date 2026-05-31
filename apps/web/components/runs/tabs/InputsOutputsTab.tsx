"use client";
import type { WorkflowRun, RunStep } from "@/types/runs";
import { JsonViewer } from "../JsonViewer";

export function InputsOutputsTab({ run, selectedStep }: { run: WorkflowRun; selectedStep?: RunStep }) {
  const step = selectedStep;
  return (
    <div className="space-y-4">
      {step ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p style={{ fontSize: 11.5, color: "#64748B" }}>
              Showing inputs/outputs for: <strong style={{ color: "#0F172A" }}>{step.businessName}</strong>
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {step.input !== undefined ? <JsonViewer data={step.input} label="Step input" /> : <div style={{ fontSize: 12, color: "#94A3B8" }}>No input recorded</div>}
            {step.output !== undefined ? <JsonViewer data={step.output} label="Step output" /> : <div style={{ fontSize: 12, color: "#94A3B8" }}>No output recorded</div>}
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "#64748B" }}>Workflow-level input and current output</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <JsonViewer data={run.steps[0]?.input} label="Workflow input" />
            {run.steps.filter(s => s.output).slice(-1).map(s =>
              <JsonViewer key={s.id} data={s.output} label="Latest output" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
