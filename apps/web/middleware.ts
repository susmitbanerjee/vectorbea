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
// Stricter caps for credential endpoints; generous for normal API chatter.
const AUTH_LIMIT = 10;     // signin/signup/resend per IP per minute
const API_LIMIT = 240;     // all other /api/* per IP per minute

const AUTH_RATE_PATHS = [
  "/api/auth/signin", "/api/auth/signup", "/api/auth/resend-verification",
  "/api/auth/set-session", "/api/book-demo",
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
  if (authRedirect) return withSecurityHeaders(authRedirect);
  // Pass pathname to server components via header (needed for beta gate in layout.tsx)
  const response = NextResponse.next();
  response.headers.set("x-pathname", request.nextUrl.pathname);
  return withSecurityHeaders(response);
}

export const config = {
  // api/auth is included on purpose: the rate limiter must cover credential
  // endpoints (enforceAuth itself only gates page prefixes, so OAuth flows
  // are unaffected beyond security headers).
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
