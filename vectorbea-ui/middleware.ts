import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, SESSION_ID_COOKIE_NAME } from "@/lib/auth/cookies";

const PROTECTED_HOST_PATTERNS = ["dev.vectorbea.com", "stage.vectorbea.com"];
const PUBLIC_HOST_PATTERNS = ["vectorbea.com", "www.vectorbea.com"];
const AUTH_PROTECTED_PREFIXES = [
  "/onboarding",
  "/dashboard",
  "/prompts",
  "/audit-logs",
  "/api-keys",
  "/settings",
  "/billing",
];

function normalizeHostname(request: NextRequest) {
  const rawHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.hostname ||
    "";
  return rawHost.toLowerCase().split(":")[0].trim();
}

function isProtectedHost(hostname: string) {
  return PROTECTED_HOST_PATTERNS.some((host) => hostname.includes(host));
}

function isPublicProductionHost(hostname: string) {
  return PUBLIC_HOST_PATTERNS.some((host) => hostname === host);
}

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstForwardedIp = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .find(Boolean);

    if (firstForwardedIp) {
      return firstForwardedIp.replace(/:\d+$/, "");
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp.replace(/:\d+$/, "");
  }

  const requestWithIp = request as NextRequest & { ip?: string | null };
  const directIp = requestWithIp.ip?.trim();
  if (directIp) {
    return directIp.replace(/:\d+$/, "");
  }

  return null;
}

function getWhitelistedIps() {
  return new Set(
    (process.env.WHITELISTED_IPS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

// Requests from within the Next.js runtime (server components calling their
// own API routes) arrive from AWS infra IPs, not the user's IP. Allow them
// through if they carry the correct internal secret so the IP whitelist does
// not block server-to-server calls.
function isInternalRequest(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  return request.headers.get("x-internal-secret") === secret;
}

function deny(ip: string | null, hostname: string) {
  const response = new NextResponse(
    `Access Denied.\nRejected IP: ${ip ?? "Unavailable"}\nHost: ${hostname || "Unavailable"}\n`,
    {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
  return withSecurityHeaders(response);
}

function withSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function isAuthProtectedPath(pathname: string) {
  return AUTH_PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function enforceAuth(request: NextRequest) {
  const sessionToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!isAuthProtectedPath(request.nextUrl.pathname) || sessionToken) {
    return null;
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(loginUrl);
}

// ── Seat-sharing prevention ───────────────────────────────────────────────────
//
// Strategy
// ────────
// Every login writes a fresh UUID to vectorbea.profiles.current_session_id
// AND sets that same UUID in the vb_session_id httpOnly cookie.
// On each protected page request this function:
//   1. Decodes the JWT locally to extract the user ID (sub claim).
//      We do NOT fully verify the signature here — Supabase validates the
//      token on every authenticated DB call; middleware just needs the sub.
//   2. Calls Supabase REST directly (Edge-compatible fetch, no server-only deps).
//   3. Compares the cookie UUID against the DB UUID.
//      Mismatch → another device rotated the UUID → kill this session.
//
// Performance: one REST call per protected page navigation (~5-20 ms on the
// same-region deployment). API routes are NOT checked here — they carry out
// their own auth and this protection targets interactive sessions.

function decodeJwtSub(token: string): string | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    // Base64url → Base64
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded);
    const payload = JSON.parse(json) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

async function enforceSessionConcurrency(
  request: NextRequest,
): Promise<NextResponse | null> {
  // Only run on protected pages, and only when the user appears to be logged in.
  if (!isAuthProtectedPath(request.nextUrl.pathname)) return null;

  const accessToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const cookieSessionId = request.cookies.get(SESSION_ID_COOKIE_NAME)?.value;

  // If either cookie is missing the request will already be redirected to
  // /login by enforceAuth() — nothing more to do here.
  if (!accessToken || !cookieSessionId) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // If env vars are absent (e.g. early boot) let the request through —
  // the downstream route handlers will catch auth errors.
  if (!supabaseUrl || !serviceRoleKey) return null;

  const userId = decodeJwtSub(accessToken);
  if (!userId) return null;

  try {
    // Query vectorbea.profiles.current_session_id by primary key.
    // Accept-Profile routes the query to the vectorbea schema (PostgREST spec).
    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=current_session_id&id=eq.${encodeURIComponent(userId)}&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Accept-Profile": "vectorbea",
          Accept: "application/json",
        },
        // Don't cache — we need the live DB value every time.
        cache: "no-store",
      },
    );

    if (!res.ok) {
      // Supabase REST error — let the request through and let API routes handle it.
      console.warn("[middleware] session concurrency check failed:", res.status);
      return null;
    }

    const rows = (await res.json()) as Array<{ current_session_id: string | null }>;
    const dbSessionId = rows[0]?.current_session_id ?? null;

    // No session ID recorded yet means the user hasn't logged in via the new
    // flow (e.g. a pre-existing session). Let them through — they'll get a
    // fresh UUID on their next login.
    if (!dbSessionId) return null;

    if (dbSessionId !== cookieSessionId) {
      // ── Session displaced: another device logged in and rotated the UUID ──
      console.info(
        `[middleware] session displaced for user ${userId} — killing session`,
      );

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "session_expired");

      const response = NextResponse.redirect(loginUrl);

      const expiredOptions = {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      };
      response.cookies.set(AUTH_COOKIE_NAME, "", expiredOptions);
      response.cookies.set(SESSION_ID_COOKIE_NAME, "", expiredOptions);

      return response;
    }
  } catch (err) {
    // Network error or JSON parse failure — fail open so a transient Supabase
    // hiccup doesn't lock users out. Log for observability.
    console.warn("[middleware] session concurrency check exception:", err);
  }

  return null;
}

export async function middleware(request: NextRequest) {
  const hostname = normalizeHostname(request);
  const pathname = request.nextUrl.pathname;

  if (isPublicProductionHost(hostname)) {
    const authRedirect = enforceAuth(request);
    if (authRedirect) return withSecurityHeaders(authRedirect);

    const concurrencyRedirect = await enforceSessionConcurrency(request);
    if (concurrencyRedirect) return withSecurityHeaders(concurrencyRedirect);

    return withSecurityHeaders(NextResponse.next());
  }

  if (!isProtectedHost(hostname)) {
    const authRedirect = enforceAuth(request);
    if (authRedirect) return withSecurityHeaders(authRedirect);

    const concurrencyRedirect = await enforceSessionConcurrency(request);
    if (concurrencyRedirect) return withSecurityHeaders(concurrencyRedirect);

    return withSecurityHeaders(NextResponse.next());
  }

  // M2M proxy endpoints perform their own Bearer-token validation and should
  // not be blocked by dashboard IP allowlists.
  if (pathname.startsWith("/api/proxy/")) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (isInternalRequest(request)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const clientIp = getClientIp(request);
  const whitelistedIps = getWhitelistedIps();

  if (!clientIp || !whitelistedIps.has(clientIp)) {
    return deny(clientIp, hostname);
  }

  const authRedirect = enforceAuth(request);
  if (authRedirect) return withSecurityHeaders(authRedirect);

  const concurrencyRedirect = await enforceSessionConcurrency(request);
  if (concurrencyRedirect) return withSecurityHeaders(concurrencyRedirect);

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
