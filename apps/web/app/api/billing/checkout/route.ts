import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getLemonSqueezyClient } from "@/lib/lemonsqueezy";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutRequest = {
  quantity?: number;
  workspaceId?: string;
};

export async function POST(request: NextRequest) {
  // ── 1. Parse body first so we have workspaceId for auth ──────────────────
  let payload: CheckoutRequest;
  try {
    payload = (await request.json()) as CheckoutRequest;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const quantity = Number(payload.quantity);
  const workspaceId = payload.workspaceId?.trim();

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  }

  if (!Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json(
      { error: "A valid seat quantity (≥ 1) is required." },
      { status: 400 },
    );
  }

  // ── 2. Authenticate — verify the caller is a member of the workspace ──────
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  // ── 3. Authorise — only workspace admins may initiate a checkout ──────────
  const supabase = createVectorBeaAdminClient();
  const { data: membership, error: roleError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", authResult.user.id)
    .maybeSingle();

  if (roleError) {
    console.error("[checkout] role lookup failed:", roleError.message);
    return NextResponse.json({ error: "Failed to verify workspace role." }, { status: 500 });
  }

  if (membership?.role !== "admin") {
    return NextResponse.json(
      { error: "Only workspace admins can initiate a billing checkout." },
      { status: 403 },
    );
  }

  // ── 4. Create the Lemon Squeezy checkout ──────────────────────────────────
  try {
    const { createCheckout, storeId, variantId } = getLemonSqueezyClient();

    const response = await createCheckout(storeId, variantId, {
      checkoutData: {
        // workspaceId in custom_data is the CRITICAL metadata the billing
        // webhook uses to route subscription events back to the right org.
        custom: {
          workspaceId,
        },
        variantQuantities: [
          {
            variantId,
            quantity,
          },
        ],
      },
      productOptions: {
        redirectUrl: `${request.nextUrl.origin}/settings/billing?checkout=success`,
      },
    });

    if (response.error || !response.data) {
      throw response.error ?? new Error("Lemon Squeezy returned an empty response.");
    }

    return NextResponse.json({
      url: response.data.data.attributes.url,
    });
  } catch (error) {
    console.error("[checkout] Lemon Squeezy error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create checkout session.",
      },
      { status: 500 },
    );
  }
}
