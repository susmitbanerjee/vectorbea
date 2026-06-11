/**
 * Workflow Mapping Resolver
 *
 * Resolves template expressions in workflow node configs against the current
 * run context.  Expressions use the syntax: {{ path.to.value }}
 *
 * Supported root keys:
 *   workflow.input.<key>          — top-level workflow input field
 *   steps.<nodeId>.output.<key>  — extracted output from a prior step
 *   steps.<nodeId>.raw.<key>     — raw output from a prior step
 *   run.id                       — run UUID
 *   run.workspaceId              — workspace UUID
 *   run.workflowId               — workflow UUID
 *   run.startedAt                — ISO timestamp
 *   run.triggerType              — manual | cron | webhook | api
 *   run.attemptNumber            — retry attempt count (1-indexed)
 *   env.<VAR>                    — NOT SUPPORTED — use connections for secrets
 *
 * Expressions are greedy — whitespace around the path is trimmed.
 * Missing paths return undefined (the expression tag is left as-is in
 * debug mode, or replaced with empty string in strict mode).
 *
 * SECURITY: secrets are NEVER accessible via template expressions.
 * The `connections` root is explicitly blocked.
 */

import type { WorkflowRunContext } from "@/types/workflow-graph";

// ─── Path navigation ──────────────────────────────────────────────────────────

function resolvePath(obj: unknown, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[part];
    } else if (Array.isArray(cur)) {
      const idx = parseInt(part, 10);
      cur = Number.isFinite(idx) ? (cur as unknown[])[idx] : undefined;
    } else {
      return undefined;
    }
  }
  return cur;
}

// ─── Single expression evaluator ─────────────────────────────────────────────

/**
 * Resolve a single expression (without the {{ }} delimiters).
 * Returns the resolved value, or undefined if the path doesn't exist.
 */
function resolveExpression(
  expression: string,
  context: WorkflowRunContext,
): unknown {
  const trimmed = expression.trim();

  // Security: block secrets / env access
  if (trimmed.startsWith("connections.") || trimmed.startsWith("env.") || trimmed.startsWith("secrets.")) {
    return `[BLOCKED:${trimmed.split(".")[0]}]`;
  }

  const parts = trimmed.split(".");
  const root = parts[0];

  if (root === "workflow") {
    // e.g. workflow.input.name → context.workflow.input.name
    return resolvePath(context.workflow, parts.slice(1));
  }

  if (root === "steps") {
    // e.g. steps.fetchUser.output.id OR steps.fetchUser.raw.body
    const nodeId = parts[1];
    if (!nodeId) return undefined;
    const stepEntry = context.steps[nodeId];
    if (!stepEntry) return undefined;
    const sub = parts[2]; // output | raw | status | error | durationMs
    if (!sub) return stepEntry;
    if (sub === "output") return resolvePath(stepEntry.extracted, parts.slice(3));
    if (sub === "raw") return resolvePath(stepEntry.raw, parts.slice(3));
    if (sub === "status") return stepEntry.status;
    if (sub === "error") return stepEntry.errorMessage;
    if (sub === "durationMs") return stepEntry.durationMs;
    if (sub === "tokensUsed") return stepEntry.tokensUsed;
    return undefined;
  }

  if (root === "run") {
    return resolvePath(context.run, parts.slice(1));
  }

  return undefined;
}

// ─── Template string resolver ─────────────────────────────────────────────────

const EXPR_REGEX = /\{\{\s*([\w$.[\]]+(?:\.[\w$[\]]+)*)\s*\}\}/g;

/**
 * Resolve all {{ expression }} tokens in a template string.
 *
 * - If the entire string is a single expression and the resolved value is
 *   not a string, the original value is returned (preserves types like
 *   numbers, booleans, objects, arrays).
 * - Otherwise interpolation is done as string concatenation.
 * - Missing expressions are replaced with empty string in production.
 */
export function resolveTemplate(
  template: string,
  context: WorkflowRunContext,
): unknown {
  // Fast path: no expressions
  if (!template.includes("{{")) return template;

  // Check if the entire string is a single expression
  const singleMatch = template.match(/^\{\{\s*([\w$.[\]]+(?:\.[\w$[\]]+)*)\s*\}\}$/);
  if (singleMatch) {
    const resolved = resolveExpression(singleMatch[1]!, context);
    return resolved ?? "";
  }

  // Multi-expression string interpolation
  return template.replace(EXPR_REGEX, (_, expr: string) => {
    const val = resolveExpression(expr, context);
    if (val === undefined || val === null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

// ─── Object/record resolver ───────────────────────────────────────────────────

/**
 * Resolve all template expressions in a flat key→template map.
 * Returns a new Record<string, unknown> with resolved values.
 */
export function resolveMapping(
  mapping: Record<string, string>,
  context: WorkflowRunContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(mapping)) {
    result[key] = resolveTemplate(template, context);
  }
  return result;
}

// ─── Deep object resolver ─────────────────────────────────────────────────────

/**
 * Recursively resolve all string values inside an object/array that contain
 * {{ expressions }}.  Leaves non-string values untouched.
 */
export function resolveDeep(
  value: unknown,
  context: WorkflowRunContext,
): unknown {
  if (typeof value === "string") {
    return resolveTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveDeep(item, context));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = resolveDeep(v, context);
    }
    return result;
  }
  return value;
}

// ─── Context factory ──────────────────────────────────────────────────────────

export function makeRunContext(opts: {
  runId: string;
  workspaceId: string;
  workflowId: string;
  startedAt: string;
  triggerType: string;
  workflowInput: Record<string, unknown>;
  attemptNumber?: number;
}): WorkflowRunContext {
  return {
    run: {
      id: opts.runId,
      workspaceId: opts.workspaceId,
      workflowId: opts.workflowId,
      startedAt: opts.startedAt,
      triggerType: opts.triggerType,
      attemptNumber: opts.attemptNumber ?? 1,
    },
    workflow: {
      input: opts.workflowInput,
    },
    steps: {},
  };
}
