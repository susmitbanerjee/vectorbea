import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

const AUTH_PROTECTED_PREFIXES = [
  "/onboarding", "/dashboard", "/prompts", "/audit-logs",
  "/api-keys", "/settings", "/billing", "/workflows", "/runs",
  "/agents", "/tools", "/connections", "/approvals", "/schedules",
];

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
  const authRedirect = enforceAuth(request);
  if (authRedirect) return withSecurityHeaders(authRedirect);
  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|api/auth/).*)"],
};
