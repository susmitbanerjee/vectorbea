import { NextRequest, NextResponse } from "next/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/server/email";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemoRequestBody {
  full_name: string;
  work_email: string;
  company_name: string;
  role: string;
  company_size: string;
  llm_use_case: string;
  main_challenge: string;
  preferred_time?: string;
  source_page?: string;
}

// ─── Email helpers ────────────────────────────────────────────────────────────

function internalNotificationHtml(req: DemoRequestBody): string {
  const rows = [
    ["Name",            req.full_name],
    ["Email",           req.work_email],
    ["Company",         req.company_name],
    ["Role",            req.role],
    ["Company size",    req.company_size],
    ["LLM use case",    req.llm_use_case],
    ["Main challenge",  req.main_challenge],
    ["Preferred time",  req.preferred_time ?? "Not specified"],
    ["Source",          req.source_page ?? "/book-demo"],
  ];

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F8F5EF;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F5EF;padding:40px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="border-radius:14px;overflow:hidden;border:1px solid #E7DED1;background:#FFFFFF;">
      <tr>
        <td style="background:#111111;padding:28px 36px;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#F8F5EF;letter-spacing:0.12em;text-transform:uppercase;">
            VectorBea
          </p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#FFFFFF;letter-spacing:-0.02em;">
            New demo request
          </h1>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 36px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${rows.map(([label, value]) => `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #F1ECE3;vertical-align:top;width:40%;">
                <span style="font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.08em;">${label}</span>
              </td>
              <td style="padding:10px 0;border-bottom:1px solid #F1ECE3;vertical-align:top;">
                <span style="font-size:14px;color:#111111;">${value}</span>
              </td>
            </tr>`).join("")}
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
            <tr>
              <td align="center">
                <a href="mailto:${req.work_email}" style="display:inline-block;background:#2563EB;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;letter-spacing:-0.01em;">
                  Reply to ${req.full_name}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 36px;border-top:1px solid #F1ECE3;">
          <p style="margin:0;font-size:12px;color:#9CA3AF;">This is an internal notification from VectorBea demo request system</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function confirmationHtml(req: DemoRequestBody): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F8F5EF;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F5EF;padding:40px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="border-radius:14px;overflow:hidden;border:1px solid #E7DED1;background:#FFFFFF;">
      <tr>
        <td style="background:#111111;padding:28px 36px;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#F8F5EF;letter-spacing:0.12em;text-transform:uppercase;">VectorBea</p>
          <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#FFFFFF;letter-spacing:-0.02em;">Demo request received</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 36px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
            Hi ${req.full_name},
          </p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
            Thank you for requesting a VectorBea demo. We received your request and will be in touch shortly with available time slots.
          </p>
          <p style="margin:0 0 32px;font-size:15px;color:#374151;line-height:1.7;">
            In the meantime you can explore the docs and see how VectorBea handles tracing evaluations regressions and rollout safety for production LLM teams.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${process.env.APP_URL ?? "https://app.vectorbea.app"}/docs/overview" style="display:inline-block;background:#2563EB;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px;letter-spacing:-0.01em;">
                  Explore the docs
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 36px;border-top:1px solid #F1ECE3;">
          <p style="margin:0;font-size:12px;color:#9CA3AF;">VectorBea — AI risk control for production LLMs</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<DemoRequestBody>;

    // Validation
    const required: (keyof DemoRequestBody)[] = [
      "full_name", "work_email", "company_name", "role", "company_size",
      "llm_use_case", "main_challenge",
    ];
    const missing = required.filter((k) => !body[k]?.trim());
    if (missing.length) {
      return NextResponse.json({ error: `Missing required fields: ${missing.join(", ")}` }, { status: 400 });
    }

    const req = body as DemoRequestBody;

    // Email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.work_email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // ── Persist to DB ──────────────────────────────────────────────────────
    // TODO: Run the migration in supabase/migrations/ to create the demo_requests table
    // before this upsert becomes active. Until then it silently skips.
    let dbId: string | null = null;
    try {
      const supabase = createVectorBeaAdminClient();
      const { data, error } = await supabase
        .from("demo_requests")
        .insert({
          full_name:       req.full_name,
          work_email:      req.work_email,
          company_name:    req.company_name,
          role:            req.role,
          company_size:    req.company_size,
          llm_use_case:    req.llm_use_case,
          main_challenge:  req.main_challenge,
          preferred_time:  req.preferred_time ?? null,
          source_page:     req.source_page ?? "/book-demo",
          status:          "new",
        })
        .select("id")
        .single();

      if (!error && data) dbId = data.id as string;
      if (error) console.warn("[book-demo] DB insert skipped (table may not exist yet):", error.message);
    } catch (dbErr) {
      console.warn("[book-demo] DB unavailable:", dbErr instanceof Error ? dbErr.message : dbErr);
    }

    // ── Send internal notification ─────────────────────────────────────────
    const salesEmail = process.env.SALES_EMAIL ?? process.env.FROM_EMAIL;
    if (salesEmail) {
      try {
        await sendEmail({
          to:      salesEmail,
          subject: `New demo request — ${req.full_name} at ${req.company_name}`,
          html:    internalNotificationHtml(req),
          text:    `New demo request from ${req.full_name} (${req.work_email}) at ${req.company_name}. Challenge: ${req.main_challenge}`,
        });
      } catch (e) {
        console.error("[book-demo] Internal notification failed:", e instanceof Error ? e.message : e);
      }
    } else {
      // TODO: Set SALES_EMAIL env var to receive internal demo notifications
      console.log("[book-demo] No SALES_EMAIL set — skipping internal notification for:", req.work_email);
    }

    // ── Send requester confirmation ────────────────────────────────────────
    try {
      await sendEmail({
        to:      req.work_email,
        subject: "Demo request received — VectorBea",
        html:    confirmationHtml(req),
        text:    `Hi ${req.full_name}, thank you for requesting a VectorBea demo. We will be in touch shortly with available time slots.`,
      });
    } catch (e) {
      console.error("[book-demo] Confirmation email failed:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ ok: true, id: dbId });
  } catch (err) {
    console.error("[book-demo] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
