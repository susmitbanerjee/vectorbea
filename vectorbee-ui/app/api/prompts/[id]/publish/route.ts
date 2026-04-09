import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type PromptDetail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const prompt = await apiFetch<PromptDetail>(`/api/prompts/${id}/publish`, {
      method: "POST",
    });
    return NextResponse.json(prompt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to publish prompt" },
      { status: 500 },
    );
  }
}
