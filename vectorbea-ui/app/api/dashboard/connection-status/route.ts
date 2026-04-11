import { NextRequest, NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

interface ConnectionStatus {
  connected: boolean;
  lastSeenAt: string | null;
  recentCallCount: number;
}

export async function GET(request: NextRequest) {
  try {
    const wsId = request.nextUrl.searchParams.get("workspaceId")
      ?? request.nextUrl.searchParams.get("organizationId"); // back-compat
    if (!wsId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    const status = await apiFetch<ConnectionStatus>(
      `/api/dashboard/connection-status?workspaceId=${encodeURIComponent(wsId)}`,
    );
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load connection status" },
      { status: 500 },
    );
  }
}
