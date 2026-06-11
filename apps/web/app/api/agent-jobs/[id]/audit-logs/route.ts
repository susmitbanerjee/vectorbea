import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId } = await getMockSession();
    const { id } = await params;

    const logs = await db.auditLog.findMany({
      where: { organizationId, entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadataJson: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    });

    return NextResponse.json({ logs });
  } catch (err) {
    console.error("[audit-logs]", err);
    return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
  }
}
