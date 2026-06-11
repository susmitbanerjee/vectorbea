import { NextResponse } from "next/server";

/**
 * This route has been migrated to the Kotlin API.
 * The frontend now calls POST /api/workflows/:id/nodes/:nodeId/test directly.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Moved to Kotlin API: POST /api/workflows/:id/nodes/:nodeId/test" },
    { status: 410 },
  );
}
