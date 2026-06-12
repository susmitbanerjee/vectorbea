import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      name?: string;
      organizationId?: string;
    };
    const name = payload.name?.trim();
    const organizationId = payload.organizationId?.trim();

    if (!name) {
      return NextResponse.json(
        { error: "Workspace name is required" },
        { status: 400 },
      );
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required" },
        { status: 400 },
      );
    }

    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("workspaces")
      .insert([{ name, organization_id: organizationId }])
      .select("id, organization_id, name, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        id: data.id,
        organizationId: data.organization_id,
        name: data.name,
        createdAt: data.created_at,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create workspace" },
      { status: 500 },
    );
  }
}
