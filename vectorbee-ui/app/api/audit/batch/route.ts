import { NextRequest, NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const response = await apiFetch("/api/audit/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to insert audit logs" },
      { status: 500 },
    );
  }
}
