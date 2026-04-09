import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type PromptDetail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const versions = await apiFetch<PromptDetail[]>(`/api/prompts/${id}/versions`);
    return NextResponse.json(versions);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompt versions" },
      { status: 500 },
    );
  }
}
