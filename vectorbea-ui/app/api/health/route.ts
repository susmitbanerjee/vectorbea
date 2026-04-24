import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Health check endpoint — no authentication required.
 * Used by the proxy sidecar's HubClient.warmup() to prime the HTTP/2 connection.
 */
export async function GET() {
  return NextResponse.json({ status: "ok", service: "vectorbea-hub" });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
