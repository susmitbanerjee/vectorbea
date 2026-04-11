import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type ApiKeyView, type CreateApiKeyResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.toString();
    const keys = await apiFetch<ApiKeyView[]>(`/api/keys${query ? `?${query}` : ""}`);
    return NextResponse.json(keys);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load API keys" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const payload = await request.json();
    const response = await apiFetch<CreateApiKeyResponse>("/api/keys", {
      method: "POST",
      body: JSON.stringify(payload),
      workspaceId,
    });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create API key" },
      { status: 500 },
    );
  }
}
