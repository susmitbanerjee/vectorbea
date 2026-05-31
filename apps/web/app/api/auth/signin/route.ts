import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth/neon-auth";
import { signToken } from "@/lib/auth/jwt";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic  = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as {
      email?: string; password?: string;
    };

    if (!email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const user = await verifyCredentials(email, password);
    if (!user) {
      // Deliberate vague message — don't reveal which field is wrong
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const token = await signToken({ sub: user.id, email: user.email });

    const res = NextResponse.json({
      user:        { id: user.id, email: user.email, fullName: user.full_name },
      accessToken: token,               // frontend stores for Kotlin API Authorization header
    });

    res.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err: unknown) {
    console.error("[signin]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sign in failed. Please try again." }, { status: 500 });
  }
}
