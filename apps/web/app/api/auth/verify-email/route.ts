import { NextRequest, NextResponse } from "next/server";
import { verifyEmailVerificationToken } from "@/lib/auth/jwt";
import { consumeVerificationToken } from "@/lib/auth/verification-tokens";
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
  //  - opaque single-use token: random bytes, hash-matched in the DB, expires
  //    in 24h, consumed atomically (replay returns invalid_or_expired)
  //  - legacy fallback for mails sent before the switch: 3-part base64url JWT,
  //    signature + purpose claim ("email_verify") verified with the server
  //    secret — a session token or forged string can't be repurposed
  //  - the token is never echoed into HTML/response, and every redirect target
  //    below is a hardcoded same-origin path (no open redirect)
  let subject: string | null = null;
  if (token.length > 0 && token.length <= 2048) {
    if (token.includes(".")) {
      // Legacy JWT-style link (transition period)
      if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
        subject = (await verifyEmailVerificationToken(token))?.userId ?? null;
      }
    } else {
      try {
        subject = (await consumeVerificationToken(token))?.subject ?? null;
      } catch (err) {
        console.error("[verify-email] token lookup failed:", err);
        return NextResponse.redirect(new URL("/verify-email?error=server", request.url));
      }
    }
  }

  if (!subject) {
    return NextResponse.redirect(new URL("/verify-email?error=invalid_or_expired", request.url));
  }

  try {
    await markEmailVerified(subject);
  } catch (err) {
    console.error("[verify-email] failed to mark verified:", err);
    return NextResponse.redirect(new URL("/verify-email?error=server", request.url));
  }

  // Verified → land on the beta approval form. If their session lapsed,
  // the signin page bounces them back to /beta afterwards.
  return NextResponse.redirect(new URL("/beta?verified=1", request.url));
}
