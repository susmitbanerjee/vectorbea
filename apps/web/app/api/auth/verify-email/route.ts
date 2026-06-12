import { NextRequest, NextResponse } from "next/server";
import { verifyEmailVerificationToken } from "@/lib/auth/jwt";
import { markEmailVerified } from "@/lib/auth/neon-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/verify-email?token=…
 *
 * Landing for the link in the verification mail. Validates the signed,
 * purpose-scoped token, flips email_verified, and sends the user to the
 * private-beta application form.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";

  // Injection hardening — the token is the ONLY user-controlled input here:
  //  - shape-check (3-part base64url JWT, bounded length) before any crypto work
  //  - signature + purpose claim ("email_verify") verified with the server secret,
  //    so a token can't be forged or repurposed from a session JWT
  //  - the token is never echoed into HTML/response, and every redirect target
  //    below is a hardcoded same-origin path (no open redirect)
  const looksLikeJwt = token.length > 0 && token.length <= 2048 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
  const claims = looksLikeJwt ? await verifyEmailVerificationToken(token) : null;

  if (!claims) {
    return NextResponse.redirect(new URL("/verify-email?error=invalid_or_expired", request.url));
  }

  try {
    await markEmailVerified(claims.userId);
  } catch (err) {
    console.error("[verify-email] failed to mark verified:", err);
    return NextResponse.redirect(new URL("/verify-email?error=server", request.url));
  }

  // Verified → land on the beta approval form. If their session lapsed,
  // the signin page bounces them back to /beta afterwards.
  return NextResponse.redirect(new URL("/beta?verified=1", request.url));
}
