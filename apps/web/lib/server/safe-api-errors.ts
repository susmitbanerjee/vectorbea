import "server-only";

import { PlanLimitError } from "@/lib/server/entitlements";

type SafeError = {
  message: string;
  status: number;
  code?: string;
  /**
   * Machine-readable facts behind the message, spread into the JSON body.
   *
   * A plan refusal is the reason this exists. "Forbidden" is a toast; `{limit:
   * 3, current: 3, plan: "free", upgradeTo: "Pro"}` is a progress bar and an
   * upgrade button that names the right plan.
   */
  detail?: Record<string, unknown>;
};

function normalizeMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected server error";
}

function isMissingMigrationError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find the table") ||
    lower.includes("schema cache") ||
    (lower.includes("relation") && lower.includes("does not exist"))
  );
}

export function toSafeApiError(error: unknown, fallbackMessage: string): SafeError {
  /*
   * A plan refusal is ALREADY safe and already specific, so it passes straight
   * through rather than being matched on its wording.
   *
   * This branch is first for a reason: without it a PlanLimitError fell to the
   * bottom of this function and came back as a 500 "internal error" — the
   * enforcement decision would be correct, and the customer would be told the
   * product was broken. Every plan refusal must name the limit, the plan and the
   * upgrade path, and losing all three to a generic fallback is the exact
   * failure the typed error exists to prevent.
   */
  if (error instanceof PlanLimitError) {
    return {
      message: error.message,
      status: error.status,
      code: error.code,
      detail: error.detail,
    };
  }

  const rawMessage = normalizeMessage(error);
  const lower = rawMessage.toLowerCase();

  if (isMissingMigrationError(rawMessage)) {
    return {
      message:
        "This feature is temporarily unavailable because required database migrations are missing. Contact your admin to apply the latest schema updates.",
      status: 503,
      code: "missing_database_migration",
    };
  }

  if (lower.includes("workspaceid is required")) {
    return { message: "workspaceId is required", status: 400, code: "workspace_required" };
  }

  if (lower.includes("not found")) {
    return { message: rawMessage, status: 404, code: "not_found" };
  }

  if (lower.includes("quota exceeded")) {
    return { message: rawMessage, status: 402, code: "quota_exceeded" };
  }

  if (lower.includes("rate limit")) {
    return { message: rawMessage, status: 429, code: "rate_limited" };
  }

  if (lower.includes("not available on the") || lower.includes("requires a higher plan")) {
    return { message: rawMessage, status: 403, code: "feature_locked" };
  }

  return {
    message: fallbackMessage,
    status: 500,
    code: "internal_error",
  };
}

