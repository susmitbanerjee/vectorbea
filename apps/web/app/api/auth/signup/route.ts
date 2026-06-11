import { NextRequest, NextResponse } from "next/server";
import { createUser } from "@/lib/auth/neon-auth";
import { signToken } from "@/lib/auth/jwt";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic  = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName } = (await req.json()) as {
      email?: string; password?: string; fullName?: string;
    };

    if (!email?.trim())    return NextResponse.json({ error: "Email is required" }, { status: 400 });
    if (!password?.trim()) return NextResponse.json({ error: "Password is required" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

    const user  = await createUser(email, password, fullName);
    const token = await signToken({ sub: user.id, email: user.email });

    const res = NextResponse.json({
      user:        { id: user.id, email: user.email, fullName: user.full_name },
      accessToken: token,                // frontend stores for Kotlin API calls
    }, { status: 201 });

    res.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Signup failed";
    // Unique-violation → email already registered
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
    }
    console.error("[signup]", msg);
    return NextResponse.json({ error: "Signup failed. Please try again." }, { status: 500 });
  }
}
