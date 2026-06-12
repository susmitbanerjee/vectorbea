import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getWorkspaceMetrics } from "@/lib/server/metrics";
import type { TimeWindow } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const window = (request.nextUrl.searchParams.get("window") ?? "24h") as TimeWindow;
    const prompt = request.nextUrl.searchParams.get("prompt") ?? null;
    const environment = request.nextUrl.searchParams.get("environment") ?? null;
    if (!["1h", "24h", "7d"].includes(window)) {
      return NextResponse.json({ error: "window must be 1h, 24h, or 7d" }, { status: 400 });
    }
    return NextResponse.json(await getWorkspaceMetrics(workspaceId, window, prompt, environment));
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
