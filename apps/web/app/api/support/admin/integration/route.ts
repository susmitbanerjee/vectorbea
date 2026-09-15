import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isSupportAdmin, supportLog } from "@/lib/server/support";
import { sendSpiceworksTest, spiceworksStatus } from "@/lib/server/support-spiceworks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) } as const;
  if (!isSupportAdmin(user.email)) {
    return { error: NextResponse.json({ error: "Support admin access required" }, { status: 403 }) } as const;
  }
  return { user } as const;
}

/** GET /api/support/admin/integration — whether tickets are forwarded to Spiceworks. */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ spiceworks: spiceworksStatus() });
}

/** POST /api/support/admin/integration — send a test ticket to Spiceworks. */
export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const result = await sendSpiceworksTest(auth.user.email);
  supportLog(result.ok ? "support.integration.test.sent" : "support.integration.test.failed", {
    adminEmail: auth.user.email, error: result.error ?? undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
