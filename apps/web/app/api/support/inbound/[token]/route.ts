import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supportLog } from "@/lib/server/support";
import { normaliseInbound } from "@/lib/server/support-inbound";
import { processInboundEmail } from "@/lib/server/support-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/support/inbound/{token} — mail arriving at the support mailbox.
 *
 * Point the inbound-mail provider for SUPPORT_INBOUND_ADDRESS here (SendGrid
 * Inbound Parse, a Mailgun route, Postmark inbound, or anything that posts JSON).
 * The token in the path is the only authentication, so it is compared in constant
 * time and must be at least 24 characters.
 *
 * Answers 200 for anything it understood, including mail it chose to ignore:
 * providers retry non-2xx responses, and retrying an ignored message changes
 * nothing except the noise.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const expected = process.env.SUPPORT_INBOUND_TOKEN?.trim() ?? "";
  if (expected.length < 24) {
    return NextResponse.json({ error: "Inbound support mail is not configured." }, { status: 503 });
  }
  const { token } = await params;
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return NextResponse.json({ error: "Message too large" }, { status: 413 });

  const type = request.headers.get("content-type") ?? "";
  let email;
  try {
    email = type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")
      ? normaliseInbound({ form: await request.formData() })
      : normaliseInbound({ json: (await request.json()) as Record<string, unknown> });
  } catch {
    return NextResponse.json({ error: "Could not read the message" }, { status: 400 });
  }
  if (!email) {
    supportLog("support.inbound.unreadable", { error: "no usable sender" });
    return NextResponse.json({ ok: true, outcome: "ignored", reason: "no usable sender" });
  }

  try {
    const result = await processInboundEmail(email);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // A database failure: let the provider retry.
    supportLog("support.inbound.failed", { error: err });
    return NextResponse.json({ error: "Could not process the message" }, { status: 500 });
  }
}
