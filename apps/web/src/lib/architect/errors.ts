import { isVectorbeaApiError } from "~/lib/api/errors";
import type { ArchitectUsage } from "./types";

/* ══════════════════════════════════════════════════════════════════════════════
   ARCHITECT FAILURES, SAID USEFULLY

   Every failure below is one a user can hit in normal use, and each one has a
   different next action. Collapsing them into "generation failed" — which is
   what a bare `catch` produces — costs the user the only information that
   matters: whether to wait, rewrite, connect something, or upgrade.

   The codes are the ones `WorkflowArchitectRoutes.kt` actually emits. It does
   NOT go through `errors/ApiError.kt`, so its bodies are flat
   (`{ error: "CODE", message: "…" }`) with domain payloads at the top level —
   `usage` on a 429, `reason`/`category` on a 422. `readEnvelope` in
   `~/lib/api/errors` flattens the first part; `raw` carries the rest.
══════════════════════════════════════════════════════════════════════════════ */

export interface ArchitectFailure {
  /** What happened, in the user's terms. */
  title: string;
  /** What it means for the work already done. */
  detail: string;
  /** The single next action. */
  fix: string;
  /** Whether trying the identical thing again could work. */
  retryable: boolean;
  /** Present when the failure is a spent build quota. */
  usage?: ArchitectUsage;
  /** For the support ticket. Null for non-HTTP faults. */
  reference?: string;
}

function usageFrom(raw: unknown): ArchitectUsage | undefined {
  if (!raw || typeof raw !== "object" || !("usage" in raw)) return undefined;
  const usage = (raw as { usage: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Partial<ArchitectUsage>;
  if (typeof u.limit !== "number" || typeof u.used !== "number") return undefined;
  return {
    used: u.used,
    limit: u.limit,
    remaining: u.remaining ?? Math.max(0, u.limit - u.used),
    periodDays: u.periodDays ?? 30,
    locked: u.locked ?? true,
    lastBuildAt: u.lastBuildAt ?? null,
    resetAt: u.resetAt ?? null,
  };
}

/**
 * Map any thrown value onto something the panel can render.
 *
 * The API's own `message` is preferred over anything written here wherever it
 * exists: these routes write genuinely specific sentences ("Goal exceeds 2000
 * chars", "Maximum revisions (3) reached"), and replacing one with a generic
 * paraphrase would be a downgrade.
 */
export function describeArchitectFailure(error: unknown): ArchitectFailure {
  if (!isVectorbeaApiError(error)) {
    return {
      title: "Something in the Architect failed",
      detail: error instanceof Error ? error.message : "The step did not complete.",
      fix: "Try that step again. Nothing has been created.",
      retryable: true,
    };
  }

  const message = error.message;
  const reference = error.status > 0 ? error.supportReference : undefined;
  const base = { retryable: error.isRetryable, reference };

  switch (error.code) {
    case "ARCHITECT_DISABLED":
      return {
        ...base,
        title: "The AI Architect is switched off on this deployment",
        detail: message,
        fix: "Build the workflow by hand, or ask an administrator to enable AI_ARCHITECT_ENABLED.",
        retryable: false,
      };

    case "ARCHITECT_USAGE_LIMIT_EXCEEDED":
      return {
        ...base,
        title: "This workspace has used its Architect build",
        detail: message,
        fix: "You can still build by hand or from a template — the limit applies only to generated plans.",
        retryable: false,
        usage: usageFrom(error.raw),
      };

    case "ARCHITECT_GOAL_OUT_OF_SCOPE":
      return {
        ...base,
        title: "That description is not an automation the Architect can design",
        detail: message,
        fix: "Describe something that starts on a trigger and does work — what begins it, what happens, and where a person decides.",
        retryable: false,
      };

    case "ARCHITECT_LLM_UNAVAILABLE":
      return {
        ...base,
        title: "The planning model could not be reached",
        detail: message,
        fix: "Your description is kept. Try again in a minute.",
        retryable: true,
      };

    case "PLAN_GENERATION_FAILED":
      return {
        ...base,
        title: "The plan could not be generated",
        detail: message,
        fix: "Nothing was created. Try again, or add a sentence about what starts the workflow and what it should touch.",
        retryable: true,
      };

    case "REVISION_FAILED":
      return {
        ...base,
        title: "The revision could not be applied",
        detail: message,
        fix: "The previous plan is untouched. Try wording the change more specifically.",
        retryable: true,
      };

    case "REVISION_LIMIT_EXCEEDED":
      return {
        ...base,
        title: "No revisions left on this plan",
        detail: message,
        fix: "Build what you have and edit it on the canvas, where changes are unlimited.",
        retryable: false,
      };

    case "ARCHITECT_BUILD_IN_PROGRESS":
      return {
        ...base,
        title: "Another build is already running for this workspace",
        detail: message,
        fix: "Wait for it to finish, then build again. Your plan is saved.",
        retryable: true,
      };

    case "WORKFLOW_CREATION_FAILED":
      return {
        ...base,
        title: "The workflow was not created",
        detail: message,
        fix: "Everything created during the attempt was rolled back — there is no half-built workflow. Try again.",
        retryable: true,
      };

    case "TOOL_GENERATION_FAILED":
    case "AGENT_GENERATION_FAILED":
      return {
        ...base,
        title: "Part of the build failed",
        detail: message,
        fix: "The plan is intact. Try building again.",
        retryable: true,
      };

    case "NOT_BOUND":
    case "CONNECTION_NOT_FOUND":
      return {
        ...base,
        title: "That connection cannot be tested",
        detail: message,
        fix: "Pick a connection for this requirement first, then test it.",
        retryable: false,
      };

    default:
      break;
  }

  if (error.intent === "unauthenticated") {
    return {
      ...base,
      title: "Your session has expired",
      detail: message,
      fix: "Sign in again. Your description is kept in this browser.",
      retryable: false,
    };
  }

  if (error.intent === "forbidden") {
    return {
      ...base,
      title: "You cannot use the Architect in this workspace",
      detail: message,
      fix: "Ask a workspace admin for the editor role.",
      retryable: false,
    };
  }

  if (error.intent === "validation") {
    return {
      ...base,
      title: "The request was rejected",
      detail: message,
      fix: "Fix what it names above and try again.",
      retryable: false,
    };
  }

  return {
    ...base,
    title: "The Architect could not complete that step",
    detail: message,
    fix: error.isRetryable ? "Try again — nothing was created." : "Nothing was created.",
  };
}
