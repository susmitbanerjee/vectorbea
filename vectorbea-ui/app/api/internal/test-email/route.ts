import { NextRequest, NextResponse } from "next/server";
import { assertInternalToken } from "@/app/api/internal/jobs/_auth";
import { sendEmail } from "@/lib/server/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/test-email
 * Body: { to: string }
 *
 * Protected by CRON_SECRET / INTERNAL_JOB_TOKEN.
 * Sends a plain test email so you can verify Resend is wired up correctly.
 */
export async function POST(request: NextRequest) {
  const auth = assertInternalToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({})) as { to?: string };
  const to = body.to;
  if (!to) return NextResponse.json({ error: "to (email address) is required in the request body" }, { status: 400 });

  // Log env state so you can see what the server actually sees
  const envState = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? "(not set — will auto-detect)",
    RESEND_API_KEY: process.env.RESEND_API_KEY ? `set (${process.env.RESEND_API_KEY.slice(0, 6)}...)` : "NOT SET",
    FROM_EMAIL: process.env.FROM_EMAIL ?? "(not set — using noreply@vectorbea.app)",
    APP_URL: process.env.APP_URL ?? "(not set)",
  };

  const result = await sendEmail({
    to,
    subject: "VectorBea — test email",
    html: `<p style="font-family:sans-serif">This is a test email from VectorBea.<br/><br/>If you received this, email delivery is working correctly.</p>`,
    text: "This is a test email from VectorBea. If you received this, email delivery is working correctly.",
  });

  return NextResponse.json({ result, envState });
}
