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

/** Verify and decode a JWT. Returns null if invalid/expired. */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
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
