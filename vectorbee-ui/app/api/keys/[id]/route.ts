import { NextRequest, NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await apiFetch(`/api/keys/${id}`, { method: "DELETE" });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to revoke API key" },
      { status: 500 },
    );
  }
}
