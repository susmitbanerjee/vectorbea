/**
 * API error taxonomy.
 *
 * Screens consume INTENT, never HTTP status codes. A 403 and a 429 are both
 * "the request failed", but one is a permission state and the other is a
 * countdown — and no screen should be re-deriving that from a number.
 *
 * The codes on the left of `INTENT_BY_CODE` are the real ones emitted by
 * `api-kotlin` (`errors/ApiError.kt`). When the API adds a code we do not know,
 * `unknown` is the honest answer and the request id is what makes it
 * supportable.
 */

/** What the UI should DO. The only thing a screen is allowed to branch on. */
export type ErrorIntent =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "quota_exceeded"
  | "upstream_unavailable"
  /**
   * The API answered, with a 200, in a shape the contract does not describe.
   *
   * Separate from `validation` (which is the user's input being wrong) and from
   * `unknown` (which is the server failing): nothing failed here, the two sides
   * simply disagree about the data. The remedy is a code change, not a retry,
   * so the UI must not offer one.
   */
  | "contract_mismatch"
  | "unknown";

/** The `error` object in the API's response envelope. */
export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

/**
 * Kotlin `ApiError` code → UI intent.
 *
 * Two mappings are worth explaining:
 *
 *  - WORKSPACE_CONCURRENCY_LIMIT is a 429 like TOO_MANY_REQUESTS, but the API
 *    separates them deliberately: rate limiting means "you asked too fast" and
 *    resolves by waiting; a concurrency ceiling means "you have too much
 *    running" and resolves by finishing work or raising the plan. That is a
 *    limits state with an upgrade path, not a countdown.
 *
 *  - CONFLICT is user-correctable (duplicate name, stale version), so it lands
 *    on `validation` and renders inline rather than as a page-level error.
 */
const INTENT_BY_CODE: Record<string, ErrorIntent> = {
  UNAUTHORIZED: "unauthenticated",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  VALIDATION_ERROR: "validation",
  UNPROCESSABLE_ENTITY: "validation",
  CONFLICT: "validation",
  TOO_MANY_REQUESTS: "rate_limited",
  WORKSPACE_CONCURRENCY_LIMIT: "quota_exceeded",
  QUEUE_SATURATED: "upstream_unavailable",
  SERVICE_UNAVAILABLE: "upstream_unavailable",
  INTERNAL_ERROR: "unknown",
  METHOD_NOT_ALLOWED: "unknown",
};

/** Status fallback for responses that carry no recognisable envelope. */
function intentForStatus(status: number): ErrorIntent {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 409 || status === 422) return "validation";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "upstream_unavailable";
  return "unknown";
}

export type FailureKind = "http" | "network" | "timeout" | "aborted" | "contract";

/**
 * Every failure the API client can produce.
 *
 * Network faults and timeouts are the same class as an HTTP failure from a
 * screen's point of view — the data did not arrive — so they carry an intent
 * too (`upstream_unavailable`, the degraded-with-retry state) rather than
 * forcing callers to catch two shapes.
 */
export class VectorbeaApiError extends Error {
  readonly name = "VectorbeaApiError";
  readonly intent: ErrorIntent;
  readonly kind: FailureKind;
  /** 0 for network faults and timeouts, which never got a response. */
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  /** The structured `details` the API attaches, verbatim. */
  readonly details: Record<string, unknown>;
  /** Parsed from `Retry-After`, or from `details.retryAfterSeconds`. */
  readonly retryAfterSeconds: number | null;
  readonly body: ApiErrorBody | null;

  constructor(init: {
    message: string;
    status: number;
    code: string;
    kind: FailureKind;
    intent: ErrorIntent;
    requestId?: string | null;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number | null;
    body?: ApiErrorBody | null;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.kind = init.kind;
    this.intent = init.intent;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? {};
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.body = init.body ?? null;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get isRetryable(): boolean {
    if (this.kind === "network" || this.kind === "timeout") return true;
    if (this.details.retryable === true) return true;
    return this.status === 502 || this.status === 503 || this.status === 504;
  }

  /** One line a user can paste into a support ticket. */
  get supportReference(): string {
    return this.requestId ? `${this.code} · ${this.requestId}` : this.code;
  }

  static fromResponse(
    response: Response,
    body: unknown,
    fallbackRequestId: string | null,
  ): VectorbeaApiError {
    const envelope =
      body && typeof body === "object" && "error" in body
        ? ((body as { error: ApiErrorBody }).error ?? null)
        : null;

    const code = envelope?.code ?? `HTTP_${response.status}`;
    const requestId =
      envelope?.requestId ?? response.headers.get("X-Request-Id") ?? fallbackRequestId;

    const details = envelope?.details ?? {};
    const headerRetry = response.headers.get("Retry-After");
    const retryAfterSeconds =
      headerRetry !== null && Number.isFinite(Number(headerRetry))
        ? Number(headerRetry)
        : typeof details.retryAfterSeconds === "number"
          ? details.retryAfterSeconds
          : null;

    return new VectorbeaApiError({
      message: envelope?.message ?? `The API returned HTTP ${response.status}.`,
      status: response.status,
      code,
      kind: "http",
      intent: INTENT_BY_CODE[code] ?? intentForStatus(response.status),
      requestId,
      details,
      retryAfterSeconds,
      body: envelope,
    });
  }

  static network(cause: unknown, requestId: string | null): VectorbeaApiError {
    return new VectorbeaApiError({
      message: "Could not reach the Vectorbea API. Check your connection and try again.",
      status: 0,
      code: "NETWORK_ERROR",
      kind: "network",
      intent: "upstream_unavailable",
      requestId,
      cause,
    });
  }

  static timeout(ms: number, requestId: string | null): VectorbeaApiError {
    return new VectorbeaApiError({
      message: `The request took longer than ${Math.round(ms / 1000)}s and was cancelled. Try again.`,
      status: 0,
      code: "TIMEOUT",
      kind: "timeout",
      intent: "upstream_unavailable",
      requestId,
    });
  }

  /**
   * The response did not match its contract.
   *
   * `details.issues` carries the full Zod issue list — path, expected, received
   * — because "contract mismatch" without the field name is a worse error than
   * the crash it replaced. `path` is what a developer greps for.
   */
  static contractMismatch(init: {
    path: string;
    issues: unknown[];
    requestId: string | null;
    received: unknown;
  }): VectorbeaApiError {
    const summary = init.issues
      .slice(0, 3)
      .map((issue) => {
        const i = issue as { path?: unknown[]; message?: string };
        const at = Array.isArray(i.path) && i.path.length ? i.path.join(".") : "(root)";
        return `${at}: ${i.message ?? "invalid"}`;
      })
      .join("; ");

    const more = init.issues.length > 3 ? ` (+${init.issues.length - 3} more)` : "";

    return new VectorbeaApiError({
      message: `The API returned data this version of the app cannot read. ${summary}${more}`,
      status: 200,
      code: "CONTRACT_MISMATCH",
      kind: "contract",
      intent: "contract_mismatch",
      requestId: init.requestId,
      details: { path: init.path, issues: init.issues, received: init.received },
    });
  }

  static aborted(requestId: string | null): VectorbeaApiError {
    return new VectorbeaApiError({
      message: "The request was cancelled.",
      status: 0,
      code: "ABORTED",
      kind: "aborted",
      intent: "unknown",
      requestId,
    });
  }
}

export function isVectorbeaApiError(error: unknown): error is VectorbeaApiError {
  return error instanceof VectorbeaApiError;
}

/** Narrow helper for the one intent that has to be handled globally. */
export function isUnauthenticated(error: unknown): boolean {
  return isVectorbeaApiError(error) && error.intent === "unauthenticated";
}

/**
 * True when a 403 means "this workspace is not yours" rather than "this action
 * is not permitted".
 *
 * The distinction matters: the first is a stale selection that should be
 * dropped and re-resolved, the second is a permission-denied state the user
 * should actually see. The API emits plain FORBIDDEN for both, so this matches
 * on the message `RequestContext.context()` produces.
 *
 * That is brittle by nature. The durable fix is a distinct code on the API side
 * (WORKSPACE_FORBIDDEN); until then a miss here degrades to a normal
 * permission-denied state, which is the safe direction to be wrong in.
 */
export function isWorkspaceMembershipDenied(error: unknown): boolean {
  if (!isVectorbeaApiError(error) || error.intent !== "forbidden") return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("not a member of workspace") ||
    message.includes("no workspace memberships")
  );
}
