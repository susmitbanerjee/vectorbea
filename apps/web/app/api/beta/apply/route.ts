import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";
import { sendEmail } from "@/lib/server/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiBase(): string {
  return (process.env.VECTORBEA_API_URL ?? process.env.NEXT_PUBLIC_VECTORBEA_API_URL ?? "http://localhost:8080")
    .trim().replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * POST /api/beta/apply — same-origin proxy to the Kotlin API.
 *
 * - Auth via the httpOnly session cookie (reliable right after email verify).
 * - The Kotlin API stays the source of truth (validation + duplicate guard:
 *   re-applying returns alreadySubmitted instead of a second application).
 * - On a NEW application, the admin (SUPPORT_EMAIL / ADMIN_EMAIL) gets a
 *   whitelisting-request email with the form details (HTML-escaped).
 */
export async function POST(request: NextRequest) {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  const claims = token ? await verifyToken(token) : null;
  if (!token || !claims) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let form: Record<string, unknown>;
  try {
    form = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/api/beta/apply`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(form),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("[beta/apply] upstream failed:", err);
    return NextResponse.json({ error: "Could not submit right now. Try again shortly." }, { status: 502 });
  }

  const body = (await upstream.json().catch(() => ({}))) as { alreadySubmitted?: boolean };

  // Notify the admin only for genuinely new applications — duplicates
  // (alreadySubmitted) and validation failures don't email.
  if (upstream.ok && !body.alreadySubmitted) {
    const adminEmail = process.env.SUPPORT_EMAIL ?? process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const f = (k: string) => String(form[k] ?? "—").slice(0, 500);
      const row = (k: string, v: string) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#9CA3AF;font-size:12px;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:4px 0;color:#0B0D0F;font-size:13px">${escapeHtml(v)}</td></tr>`;
      void sendEmail({
        to: adminEmail,
        subject: `[Vectorbea beta] New application from ${claims.email}`,
        html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:560px">
          <p style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9CA3AF;margin:0 0 6px">Whitelisting request</p>
          <h2 style="margin:0 0 14px;font-size:18px;color:#0B0D0F">${escapeHtml(f("fullName"))} wants access</h2>
          <table>
            ${row("Email", claims.email)}
            ${row("Company", f("company"))}
            ${row("Role", f("role"))}
            ${row("Runs / week", f("workflowsPerWeek"))}
            ${row("Team size", f("teamSize"))}
            ${row("Current tools", f("currentTools"))}
            ${row("Pain point", f("painPoint"))}
            ${row("BYOK ready", String(form["byokReady"] === true))}
          </table>
          <p style="white-space:pre-wrap;border:1px solid #E0E3E6;border-radius:10px;padding:12px;font-size:13px;line-height:1.6;color:#374151;margin:14px 0">${escapeHtml(String(form["useCase"] ?? ""))}</p>
          <p style="font-size:12px;color:#6B7280">Approve or reject from the admin beta controls.</p>
        </div>`,
        text:
          `New beta application\n\nName: ${f("fullName")}\nEmail: ${claims.email}\nCompany: ${f("company")}\nRole: ${f("role")}\n` +
          `Runs/week: ${f("workflowsPerWeek")} · Team: ${f("teamSize")}\nTools: ${f("currentTools")}\nPain: ${f("painPoint")}\nBYOK: ${form["byokReady"] === true}\n\nUse case:\n${String(form["useCase"] ?? "")}`,
      }).catch((err) => console.error("[beta/apply] admin notification failed:", err));
    } else {
      console.warn("[beta/apply] SUPPORT_EMAIL/ADMIN_EMAIL not set — application stored but admin not emailed");
    }
  }

  return NextResponse.json(body, { status: upstream.status });
}
