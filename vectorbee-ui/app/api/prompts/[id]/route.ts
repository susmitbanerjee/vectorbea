import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type PromptDetail } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const prompt = await apiFetch<PromptDetail>(`/api/prompts/${id}`);
    return NextResponse.json(prompt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load prompt" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = await request.json();
    const prompt = await apiFetch<PromptDetail>(`/api/prompts/${id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return NextResponse.json(prompt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update prompt" },
      { status: 500 },
    );
  }
}
