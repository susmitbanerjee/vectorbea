import { NextResponse } from "next/server";

import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health / diagnostic endpoint — no authentication required.
 *
 * GET /api/health
 *
 * Returns a JSON report of infrastructure connectivity and seed data status.
 * This is the first thing to check when API routes return errors.
 *
 * Response shape:
 *   { status: "ok" | "degraded", checks: { [name]: { ok, detail? } }, hint }
 *
 * HTTP 200 when all checks pass, 503 when any check fails.
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
      detail: "unavailable",
    };
  }

  // ── Redis connectivity ──────────────────────────────────────────────────
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  try {
    // Dynamically import ioredis to avoid bundler issues
    const { default: IORedis } = await import("ioredis");
    const redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    await redis.quit();
    checks.redis = { ok: true };
  } catch (err) {
    checks.redis = {
      ok: false,
      detail: "unavailable",
    };
  }

  // ── Seed org ────────────────────────────────────────────────────────────
  if (checks.database.ok) {
    try {
      const org = await db.organization.findFirst({ where: { slug: "acme-corp" } });
      checks.seed_org = {
        ok: !!org,
        detail: org
          ? `id=${org.id}`
          : "No organization with slug 'acme-corp' found. Run: npm run db:seed",
      };

      if (org) {
        const user = await db.user.findFirst({ where: { organizationId: org.id, role: "OWNER" } });
        checks.seed_user = {
          ok: !!user,
          detail: user ? `id=${user.id}` : "No OWNER user found in acme-corp. Run: npm run db:seed",
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
        detail: "unavailable",
      };
    }
  }

  // ── Env vars ─────────────────────────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL;
  let dbUrlDetail = "DATABASE_URL not set";
  if (dbUrl) {
    try {
      const u = new URL(dbUrl);
      dbUrlDetail = `user="${u.username}" host="${u.hostname}" port="${u.port || "5432"}"`;
    } catch {
      dbUrlDetail = `set but unparseable: ${dbUrl.slice(0, 40)}`;
    }
  }
  checks.env_database_url = { ok: !!dbUrl, detail: dbUrlDetail };

  checks.env_redis_url = {
    ok: !!process.env.REDIS_URL,
    detail: process.env.REDIS_URL
      ? `set: ${redisUrl}`
      : "REDIS_URL not set (using default redis://localhost:6379)",
  };

  checks.env_app_url = {
    ok: !!process.env.NEXT_PUBLIC_APP_URL,
    detail: process.env.NEXT_PUBLIC_APP_URL ?? "NEXT_PUBLIC_APP_URL not set",
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isOpenMode =
    !supabaseUrl ||
    supabaseUrl === "https://placeholder.supabase.co" ||
    supabaseUrl.includes("placeholder");
  checks.auth_mode = {
    ok: true, // both modes are valid
    detail: isOpenMode
      ? "open/mock-session mode (no Supabase auth)"
      : `supabase auth: ${supabaseUrl}`,
  };

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checks,
      hint: allOk
        ? "All checks passed. API routes should work correctly."
        : "One or more checks failed. See checks above and fix before retrying.",
    },
    { status: allOk ? 200 : 503 },
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
