import { NextResponse } from "next/server";

/**
 * This route has been migrated to the Kotlin API.
 * The frontend now calls GET/PATCH /api/workflows/:id directly.
 */
export async function GET() {
  return NextResponse.json({ error: "Moved to Kotlin API: GET /api/workflows/:id" }, { status: 410 });
}

export async function PUT() {
  return NextResponse.json({ error: "Moved to Kotlin API: PATCH /api/workflows/:id" }, { status: 410 });
}
