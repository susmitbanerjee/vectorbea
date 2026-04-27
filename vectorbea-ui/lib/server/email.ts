import "server-only";

/**
 * Email delivery abstraction.
 *
 * Configure via environment:
 *   EMAIL_PROVIDER=smtp|resend|sendgrid   (default: smtp)
 *   FROM_EMAIL=noreply@yourdomain.com
 *   APP_URL=https://app.yourdomain.com
 *
 *   SMTP:
 *     SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASSWORD, SMTP_SECURE (tls|starttls)
 *   Resend:
 *     RESEND_API_KEY
 *   SendGrid:
 *     SENDGRID_API_KEY
 */

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  error?: string;
}

// ─── Provider implementations ────────────────────────────────────────────────

async function sendViaResend(payload: EmailPayload): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, provider: "resend", error: "RESEND_API_KEY not set" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL ?? "noreply@vectorbea.app",
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, provider: "resend", error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true, provider: "resend" };
}

async function sendViaSendGrid(payload: EmailPayload): Promise<SendResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return { ok: false, provider: "sendgrid", error: "SENDGRID_API_KEY not set" };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: payload.to }] }],
      from: { email: process.env.FROM_EMAIL ?? "noreply@vectorbea.app" },
      subject: payload.subject,
      content: [
        { type: "text/plain", value: payload.text },
        { type: "text/html", value: payload.html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, provider: "sendgrid", error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true, provider: "sendgrid" };
}

async function sendViaSMTP(payload: EmailPayload): Promise<SendResult> {
  // Nodemailer is optional — only loaded if smtp provider is selected.
  // If nodemailer is not installed, fall back to logged simulation.
  try {
    // nodemailer is an optional peer dep — loaded at runtime only
    // eslint-disable-next-line
    const nodemailer = require("nodemailer");
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    const secure = process.env.SMTP_SECURE === "tls";

    if (!host) return { ok: false, provider: "smtp", error: "SMTP_HOST not set" };

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from: process.env.FROM_EMAIL ?? "noreply@vectorbea.app",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    return { ok: true, provider: "smtp" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // If nodemailer missing, simulate in development
    if (message.includes("Cannot find module")) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[email/smtp-sim] Would send email:", payload.subject, "→", payload.to);
        return { ok: true, provider: "smtp-sim" };
      }
      return { ok: false, provider: "smtp", error: "nodemailer not installed. Run: npm install nodemailer" };
    }
    return { ok: false, provider: "smtp", error: message };
  }
}

// ─── Public send function ─────────────────────────────────────────────────────

export async function sendEmail(payload: EmailPayload, retries = 2): Promise<SendResult> {
  const provider = (process.env.EMAIL_PROVIDER ?? "smtp").toLowerCase();

  let attempt = 0;
  let last: SendResult = { ok: false, provider, error: "No attempts made" };

  while (attempt <= retries) {
    try {
      if (provider === "resend") last = await sendViaResend(payload);
      else if (provider === "sendgrid") last = await sendViaSendGrid(payload);
      else last = await sendViaSMTP(payload);

      if (last.ok) return last;
    } catch (err) {
      last = { ok: false, provider, error: err instanceof Error ? err.message : String(err) };
    }
    attempt++;
    if (attempt <= retries) await new Promise((r) => setTimeout(r, 500 * attempt));
  }

  console.error("[email] Failed to send after retries:", last.error);
  return last;
}

export function emailConfigured(): boolean {
  const provider = (process.env.EMAIL_PROVIDER ?? "smtp").toLowerCase();
  if (provider === "resend") return !!process.env.RESEND_API_KEY;
  if (provider === "sendgrid") return !!process.env.SENDGRID_API_KEY;
  return !!process.env.SMTP_HOST;
}
