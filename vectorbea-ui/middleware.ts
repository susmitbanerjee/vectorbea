import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

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
  const rawHost = request.nextUrl.hostname || request.headers.get("host") || "";
  return rawHost.toLowerCase().split(":")[0].trim();
}

function isProtectedHost(hostname: string) {
  return PROTECTED_HOST_PATTERNS.some((host) => hostname.includes(host));
}

function isPublicProductionHost(hostname: string) {
  return PUBLIC_HOST_PATTERNS.some((host) => hostname === host);
}

function getClientIp(request: NextRequest): string | null {
  const requestWithIp = request as NextRequest & { ip?: string | null };
  const directIp = requestWithIp.ip?.trim();
  if (directIp) {
    return directIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstForwardedIp = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .find(Boolean);

    if (firstForwardedIp) {
      return firstForwardedIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
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

function deny(ip: string | null) {
  return new NextResponse(
    `Access Denied.\nRejected IP: ${ip ?? "Unavailable"}\n`,
    {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
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

export function middleware(request: NextRequest) {
  const hostname = normalizeHostname(request);

  if (isPublicProductionHost(hostname)) {
    const authRedirect = enforceAuth(request);
    if (authRedirect) {
      return authRedirect;
    }
    return NextResponse.next();
  }

  if (!isProtectedHost(hostname)) {
    const authRedirect = enforceAuth(request);
    if (authRedirect) {
      return authRedirect;
    }
    return NextResponse.next();
  }

  const clientIp = getClientIp(request);
  const whitelistedIps = getWhitelistedIps();

  if (!clientIp || !whitelistedIps.has(clientIp)) {
    return deny(clientIp);
  }

  const authRedirect = enforceAuth(request);
  if (authRedirect) {
    return authRedirect;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
