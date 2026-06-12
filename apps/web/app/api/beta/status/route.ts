import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiBase(): string {
  return (
    process.env.VECTORBEA_API_URL ??
    process.env.NEXT_PUBLIC_VECTORBEA_API_URL ??
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8080"
  )
    .trim().replace(/\/$/, "");
}

/**
 * GET /api/beta/status — same-origin proxy to the Kotlin API.
 *
 * Auth rides on the httpOnly session cookie instead of the localStorage token
 * copy (which is missing right after an email-verification click), so the
 * beta application page always works for a signed-in user.
 */
export async function GET() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const res = await fetch(`${apiBase()}/api/beta/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch (err) {
    console.error("[beta/status] upstream failed:", err);
    return NextResponse.json({ error: "Status is unavailable right now." }, { status: 502 });
  }
}
