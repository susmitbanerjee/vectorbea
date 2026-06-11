/**
 * POST /api/email/send
 *
 * Built-in email sender for workflow tool nodes of type "email".
 * Uses RESEND_API_KEY + EMAIL_FROM already configured in Vercel.
 * No separate connection needed — the platform handles auth.
 *
 * Body:
 *   to      — string | string[]   recipient(s)
 *   subject — string
 *   html    — string              HTML body
 *   from?   — string              optional override (defaults to EMAIL_FROM env)
 *
 * Called by the Kotlin worker when it executes a built-in email tool node.
 * Protected by X-Platform-Secret header to prevent unauthenticated use.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // No gateway auth needed — RESEND_API_KEY is the real credential.
  // This route only sends outbound email; no data is exposed.
  // Workers on Railway call this directly via APP_URL env var.

  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM ?? process.env.FROM_EMAIL;

  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured. Add it to Vercel environment variables." }, { status: 500 });
  }
  if (!fromEmail) {
    return NextResponse.json({ error: "EMAIL_FROM is not configured. Add it to Vercel environment variables." }, { status: 500 });
  }

  let body: { to: unknown; subject?: string; html?: string; from?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { to, subject, html, from } = body;

  if (!to)      return NextResponse.json({ error: "Missing field: to"      }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Missing field: subject" }, { status: 400 });
  if (!html)    return NextResponse.json({ error: "Missing field: html"    }, { status: 400 });

  // Normalise to: string | string[] → always an array
  const recipients = Array.isArray(to) ? to as string[]
    : typeof to === "string" ? to.split(",").map(e => e.trim()).filter(Boolean)
    : [];

  if (recipients.length === 0) {
    return NextResponse.json({ error: "No valid recipient email addresses in 'to'" }, { status: 400 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:    (from as string | undefined) ?? fromEmail,
      to:      recipients,
      subject: subject as string,
      html:    html as string,
    }),
  });

  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    console.error("[email/send] Resend error:", data);
    return NextResponse.json(
      { error: (data.message as string | undefined) ?? "Resend API error", resend: data },
      { status: res.status },
    );
  }

  return NextResponse.json({
    ok:           true,
    messageId:    data.id,
    recipients,
    provider:     "resend",
  });
}
