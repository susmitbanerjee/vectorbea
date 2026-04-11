import { NextRequest, NextResponse } from "next/server";

import { apiFetch, type OrganizationView } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const organizations = await apiFetch<OrganizationView[]>("/api/organizations");
    return NextResponse.json(organizations);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load organizations" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const organization = await apiFetch<OrganizationView>("/api/organizations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return NextResponse.json(organization, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create organization" },
      { status: 500 },
    );
  }
}
