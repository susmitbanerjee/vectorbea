import type { ZodType } from "zod";

import { VectorbeaApiError } from "./errors";

/**
 * Runtime validation at the transport boundary.
 *
 * The contracts in `@vectorbea/shared` are transcribed by hand from the Kotlin
 * route handlers, because the API has no OpenAPI spec to generate from. A
 * hand-maintained mirror drifts — that is not a risk, it is a certainty. The
 * question is only whether the drift surfaces here, naming the field, or five
 * components deep as `undefined is not an object`.
 *
 * So every response is parsed. The cost is one schema walk per response; the
 * benefit is that an API change that breaks the UI reports itself as
 * "runs.items.0.estimatedCostUsd: expected number, received string" against a
 * request id, at the exact moment it happens.
 */

/** What a mismatch reports. Consumed by the dev overlay and by prod telemetry. */
export interface ContractMismatch {
  /** Logical location, e.g. `GET /api/runs`. */
  path: string;
  requestId: string | null;
  issues: unknown[];
  /** The payload as received. Never logged wholesale in production. */
  received: unknown;
  at: string;
}

type MismatchReporter = (mismatch: ContractMismatch) => void;

const reporters = new Set<MismatchReporter>();

/**
 * Subscribe to contract mismatches.
 *
 * The dev overlay registers here. So does whatever telemetry sink exists in
 * production — the requirement is "degrade quietly but ALWAYS report", and
 * quietly means the user does not see a stack trace, not that nobody finds out.
 */
export function onContractMismatch(reporter: MismatchReporter): () => void {
  reporters.add(reporter);
  return () => {
    reporters.delete(reporter);
  };
}

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Redact a payload down to its SHAPE for production reporting.
 *
 * A mismatch report has to travel to a log sink, and the payload that triggered
 * it may contain customer data from a run's input or output. What a developer
 * needs to fix a contract break is the shape — which keys exist and what type
 * each holds — not the values. So production reports carry
 * `{ id: "string", cost: "null" }` rather than the row itself.
 */
function shapeOf(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return depth > 2 ? `array(${value.length})` : [shapeOf(value[0], depth + 1), `…×${value.length}`];
  }
  if (typeof value === "object") {
    if (depth > 2) return "object";
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = shapeOf(inner, depth + 1);
    }
    return out;
  }
  return typeof value;
}

function report(mismatch: ContractMismatch): void {
  const payload: ContractMismatch = isDev()
    ? mismatch
    : { ...mismatch, received: shapeOf(mismatch.received) };

  // Console first, so it is visible even with no reporter attached.
  if (isDev()) {
    // Plain, unstyled: devtools CSS would need a raw colour, and the token rule
    // (correctly) does not carve out an exception for console formatting.
    console.group(`[contract mismatch] ${mismatch.path}`);
    console.error("Request id:", mismatch.requestId ?? "(none)");
    console.error("Issues:", mismatch.issues);
    console.error("Received:", mismatch.received);
    console.groupEnd();
  } else {
    console.error("[contract] mismatch", {
      path: payload.path,
      requestId: payload.requestId,
      issues: payload.issues,
      shape: payload.received,
    });
  }

  for (const reporter of reporters) {
    try {
      reporter(payload);
    } catch {
      // A broken reporter must not turn a contract warning into a crash.
    }
  }
}

/**
 * Parse `data` against `schema`.
 *
 * Throws `VectorbeaApiError` with `intent: "contract_mismatch"` on failure, so
 * the screen renders its error state through the same taxonomy as every other
 * failure rather than needing a second code path.
 *
 * Passing no schema is allowed and skips validation — endpoints without a
 * contract yet should not be blocked from being called, they just do not get
 * this protection.
 */
export function validateResponse<T>(
  schema: ZodType<T> | undefined,
  data: unknown,
  context: { path: string; requestId: string | null },
): T {
  if (!schema) return data as T;

  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const mismatch: ContractMismatch = {
    path: context.path,
    requestId: context.requestId,
    issues: result.error.issues,
    received: data,
    at: new Date().toISOString(),
  };

  report(mismatch);

  throw VectorbeaApiError.contractMismatch({
    path: context.path,
    issues: result.error.issues,
    requestId: context.requestId,
    received: isDev() ? data : shapeOf(data),
  });
}
