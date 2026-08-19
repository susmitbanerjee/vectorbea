import { describe, expect, it } from "vitest";

import {
  formatResolvedValue,
  toResolvedFields,
  unresolvedFields,
  type NodeDebugDetail,
} from "~/lib/api/node-debug";

/**
 * I/O mapping preview: joining template, resolved value and provenance.
 *
 * The behaviour that matters is what happens to fields that did NOT resolve.
 * They are the reason someone opens this tab, and the easy implementations all
 * drop them — a `Object.entries(resolvedInput)` loop never sees a field that
 * produced no value.
 */

function snapshot(over: Partial<NodeDebugDetail> = {}): NodeDebugDetail {
  return {
    id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    workflowRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    nodeId: "n1",
    nodeType: "agent",
    nodeName: "Classify",
    attempt: 1,
    status: "failed",
    inputTemplate: { subject: "Re: {{steps.fetch.title}}", body: "{{steps.fetch.body}}" },
    resolvedInput: { subject: "Re: Invoice 42" },
    resolvedVariables: null,
    variableSources: [
      {
        variable: "{{steps.fetch.title}}",
        field: "subject",
        resolvedValue: "Re: Invoice 42",
        sourceNode: "Fetch",
        sourcePath: "title",
        missing: false,
      },
      {
        variable: "{{steps.fetch.body}}",
        field: "body",
        resolvedValue: null,
        sourceNode: "Fetch",
        sourcePath: "body",
        missing: true,
      },
    ],
    output: null,
    parsedOutput: null,
    schemaValidation: null,
    errorType: null,
    errorMessage: null,
    humanFailureReason: null,
    suggestedFix: null,
    modelProvider: null,
    modelName: null,
    tokensInput: null,
    tokensOutput: null,
    ...over,
  } as NodeDebugDetail;
}

describe("toResolvedFields", () => {
  it("keeps a field that did not resolve — the row the user came for", () => {
    const fields = toResolvedFields(snapshot());

    const body = fields.find((f) => f.field === "body");
    expect(body).toBeDefined();
    expect(body?.missing).toBe(true);
    expect(body?.resolved).toBeUndefined();
    expect(body?.template).toBe("{{steps.fetch.body}}");
  });

  it("pairs a resolved field with its value and provenance", () => {
    const subject = toResolvedFields(snapshot()).find((f) => f.field === "subject");

    expect(subject?.missing).toBe(false);
    expect(subject?.resolved).toBe("Re: Invoice 42");
    expect(subject?.sources[0].sourceNode).toBe("Fetch");
  });

  it("follows the template's field order, which is stable across runs", () => {
    expect(toResolvedFields(snapshot()).map((f) => f.field)).toEqual(["subject", "body"]);
  });

  it("surfaces a resolved field that has no declared template", () => {
    const fields = toResolvedFields(
      snapshot({ resolvedInput: { subject: "x", injected: "from runtime" } }),
    );
    expect(fields.map((f) => f.field)).toContain("injected");
  });

  it("marks a literal as literal, not as unresolved", () => {
    const fields = toResolvedFields(
      snapshot({
        inputTemplate: { mode: "strict" },
        resolvedInput: {},
        variableSources: [],
      }),
    );
    // No `{{` and no sources: nothing was ever going to resolve, so this must
    // not be reported as a failure.
    expect(fields[0].literal).toBe(true);
    expect(unresolvedFields(fields)).toHaveLength(0);
  });

  it("counts only genuinely unresolved expressions", () => {
    expect(unresolvedFields(toResolvedFields(snapshot())).map((f) => f.field)).toEqual(["body"]);
  });

  it("returns nothing for a node that never ran", () => {
    expect(toResolvedFields(null)).toEqual([]);
    expect(toResolvedFields(undefined)).toEqual([]);
  });
});

describe("formatResolvedValue", () => {
  it("distinguishes absent, null and empty string", () => {
    // Three different facts. A naive String() renders all three as blank, and
    // "the field was absent" and "the field resolved to empty" are different
    // bugs with different fixes.
    expect(formatResolvedValue(undefined)).toBe("—");
    expect(formatResolvedValue(null)).toBe("null");
    expect(formatResolvedValue("")).toBe('""');
  });

  it("pretty-prints objects rather than showing [object Object]", () => {
    expect(formatResolvedValue({ a: 1 })).toContain('"a": 1');
  });
});
