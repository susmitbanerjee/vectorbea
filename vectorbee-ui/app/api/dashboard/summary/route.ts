import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type DashboardSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.toString();
    const summary = await apiFetch<DashboardSummary>(`/api/dashboard/summary${query ? `?${query}` : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard summary" },
      { status: 500 },
    );
  }
}
