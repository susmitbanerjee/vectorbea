import { NextRequest, NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    await apiFetch(`/api/keys/${id}`, { method: "DELETE", workspaceId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to revoke API key" },
      { status: 500 },
    );
  }
}
