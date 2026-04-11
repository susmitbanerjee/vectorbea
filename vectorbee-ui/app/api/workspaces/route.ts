import { NextRequest, NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const workspace = await apiFetch<{ id: string; organizationId: string; name: string; createdAt: string }>(
      "/api/workspaces",
      { method: "POST", body: JSON.stringify(payload) },
    );
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create workspace" },
      { status: 500 },
    );
  }
}
