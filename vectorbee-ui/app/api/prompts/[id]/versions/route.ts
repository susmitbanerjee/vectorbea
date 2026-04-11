import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type PromptDetail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const versions = await apiFetch<PromptDetail[]>(`/api/prompts/${id}/versions`, {
      workspaceId,
    });
    return NextResponse.json(versions);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompt versions" },
      { status: 500 },
    );
  }
}
