import "server-only";
import { sendEmail, emailConfigured } from "@/lib/server/email";
import { signEmailVerificationToken } from "@/lib/auth/jwt";

/**
 * Sends the branded email-verification mail.
 *
 * Returns { sent } — callers must NOT surface provider/config errors to the
 * user; failures are logged server-side only.
 */
export async function sendVerificationEmail(
  userId: string,
  email: string,
  fullName?: string | null,
): Promise<{ sent: boolean }> {
  const token = await signEmailVerificationToken(userId, email);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const verifyUrl = `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const firstName = (fullName ?? "").trim().split(/\s+/)[0] || "there";

  const html = `
  <div style="margin:0;padding:32px 16px;background:#F7F8F9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div style="width:28px;height:28px;border-radius:8px;background:#0B0D0F;color:#fff;text-align:center;line-height:28px;font-weight:700;font-size:14px">V</div>
        <span style="font-size:16px;font-weight:700;color:#0B0D0F;letter-spacing:-0.02em">Vectorbea</span>
      </div>
      <div style="background:#FFFFFF;border:1px solid #E0E3E6;border-radius:14px;padding:32px 28px">
        <p style="margin:0;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9CA3AF">Verify your email</p>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#0B0D0F">Hi ${escapeHtml(firstName)}, confirm it&rsquo;s you.</h1>
        <p style="margin:14px 0 0;font-size:14px;line-height:1.65;color:#4B5563">
          Click the button below to verify <strong style="color:#0B0D0F">${escapeHtml(email)}</strong> and continue
          your Vectorbea private-beta application. This link expires in 24&nbsp;hours.
        </p>
        <a href="${verifyUrl}"
           style="display:inline-block;margin-top:22px;background:#007F4E;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:9px">
          Verify email &rarr;
        </a>
        <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#9CA3AF">
          If the button doesn&rsquo;t work, paste this link into your browser:<br/>
          <a href="${verifyUrl}" style="color:#007F4E;word-break:break-all">${verifyUrl}</a>
        </p>
      </div>
      <p style="margin:16px 4px 0;font-size:12px;color:#9CA3AF;line-height:1.6">
        You received this because someone signed up for Vectorbea with this address.
        If it wasn&rsquo;t you, you can safely ignore this email.
      </p>
    </div>
  </div>`;

  const text =
    `Hi ${firstName},\n\n` +
    `Verify your email to continue your Vectorbea private-beta application:\n${verifyUrl}\n\n` +
    `This link expires in 24 hours. If you didn't sign up, ignore this email.`;

  if (!emailConfigured()) {
    // Dev environments without an email provider: log the link so the flow is testable.
    console.warn(`[verify-email] email provider not configured — verification link for ${email}: ${verifyUrl}`);
    return { sent: false };
  }

  const result = await sendEmail({ to: email, subject: "Verify your email for Vectorbea", html, text });
  if (!result.ok) {
    // Server-side detail only; never returned to the browser.
    console.error(`[verify-email] send failed for ${email}: ${result.error}`);
  }
  return { sent: result.ok };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
