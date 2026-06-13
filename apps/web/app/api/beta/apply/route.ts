import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
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

function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : request.nextUrl.origin;
}

/**
 * POST /api/beta/apply — same-origin proxy to the Kotlin API.
 *
 * - Auth via the httpOnly session cookie (reliable right after email verify).
 * - The Kotlin API stays the source of truth (validation + duplicate guard:
 *   re-applying returns alreadySubmitted instead of a second application).
 */
export async function POST(request: NextRequest) {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  const claims = token ? await verifyToken(token) : null;
  if (!token || !claims) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let form: Record<string, unknown>;
  try {
    form = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/api/beta/apply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Vectorbea-App-Url": requestOrigin(request),
      },
      body: JSON.stringify(form),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("[beta/apply] upstream failed:", err);
    return NextResponse.json({ error: "Could not submit right now. Try again shortly." }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({}));

  return NextResponse.json(body, { status: upstream.status });
}
