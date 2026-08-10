import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isSupportAdmin, listTickets, supportLog, type TicketFilter } from "@/lib/server/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/support/admin/tickets — cross-tenant ticket list for support admins.
 *
 * Authorization is enforced here on the server: unauthenticated → 401,
 * non-admin → 403. Never returns ticket data before the admin check passes.
 * Query: ?filter=all|open|resolved  ?q=<search>  ?page=<n>  ?pageSize=<n>
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isSupportAdmin(user.email)) {
    return NextResponse.json({ error: "Support admin access required" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const filterRaw = (params.get("filter") ?? "all").toLowerCase();
  const filter: TicketFilter = filterRaw === "open" || filterRaw === "resolved" ? filterRaw : "all";
  const search = params.get("q");
  const pageSize = Math.min(Math.max(parseInt(params.get("pageSize") ?? "100", 10) || 100, 1), 200);
  const page = Math.max(parseInt(params.get("page") ?? "1", 10) || 1, 1);

  try {
    const result = await listTickets({ filter, search, limit: pageSize, offset: (page - 1) * pageSize });
    supportLog("support.ticket.list", { adminEmail: user.email });
    return NextResponse.json({ ...result, page, pageSize });
  } catch (err) {
    supportLog("support.ticket.list.failed", { adminEmail: user.email, error: err });
    return NextResponse.json({ error: "Could not load tickets." }, { status: 500 });
  }
}
