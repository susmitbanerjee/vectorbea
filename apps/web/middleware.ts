import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

const AUTH_PROTECTED_PREFIXES = [
  "/onboarding", "/control", "/dashboard", "/prompts", "/audit-logs",
  "/api-keys", "/settings", "/billing", "/workflows", "/runs",
  "/agents", "/tools", "/connections", "/approvals", "/schedules",
];

// ── Rate limiting (abuse protection) ─────────────────────────────────────────
// Fixed-window counters, in-memory per instance. First line of defense against
// brute force and API abuse; volumetric DDoS is absorbed at the edge
// (Vercel/Cloudflare) — application code cannot and should not handle that.
const RATE_BUCKETS = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
// Stricter caps for the session-establishing endpoints; generous for normal
// API chatter. The credential endpoints they used to guard are deleted — what
// remains worth limiting is the OAuth round-trip's landing points, which is
// where a token gets exchanged for a cookie.
const AUTH_LIMIT = 10;     // session-establishing calls per IP per minute
const API_LIMIT = 240;     // all other /api/* per IP per minute

const AUTH_RATE_PATHS = [
  "/api/auth/callback", "/api/auth/set-session", "/api/auth/token",
  "/api/book-demo",
];

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/")) return null;
  // Telemetry is high-volume by design and already cookie-gated + capped
  if (pathname.startsWith("/api/telemetry/")) return null;

  const isAuthPath = AUTH_RATE_PATHS.some((p) => pathname === p);
  const limit = isAuthPath ? AUTH_LIMIT : API_LIMIT;
  const key = `${isAuthPath ? "auth" : "api"}:${clientIp(request)}`;

  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    // Opportunistic cleanup so the map can't grow unbounded under churn
    if (RATE_BUCKETS.size > 10_000) {
      for (const [k, b] of RATE_BUCKETS) {
        if (now - b.windowStart >= WINDOW_MS) RATE_BUCKETS.delete(k);
      }
    }
    RATE_BUCKETS.set(key, { count: 1, windowStart: now });
    return null;
  }

  bucket.count += 1;
  if (bucket.count <= limit) return null;

  const retryAfter = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
  const res = NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429 },
  );
  res.headers.set("Retry-After", String(Math.max(1, retryAfter)));
  return res;
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE SESSION HINT

   The session cookie is httpOnly, so nothing on a page can read it. That is
   correct and stays that way — but it left the PUBLIC pages unable to tell a
   signed-in visitor from a stranger, so the landing page offered "Sign in" and
   "Start free" to someone who had been signed in for a week, and the docs header
   offered "Start free" as its only way back.

   Three ways to answer "is there a session" on a static page, and why this one:

     - Read it server-side. Correct, but `/` and every docs page are statically
       prerendered (`○` in the build output); reading cookies would turn the
       highest-traffic, most SEO-critical page into a per-request render, to
       change a button label.
     - Call `/api/auth/token`. Authoritative, but it is in AUTH_RATE_PATHS at ten
       requests per IP per minute — one office behind a NAT browsing the landing
       page would exhaust the budget that protects real sign-ins.
     - Mirror the session cookie into a readable, NON-IDENTIFYING boolean. Costs
       no request, no render, and is derived from the real cookie rather than
       from localStorage, which only the legacy auth path ever wrote.

   THIS IS PRESENTATION ONLY. It carries no identity, no token and no claim, and
   nothing may authorise on it: a forged `vb_signed_in=1` buys a visitor exactly
   one button label and a redirect back to /signin. Every gate stays on the
   httpOnly cookie — `enforceAuth` below, and the server checks in the (app)
   layout and on /signin, /signup and /login.
══════════════════════════════════════════════════════════════════════════════ */
const SESSION_HINT_COOKIE = "vb_signed_in";

function syncSessionHint(request: NextRequest, response: NextResponse) {
  const signedIn = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const hinted = request.cookies.get(SESSION_HINT_COOKIE)?.value === "1";

  // Only written when the two disagree. Otherwise every request to every page
  // and asset would carry a redundant Set-Cookie.
  if (signedIn === hinted) return response;

  response.cookies.set(SESSION_HINT_COOKIE, signedIn ? "1" : "", {
    // Readable on purpose — that is the entire point. Nothing sensitive is in it.
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Matches the session cookie's own lifetime. If the session expires first,
    // the next request through here clears the hint, so the two converge.
    maxAge: signedIn ? 60 * 60 * 24 * 7 : 0,
  });
  return response;
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
  const loginUrl = new URL("/signin", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const limited = checkRateLimit(request);
  if (limited) return withSecurityHeaders(limited);

  // support.vectorbea.com → the admin support portal. Assign the domain to
  // this Vercel project; the rewrite keeps API/auth paths working as-is.
  const host = request.headers.get("host") ?? "";
  if (host.startsWith("support.")) {
    const { pathname } = request.nextUrl;
    const passthrough = pathname.startsWith("/api/") || pathname.startsWith("/signin") ||
      pathname.startsWith("/signup") || pathname.startsWith("/support") || pathname.startsWith("/auth");
    if (!passthrough) {
      const url = request.nextUrl.clone();
      url.pathname = "/support";
      return withSecurityHeaders(NextResponse.rewrite(url));
    }
  }

  const authRedirect = enforceAuth(request);
  if (authRedirect) return withSecurityHeaders(syncSessionHint(request, authRedirect));
  // Pass pathname to server components via header (needed for beta gate in layout.tsx)
  const response = NextResponse.next();
  response.headers.set("x-pathname", request.nextUrl.pathname);
  return withSecurityHeaders(syncSessionHint(request, response));
}

export const config = {
  // api/auth is included on purpose: the rate limiter must cover credential
  // endpoints (enforceAuth itself only gates page prefixes, so OAuth flows
  // are unaffected beyond security headers).
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
