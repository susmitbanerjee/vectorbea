import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { sendEmail } from "@/lib/server/email";
import {
  createIncident, listAllIncidents, listIncidentsForUser,
  isSupportAdmin, INCIDENT_CATEGORIES, INCIDENT_SEVERITIES,
} from "@/lib/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — admin sees everything; users see their own reports. */
export async function GET() {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const incidents = isSupportAdmin(user.email)
    ? await listAllIncidents()
    : await listIncidentsForUser(user.id);
  return NextResponse.json({ incidents, isAdmin: isSupportAdmin(user.email) });
}

/** POST — file a structured incident; notifies SUPPORT_EMAIL. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { category?: string; severity?: string; subject?: string; description?: string; pagePath?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const category = (body.category ?? "").trim();
  const severity = (body.severity ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const description = (body.description ?? "").trim();

  if (!(INCIDENT_CATEGORIES as readonly string[]).includes(category))
    return NextResponse.json({ error: "Pick a valid category." }, { status: 400 });
  if (!(INCIDENT_SEVERITIES as readonly string[]).includes(severity))
    return NextResponse.json({ error: "Pick a valid severity." }, { status: 400 });
  if (subject.length < 4 || subject.length > 160)
    return NextResponse.json({ error: "Subject must be 4–160 characters." }, { status: 400 });
  if (description.length < 10 || description.length > 5000)
    return NextResponse.json({ error: "Description must be 10–5000 characters." }, { status: 400 });

  try {
    const incident = await createIncident({
      reporterUserId: user.id,
      reporterEmail: user.email,
      category, severity, subject, description,
      pagePath: body.pagePath?.slice(0, 300) ?? null,
    });

    // Notify the support admin — failure here never fails the report.
    const adminEmail = process.env.SUPPORT_EMAIL;
    if (adminEmail) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
      const portal = appUrl ? `${appUrl}/support` : "https://support.vectorbea.com";
      const line = (k: string, v: string) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#9CA3AF;font-size:12px;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:4px 0;color:#0B0D0F;font-size:13px">${v}</td></tr>`;
      void sendEmail({
        to: adminEmail,
        subject: `[Vectorbea support] ${severity.toUpperCase()} · ${subject}`,
        html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:560px">
          <p style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9CA3AF;margin:0 0 6px">New support incident</p>
          <h2 style="margin:0 0 14px;font-size:18px;color:#0B0D0F">${escapeHtml(subject)}</h2>
          <table>${line("Incident", incident.id)}${line("Reporter", escapeHtml(user.email))}${line("Category", category)}${line("Severity", severity)}${line("Page", escapeHtml(body.pagePath ?? "—"))}</table>
          <p style="white-space:pre-wrap;border:1px solid #E0E3E6;border-radius:10px;padding:12px;font-size:13px;line-height:1.6;color:#374151;margin:14px 0">${escapeHtml(description)}</p>
          <a href="${portal}" style="display:inline-block;background:#0B0D0F;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px">Open support portal →</a>
        </div>`,
        text: `New support incident ${incident.id}\nReporter: ${user.email}\nCategory: ${category} · Severity: ${severity}\nPage: ${body.pagePath ?? "—"}\n\n${subject}\n\n${description}\n\nPortal: ${portal}`,
      }).catch((err) => console.error("[support] admin notification failed:", err));
    } else {
      console.warn("[support] SUPPORT_EMAIL not set — incident stored but admin not notified");
    }

    return NextResponse.json({ ok: true, incident }, { status: 201 });
  } catch (err) {
    console.error("[support] create failed:", err);
    return NextResponse.json({ error: "Could not file the report right now. Try again shortly." }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
