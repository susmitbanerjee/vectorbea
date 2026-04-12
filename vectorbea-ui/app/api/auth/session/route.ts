import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import {
  getAuthenticatedUserForAccessToken,
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
} from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    return NextResponse.json(
      { authenticated: false, redirectTo: "/login" },
      { status: 401 },
    );
  }

  const { redirectTo } = await getPostLoginRedirectForUser(user.id);
  return NextResponse.json({
    authenticated: true,
    redirectTo,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { accessToken?: string };
    const accessToken = payload.accessToken?.trim();

    if (!accessToken) {
      return NextResponse.json(
        { error: "accessToken is required" },
        { status: 400 },
      );
    }

    const user = await getAuthenticatedUserForAccessToken(accessToken);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid Supabase session" },
        { status: 401 },
      );
    }

    const { redirectTo } = await getPostLoginRedirectForUser(user.id);
    const response = NextResponse.json({
      authenticated: true,
      redirectTo,
      user: {
        id: user.id,
        email: user.email ?? null,
      },
    });

    response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to establish auth session",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
