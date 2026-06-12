import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { getUserById, isEmailVerified, markEmailVerified } from "@/lib/auth/neon-auth";
import { sendVerificationEmail } from "@/lib/auth/verification-email";
import { emailConfigured } from "@/lib/server/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-user cooldown so the endpoint can't be used to spam someone's inbox.
// In-memory per instance — good enough as a first line; the platform rate
// limiter covers the rest.
const lastSent = new Map<string, number>();
const COOLDOWN_MS = 60_000;

/** POST /api/auth/resend-verification — re-sends the confirmation mail. */
export async function POST() {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (await isEmailVerified(user.id)) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  // No email provider configured → this account can NEVER receive the mail.
  // Heal it: auto-verify instead of leaving the user stuck on the screen.
  if (!emailConfigured()) {
    console.warn(`[verify-email] no email provider configured — auto-verifying ${user.email}`);
    await markEmailVerified(user.id);
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const last = lastSent.get(user.id) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a minute before requesting another email." }, { status: 429 });
  }
  lastSent.set(user.id, Date.now());

  const profile = await getUserById(user.id);
  const { sent } = await sendVerificationEmail(user.id, user.email, profile?.full_name);
  if (!sent) {
    // Honest but generic — details (provider/config) stay in server logs.
    return NextResponse.json(
      { error: "We couldn't send the email right now. Please try again in a few minutes." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
