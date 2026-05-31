import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Redirect to the shared /api/auth/callback which handles all OAuth providers.
 */
export async function GET(request: NextRequest) {
  const url = new URL("/api/auth/callback", request.url);
  // Forward all query params (code, state, error, etc.)
  request.nextUrl.searchParams.forEach((value, key) => url.searchParams.set(key, value));
  return NextResponse.redirect(url);
}
