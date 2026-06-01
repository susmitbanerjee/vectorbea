"use client";
import type { WorkflowRun, RunStep } from "@/types/runs";
import { JsonViewer } from "../JsonViewer";

function NoData({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 py-8 text-center">
      <p style={{ fontSize: 12, color: "#94A3B8" }}>{label}</p>
    </div>
  );
}

export function InputsOutputsTab({ run, selectedStep }: { run: WorkflowRun; selectedStep?: RunStep }) {
  const step = selectedStep;

  // Workflow-level: use run input/output (from the WorkflowRun object directly)
  const workflowInput  = (run as unknown as Record<string, unknown>).input;
  const workflowOutput = (run as unknown as Record<string, unknown>).output;

  // Last step with output (fallback)
  const lastOutput = run.steps.filter(s => s.output !== undefined).at(-1)?.output;

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
            {step.input !== undefined
              ? <JsonViewer data={step.input} label="Step input" />
              : <NoData label="No input recorded for this step" />
            }
            {step.output !== undefined
              ? <JsonViewer data={step.output} label="Step output" />
              : <NoData label="No output recorded for this step" />
            }
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "#64748B" }}>Workflow-level trigger input and final output</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {workflowInput !== undefined
              ? <JsonViewer data={workflowInput} label="Workflow input" />
              : <NoData label="No workflow input" />
            }
            {workflowOutput !== undefined
              ? <JsonViewer data={workflowOutput} label="Workflow output" />
              : lastOutput !== undefined
                ? <JsonViewer data={lastOutput} label="Latest step output" />
                : <NoData label="No output yet" />
            }
          </div>
        </>
      )}
    </div>
  );
}
