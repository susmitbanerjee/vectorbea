import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Security headers applied to every response.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
};

/**
 * Resolve the caller's IP from Vercel-injected headers.
 * `x-real-ip`       — set by Vercel for direct requests.
 * `x-forwarded-for` — may be a comma-separated chain; the first entry is the
 *                     original client IP (leftmost = closest to the client).
 */
function getClientIp(request: NextRequest): string | null {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return null;
}

/**
 * Parse the WHITELISTED_IPS env var into a Set for O(1) lookup.
 * Expected format: "1.2.3.4,5.6.7.8,..."
 * Whitespace around entries is stripped; empty entries are ignored.
 */
function getAllowedIps(): Set<string> {
  const raw = process.env.WHITELISTED_IPS ?? "";
  return new Set(
    raw
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
}

export function middleware(request: NextRequest) {
  const env = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development' | undefined

  // Only gate non-production environments.
  if (env === "preview" || env === "development") {
    const allowedIps = getAllowedIps();

    // If no whitelist is configured, fail closed — deny all access.
    if (allowedIps.size === 0) {
      return new NextResponse("Access restricted: no IP whitelist configured.", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const clientIp = getClientIp(request);

    if (!clientIp || !allowedIps.has(clientIp)) {
      return new NextResponse("Access restricted.", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  // Production or IP check passed — attach security headers and continue.
  const response = NextResponse.next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(k, v);
  }
  return response;
}

export const config = {
  // Skip Next.js internals and all static assets. Run on everything else.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
