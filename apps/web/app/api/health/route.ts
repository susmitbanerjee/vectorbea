import { NextResponse } from "next/server";

import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health / diagnostic endpoint — no authentication required.
 *
 * Visit /api/health to get a JSON report of what's working and what isn't.
 * This is the first thing to check when API routes return errors.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // ── Database connectivity ───────────────────────────────────────────────
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (err) {
    checks.database = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // ── Seed org ────────────────────────────────────────────────────────────
  if (checks.database.ok) {
    try {
      const org = await db.organization.findFirst({ where: { slug: "acme-corp" } });
      checks.seed_org = {
        ok: !!org,
        detail: org ? `id=${org.id}` : "No organization with slug 'acme-corp' found. Run the seed SQL.",
      };

      if (org) {
        const user = await db.user.findFirst({ where: { organizationId: org.id, role: "OWNER" } });
        checks.seed_user = {
          ok: !!user,
          detail: user ? `id=${user.id}` : "No OWNER user found in acme-corp. Check seed SQL.",
        };

        const jobCount = await db.agentJob.count({ where: { organizationId: org.id } });
        checks.seed_jobs = {
          ok: jobCount > 0,
          detail: `${jobCount} agent job(s) found`,
        };
      }
    } catch (err) {
      checks.seed_org = {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Env vars ─────────────────────────────────────────────────────────────
  checks.env_database_url = {
    ok: !!process.env.DATABASE_URL,
    detail: process.env.DATABASE_URL
      ? `set (starts with: ${process.env.DATABASE_URL.slice(0, 20)}...)`
      : "DATABASE_URL not set",
  };
  checks.env_supabase = {
    ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    detail: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `set: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`
      : "NEXT_PUBLIC_SUPABASE_URL not set (open/mock mode active)",
  };

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checks,
      hint: allOk
        ? "All checks passed. API routes should work correctly."
        : "One or more checks failed. Fix the issues above, then retry.",
    },
    { status: allOk ? 200 : 503 },
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
