/**
 * User-facing error helpers.
 *
 * Goal: the message shown to the user and the message written to the log are the
 * SAME human-readable sentence — never a raw `HTTP 500` or a stack trace in the
 * UI, and never a cryptic console line that doesn't match what the user saw.
 * The raw error is still attached to the console line for debugging.
 */

import { ApiError } from "@/lib/api/client";

/**
 * Maps any thrown value to a friendly, user-readable sentence.
 * Prefers a human `message` the server already provided (ApiError), otherwise
 * translates common technical/network failures, falling back to [fallback].
 */
export function friendlyMessage(err: unknown, fallback: string): string {
  // The API client already surfaces the server's human-readable `message`.
  if (err instanceof ApiError) {
    const m = err.message?.trim();
    if (m && !/^API error \d+$/i.test(m) && !/^HTTP \d+$/i.test(m)) return m;
    return statusMessage(err.status, fallback);
  }

  if (err instanceof Error) {
    const m = err.message ?? "";
    const statusMatch = /HTTP\s*(\d{3})/i.exec(m);
    if (statusMatch) {
      const friendly = statusMessage(Number(statusMatch[1]), "");
      if (friendly) return friendly;
    }
    if (/failed to fetch|networkerror|load failed|fetch failed|ECONNREFUSED/i.test(m)) {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    if (/timeout|timed out/i.test(m)) {
      return "The request took too long. Please try again.";
    }
    // A message that isn't obviously technical is probably already meant for humans.
    if (m && !/^HTTP \d+$/i.test(m)) return m;
  }

  return fallback;
}

function statusMessage(status: number, fallback: string): string {
  switch (status) {
    case 401: return "Your session has expired — please sign in again.";
    case 403: return "You don't have permission to do that.";
    case 404: return fallback || "We couldn't find what you were looking for.";
    case 409: return "That conflicts with the current state — refresh and try again.";
    case 422: return fallback || "That request couldn't be processed.";
    case 429: return "Too many requests — please wait a moment and try again.";
    case 500:
    case 502:
    case 503:
    case 504: return "Something went wrong on our side. Please try again shortly.";
    default:  return fallback;
  }
}

/**
 * Logs the user-facing message (so logs match what the user sees) along with the
 * raw error for debugging, and returns the friendly message to display.
 */
export function reportError(context: string, err: unknown, fallback: string): string {
  const message = friendlyMessage(err, fallback);
  console.error(`[${context}] ${message}`, err);
  return message;
}
