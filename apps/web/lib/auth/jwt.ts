import "server-only";
import { SignJWT, jwtVerify } from "jose";

const RAW_SECRET = process.env.JWT_SECRET ?? process.env.SUPABASE_JWT_SECRET ?? "";

function getSecret(): Uint8Array {
  if (!RAW_SECRET) throw new Error("JWT_SECRET env var is not set");
  return new TextEncoder().encode(RAW_SECRET);
}

export interface JwtPayload {
  sub: string;    // app_users.id (UUID)
  email: string;
  role?: string;
}

/** Sign a new JWT valid for 7 days. */
export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role ?? "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

/**
 * Sign a short-lived, purpose-scoped email-verification token (24h).
 * Stateless: no DB storage — the signature + purpose claim are the proof.
 */
export async function signEmailVerificationToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ email, purpose: "email_verify" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecret());
}

/** Verify an email-verification token. Returns userId+email or null. */
export async function verifyEmailVerificationToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  try {
    if (!RAW_SECRET) return null;
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub || payload["purpose"] !== "email_verify") return null;
    return { userId: payload.sub, email: (payload["email"] as string) ?? "" };
  } catch {
    return null;
  }
}

/** Verify and decode a JWT. Returns null if invalid/expired or if JWT_SECRET is not set. */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    if (!RAW_SECRET) return null;  // JWT_SECRET not configured — degrade gracefully
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      sub:   payload.sub,
      email: (payload["email"] as string) ?? "",
      role:  (payload["role"]  as string) ?? "authenticated",
    };
  } catch {
    return null;
  }
}
