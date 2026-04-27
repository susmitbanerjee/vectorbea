import { NextRequest } from "next/server";

/**
 * Validate the internal job token.
 *
 * Priority order for token source:
 *   1. CRON_SECRET  — set automatically by Vercel Cron; Vercel sends it as
 *                     Authorization: Bearer <CRON_SECRET> on cron invocations.
 *   2. INTERNAL_JOB_TOKEN — set manually for GitHub Actions / Linux cron.
 *   3. INTERNAL_API_SECRET — legacy fallback.
 *
 * Accepted request headers (any one):
 *   Authorization: Bearer <token>          ← Vercel Cron (CRON_SECRET)
 *   x-internal-job-token: <token>          ← GitHub Actions / manual
 *   x-internal-secret: <token>             ← legacy
 */
export function assertInternalToken(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const configured =
    process.env.CRON_SECRET ??
    process.env.INTERNAL_JOB_TOKEN ??
    process.env.INTERNAL_API_SECRET;

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, status: 403, error: "No job token configured (set CRON_SECRET or INTERNAL_JOB_TOKEN)" };
    }
    return { ok: true }; // dev: allow unauthenticated
  }

  const authHeader = request.headers.get("authorization");
  const provided =
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader) ??
    request.headers.get("x-internal-job-token") ??
    request.headers.get("x-internal-secret") ??
    null;

  if (!provided || provided !== configured) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
