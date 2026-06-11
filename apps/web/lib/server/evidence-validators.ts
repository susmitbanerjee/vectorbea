import "server-only";

type ValidatorStatus = "passed" | "failed" | "needs_review";

export type EvidenceValidatorInput = {
  evidenceType: string;
  validatorType?: string | null;
  inputPayload?: Record<string, unknown> | null;
  outputPayload?: Record<string, unknown> | null;
  validatorConfig?: Record<string, unknown> | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

export type EvidenceValidatorResult = {
  status: ValidatorStatus;
  passed: boolean | null;
  score: number | null;
  reason: string;
  details: Record<string, unknown>;
};

function textFromPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return "";
  const direct = payload.text ?? payload.output ?? payload.response ?? payload.final_response ?? payload.answer;
  return typeof direct === "string" ? direct : JSON.stringify(payload);
}

function hasSecretLikeValue(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._-]{16,}/i,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    /\b(?:\d[ -]*?){13,19}\b/,
  ].some((pattern) => pattern.test(text));
}

function getByPath(payload: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, payload);
}

function compareValues(actual: unknown, operator: string, expected: unknown) {
  if (operator === "exists") return actual !== undefined && actual !== null;
  if (operator === "not_exists") return actual === undefined || actual === null;
  if (operator === "equals") return actual === expected;
  if (operator === "not_equals") return actual !== expected;
  if (operator === "lte") return Number(actual) <= Number(expected);
  if (operator === "gte") return Number(actual) >= Number(expected);
  return false;
}

export function validateEvidenceRun(input: EvidenceValidatorInput): EvidenceValidatorResult {
  const config = input.validatorConfig ?? {};
  const validator = input.validatorType ?? config.validatorType ?? input.evidenceType;
  const output = input.outputPayload ?? {};
  const text = textFromPayload(output);

  if (validator === "contains") {
    const expected = String(config.contains ?? config.value ?? "");
    const passed = expected.length > 0 && text.includes(expected);
    return { status: passed ? "passed" : "failed", passed, score: passed ? 1 : 0, reason: passed ? "Required text was present." : `Missing required text: ${expected}`, details: { expected } };
  }

  if (validator === "not_contains") {
    const forbidden = String(config.notContains ?? config.value ?? "");
    const passed = forbidden.length > 0 && !text.includes(forbidden);
    return { status: passed ? "passed" : "failed", passed, score: passed ? 1 : 0, reason: passed ? "Forbidden text was not present." : `Forbidden text was present: ${forbidden}`, details: { forbidden } };
  }

  if (validator === "regex") {
    const pattern = String(config.pattern ?? "");
    if (!pattern) return { status: "needs_review", passed: null, score: null, reason: "Regex validator is missing a pattern.", details: {} };
    const passed = new RegExp(pattern).test(text);
    return { status: passed ? "passed" : "failed", passed, score: passed ? 1 : 0, reason: passed ? "Regex matched evidence output." : "Regex did not match evidence output.", details: { pattern } };
  }

  if (validator === "pii_redaction" || input.evidenceType === "privacy_check") {
    const leaked = hasSecretLikeValue(input.inputPayload) || hasSecretLikeValue(input.outputPayload);
    return { status: leaked ? "failed" : "passed", passed: !leaked, score: leaked ? 0 : 1, reason: leaked ? "Potential PII or secret was detected in evidence payload." : "No obvious PII or secrets detected.", details: { deterministic: true } };
  }

  if (validator === "tool_sequence" || input.evidenceType === "workflow_regression" || input.evidenceType === "mcp_tool_policy_check") {
    const sequence = Array.isArray(output.tool_sequence) ? output.tool_sequence.map(String) : [];
    const requiredBefore = config.requiredBefore as Record<string, string> | undefined;
    if (!requiredBefore) return { status: "needs_review", passed: null, score: null, reason: "Tool sequence validator needs a requiredBefore rule.", details: { sequence } };
    for (const [tool, predecessor] of Object.entries(requiredBefore)) {
      const toolIndex = sequence.indexOf(tool);
      const predecessorIndex = sequence.indexOf(predecessor);
      if (toolIndex >= 0 && (predecessorIndex < 0 || predecessorIndex > toolIndex)) {
        return { status: "failed", passed: false, score: 0, reason: `${tool} was called before required tool ${predecessor}.`, details: { sequence, tool, predecessor } };
      }
    }
    return { status: "passed", passed: true, score: 1, reason: "Tool sequence satisfied deterministic order rules.", details: { sequence } };
  }

  if (validator === "tool_argument") {
    const path = String(config.path ?? "");
    const operator = String(config.operator ?? "exists");
    const actual = path ? getByPath(output, path) : undefined;
    const passed = compareValues(actual, operator, config.value);
    return { status: passed ? "passed" : "failed", passed, score: passed ? 1 : 0, reason: passed ? "Tool argument rule passed." : "Tool argument rule failed.", details: { path, operator, expected: config.value, actual } };
  }

  if (validator === "citation_required" || input.evidenceType === "rag_citation_check" || input.evidenceType === "rag_grounding_check") {
    const citations = Array.isArray(output.citations) ? output.citations : [];
    const retrieved = Array.isArray(output.retrieved_source_ids) ? output.retrieved_source_ids.map(String) : [];
    const missing = citations.map(String).filter((citation) => retrieved.length > 0 && !retrieved.includes(citation));
    const passed = citations.length > 0 && missing.length === 0;
    return { status: passed ? "passed" : "failed", passed, score: passed ? 1 : 0, reason: passed ? "Citations are present and refer to retrieved sources." : "Citation evidence is missing or cites unavailable sources.", details: { citations, retrieved, missing } };
  }

  if (validator === "json_schema" || input.evidenceType === "deterministic_check") {
    const required = Array.isArray(config.required) ? config.required.map(String) : [];
    const missing = required.filter((field) => getByPath(output, field) === undefined);
    const passed = missing.length === 0;
    return { status: passed ? "passed" : "failed", passed, score: passed ? 1 : 0, reason: passed ? "Required output fields are present." : `Missing required output fields: ${missing.join(", ")}`, details: { required, missing } };
  }

  return {
    status: "needs_review",
    passed: null,
    score: null,
    reason: "No deterministic validator is configured for this evidence type.",
    details: { validator, sourceType: input.sourceType, sourceId: input.sourceId },
  };
}
