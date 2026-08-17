"use client";

/**
 * The Contract tab of the node inspector (P16).
 *
 * Three things a user needs in order to trust a contract, and the tab is
 * structured around them:
 *
 *   1. **A schema editor that tells them immediately if it is wrong.** Validation
 *      on every keystroke, not on save — a JSON error discovered at publish is a
 *      context switch.
 *   2. **An assertion builder they can TEST.** The single biggest reason
 *      assertions go unused is that authors cannot tell whether an expression does
 *      what they meant. Testing against the node's last real output removes the
 *      guesswork, and the API evaluates it with the same engine the worker runs, so
 *      what is shown here is what will happen.
 *   3. **Severity explained where it is chosen.** `fail` / `warn` / `gate` have
 *      very different consequences and the difference is not guessable from the
 *      words. The explanation sits next to the control rather than in a doc.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, Plus, Shield, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";

type Severity = "fail" | "warn" | "gate";

interface Assertion {
  name: string;
  expr: string;
  severity: Severity;
  message?: string;
}

interface TestResult {
  schemaValid: boolean;
  schemaErrors: string[];
  outcome: "pass" | "fail" | "warn" | "gate";
  assertions: Array<{
    name: string; severity: Severity; passed: boolean;
    message: string; error?: string | null;
    observed?: Record<string, unknown>;
  }>;
}

/** `GET /api/workflows/:id/contracts/:nodeId` */
interface ContractResponse {
  schema?: Record<string, unknown> | null;
  assertions?: Assertion[];
  version?: number;
  decodingEnforced?: boolean;
}

/** `PUT` / `POST .../infer` both return a message the UI shows verbatim. */
interface SaveResponse {
  message?: string;
  version?: number;
  warnings?: string[];
}

interface InferResponse {
  inferred?: boolean;
  schema?: Record<string, unknown>;
  message?: string;
}

interface Props {
  workflowId: string;
  nodeId: string;
  /** The node's most recent real output, used as the default test sample. */
  lastOutput?: unknown;
  lastInput?: unknown;
}

/**
 * What each severity actually does.
 *
 * Written as consequences, not definitions. "fail — do not commit" is a
 * definition; "the node fails and nothing downstream runs" is what the user needs
 * to predict.
 */
const SEVERITY_DOC: Record<Severity, { label: string; effect: string; tone: string }> = {
  fail: {
    label: "Fail",
    effect: "The output is never committed. The node fails with your message, and nothing downstream runs.",
    tone: "text-[#B91C1C]",
  },
  warn: {
    label: "Warn",
    effect: "The output commits and the run continues, but the run is flagged low-confidence and surfaces on Control for review.",
    tone: "text-[#B45309]",
  },
  gate: {
    label: "Gate",
    effect: "The output commits, then a human approval is required before any downstream side effect — emails, writes, webhooks.",
    tone: "text-[#6D28D9]",
  },
};

export function ContractTab({ workflowId, nodeId, lastOutput, lastInput }: Props) {
  const [schemaText, setSchemaText] = useState("");
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [sampleText, setSampleText] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // ── Load the existing contract ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch<ContractResponse>(`/api/workflows/${workflowId}/contracts/${nodeId}`);
        if (cancelled) return;
        if (r?.schema) setSchemaText(JSON.stringify(r.schema, null, 2));
        if (Array.isArray(r?.assertions)) setAssertions(r.assertions);
      } catch {
        // 404 is the normal case for a node with no contract yet.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [workflowId, nodeId]);

  useEffect(() => {
    if (lastOutput !== undefined && sampleText === "") {
      setSampleText(JSON.stringify(lastOutput, null, 2));
    }
  }, [lastOutput, sampleText]);

  // ── Live schema validation ────────────────────────────────────────────────
  // Parsed on every render rather than on save: a JSON error found at publish time
  // is a context switch, and this is cheap.
  const schemaError = useMemo(() => {
    if (!schemaText.trim()) return null;
    try {
      const parsed = JSON.parse(schemaText);
      if (parsed.type !== "object") {
        return 'The root must be {"type": "object"} — providers cannot constrain a bare array or scalar.';
      }
      if (!parsed.properties || Object.keys(parsed.properties).length === 0) {
        return "The schema declares no properties, so it constrains nothing.";
      }
      return null;
    } catch (e) {
      return `Not valid JSON: ${(e as Error).message}`;
    }
  }, [schemaText]);

  const sampleError = useMemo(() => {
    if (!sampleText.trim()) return null;
    try { JSON.parse(sampleText); return null; }
    catch (e) { return `Not valid JSON: ${(e as Error).message}`; }
  }, [sampleText]);

  // ── Test against sample data ──────────────────────────────────────────────
  const runTest = useCallback(async () => {
    if (schemaError || sampleError) return;
    try {
      const result = await apiFetch<TestResult>(
        `/api/workflows/${workflowId}/contracts/${nodeId}/test`, {
          method: "POST",
          json: {
            schema: schemaText.trim() ? JSON.parse(schemaText) : null,
            assertions,
            sampleOutput: sampleText.trim() ? JSON.parse(sampleText) : null,
            sampleInput: lastInput ?? null,
          },
        });
      setTest(result);
    } catch (e) {
      setTest(null);
      setSaveMsg(`Could not run the test: ${(e as Error).message}`);
    }
  }, [workflowId, nodeId, schemaText, assertions, sampleText, lastInput, schemaError, sampleError]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await apiFetch<SaveResponse>(`/api/workflows/${workflowId}/contracts/${nodeId}`, {
        method: "PUT",
        json: {
          schema: schemaText.trim() ? JSON.parse(schemaText) : null,
          assertions,
        },
      });
      setSaveMsg(r?.message ?? "Saved.");
    } catch (e) {
      setSaveMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [workflowId, nodeId, schemaText, assertions]);

  const inferDraft = useCallback(async () => {
    try {
      const r = await apiFetch<InferResponse>(
        `/api/workflows/${workflowId}/contracts/${nodeId}/infer`, { method: "POST" });
      if (r?.inferred && r?.schema) {
        setSchemaText(JSON.stringify(r.schema, null, 2));
        setSaveMsg(r.message ?? "Draft inferred — review it, then save to apply.");
      } else {
        setSaveMsg(r?.message ?? "Not enough history to infer a contract.");
      }
    } catch (e) {
      setSaveMsg((e as Error).message);
    }
  }, [workflowId, nodeId]);

  const update = (i: number, patch: Partial<Assertion>) =>
    setAssertions((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  if (!loaded) return <div className="p-4 text-[12px] text-[#6B7280]">Loading contract…</div>;

  return (
    <div className="space-y-5 p-4">
      {/* ── Schema ─────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-[#047857]" />
            <h3 className="text-[13px] font-semibold text-[#111827]">Output schema</h3>
          </div>
          <button type="button" onClick={inferDraft}
            className="text-[11.5px] font-medium text-[#047857] hover:underline">
            Infer from history
          </button>
        </div>
        <p className="mb-2 text-[11.5px] leading-[1.5] text-[#6B7280]">
          With a schema declared, the provider is constrained to produce it — a malformed
          response becomes impossible rather than unlikely. Costs nothing.
        </p>
        <textarea
          value={schemaText}
          onChange={(e) => setSchemaText(e.target.value)}
          spellCheck={false}
          rows={10}
          placeholder='{\n  "type": "object",\n  "properties": {\n    "risk_score": { "type": "integer", "minimum": 0, "maximum": 100 }\n  },\n  "required": ["risk_score"]\n}'
          className={cn(
            "w-full rounded-[8px] border p-2.5 font-mono text-[11.5px] leading-[1.5] outline-none",
            schemaError ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E5E7EB] focus:border-[#047857]",
          )}
        />
        {schemaError && (
          <p className="mt-1 flex items-start gap-1 text-[11.5px] text-[#B91C1C]">
            <XCircle className="mt-px h-3 w-3 shrink-0" /> {schemaError}
          </p>
        )}
      </section>

      {/* ── Assertions ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#111827]">Assertions</h3>
          <button
            type="button"
            onClick={() => setAssertions((p) => [...p, { name: "", expr: "", severity: "fail" }])}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#047857] hover:underline"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        <p className="mb-2 text-[11.5px] leading-[1.5] text-[#6B7280]">
          Business rules the output must satisfy. A schema cannot catch{" "}
          <code className="rounded bg-[#F3F4F6] px-1 font-mono text-[11px]">risk_score: 340</code>{" "}
          — 340 is a valid integer. An assertion can.
        </p>

        <div className="space-y-2.5">
          {assertions.map((a, i) => (
            <div key={i} className="rounded-[8px] border border-[#E5E7EB] p-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={a.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="score_in_range"
                  className="min-w-0 flex-1 rounded-[6px] border border-[#E5E7EB] px-2 py-1 font-mono text-[11.5px] outline-none focus:border-[#047857]"
                />
                <select
                  value={a.severity}
                  onChange={(e) => update(i, { severity: e.target.value as Severity })}
                  className="rounded-[6px] border border-[#E5E7EB] px-2 py-1 text-[11.5px] outline-none focus:border-[#047857]"
                >
                  {(Object.keys(SEVERITY_DOC) as Severity[]).map((s) => (
                    <option key={s} value={s}>{SEVERITY_DOC[s].label}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setAssertions((p) => p.filter((_, j) => j !== i))}
                  className="text-[#9CA3AF] hover:text-[#B91C1C]" aria-label={`Remove assertion ${i + 1}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <input
                value={a.expr}
                onChange={(e) => update(i, { expr: e.target.value })}
                placeholder="output.risk_score >= 0 and output.risk_score <= 100"
                spellCheck={false}
                className="mt-1.5 w-full rounded-[6px] border border-[#E5E7EB] px-2 py-1 font-mono text-[11.5px] outline-none focus:border-[#047857]"
              />
              <input
                value={a.message ?? ""}
                onChange={(e) => update(i, { message: e.target.value })}
                placeholder="risk_score was {output.risk_score}, expected 0-100"
                className="mt-1.5 w-full rounded-[6px] border border-[#E5E7EB] px-2 py-1 text-[11.5px] outline-none focus:border-[#047857]"
              />

              {/* The consequence, next to the control that sets it. */}
              <p className={cn("mt-1.5 text-[11px] leading-[1.5]", SEVERITY_DOC[a.severity].tone)}>
                <span className="font-semibold">{SEVERITY_DOC[a.severity].label}:</span>{" "}
                {SEVERITY_DOC[a.severity].effect}
              </p>
            </div>
          ))}
          {assertions.length === 0 && (
            <p className="rounded-[8px] border border-dashed border-[#E5E7EB] p-3 text-center text-[11.5px] text-[#9CA3AF]">
              No assertions. The schema still constrains the shape; assertions constrain the meaning.
            </p>
          )}
        </div>
      </section>

      {/* ── Live test ──────────────────────────────────────────────────── */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#111827]">Test against sample data</h3>
          <button type="button" onClick={runTest} disabled={!!schemaError || !!sampleError}
            className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-[#111827] px-2.5 text-[11.5px] font-semibold text-white disabled:opacity-40">
            <Play className="h-3 w-3" /> Run test
          </button>
        </div>
        <textarea
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          spellCheck={false}
          rows={6}
          placeholder="Paste a sample output, or this node's last run output loads automatically."
          className={cn(
            "w-full rounded-[8px] border p-2.5 font-mono text-[11.5px] leading-[1.5] outline-none",
            sampleError ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E5E7EB] focus:border-[#047857]",
          )}
        />
        {sampleError && <p className="mt-1 text-[11.5px] text-[#B91C1C]">{sampleError}</p>}

        {test && (
          <div className="mt-2.5 rounded-[8px] border border-[#E5E7EB] p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              {test.outcome === "pass"
                ? <CheckCircle2 className="h-3.5 w-3.5 text-[#047857]" />
                : <AlertTriangle className="h-3.5 w-3.5 text-[#B45309]" />}
              <span className="text-[12px] font-semibold text-[#111827]">
                {test.outcome === "pass" ? "This output would commit" :
                 test.outcome === "fail" ? "This output would be REJECTED" :
                 test.outcome === "gate" ? "This output would commit, then require approval" :
                 "This output would commit, flagged low-confidence"}
              </span>
            </div>
            {test.schemaErrors.length > 0 && (
              <ul className="mb-1.5 space-y-0.5">
                {test.schemaErrors.map((e, i) => (
                  <li key={i} className="text-[11.5px] text-[#B91C1C]">· {e}</li>
                ))}
              </ul>
            )}
            <ul className="space-y-1">
              {test.assertions.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11.5px]">
                  {r.passed
                    ? <CheckCircle2 className="mt-px h-3 w-3 shrink-0 text-[#047857]" />
                    : <XCircle className="mt-px h-3 w-3 shrink-0 text-[#B91C1C]" />}
                  <span className={r.passed ? "text-[#4B5563]" : "text-[#111827]"}>{r.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-3">
        <p className="text-[11.5px] text-[#6B7280]">{saveMsg}</p>
        <button type="button" onClick={save} disabled={saving || !!schemaError}
          className="inline-flex h-8 items-center rounded-[8px] bg-[#047857] px-3.5 text-[12px] font-semibold text-white disabled:opacity-40">
          {saving ? "Saving…" : "Save contract"}
        </button>
      </div>
    </div>
  );
}
