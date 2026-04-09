import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type DailyRequestPoint } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.toString();
    const points = await apiFetch<DailyRequestPoint[]>(`/api/dashboard/requests${query ? `?${query}` : ""}`);
    return NextResponse.json(points);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard requests" },
      { status: 500 },
    );
  }
}
