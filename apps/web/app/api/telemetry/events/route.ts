import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/telemetry/events — same-origin telemetry ingestion proxy.
 *
 * Why a proxy instead of the browser posting straight to the telemetry
 * service:
 *  - Auth rides on the httpOnly session cookie, so events flow for every
 *    signed-in user (the old direct path silently dropped everything when
 *    the localStorage token copy was missing).
 *  - TELEMETRY_ENDPOINT / TELEMETRY_INTERNAL_TOKEN stay server-side — no
 *    NEXT_PUBLIC_* exposure and no CORS dependency.
 *
 * Always succeeds from the caller's perspective: telemetry must never
 * surface errors into the product UI.
 */
export async function POST(request: NextRequest) {
  const endpoint = (process.env.TELEMETRY_ENDPOINT ?? process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT ?? "").replace(/\/$/, "");
  const internalToken = process.env.TELEMETRY_INTERNAL_TOKEN ?? "";

  // Not configured → cheap no-op so the client never sees an error.
  if (!endpoint || !internalToken) return new NextResponse(null, { status: 204 });

  // Require a signed-in session; attribute events to it.
  const session = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  const claims = session ? await verifyToken(session) : null;
  if (!claims) return new NextResponse(null, { status: 204 });

  let batch: { events?: Array<Record<string, unknown>> };
  try {
    batch = (await request.json()) as { events?: Array<Record<string, unknown>> };
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!Array.isArray(batch.events) || batch.events.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Cap batch size; fill user attribution when the client didn't set it.
  const events = batch.events.slice(0, 50).map((e) => ({ appUserId: claims.sub, ...e }));

  try {
    await fetch(`${endpoint}/internal/telemetry/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telemetry-Token": internalToken,
        "X-Source-Service": "vectorbea-web",
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // fire-and-forget — never propagate telemetry failures
  }
  return new NextResponse(null, { status: 202 });
}
