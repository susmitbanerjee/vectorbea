import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import {
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
  loadProfileForUser,
} from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    return NextResponse.json({ authenticated: false, redirectTo: "/login" }, { status: 401 });
  }

  const [{ redirectTo }, profile] = await Promise.all([
    getPostLoginRedirectForUser(user.id),
    loadProfileForUser(user.id),
  ]);

  return NextResponse.json({
    authenticated: true,
    redirectTo,
    user: {
      id:       user.id,
      email:    user.email,
      fullName: profile?.full_name ?? null,
      avatarUrl:profile?.avatar_url ?? null,
    },
  });
}

export async function DELETE() {
  const expired = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 };
  const res = NextResponse.json({ authenticated: false });
  res.cookies.set(AUTH_COOKIE_NAME, "", expired);
  return res;
}
