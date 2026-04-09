import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type AuditLogView } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.toString();
    const logs = await apiFetch<AuditLogView[]>(`/api/audit${query ? `?${query}` : ""}`);
    return NextResponse.json(logs);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load audit logs" },
      { status: 500 },
    );
  }
}
