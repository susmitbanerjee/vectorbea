/**
 * DEV-ONLY endpoint — approve beta access for local testing.
 * Blocked in production. Requires DEV_ADMIN_SECRET env var.
 *
 * Usage:
 *   curl -X POST http://localhost:3000/api/dev/approve-beta \
 *     -H "x-dev-secret: your_secret" \
 *     -H "Content-Type: application/json" \
 *     -d '{"email": "you@example.com"}'
 */
import { NextRequest, NextResponse } from "next/server";
import { appSql } from "@/lib/server/app-db";

export const dynamic = "force-dynamic";

function db() {
  return appSql;
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const devSecret = process.env.DEV_ADMIN_SECRET;
  if (!devSecret) {
    return NextResponse.json(
      { error: "Set DEV_ADMIN_SECRET in .env.local, then retry." },
      { status: 503 },
    );
  }

  if (request.headers.get("x-dev-secret") !== devSecret) {
    return NextResponse.json({ error: "Invalid dev secret" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { email?: string };
  const email = body.email?.trim();
  if (!email) {
    return NextResponse.json({ error: "email required in body" }, { status: 400 });
  }

  try {
    const sql = db();
    const result = await sql`
      UPDATE app_users
      SET beta_status = 'approved', is_platform_admin = true, updated_at = now()
      WHERE LOWER(email) = LOWER(${email})
      RETURNING id, email, beta_status, is_platform_admin
    ` as { id: string; email: string; beta_status: string; is_platform_admin: boolean }[];

    if (result.length === 0) {
      return NextResponse.json(
        { error: `No user found with email ${email}. Sign up first.` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `✅ ${email} approved with platform admin access`,
      user: result[0],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("column") && msg.includes("does not exist")) {
      return NextResponse.json(
        { error: "V015 migration not applied yet. Set RUN_MIGRATIONS=true on api-kotlin and redeploy." },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
